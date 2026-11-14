"""Offline unit tests: fake LLM + mocked Tavily, no network."""
import asyncio
from datetime import datetime, timezone
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("TAVILY_API_KEY", "test-key")

import server  # noqa: E402
from llm_gateway import parse_json  # noqa: E402
from runtime import RateLimiter, TTLCache, client_ip, parse_date, with_retries  # noqa: E402

RESULTS = [
    {"title": "Official store", "url": "https://store.example.com/p", "published_date": "2026-03-01", "content": "Now $499"},
    {"title": "Old blog", "url": "https://blog.example.com/old", "published_date": "2023-01-01", "content": "Was $399"},
    {"title": "Swappa listing", "url": "https://swappa.com/listing/1", "published_date": "2026-04-01", "content": "$250 used"},
]


def claim(**kw):
    return {"id": "c1", "claim": "X costs $399", "quote": "costs $399", "category": "other", "region": "US",
            "condition": "n/a", "search_query": "x price", **kw}


# ---- score clamp ----
@pytest.mark.parametrize("verdict,raw,expected", [
    ("Outdated", 90, 30), ("Outdated", 10, 10), ("Outdated", None, 30),
    ("Uncertain", 5, 35), ("Uncertain", 95, 65), ("Uncertain", "50", 50),
    ("Current", 20, 70), ("Current", "85%", 85), ("Current", 150, 100),
])
def test_clamp_score(verdict, raw, expected):
    assert server.clamp_score(verdict, raw) == expected


# ---- source id mapping ----
def test_valid_source_ids_filters_and_dedupes():
    assert server.valid_source_ids([2, "1", 9, 2, "x", 0, None], 3) == [2, 1]
    assert server.valid_source_ids("1,2", 3) == []


def test_map_sources_uses_real_urls_only():
    out = server.map_sources(RESULTS, [2, 1])
    assert [s["url"] for s in out] == [RESULTS[1]["url"], RESULTS[0]["url"]]
    assert out[0] == {"title": "Old blog", "url": RESULTS[1]["url"], "date": "2023-01-01"}


# ---- BUG-2 downgrade ----
def test_outdated_without_valid_sources_downgrades_to_uncertain():
    r = server.finalize_verdict(claim(), {"verdict": "Outdated", "freshness_score": 5, "updated_fact": "X costs $499",
                                          "reason": "changed", "source_ids": [7, "nope"]}, RESULTS)
    assert r["verdict"] == "Uncertain" and r["updated_fact"] is None and 35 <= r["freshness_score"] <= 65


def test_outdated_with_sources_keeps_fact_truncated():
    r = server.finalize_verdict(claim(), {"verdict": "Outdated", "freshness_score": 80, "updated_fact": "y" * 500,
                                          "reason": "r", "source_ids": [1]}, RESULTS)
    assert r["verdict"] == "Outdated" and r["freshness_score"] == 30 and len(r["updated_fact"]) == 300
    assert r["sources"][0]["url"] == RESULTS[0]["url"]


def test_current_with_no_ids_falls_back_to_all_results():
    r = server.finalize_verdict(claim(), {"verdict": "Current", "freshness_score": 90, "source_ids": []}, RESULTS)
    assert r["verdict"] == "Current" and len(r["sources"]) == 3 and r["updated_fact"] is None


# ---- VERDICT-1 consistency guard ----
@pytest.mark.parametrize("stale_reason", [
    "Python 3.11 is outdated; the latest version is Python 3.13",
    "Python 3.11 is no longer supported as the primary release",
    "Python 3.11 has been superseded by newer releases",
    "The latest is Python 3.13, not 3.11",
    "Python 3.11 has been replaced by Python 3.12 and 3.13",
])
def test_finalize_verdict_flips_current_to_outdated(stale_reason):
    c = claim(claim="Python 3.11 is the latest stable release", quote="3.11 is the latest")
    v = {
        "verdict": "Current",
        "freshness_score": 85,
        "updated_fact": "Python 3.13 is the latest stable release",
        "reason": stale_reason,
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, RESULTS)
    assert r["verdict"] == "Outdated"
    assert r["freshness_score"] <= 30
    assert r["updated_fact"] == "Python 3.13 is the latest stable release"
    assert len(r["sources"]) == 1


def test_finalize_verdict_flips_current_to_uncertain_when_no_valid_sources():
    c = claim(claim="Python 3.11 is the latest stable release", quote="3.11 is the latest")
    v = {
        "verdict": "Current",
        "freshness_score": 85,
        "updated_fact": "Python 3.13 is the latest stable release",
        "reason": "Python 3.11 is outdated and superseded",
        "source_ids": [],
    }
    r = server.finalize_verdict(c, v, RESULTS)
    assert r["verdict"] == "Uncertain"
    assert 35 <= r["freshness_score"] <= 65
    assert r["updated_fact"] is None


@pytest.mark.parametrize("confirming_reason", [
    "The claim is confirmed and remains accurate based on official docs",
    "This version is still current and supported",
    "The release date remains valid and is correct",
])
def test_finalize_verdict_inverse_flips_outdated_to_current(confirming_reason):
    c = claim(claim="Python 3.11 was released in October 2022", quote="released in October 2022")
    v = {
        "verdict": "Outdated",
        "freshness_score": 15,
        "updated_fact": None,
        "reason": confirming_reason,
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, RESULTS)
    assert r["verdict"] == "Current"
    assert r["freshness_score"] >= 70
    assert r["updated_fact"] is None


def test_finalize_verdict_inverse_does_not_flip_if_updated_fact_present():
    c = claim(claim="Python 3.11 was released in October 2022")
    v = {
        "verdict": "Outdated",
        "freshness_score": 15,
        "updated_fact": "Python 3.12 was released later",
        "reason": "The claim is confirmed, but newer version exists",
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, RESULTS)
    assert r["verdict"] == "Outdated"
    assert r["freshness_score"] <= 30
    assert r["updated_fact"] == "Python 3.12 was released later"


def test_finalize_verdict_no_flip_on_insufficient_evidence():
    phrase = "Current evidence is insufficient to verify the claim"
    c = claim(claim="Foo costs $10")
    v_outdated = {
        "verdict": "Outdated",
        "freshness_score": 20,
        "updated_fact": None,
        "reason": phrase,
        "source_ids": [1],
    }
    r1 = server.finalize_verdict(c, v_outdated, RESULTS)
    assert r1["verdict"] == "Outdated"
    assert r1["freshness_score"] <= 30

    v_current = {
        "verdict": "Current",
        "freshness_score": 80,
        "updated_fact": None,
        "reason": phrase,
        "source_ids": [1],
    }
    r2 = server.finalize_verdict(c, v_current, RESULTS)
    assert r2["verdict"] == "Current"
    assert r2["freshness_score"] >= 70


def test_finalize_verdict_negative_context_does_not_flip_current():
    c = claim(claim="Python 3.11 is supported")
    v = {
        "verdict": "Current",
        "freshness_score": 85,
        "updated_fact": None,
        "reason": "Python 3.11 is not outdated and is still receiving security updates",
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, RESULTS)
    assert r["verdict"] == "Current"
    assert r["freshness_score"] >= 70


# ---- BUG-3 resale evidence ----
def test_resale_only_cannot_make_list_price_outdated():
    r = server.finalize_verdict(claim(category="price", condition="new"),
                                {"verdict": "Outdated", "freshness_score": 10, "updated_fact": "$250", "source_ids": [3]}, RESULTS)
    assert r["verdict"] == "Uncertain" and r["updated_fact"] is None


def test_resale_sources_dropped_when_official_exists():
    r = server.finalize_verdict(claim(category="price", condition="new"),
                                {"verdict": "Outdated", "freshness_score": 10, "updated_fact": "$499", "source_ids": [3, 1]}, RESULTS)
    assert r["verdict"] == "Outdated" and [s["url"] for s in r["sources"]] == [RESULTS[0]["url"]]


def test_find_quote_fuzzy_fallback():
    ans = "The  PlayStation 5 Digital Edition is priced at $399 in the US."
    assert server.find_quote(ans, "is priced at $399") == "is priced at $399"
    assert server.find_quote(ans, "the playstation 5 digital edition") == "The  PlayStation 5 Digital Edition"
    assert server.find_quote(ans, "costs $999") == "" and server.find_quote(ans, "") == ""


def test_price_query_gets_official_price():
    claims = server.build_claims([{"claim": "A costs $1", "quote": "A", "category": "price", "search_query": "A price US"}], "A costs $1")
    assert "official price" in claims[0]["search_query"] and claims[0]["condition"] == "n/a"
    assert datetime.now(timezone.utc).strftime("%B %Y") in claims[0]["search_query"]


# ---- BUG-2 rewrite citations ----
def test_pick_citations_skips_older_second_source():
    top = {"url": "https://a", "date": "2026-03-01"}
    assert server.pick_citations([top, {"url": "https://b", "date": "2023-01-01"}]) == [top]
    assert len(server.pick_citations([top, {"url": "https://b", "date": "2026-05-01"}])) == 2
    assert len(server.pick_citations([top, {"url": "https://b", "date": None}])) == 2
    assert len(server.pick_citations([top, {"url": "https://b", "date": "Mon, 02 Mar 2026 10:00:00 GMT"}])) == 2
    assert server.pick_citations([]) == []


def test_parse_date_formats():
    assert parse_date("2026-03-01").year == 2026
    assert parse_date("Mon, 02 Mar 2026 10:00:00 GMT").month == 3
    assert parse_date("garbage") is None and parse_date(None) is None


# ---- parse_json ----
def test_parse_json_variants():
    assert parse_json('{"a": 1}') == {"a": 1}
    assert parse_json('```json\n{"a": {"b": 2}}\n```') == {"a": {"b": 2}}
    assert parse_json('Sure! {"claims": []} done') == {"claims": []}
    with pytest.raises(json.JSONDecodeError):
        parse_json("no json here")


# ---- rate limiter / cache / retries ----
def test_rate_limiter_window():
    now = [0.0]
    rl = RateLimiter(3, 600, clock=lambda: now[0])
    assert [rl.hit("ip") for _ in range(3)] == [0, 0, 0]
    assert rl.hit("ip") == 600
    assert rl.hit("other") == 0
    now[0] = 599.5
    assert rl.hit("ip") == 1
    now[0] = 600.0
    assert rl.hit("ip") == 0


def test_client_ip_ignores_spoofed_xff():
    class R:
        def __init__(self, xff):
            self.headers = {"x-forwarded-for": xff} if xff else {}
            self.client = type("C", (), {"host": "10.0.0.1"})()
    assert client_ip(R("6.6.6.6, 1.2.3.4, 10.1.1.1, 10.2.2.2")) == "1.2.3.4"
    assert client_ip(R("1.2.3.4, 10.1.1.1, 10.2.2.2")) == "1.2.3.4"
    assert client_ip(R("1.2.3.4")) == "1.2.3.4"
    assert client_ip(R(None)) == "10.0.0.1"


def test_ttl_cache_expires():
    now = [0.0]
    c = TTLCache(10, 2, clock=lambda: now[0])
    c.set("a", 1)
    assert c.get("a") == 1
    now[0] = 11
    assert c.get("a") is None


def test_with_retries_retries_then_succeeds():
    calls = []

    async def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise TimeoutError()
        return "ok"
    assert asyncio.run(with_retries(flaky, lambda e: True, retries=2, base_delay=0)) == "ok" and len(calls) == 3


def test_with_retries_gives_up():
    async def bad():
        raise ValueError("x")
    with pytest.raises(ValueError):
        asyncio.run(with_retries(bad, lambda e: True, retries=2, base_delay=0))


# ---- SSE pipeline with fake LLM + mocked Tavily ----
ANSWER = "Product A costs $399. Tool B 1.0 is the latest version."


async def fake_chat_json(model, system, prompt, stage, ref=None):
    log = {"kind": "llm", "stage": stage, "ref": ref, "model": model, "route": "direct",
           "prompt_tokens": 1, "completion_tokens": 1, "status": "ok", "latency_ms": 1}
    if stage == "extract":
        return {"claims": [
            {"claim": "Product A costs $399", "quote": "Product A costs $399", "category": "price", "region": "US",
             "condition": "new", "search_query": "product a price"},
            {"claim": "Tool B 1.0 is the latest version", "quote": "Tool B 1.0", "category": "version",
             "search_query": "tool b latest version"},
        ]}, log
    if stage == "rewrite":
        return {"rewritten": "Product A costs $499 [1]. Tool B 1.0 is the latest version."}, log
    if "Product A" in prompt:
        return {"verdict": "Outdated", "freshness_score": 10, "updated_fact": "Product A costs $499",
                "reason": "price rose", "source_ids": [1]}, log
    return {"verdict": "Current", "freshness_score": 90, "reason": "ok", "source_ids": [1]}, log


def collect(req, run_id="t1"):
    async def go():
        return [chunk async for chunk in server.run_check(req, run_id)]
    events = []
    for chunk in asyncio.run(go()):
        lines = dict(line.split(": ", 1) for line in chunk.strip().splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


@pytest.fixture
def offline(monkeypatch):
    calls = []

    async def fake_fetch(client, query):
        calls.append(query)
        if "tool b" in query:
            return {"answer": None, "results": [{"title": "B releases", "url": "https://b.dev/releases",
                                                 "published_date": "2026-01-01", "content": "1.0 latest"}]}
        return {"answer": "A is $499", "results": RESULTS[:2]}
    monkeypatch.setattr(server, "chat_json", fake_chat_json)
    monkeypatch.setattr(server, "tavily_fetch", fake_fetch)
    server.search_cache.data.clear()
    server.check_limiter.hits.clear()
    server.rewrite_limiter.hits.clear()
    return calls


def test_sse_event_order(offline):
    events = collect(server.CheckRequest(answer=ANSWER))
    names = [e for e, _ in events]
    assert names[:4] == ["meta", "status", "llm_call", "claims"] and names[-1] == "done"
    assert events[0][1]["run_id"] == "t1"
    claims_evt = events[3][1]
    assert claims_evt["truncated"] is False and claims_evt["total_found"] == 2
    for cid in ("c1", "c2"):
        start = [i for i, (e, d) in enumerate(events) if e == "claim_start" and d["id"] == cid][0]
        result = [i for i, (e, d) in enumerate(events) if e == "claim_result" and d["id"] == cid][0]
        assert start < result
    results = {d["id"]: d for e, d in events if e == "claim_result"}
    assert results["c1"]["verdict"] == "Outdated" and results["c2"]["verdict"] == "Current"
    assert events[-1][1]["counts"] == {"Current": 1, "Outdated": 1, "Uncertain": 0}
    assert any(e == "llm_call" and d["kind"] == "search" for e, d in events)
    assert "official price" in offline[0]


def test_search_cache_marks_cached(offline):
    collect(server.CheckRequest(answer=ANSWER), "r1")
    events = collect(server.CheckRequest(answer=ANSWER), "r2")
    searches = [d for e, d in events if e == "llm_call" and d["kind"] == "search"]
    assert len(offline) == 2 and searches and all(s["cached"] for s in searches)


def test_truncation_flag(offline, monkeypatch):
    async def many(model, system, prompt, stage, ref=None):
        if stage == "extract":
            return {"claims": [{"claim": f"C{i}", "quote": "", "category": "other", "search_query": f"q{i}"} for i in range(15)]}, {"kind": "llm"}
        return await fake_chat_json(model, system, prompt, stage, ref)
    monkeypatch.setattr(server, "chat_json", many)
    events = collect(server.CheckRequest(answer=ANSWER))
    claims_evt = [d for e, d in events if e == "claims"][0]
    assert claims_evt["truncated"] is True and claims_evt["total_found"] == 15 and len(claims_evt["claims"]) == 12


def test_no_tavily_results_is_uncertain(offline, monkeypatch):
    async def empty(client, query):
        return {"results": []}
    monkeypatch.setattr(server, "tavily_fetch", empty)
    events = collect(server.CheckRequest(answer=ANSWER))
    for _, d in [x for x in events if x[0] == "claim_result"]:
        assert d["verdict"] == "Uncertain" and d["sources"] == []


def test_run_timeout_emits_error(offline, monkeypatch):
    async def slow(client, query):
        await asyncio.sleep(5)
    monkeypatch.setattr(server, "tavily_fetch", slow)
    monkeypatch.setattr(server, "RUN_TIMEOUT", 0.3)
    events = collect(server.CheckRequest(answer=ANSWER))
    assert events[-1][0] == "error" and "seconds" in events[-1][1]["message"]


# ---- /api/rewrite (SEC-5) and 429 ----
def test_rewrite_endpoint_uses_stored_run(offline):
    collect(server.CheckRequest(answer=ANSWER), "stored1")
    client = TestClient(server.app)
    assert client.post("/api/rewrite", json={"run_id": "missing", "answer": ANSWER}).status_code == 404
    assert client.post("/api/rewrite", json={"run_id": "stored1", "answer": ANSWER + " extra"}).status_code == 409
    r = client.post("/api/rewrite", json={"run_id": "stored1", "answer": ANSWER})
    body = r.json()
    assert r.status_code == 200 and body["changed"] is True
    assert [s["url"] for s in body["sources"]] == [RESULTS[0]["url"]]
    r2 = client.post("/api/rewrite", json={"run_id": "stored1", "answer": ANSWER, "accepted_claim_ids": ["c2"]})
    assert r2.json()["changed"] is False


def test_rewrite_with_edited_facts(offline):
    collect(server.CheckRequest(answer=ANSWER), "stored_edit")
    client = TestClient(server.app)
    r = client.post("/api/rewrite", json={
        "run_id": "stored_edit",
        "answer": ANSWER,
        "accepted_claim_ids": ["c1"],
        "edited_facts": {"c1": "Product A is priced at $550 officially"}
    })
    assert r.status_code == 200
    stored = server.runs.get("stored_edit")
    assert stored["results"]["c1"]["updated_fact"] == "Product A is priced at $550 officially"


def test_rewrite_rejects_client_supplied_claims(offline):
    client = TestClient(server.app)
    r = client.post("/api/rewrite", json={"answer": ANSWER, "claims": [{"claim": "x", "verdict": "Outdated"}]})
    assert r.status_code == 422


def test_rate_limit_returns_429_with_retry_after(offline, monkeypatch):
    monkeypatch.setattr(server.rewrite_limiter, "limit", 1)
    client = TestClient(server.app)
    assert client.post("/api/rewrite", json={"run_id": "nope", "answer": ANSWER}).status_code == 404
    r = client.post("/api/rewrite", json={"run_id": "nope", "answer": ANSWER})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_rate_limit_allowlist_bypasses_limit(offline, monkeypatch):
    monkeypatch.setattr(server.rewrite_limiter, "limit", 1)
    client = TestClient(server.app)
    headers = {"CF-Connecting-IP": "89.74.250.55"}
    for _ in range(5):
        r = client.post("/api/rewrite", json={"run_id": "nope", "answer": ANSWER}, headers=headers)
        assert r.status_code == 404  # Bypasses rate limit, returns 404 not 429


def test_health_reports_presence_only():
    body = TestClient(server.app).get("/api/health").json()
    assert body["status"] == "ok" and all(isinstance(v, bool) for v in body["env"].values())


# ---- Bifrost routing tests ----
def test_bifrost_route_detection(monkeypatch):
    monkeypatch.delenv("BIFROST_BASE_URL", raising=False)
    assert server.get_route() == "direct"
    monkeypatch.setenv("BIFROST_BASE_URL", "http://localhost:8080")
    assert server.get_route() == "bifrost"


def test_chat_json_routes_via_bifrost(monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setenv("BIFROST_BASE_URL", "http://localhost:8080")
    monkeypatch.setenv("BIFROST_API_KEY", "bifrost-secret")

    fake_bifrost_call = AsyncMock(return_value=('{"result": "ok"}', 10, 20))
    monkeypatch.setattr("llm_gateway._call_bifrost", fake_bifrost_call)

    from llm_gateway import chat_json
    data, log = asyncio.run(chat_json("gpt-4o-mini", "system", "prompt", "test_stage", "c1"))
    assert data == {"result": "ok"}
    assert log["route"] == "bifrost"
    assert log["stage"] == "test_stage"
    assert log["ref"] == "c1"
    assert log["prompt_tokens"] == 10
    assert log["completion_tokens"] == 20
    assert fake_bifrost_call.called


def test_meta_event_emits_bifrost_route(offline, monkeypatch):
    monkeypatch.setenv("BIFROST_BASE_URL", "http://localhost:8080")
    events = collect(server.CheckRequest(answer=ANSWER))
    meta_event = [d for e, d in events if e == "meta"][0]
    assert meta_event["route"] == "bifrost"


def test_recheck_single_claim_endpoint(offline):
    collect(server.CheckRequest(answer=ANSWER), "run_recheck")
    client = TestClient(server.app)
    payload = {
        "run_id": "run_recheck",
        "claim": {"id": "c1", "claim": "Product A costs $399", "quote": "costs $399", "category": "price",
                  "search_query": "product a price"},
        "search_query": "product a official price 2026",
    }
    r = client.post("/api/check/claim", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "result" in data and "logs" in data
    assert data["result"]["id"] == "c1"
    assert data["result"]["verdict"] in ("Current", "Outdated", "Uncertain")
    stored = server.runs.get("run_recheck")
    assert stored["results"]["c1"]["id"] == "c1"


def test_check_json_mode_non_streaming(offline):
    client = TestClient(server.app)
    r = client.post("/api/check?stream=false", json={"answer": ANSWER})
    assert r.status_code == 200
    data = r.json()
    assert "run_id" in data
    assert "claims" in data and isinstance(data["claims"], list)
    assert len(data["claims"]) == 2
    assert "summary" in data and "overall_score" in data["summary"]
    assert "counts" in data["summary"]
    assert "logs" in data and isinstance(data["logs"], list)
    assert "meta" in data and "route" in data["meta"]
    # Check that the run is stored server-side for subsequent rewrites
    stored = server.runs.get(data["run_id"])
    assert stored is not None
    assert stored["answer"] == ANSWER


def test_verdict_structured_output_attempts_schema_first(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    import llm_gateway

    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock(message=MagicMock(content='{"verdict": "Outdated", "freshness_score": 20, "updated_fact": "foo", "reason": "bar", "source_ids": [1]}'))]
    mock_resp.usage = MagicMock(prompt_tokens=15, completion_tokens=25)
    mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)

    monkeypatch.setattr(llm_gateway, "_bifrost_client", lambda: mock_client)

    content, p_tok, c_tok = asyncio.run(llm_gateway._call_bifrost("test-model", "sys", "prompt", stage="verdict"))
    assert json.loads(content)["verdict"] == "Outdated"
    assert mock_client.chat.completions.create.call_args.kwargs["response_format"] == llm_gateway.VERDICT_SCHEMA


def test_verdict_structured_output_falls_back_when_rejected(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    import llm_gateway

    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock(message=MagicMock(content='{"verdict": "Current", "freshness_score": 80, "updated_fact": null, "reason": "ok", "source_ids": [1]}'))]
    mock_resp.usage = MagicMock(prompt_tokens=10, completion_tokens=10)

    # First call with schema raises, second call succeeds
    mock_client.chat.completions.create = AsyncMock(side_effect=[
        Exception("Provider does not support json_schema"),
        mock_resp,
    ])

    monkeypatch.setattr(llm_gateway, "_bifrost_client", lambda: mock_client)

    content, p_tok, c_tok = asyncio.run(llm_gateway._call_bifrost("test-model", "sys", "prompt", stage="verdict"))
    assert json.loads(content)["verdict"] == "Current"
    assert mock_client.chat.completions.create.call_count == 2


# ---- FRESH-1: search query refinement and RC guard ----
def test_refine_search_query_version_strips_old_version_and_adds_month_year():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    cases = [
        ("Python 3.11 release date", "Python 3.11 is the latest version", "latest stable Python release November 2026"),
        ("Python 3.11 official price", "Python 3.11 is latest", "latest stable Python release November 2026"),
        ("Next.js 14", "Next.js 14 is current", "latest stable Next.js release November 2026"),
        ("React 18 official price", "React 18 is latest", "latest stable React release November 2026"),
        ("Node.js 20 LTS release", "Node 20 LTS is active", "latest stable Node.js LTS release November 2026"),
        ("v1.28.0 release", "Kubernetes 1.28", "latest stable Kubernetes release November 2026"),
    ]
    for raw_q, claim_txt, expected in cases:
        out = server.refine_search_query("version", raw_q, claim_txt, now=now)
        assert out == expected


def test_refine_search_query_price_adds_official_price_and_year():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    cases = [
        ("ChatGPT Plus price", "ChatGPT Plus is $20", "ChatGPT Plus official price November 2026"),
        ("ChatGPT Plus $20 official price", "ChatGPT Plus costs $20", "ChatGPT Plus official price November 2026"),
        ("PlayStation 5 $499 US", "PS5 costs $499", "PlayStation 5 US official price November 2026"),
    ]
    for raw_q, claim_txt, expected in cases:
        out = server.refine_search_query("price", raw_q, claim_txt, now=now)
        assert out == expected


def test_refine_search_query_preserves_other_categories():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    assert server.refine_search_query("role", "who is CEO of Twitter", now=now) == "who is CEO of Twitter"
    assert server.refine_search_query("date", "when was Python created", now=now) == "when was Python created"


def test_finalize_verdict_rc_guard_flips_to_uncertain():
    results = [
        {
            "title": "Python 3.15 Gets a Surprise RC3 and Other Python News for October 2026",
            "url": "https://realpython.com/rc3",
            "published_date": "2026-10-15",
            "content": "Python 3.15 is currently in release candidate status (RC3) and not yet generally available. Python 3.14 is the latest stable version.",
        }
    ]
    c = claim(claim="Python 3.11 is the latest stable release", category="version")
    v = {
        "verdict": "Outdated",
        "freshness_score": 10,
        "updated_fact": "Python 3.15 is the latest stable release",
        "reason": "Python 3.15 has been released",
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, results)
    assert r["verdict"] == "Uncertain"
    assert 35 <= r["freshness_score"] <= 65
    assert r["updated_fact"] is None
    assert "pre-release" in r["reason"] or "RC" in r["reason"]


def test_finalize_verdict_rc_guard_preserves_stable_version():
    results = [
        {
            "title": "Python 3.14 Released as Latest Stable Version",
            "url": "https://python.org/release-3-14",
            "published_date": "2026-10-01",
            "content": "Python 3.14 is the latest stable release of Python.",
        }
    ]
    c = claim(claim="Python 3.11 is the latest stable release", category="version")
    v = {
        "verdict": "Outdated",
        "freshness_score": 10,
        "updated_fact": "Python 3.14 is the latest stable release",
        "reason": "Python 3.14 is the new stable release",
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, results)
    assert r["verdict"] == "Outdated"
    assert r["freshness_score"] <= 30
    assert r["updated_fact"] == "Python 3.14 is the latest stable release"


def test_finalize_verdict_rc_guard_catches_beta_and_preview():
    results = [
        {
            "title": "Next.js 16 Preview Available",
            "url": "https://nextjs.org/blog/preview",
            "published_date": "2026-05-01",
            "content": "Next.js 16 is now available in beta preview.",
        }
    ]
    c = claim(claim="Next.js 14 is current", category="version")
    v = {
        "verdict": "Outdated",
        "freshness_score": 15,
        "updated_fact": "Next.js 16 is current",
        "reason": "Next.js 16 is out",
        "source_ids": [1],
    }
    r = server.finalize_verdict(c, v, results)
    assert r["verdict"] == "Uncertain"
    assert r["updated_fact"] is None


def test_is_mostly_english_accepts_english_pages():
    eng_source = {
        "title": "Next.js 15 is now generally available",
        "url": "https://nextjs.org/blog/next-15",
        "content": "Today we are excited to introduce Next.js 15 with React 19 support and performance improvements.",
    }
    assert server.is_mostly_english(eng_source) is True


def test_is_mostly_english_rejects_german_pages():
    german_source = {
        "title": "Next.js 14 veröffentlicht: Das sind die Neuerungen",
        "url": "https://heise.de/news/Next-js-14-veroeffentlicht-934567.html",
        "content": "Vercel hat die neue Version des Frameworks freigegeben. Zu den wichtigsten Änderungen gehört...",
    }
    assert server.is_mostly_english(german_source) is False


def test_filter_english_sources_drops_non_english():
    eng_source = {
        "title": "Next.js 15 is now generally available",
        "url": "https://nextjs.org/blog/next-15",
        "content": "Today we are excited to introduce Next.js 15 with React 19 support.",
    }
    german_source = {
        "title": "Next.js 14 veröffentlicht: Das sind die Neuerungen",
        "url": "https://heise.de/news/Next-js-14-veroeffentlicht-934567.html",
        "content": "Vercel hat die neue Version des Frameworks freigegeben. Zu den wichtigsten Änderungen gehört...",
    }
    filtered = server.filter_english_sources([eng_source, german_source])
    assert len(filtered) == 1
    assert filtered[0]["url"] == eng_source["url"]


def test_filter_english_sources_keeps_at_least_one_when_only_non_english():
    german_source = {
        "title": "Next.js 14 veröffentlicht: Das sind die Neuerungen",
        "url": "https://heise.de/news/Next-js-14-veroeffentlicht-934567.html",
        "content": "Vercel hat die neue Version des Frameworks freigegeben. Zu den wichtigsten Änderungen gehört...",
    }
    filtered = server.filter_english_sources([german_source])
    assert len(filtered) == 1
    assert filtered[0]["url"] == german_source["url"]


