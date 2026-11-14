import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from llm_gateway import EXTRACT_MODEL, VERDICT_MODEL, ROUTE, GatewayError, chat_json, get_route  # noqa: E402
from runtime import LRU, RateLimiter, TTLCache, client_ip, http_retryable, parse_date, with_retries  # noqa: E402

TAVILY_URL = "https://api.tavily.com/search"
MAX_CLAIMS = 12
MAX_FACT_CHARS = 300
RATE_LIMIT_PER_24H = int(os.environ.get("RATE_LIMIT_PER_24H") or os.environ.get("RATE_LIMIT_PER_10MIN") or 10)
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS") or (24 * 3600))  # 24 hours default
RATE_LIMIT_ALLOWLIST = set(filter(None, [
    ip.strip() for ip in os.environ.get("RATE_LIMIT_ALLOWLIST", "89.74.250.55").split(",")
]))
RUN_TIMEOUT = float(os.environ.get("RUN_TIMEOUT_SECONDS") or 120)
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS") or 2)
RESALE_DOMAINS = ("swappa.com", "ebay.", "backmarket.", "decluttr.", "gazelle.com", "mercari.com", "craigslist.org")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("freshcheck")
logger.info("FreshCheck config: route=%s extract_model=%s verdict_model=%s rate_limit=%s/24h allowlist=%s run_timeout=%ss",
            ROUTE, EXTRACT_MODEL, VERDICT_MODEL, RATE_LIMIT_PER_24H, list(RATE_LIMIT_ALLOWLIST), RUN_TIMEOUT)

runs = LRU(1000)
search_cache = TTLCache(24 * 3600, 2000)
check_limiter = RateLimiter(RATE_LIMIT_PER_24H, RATE_LIMIT_WINDOW)
rewrite_limiter = RateLimiter(RATE_LIMIT_PER_24H, RATE_LIMIT_WINDOW)

app = FastAPI()
api_router = APIRouter(prefix="/api")


def rate_limited(limiter: RateLimiter):
    def dep(request: Request):
        ip = client_ip(request, TRUSTED_PROXY_HOPS)
        if ip in RATE_LIMIT_ALLOWLIST or any(allow in ip for allow in RATE_LIMIT_ALLOWLIST):
            return
        retry = limiter.hit(ip)
        if retry:
            raise HTTPException(status_code=429, detail=f"Too many requests. Limit is {limiter.limit} requests per 24 hours. Try again in {retry} seconds.",
                                headers={"Retry-After": str(retry)})
    return dep


class CheckRequest(BaseModel):
    answer: str = Field(min_length=10, max_length=8000)
    generated_date: Optional[str] = None


class ClaimCheckRequest(BaseModel):
    run_id: Optional[str] = None
    claim: dict
    generated_date: Optional[str] = None
    search_query: Optional[str] = None


class RewriteRequest(BaseModel):
    run_id: str = Field(min_length=1, max_length=64)
    answer: str = Field(min_length=10, max_length=8000)
    accepted_claim_ids: Optional[List[str]] = None
    edited_facts: Optional[dict] = None


EXTRACT_SYSTEM = """You extract atomic, independently checkable factual claims from an AI-generated answer.
Focus on time-sensitive facts: prices, software/product versions, release dates, people in roles, statistics, rules/laws/policies.
Each claim must state ONE fact. Skip opinions and vague statements.
For every claim also give:
- region: the country/market the fact applies to (e.g. "US"), or "n/a"
- condition: "new", "used" or "n/a" (use "new" for list/retail prices unless the answer says used/refurbished)
- search_query: concise web search query to verify the CURRENT state of this fact; for prices include the words "official price" and the region.
Return ONLY JSON: {"claims":[{"claim":"self-contained restatement","quote":"exact verbatim substring of the answer that expresses it (short, copied character-for-character)","category":"price|version|date|role|statistic|rule|other","region":"US","condition":"new|used|n/a","search_query":"..."}]}
Return ALL checkable claims you find (up to 40), in the order they appear."""

VERIFY_SYSTEM = """You verify whether a factual claim is still current, using ONLY the provided web evidence.
Rules:
- Never use sources other than the numbered evidence items. Never invent URLs.
- verdict "Current" if evidence confirms the claim is still true today.
- verdict "Outdated" if evidence shows the fact has changed (newer version, new price, different person in role, etc).
- If the product/service/plan has been discontinued, verdict is "Outdated" and updated_fact starts with "Discontinued:".
- verdict "Uncertain" if evidence is missing, conflicting or insufficient.
- For software/product version claims: pick the newest STABLE, generally available version mentioned in the sources. Ignore alpha, beta, RC, preview, canary and nightly versions for "latest stable" claims. If sources disagree, trust the most recent dated official source (python.org, nextjs.org, react.dev, nodejs.org, vendor pricing page).
- Compare like-for-like: official/list prices from the vendor for the claim's region and condition, official release channels for versions, official announcements for roles.
- Resale or used-marketplace evidence (Swappa, eBay, Back Market, refurbished listings) can NEVER change a new/list-price verdict; if that is all you have, verdict is "Uncertain".
- freshness_score 0-100 measures how FRESH the claim is (not your confidence): 70-100 current, 0-30 outdated, 35-65 uncertain.
- updated_fact: if Outdated, restate the claim with the current fact as a plain, self-contained statement in one sentence (max 300 characters), e.g. "The PlayStation 5 Digital Edition costs $499 in the US." Keep the claim's original subject wording and region phrasing and change ONLY the outdated value. Do not copy product SKUs, listing titles or storage suffixes, and never name stores, sites or listings. Else null. State ONLY details explicitly present in the evidence; do not add versions, dates or numbers that the evidence does not contain.
- reason: one short line.
- source_ids: the evidence numbers you relied on, ordered so the most recent source that supports your verdict (and the updated_fact) comes FIRST; omit stale sources that only show the old fact. An "Outdated" verdict MUST cite at least one source.
Return ONLY JSON: {"verdict":"Current|Outdated|Uncertain","freshness_score":0,"updated_fact":null,"reason":"","source_ids":[1]}"""


def norm_query(query: str) -> str:
    return " ".join(query.lower().split())


def is_resale(url: str) -> bool:
    u = (url or "").lower()
    return any(d in u for d in RESALE_DOMAINS)


async def tavily_fetch(client: httpx.AsyncClient, query: str, time_range: Optional[str] = None) -> dict:
    async def once():
        payload = {"query": query, "search_depth": "advanced", "include_answer": True, "max_results": 5}
        if time_range:
            payload["time_range"] = time_range
        resp = await client.post(
            TAVILY_URL,
            headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
            json=payload,
            timeout=40,
        )
        resp.raise_for_status()
        return resp.json()
    return await with_retries(once, http_retryable)


async def tavily_search(client: httpx.AsyncClient, query: str, emit, ref: str, category: Optional[str] = None) -> dict:
    start = time.perf_counter()
    use_recent = category in ("version", "price")
    time_range = "year" if use_recent else None
    key = f"{norm_query(query)}:{time_range or 'std'}"
    log = {"kind": "search", "stage": "search", "ref": ref, "model": "tavily/advanced", "route": "tavily",
           "status": "ok", "cached": False}
    try:
        data = search_cache.get(key)
        if data is not None:
            log["cached"] = True
        else:
            try:
                data = await tavily_fetch(client, query, time_range=time_range)
            except TypeError:
                data = await tavily_fetch(client, query)
            # If recent search returned no results, fall back to standard query without time_range
            if use_recent and not data.get("results"):
                std_key = f"{norm_query(query)}:std"
                data = search_cache.get(std_key)
                if data is None:
                    try:
                        data = await tavily_fetch(client, query, time_range=None)
                    except TypeError:
                        data = await tavily_fetch(client, query)
                    search_cache.set(std_key, data)
                key = std_key
            search_cache.set(key, data)
        log["results"] = len(data.get("results", []))
        return data
    except Exception as exc:
        log.update(status="error", error=str(exc)[:200])
        raise
    finally:
        log["latency_ms"] = round((time.perf_counter() - start) * 1000)
        await emit(log)


def uncertain(claim: dict, reason: str) -> dict:
    return {**claim, "verdict": "Uncertain", "freshness_score": 50, "updated_fact": None, "reason": reason, "sources": []}


def clamp_score(verdict: str, raw) -> int:
    m = re.search(r"\d+", str(raw if raw is not None else "50"))
    score = max(0, min(100, int(m.group(0)) if m else 50))
    if verdict == "Outdated":
        return min(score, 30)
    if verdict == "Uncertain":
        return max(35, min(score, 65))
    return max(score, 70)


def valid_source_ids(raw_ids, n: int) -> List[int]:
    out = []
    for i in raw_ids if isinstance(raw_ids, list) else []:
        try:
            i = int(i)
        except (TypeError, ValueError):
            continue
        if 1 <= i <= n and i not in out:
            out.append(i)
    return out


def map_sources(results: list, ids: List[int]) -> List[dict]:
    return [{"title": results[i - 1].get("title") or results[i - 1]["url"], "url": results[i - 1]["url"],
             "date": results[i - 1].get("published_date")} for i in ids]


STALE_PHRASES = ("outdated", "no longer", "superseded", "latest is", "has been replaced")
CONFIRMING_PHRASES = (
    "is still", "remains", "confirmed", "still current", "still accurate",
    "is current", "is accurate", "is correct", "still valid", "still the latest"
)
INSUFFICIENT_PHRASES = (
    "insufficient", "cannot be confirmed", "not enough", "inconclusive",
    "unclear", "lacks evidence", "no evidence", "not confirmed"
)
RC_PATTERNS = re.compile(
    r"\b(rc\d*|release candidate|beta\d*|alpha\d*|preview|nightly)\b",
    re.IGNORECASE,
)
STABLE_PATTERNS = re.compile(
    r"\b(stable|general availability|ga|officially released|current release|current stable)\b",
    re.IGNORECASE,
)


def find_prerelease_version(updated_fact: Optional[str], results: list, ids: List[int]) -> Optional[str]:
    if not updated_fact:
        return None
    dotted = re.findall(r"\bv?(\d+(?:\.\d+)+)\b", updated_fact)
    integers = [n for n in re.findall(r"\bv?(\d+)\b", updated_fact) if not (len(n) == 4 and n.startswith(("19", "20")))]
    versions = dotted or integers
    if not versions:
        return None

    sources_to_check = [results[i - 1] for i in ids if 1 <= i <= len(results)] if ids else results
    if not sources_to_check:
        return None

    for v in versions:
        v_escaped = re.escape(v)
        found_mentions = False
        has_prerelease = False
        has_stable = False

        for s in sources_to_check:
            text = f"{s.get('title', '')} {s.get('content', '')}"
            for m in re.finditer(rf"(?:\b|\D){v_escaped}(?:\b|\D)", text, re.IGNORECASE):
                found_mentions = True
                start = max(0, m.start() - 60)
                end = min(len(text), m.end() + 60)
                window = text[start:end]
                if RC_PATTERNS.search(window):
                    has_prerelease = True
                if STABLE_PATTERNS.search(window):
                    has_stable = True

        if found_mentions and has_prerelease and not has_stable:
            return v
    return None


def is_real_fact_change(claim: dict, updated_fact: Optional[str]) -> bool:
    if not updated_fact or not updated_fact.strip():
        return False
    norm_u = re.sub(r"[^\w\s]", "", updated_fact).strip().lower()
    if not norm_u:
        return False
    norm_claim = re.sub(r"[^\w\s]", "", claim.get("claim", "")).strip().lower()
    norm_quote = re.sub(r"[^\w\s]", "", claim.get("quote", "")).strip().lower()
    return norm_u != norm_claim and norm_u != norm_quote


def finalize_verdict(claim: dict, v: dict, results: list) -> dict:
    verdict = v.get("verdict") if v.get("verdict") in ("Current", "Outdated", "Uncertain") else "Uncertain"
    reason = v.get("reason") or ""
    ids = valid_source_ids(v.get("source_ids"), len(results))
    raw_updated = (v.get("updated_fact") or "")[:MAX_FACT_CHARS].strip() or None

    r_lower = reason.lower()

    # Consistency guard:
    # 1) Current but reason/updated_fact clearly indicates stale
    if verdict == "Current":
        has_real_change = is_real_fact_change(claim, raw_updated)
        says_stale = any(phrase in r_lower for phrase in STALE_PHRASES) and not any(
            neg in r_lower for neg in ("not outdated", "isn't outdated", "not superseded")
        )
        if has_real_change or says_stale:
            if ids:
                verdict = "Outdated"
            else:
                verdict = "Uncertain"

    # 2) Inverse: Outdated with no updated_fact and reason that only confirms the claim
    elif verdict == "Outdated":
        only_confirms = (
            not raw_updated
            and any(phrase in r_lower for phrase in CONFIRMING_PHRASES)
            and not any(insuf in r_lower for insuf in INSUFFICIENT_PHRASES)
            and not any(stale in r_lower for stale in STALE_PHRASES)
        )
        if only_confirms:
            verdict = "Current"
            raw_updated = None

    if verdict == "Outdated" and not ids:
        verdict, reason = "Uncertain", "Flagged as outdated but no supporting evidence was cited, so it cannot be confirmed."

    # 3) Guard against RC / beta / alpha / preview versions in updated_fact
    if verdict == "Outdated" and raw_updated:
        prerelease_v = find_prerelease_version(raw_updated, results, ids)
        if prerelease_v:
            verdict = "Uncertain"
            reason = f"Version {prerelease_v} in sources is only a pre-release (RC/beta/alpha/preview), not confirmed as stable."
            raw_updated = None

    sources = map_sources(results, ids or list(range(1, len(results) + 1)))
    if claim.get("category") == "price" and claim.get("condition") != "used":
        official = [s for s in sources if not is_resale(s["url"])]
        if verdict == "Outdated" and not official:
            verdict, reason = "Uncertain", "Only resale/used-market prices were found, which cannot change a list price."
        if official:
            sources = official

    final_updated = raw_updated if verdict == "Outdated" else None
    return {
        **claim,
        "verdict": verdict,
        "freshness_score": clamp_score(verdict, v.get("freshness_score")),
        "updated_fact": final_updated,
        "reason": reason,
        "sources": sources,
    }


async def verify_claim(client: httpx.AsyncClient, claim: dict, today: str, generated: Optional[str], emit,
                       run_id: str = "-") -> dict:
    query = claim.get("search_query") or claim.get("claim", "")
    query = refine_search_query(claim.get("category", ""), query, claim.get("claim", ""))
    try:
        data = await tavily_search(
            client,
            query,
            emit,
            claim["id"],
            category=claim.get("category"),
        )
    except Exception as exc:
        logger.error("[run %s] Tavily failed for %s: %s", run_id, claim["id"], exc)
        return uncertain(claim, "Web search failed, so this claim could not be verified.")
    results = [r for r in data.get("results", []) if r.get("url")]
    if not results:
        return uncertain(claim, "No web evidence was found for this claim.")
    evidence = "\n\n".join(
        f"[{i}] {r.get('title', '')} ({r.get('published_date') or 'date unknown'})\nURL: {r['url']}\n{(r.get('content') or '')[:1200]}"
        for i, r in enumerate(results, 1)
    )
    prompt = (
        f"Today's date: {today}\nAnswer generated on: {generated or 'unknown'}\n\nCLAIM: {claim['claim']}\n"
        f"Category: {claim.get('category')} · Region: {claim.get('region') or 'n/a'} · Condition: {claim.get('condition') or 'n/a'}\n\n"
        f"Search summary: {data.get('answer') or 'none'}\n\nEVIDENCE:\n{evidence}"
    )
    try:
        v, log = await chat_json(VERDICT_MODEL, VERIFY_SYSTEM, prompt, "verdict", claim["id"])
        await emit(log)
    except GatewayError as exc:
        await emit(exc.log)
        logger.error("[run %s] Verify LLM failed for %s: %s", run_id, claim["id"], exc)
        return uncertain(claim, "The verification model failed for this claim.")
    return finalize_verdict(claim, v, results)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def find_quote(answer: str, quote: str) -> str:
    """Exact quote if present, else the original substring matching it case/whitespace-insensitively."""
    if not quote:
        return ""
    if quote in answer:
        return quote
    words = quote.split()
    if not words:
        return ""
    m = re.search(r"\s+".join(re.escape(w) for w in words), answer, re.IGNORECASE)
    return m.group(0) if m else ""


JUNK_VERSION_PATTERNS = [
    r"\bofficial price\b",
    r"\bofficial pricing\b",
    r"\bpricing\b",
    r"\bprice\b",
    r"\brelease dates\b",
    r"\brelease date\b",
    r"\blatest stable release\b",
    r"\blatest stable version\b",
    r"\blatest stable\b",
    r"\blatest version\b",
    r"\bcurrent version\b",
    r"\bnewest version\b",
    r"\bcurrent major version\b",
    r"\bnewest major release\b",
    r"\bmajor version\b",
    r"\bmajor release\b",
    r"\blatest\b",
    r"\bcurrent\b",
    r"\bnewest\b",
    r"\bstable\b",
    r"\bversion\b",
    r"\bversions\b",
    r"\breleases\b",
    r"\brelease\b",
    r"\breleased\b",
    r"\bmajor\b",
    r"\bactive\b",
    r"\bstatus\b",
    r"\bintroduced\b",
    r"\bthe app router\b",
    r"\bapp router\b",
]

STOPWORDS_PATTERN = re.compile(
    r"\b(the|is the|is|of|for|in|and|to|with|that|most|teams|should|use|as|by|a|an)\b",
    re.IGNORECASE,
)

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
]


def clean_subject_for_version(text: str) -> str:
    cleaned = text
    for pat in JUNK_VERSION_PATTERNS:
        cleaned = re.sub(pat, " ", cleaned, flags=re.IGNORECASE)

    for m in MONTH_NAMES:
        cleaned = re.sub(rf"\b{m}\b", " ", cleaned, flags=re.IGNORECASE)

    # Strip 4-digit years >= 1990
    cleaned = re.sub(r"\b(19\d\d|20\d\d)\b", " ", cleaned)

    # Strip version numbers: dotted (3.11.4, 3.11, v3.11) or 1-3 digit standalone (14, 18, 20, v14)
    cleaned = re.sub(r"\bv?\d+(?:\.\d+)+\b", " ", cleaned)
    cleaned = re.sub(r"\bv?\d{1,3}\b", " ", cleaned)

    # Strip stopwords
    cleaned = STOPWORDS_PATTERN.sub(" ", cleaned)

    # Deduplicate repeated words (e.g. "React React" -> "React")
    tokens = []
    for t in cleaned.split():
        if not tokens or t.lower() != tokens[-1].lower():
            tokens.append(t)
    cleaned = " ".join(tokens)

    # Clean whitespace and stray punctuation
    cleaned = re.sub(r"^[^\w]+|[^\w]+$", "", cleaned).strip()
    return cleaned


def refine_search_query(category: str, raw_query: str, claim_text: str = "", now: Optional[datetime] = None) -> str:
    if now is None:
        now = datetime.now(timezone.utc)
    month_year = now.strftime("%B %Y")

    if category == "version":
        subject = clean_subject_for_version(raw_query or "")
        if not subject and claim_text:
            subject = clean_subject_for_version(claim_text)
        if not subject:
            subject = (raw_query or claim_text).strip()
        return f"latest stable {subject} release {month_year}"

    if category == "price":
        q = (raw_query or claim_text).strip()
        # Strip old price numbers like $20, $499, 20 USD, etc.
        q = re.sub(r"\$\s*\d+(?:\.\d+)?", " ", q)
        q = re.sub(r"\b\d+\s*(?:usd|dollars|eur|euro|gbp)\b", " ", q, flags=re.IGNORECASE)
        q = " ".join(q.split())
        if "official price" not in q.lower():
            if re.search(r"\bprice\b", q, flags=re.IGNORECASE):
                q = re.sub(r"\bprice\b", "official price", q, count=1, flags=re.IGNORECASE)
            else:
                q = f"{q} official price"
        if str(now.year) not in q:
            q = f"{q} {month_year}"
        return q

    return raw_query or claim_text


def build_claims(raw: list, answer: str, now: Optional[datetime] = None) -> List[dict]:
    claims = []
    for i, c in enumerate(raw[:MAX_CLAIMS], 1):
        quote = find_quote(answer, (c.get("quote") or "").strip())
        category = c.get("category", "other")
        raw_query = c.get("search_query") or c.get("claim", "")
        query = refine_search_query(category, raw_query, c.get("claim", ""), now=now)
        condition = c.get("condition") if c.get("condition") in ("new", "used", "n/a") else "n/a"
        claims.append({"id": f"c{i}", "claim": c["claim"], "quote": quote,
                       "category": category, "region": c.get("region") or "n/a", "condition": condition,
                       "search_query": query})
    return claims


TIMEOUT_MSG = "The check took longer than {s} seconds and was stopped. Try a shorter answer."


async def run_check(req: CheckRequest, run_id: str):
    deadline = time.monotonic() + RUN_TIMEOUT
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    runs.set(run_id, {"answer": req.answer, "results": {}})
    logger.info("[run %s] started (%d chars)", run_id, len(req.answer))
    yield sse("meta", {"run_id": run_id, "route": get_route(), "extract_model": EXTRACT_MODEL, "verdict_model": VERDICT_MODEL})
    yield sse("status", {"stage": "extracting"})
    try:
        out, log = await asyncio.wait_for(
            chat_json(EXTRACT_MODEL, EXTRACT_SYSTEM,
                      f"Answer generated on: {req.generated_date or 'unknown'}\n\nANSWER:\n{req.answer}", "extract"),
            timeout=RUN_TIMEOUT)
        yield sse("llm_call", log)
    except asyncio.TimeoutError:
        logger.warning("[run %s] timed out during extraction", run_id)
        yield sse("error", {"message": TIMEOUT_MSG.format(s=int(RUN_TIMEOUT))})
        return
    except (asyncio.CancelledError, GeneratorExit):
        logger.info("[run %s] stopped early during extraction (client cancelled)", run_id)
        raise
    except GatewayError as exc:
        logger.error("[run %s] Extraction failed: %s", run_id, exc)
        yield sse("llm_call", exc.log)
        yield sse("error", {"message": "Could not extract claims from the answer. Please try again."})
        return
    raw = [c for c in out.get("claims", []) if isinstance(c, dict) and c.get("claim")]
    claims = build_claims(raw, req.answer)
    yield sse("claims", {"claims": claims, "truncated": len(raw) > MAX_CLAIMS, "total_found": len(raw)})
    if not claims:
        yield sse("done", {"overall_score": None, "counts": {"Current": 0, "Outdated": 0, "Uncertain": 0}})
        return

    queue: asyncio.Queue = asyncio.Queue()
    sem = asyncio.Semaphore(4)

    async with httpx.AsyncClient() as client:
        async def emit(log):
            await queue.put(("llm_call", log))

        async def worker(claim):
            async with sem:
                await queue.put(("claim_start", {"id": claim["id"]}))
                try:
                    result = await verify_claim(client, claim, today, req.generated_date, emit, run_id)
                except Exception as exc:
                    logger.error("[run %s] Verify crashed for %s: %s", run_id, claim["id"], exc)
                    result = uncertain(claim, "Verification failed for this claim.")
                await queue.put(("claim_result", result))

        tasks = [asyncio.create_task(worker(c)) for c in claims]
        results, remaining = [], len(claims)
        try:
            while remaining:
                event, data = await asyncio.wait_for(queue.get(), timeout=max(0.01, deadline - time.monotonic()))
                if event == "claim_result":
                    results.append(data)
                    runs.get(run_id)["results"][data["id"]] = data
                    remaining -= 1
                yield sse(event, data)
        except asyncio.TimeoutError:
            logger.warning("[run %s] timed out after %ss with %d/%d claims done", run_id, RUN_TIMEOUT, len(results), len(claims))
            yield sse("error", {"message": TIMEOUT_MSG.format(s=int(RUN_TIMEOUT))})
            return
        finally:
            if remaining and any(not t.done() for t in tasks):
                logger.info("[run %s] stopped early (client cancelled or timeout) with %d/%d claims done",
                            run_id, len(results), len(claims))
            for t in tasks:
                t.cancel()

    counts = {k: sum(1 for r in results if r["verdict"] == k) for k in ("Current", "Outdated", "Uncertain")}
    overall = round(sum(r["freshness_score"] for r in results) / len(results))
    logger.info("[run %s] done: score=%s counts=%s", run_id, overall, counts)
    yield sse("done", {"overall_score": overall, "counts": counts})


@api_router.get("/")
async def root():
    return {"message": "FreshCheck API"}


@api_router.get("/health")
async def health():
    keys = ("TAVILY_API_KEY", "EMERGENT_LLM_KEY", "BIFROST_BASE_URL", "BIFROST_API_KEY", "MONGO_URL")
    return {"status": "ok", "route": ROUTE, "env": {k: bool(os.environ.get(k)) for k in keys}}


@api_router.get("/config")
async def config():
    return {"route": ROUTE, "extract_model": EXTRACT_MODEL, "verdict_model": VERDICT_MODEL}


REWRITE_SYSTEM = """You rewrite an AI-generated answer so every outdated fact is replaced with its up-to-date version.
Rules:
- Keep the original wording, tone and sentence structure; change only what the corrections require. Merge each updated fact inline so every sentence stays grammatical.
- Place the citation markers given for that correction right after the corrected clause, before the sentence's final punctuation, e.g. "costs $499 [1]." Use ONLY the given markers.
- Do not add new facts, sources or claims beyond the corrections.
Return ONLY JSON: {"rewritten":"..."}"""


def pick_citations(sources: List[dict]) -> List[dict]:
    """Top supporting source, plus a second only if it is not older than the top one."""
    picked = [s for s in sources[:1] if s.get("url")]
    if picked and len(sources) > 1 and sources[1].get("url") and sources[1]["url"] != picked[0]["url"]:
        d1, d2 = parse_date(picked[0].get("date")), parse_date(sources[1].get("date"))
        if d2 is None or d1 is None or d2 >= d1:
            picked.append(sources[1])
    return picked


@api_router.post("/rewrite", dependencies=[Depends(rate_limited(rewrite_limiter))])
async def rewrite(req: RewriteRequest):
    run = runs.get(req.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Unknown or expired check run. Run the check again.")
    if req.answer != run["answer"]:
        raise HTTPException(status_code=409, detail="This answer does not match the checked run.")
    if req.edited_facts and isinstance(req.edited_facts, dict):
        for cid, fact in req.edited_facts.items():
            if cid in run["results"]:
                run["results"][cid]["updated_fact"] = str(fact)[:MAX_FACT_CHARS]
    results = sorted(run["results"].values(), key=lambda r: int(r["id"][1:]))
    outdated = [r for r in results if r["verdict"] == "Outdated" and r.get("updated_fact")]
    if req.accepted_claim_ids is not None:
        outdated = [r for r in outdated if r["id"] in req.accepted_claim_ids]
    outdated = outdated[:MAX_CLAIMS]
    if not outdated:
        return {"rewritten": run["answer"], "sources": [], "changed": False, "log": None}
    sources, lines = [], []
    for i, c in enumerate(outdated, 1):
        marks = ""
        for s in pick_citations(c["sources"]):
            sources.append({"n": len(sources) + 1, "title": s.get("title") or s["url"], "url": s["url"], "date": s.get("date")})
            marks += f"[{len(sources)}]"
        lines.append(f"Correction {i}: original \"{c['quote'] or c['claim']}\" -> \"{c['updated_fact'][:MAX_FACT_CHARS]}\" cite {marks or '(no source)'}")
    prompt = f"ORIGINAL ANSWER:\n{run['answer']}\n\nCORRECTIONS:\n" + "\n".join(lines)
    try:
        out, log = await chat_json(VERDICT_MODEL, REWRITE_SYSTEM, prompt, "rewrite", req.run_id)
    except GatewayError as exc:
        logger.error("[run %s] Rewrite failed: %s", req.run_id, exc)
        raise HTTPException(status_code=502, detail="Could not rewrite the answer. Please try again.")
    return {"rewritten": out.get("rewritten") or run["answer"], "sources": sources, "changed": True, "log": log}


@api_router.post("/check/claim", dependencies=[Depends(rate_limited(check_limiter))])
async def check_claim(req: ClaimCheckRequest):
    if not os.environ.get('TAVILY_API_KEY'):
        raise HTTPException(status_code=503, detail="TAVILY_API_KEY is not configured")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    claim_data = dict(req.claim)
    if req.search_query:
        claim_data["search_query"] = req.search_query.strip()
    logs = []

    async def emit(log):
        logs.append(log)

    async with httpx.AsyncClient() as client:
        result = await verify_claim(client, claim_data, today, req.generated_date, emit, req.run_id or "-")
    if req.run_id and runs.get(req.run_id):
        runs.get(req.run_id)["results"][result["id"]] = result
    return {"result": result, "logs": logs}


@api_router.post("/check", dependencies=[Depends(rate_limited(check_limiter))])
async def check(req: CheckRequest, stream: bool = Query(True)):
    if not os.environ.get('TAVILY_API_KEY'):
        raise HTTPException(status_code=503, detail="TAVILY_API_KEY is not configured")
    run_id = uuid.uuid4().hex[:12]
    if stream:
        return StreamingResponse(run_check(req, run_id), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Non-streaming JSON mode (API-1)
    results = []
    logs = []
    meta = None
    summary = None
    error_msg = None

    async for chunk in run_check(req, run_id):
        lines = dict(line.split(": ", 1) for line in chunk.strip().splitlines() if ": " in line)
        event = lines.get("event")
        if not event:
            continue
        data = json.loads(lines.get("data", "{}"))
        if event == "meta":
            meta = data
        elif event == "llm_call":
            logs.append(data)
        elif event == "claim_result":
            results.append(data)
        elif event == "done":
            summary = data
        elif event == "error":
            error_msg = data.get("message", "Check failed")

    if error_msg and not summary:
        status = 504 if "longer than" in error_msg else 502
        raise HTTPException(status_code=status, detail=error_msg)

    sorted_claims = sorted(results, key=lambda r: int(r["id"][1:]) if r.get("id", "").startswith("c") and r["id"][1:].isdigit() else r.get("id", ""))
    return {
        "run_id": run_id,
        "claims": sorted_claims,
        "summary": summary or {"overall_score": None, "counts": {"Current": 0, "Outdated": 0, "Uncertain": 0}},
        "logs": logs,
        "meta": meta or {"run_id": run_id, "route": get_route(), "extract_model": EXTRACT_MODEL, "verdict_model": VERDICT_MODEL},
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
