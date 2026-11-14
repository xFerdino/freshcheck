"""Offline unit tests: fake LLM + mocked Tavily, no network."""
import asyncio
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
    assert claims[0]["search_query"].endswith("official price") and claims[0]["condition"] == "n/a"


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
    assert offline[0].endswith("official price")


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
