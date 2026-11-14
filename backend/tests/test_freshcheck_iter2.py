# FreshCheck iteration 2: config/route, SSE meta + llm_call logs, /api/rewrite
import json
import os
import re
import pytest
import requests

pytestmark = pytest.mark.live

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or '').rstrip('/')


def parse_sse(text):
    events = []
    for part in text.split("\n\n"):
        ev = data = None
        for line in part.splitlines():
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if ev:
            events.append((ev, data))
    return events


# Root + config
def test_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=20)
    assert r.status_code == 200
    assert r.json()["message"] == "FreshCheck API"


def test_config_direct():
    r = requests.get(f"{BASE_URL}/api/config", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["route"] == "direct"
    assert d["extract_model"] == "openai/gpt-5.4-mini"
    assert d["verdict_model"] == "openai/gpt-5.4"


# Validation
@pytest.mark.parametrize("payload", [{"answer": "short"}, {}, {"answer": "x" * 8001}])
def test_check_validation_422(payload):
    r = requests.post(f"{BASE_URL}/api/check", json=payload, timeout=20)
    assert r.status_code == 422


@pytest.mark.parametrize("payload", [{"answer": "short", "claims": []}, {"answer": "long enough answer"}])
def test_rewrite_validation_422(payload):
    r = requests.post(f"{BASE_URL}/api/rewrite", json=payload, timeout=20)
    assert r.status_code == 422


# Rewrite: no outdated -> unchanged
@pytest.mark.skip(reason="Superseded by SEC-5: /api/rewrite now takes run_id; see test_unit.py")
def test_rewrite_no_outdated():
    ans = "Satya Nadella is the CEO of Microsoft."
    r = requests.post(f"{BASE_URL}/api/rewrite", json={"answer": ans, "claims": [
        {"claim": "Satya Nadella is CEO of Microsoft", "quote": ans, "verdict": "Current", "updated_fact": None, "sources": []}]}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["changed"] is False and d["rewritten"] == ans and d["sources"] == [] and d["log"] is None


# Rewrite: outdated -> citations
@pytest.mark.skip(reason="Superseded by SEC-5: /api/rewrite now takes run_id; see test_unit.py")
def test_rewrite_with_outdated():
    ans = "Twitter's CEO is Parag Agrawal. Satya Nadella is the CEO of Microsoft."
    claims = [
        {"claim": "Twitter's CEO is Parag Agrawal", "quote": "Twitter's CEO is Parag Agrawal", "verdict": "Outdated",
         "updated_fact": "Linda Yaccarino became CEO of X (formerly Twitter) in June 2023.",
         "sources": [{"title": "Src A", "url": "https://example.com/a"}, {"title": "Src B", "url": "https://example.com/b"},
                     {"title": "Src C", "url": "https://example.com/c"}]},
        {"claim": "Nadella CEO", "quote": "Satya Nadella is the CEO of Microsoft", "verdict": "Current", "updated_fact": None, "sources": []},
    ]
    r = requests.post(f"{BASE_URL}/api/rewrite", json={"answer": ans, "claims": claims}, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    assert d["changed"] is True
    assert len(d["sources"]) == 2  # capped at 2 per claim
    assert [s["n"] for s in d["sources"]] == [1, 2]
    assert re.search(r"\[\d\]", d["rewritten"])
    assert "Yaccarino" in d["rewritten"]
    assert d["log"]["stage"] == "rewrite" and d["log"]["model"] == "openai/gpt-5.4" and d["log"]["route"] == "direct"


# Full SSE run with meta + llm_call logs
def test_check_stream_meta_and_logs():
    answer = "Twitter's CEO is Parag Agrawal. Bob Chapek runs Disney as its chief executive."
    r = requests.post(f"{BASE_URL}/api/check", json={"answer": answer, "generated_date": "2023-01-15"}, timeout=180)
    assert r.status_code == 200
    events = parse_sse(r.text)
    names = [e for e, _ in events]
    print(names)
    assert names[0] == "meta"
    meta = events[0][1]
    assert meta == {"route": "direct", "extract_model": "openai/gpt-5.4-mini", "verdict_model": "openai/gpt-5.4"}
    assert names[1] == "status" and names[-1] == "done"
    logs = [d for e, d in events if e == "llm_call"]
    llm = [l for l in logs if l["kind"] == "llm"]
    search = [l for l in logs if l["kind"] == "search"]
    extract = [l for l in llm if l["stage"] == "extract"]
    verdicts = [l for l in llm if l["stage"] == "verdict"]
    assert len(extract) == 1 and extract[0]["model"] == "openai/gpt-5.4-mini"
    claims = next(d for e, d in events if e == "claims")["claims"]
    assert len(search) == len(claims)
    for s in search:
        assert isinstance(s["results"], int) and s["route"] == "tavily" and s["latency_ms"] >= 0
    for l in llm:
        print(l)
        assert l["route"] == "direct"
        assert l["status"] == "ok"
        assert isinstance(l["latency_ms"], int)
        assert l["prompt_tokens"] > 0 and l["completion_tokens"] > 0
    for v in verdicts:
        assert v["model"] == "openai/gpt-5.4" and v["ref"].startswith("c")
    results = [d for e, d in events if e == "claim_result"]
    assert len(results) == len(claims)
    assert any(x["verdict"] == "Outdated" for x in results)
