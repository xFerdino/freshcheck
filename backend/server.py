import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from llm_gateway import EXTRACT_MODEL, VERDICT_MODEL, ROUTE, GatewayError, chat_json  # noqa: E402

TAVILY_URL = "https://api.tavily.com/search"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("freshcheck")

app = FastAPI()
api_router = APIRouter(prefix="/api")


class CheckRequest(BaseModel):
    answer: str = Field(min_length=10, max_length=8000)
    generated_date: Optional[str] = None


class RewriteClaim(BaseModel):
    claim: str
    quote: Optional[str] = ""
    verdict: str
    updated_fact: Optional[str] = None
    sources: List[dict] = []


class RewriteRequest(BaseModel):
    answer: str = Field(min_length=10, max_length=8000)
    claims: List[RewriteClaim]


EXTRACT_SYSTEM = """You extract atomic, independently checkable factual claims from an AI-generated answer.
Focus on time-sensitive facts: prices, software/product versions, release dates, people in roles, statistics, rules/laws/policies.
Each claim must state ONE fact. Skip opinions and vague statements.
Return ONLY JSON: {"claims":[{"claim":"self-contained restatement","quote":"exact verbatim substring of the answer that expresses it (short, copied character-for-character)","category":"price|version|date|role|statistic|rule|other","search_query":"concise web search query to verify the current state of this fact"}]}
Return at most 12 claims."""

VERIFY_SYSTEM = """You verify whether a factual claim is still current, using ONLY the provided web evidence.
Rules:
- Never use sources other than the numbered evidence items. Never invent URLs.
- verdict "Current" if evidence confirms the claim is still true today.
- verdict "Outdated" if evidence shows the fact has changed (newer version, new price, different person in role, etc).
- verdict "Uncertain" if evidence is missing, conflicting or insufficient.
- Compare like-for-like: official/list prices from the vendor (same region, new not used/resale), official release channels for versions, official announcements for roles.
- freshness_score 0-100 measures how FRESH the claim is (not your confidence): 70-100 current, 0-30 outdated, 35-65 uncertain.
- updated_fact: the up-to-date fact in one sentence if Outdated, else null. State ONLY details explicitly present in the evidence; do not add versions, dates or numbers that the evidence does not contain.
- reason: one short line.
- source_ids: the evidence numbers you relied on, ordered so the most recent source that supports your verdict (and the updated_fact) comes FIRST; omit stale sources that only show the old fact.
Return ONLY JSON: {"verdict":"Current|Outdated|Uncertain","freshness_score":0,"updated_fact":null,"reason":"","source_ids":[1]}"""


async def tavily_search(client: httpx.AsyncClient, query: str, emit, ref: str) -> dict:
    start = time.perf_counter()
    log = {"kind": "search", "stage": "search", "ref": ref, "model": "tavily/advanced", "route": "tavily", "status": "ok"}
    try:
        resp = await client.post(
            TAVILY_URL,
            headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
            json={"query": query, "search_depth": "advanced", "include_answer": True, "max_results": 5},
            timeout=40,
        )
        resp.raise_for_status()
        data = resp.json()
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


async def verify_claim(client: httpx.AsyncClient, claim: dict, today: str, generated: Optional[str], emit) -> dict:
    try:
        data = await tavily_search(client, claim["search_query"] or claim["claim"], emit, claim["id"])
    except Exception as exc:
        logger.error("Tavily failed for %s: %s", claim["id"], exc)
        return uncertain(claim, "Web search failed, so this claim could not be verified.")
    results = [r for r in data.get("results", []) if r.get("url")]
    if not results:
        return uncertain(claim, "No web evidence was found for this claim.")
    evidence = "\n\n".join(
        f"[{i}] {r.get('title', '')} ({r.get('published_date') or 'date unknown'})\nURL: {r['url']}\n{(r.get('content') or '')[:1200]}"
        for i, r in enumerate(results, 1)
    )
    prompt = (
        f"Today's date: {today}\nAnswer generated on: {generated or 'unknown'}\n\nCLAIM: {claim['claim']}\n\n"
        f"Search summary: {data.get('answer') or 'none'}\n\nEVIDENCE:\n{evidence}"
    )
    try:
        v, log = await chat_json(VERDICT_MODEL, VERIFY_SYSTEM, prompt, "verdict", claim["id"])
        await emit(log)
    except GatewayError as exc:
        await emit(exc.log)
        logger.error("Verify LLM failed for %s: %s", claim["id"], exc)
        return uncertain(claim, "The verification model failed for this claim.")
    verdict = v.get("verdict") if v.get("verdict") in ("Current", "Outdated", "Uncertain") else "Uncertain"
    ids = [i for i in v.get("source_ids", []) if isinstance(i, int) and 1 <= i <= len(results)] or list(range(1, len(results) + 1))
    sources = [{"title": results[i - 1].get("title") or results[i - 1]["url"], "url": results[i - 1]["url"],
                "date": results[i - 1].get("published_date")} for i in ids]
    m = re.search(r"\d+", str(v.get("freshness_score", "50")))
    score = max(0, min(100, int(m.group(0)) if m else 50))
    if verdict == "Outdated":
        score = min(score, 30)
    elif verdict == "Uncertain":
        score = max(35, min(score, 65))
    else:
        score = max(score, 70)
    return {**claim, "verdict": verdict, "freshness_score": score,
            "updated_fact": v.get("updated_fact") if verdict == "Outdated" else None,
            "reason": v.get("reason") or "", "sources": sources}


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def run_check(req: CheckRequest):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    yield sse("meta", {"route": ROUTE, "extract_model": EXTRACT_MODEL, "verdict_model": VERDICT_MODEL})
    yield sse("status", {"stage": "extracting"})
    try:
        out, log = await chat_json(EXTRACT_MODEL, EXTRACT_SYSTEM,
                                   f"Answer generated on: {req.generated_date or 'unknown'}\n\nANSWER:\n{req.answer}", "extract")
        yield sse("llm_call", log)
    except GatewayError as exc:
        logger.error("Extraction failed: %s", exc)
        yield sse("llm_call", exc.log)
        yield sse("error", {"message": "Could not extract claims from the answer. Please try again."})
        return
    claims = []
    for i, c in enumerate(out.get("claims", [])[:12], 1):
        if not c.get("claim"):
            continue
        quote = c.get("quote") or ""
        claims.append({"id": f"c{i}", "claim": c["claim"], "quote": quote if quote and quote in req.answer else "",
                       "category": c.get("category", "other"), "search_query": c.get("search_query") or c["claim"]})
    yield sse("claims", {"claims": claims})
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
                    result = await verify_claim(client, claim, today, req.generated_date, emit)
                except Exception as exc:
                    logger.error("Verify crashed for %s: %s", claim["id"], exc)
                    result = uncertain(claim, "Verification failed for this claim.")
                await queue.put(("claim_result", result))

        tasks = [asyncio.create_task(worker(c)) for c in claims]
        results, remaining = [], len(claims)
        try:
            while remaining:
                event, data = await queue.get()
                if event == "claim_result":
                    results.append(data)
                    remaining -= 1
                yield sse(event, data)
        finally:
            for t in tasks:
                t.cancel()

    counts = {k: sum(1 for r in results if r["verdict"] == k) for k in ("Current", "Outdated", "Uncertain")}
    overall = round(sum(r["freshness_score"] for r in results) / len(results))
    yield sse("done", {"overall_score": overall, "counts": counts})


@api_router.get("/")
async def root():
    return {"message": "FreshCheck API"}


@api_router.get("/config")
async def config():
    return {"route": ROUTE, "extract_model": EXTRACT_MODEL, "verdict_model": VERDICT_MODEL}


REWRITE_SYSTEM = """You rewrite an AI-generated answer so every outdated fact is replaced with its up-to-date version.
Rules:
- Keep the original wording, tone and sentence structure; change only what the corrections require. Merge each updated fact inline so every sentence stays grammatical.
- Place the citation markers given for that correction right after the corrected clause, before the sentence's final punctuation, e.g. "costs $499 [1]." Use ONLY the given markers.
- Do not add new facts, sources or claims beyond the corrections.
Return ONLY JSON: {"rewritten":"..."}"""


@api_router.post("/rewrite")
async def rewrite(req: RewriteRequest):
    outdated = [c for c in req.claims if c.verdict == "Outdated" and c.updated_fact]
    if not outdated:
        return {"rewritten": req.answer, "sources": [], "changed": False, "log": None}
    sources, lines = [], []
    for i, c in enumerate(outdated, 1):
        marks = ""
        for s in c.sources[:2]:
            if s.get("url"):
                sources.append({"n": len(sources) + 1, "title": s.get("title") or s["url"], "url": s["url"]})
                marks += f"[{len(sources)}]"
        lines.append(f"Correction {i}: original \"{c.quote or c.claim}\" -> \"{c.updated_fact}\" cite {marks or '(no source)'}")
    prompt = f"ORIGINAL ANSWER:\n{req.answer}\n\nCORRECTIONS:\n" + "\n".join(lines)
    try:
        out, log = await chat_json(VERDICT_MODEL, REWRITE_SYSTEM, prompt, "rewrite")
    except GatewayError as exc:
        logger.error("Rewrite failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not rewrite the answer. Please try again.")
    return {"rewritten": out.get("rewritten") or req.answer, "sources": sources, "changed": True, "log": log}


@api_router.post("/check")
async def check(req: CheckRequest):
    if not os.environ.get('TAVILY_API_KEY'):
        raise HTTPException(status_code=503, detail="TAVILY_API_KEY is not configured")
    return StreamingResponse(run_check(req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
