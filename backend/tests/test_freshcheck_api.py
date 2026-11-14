# FreshCheck API tests: root, validation, SSE streaming /api/check
import json
import os
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


# Root/health
def test_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["message"] == "FreshCheck API"


# Validation
@pytest.mark.parametrize("payload", [{"answer": "short"}, {"answer": ""}, {}, {"answer": "x" * 8001}])
def test_validation_422(payload):
    r = requests.post(f"{BASE_URL}/api/check", json=payload, timeout=20)
    assert r.status_code == 422


# Full SSE run (real LLM + Tavily)
def test_check_stream_full():
    answer = "The latest stable version of Python is 3.11. Twitter's CEO is Parag Agrawal."
    r = requests.post(f"{BASE_URL}/api/check", json={"answer": answer, "generated_date": "2023-01-15"}, timeout=180)
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")
    events = parse_sse(r.text)
    names = [e for e, _ in events]
    print(names)
    assert names[0] == "meta" and names[1] == "status"
    assert "claims" in names
    assert names[-1] == "done"
    claims = next(d for e, d in events if e == "claims")["claims"]
    assert len(claims) >= 1
    for c in claims:
        assert c["id"].startswith("c")
        assert c["quote"] == "" or c["quote"] in answer
    results = [d for e, d in events if e == "claim_result"]
    starts = [d for e, d in events if e == "claim_start"]
    assert len(results) == len(claims) == len(starts)
    for res in results:
        print(res["id"], res["verdict"], res["freshness_score"], res.get("updated_fact"), [s["url"] for s in res["sources"]])
        assert res["verdict"] in ("Current", "Outdated", "Uncertain")
        assert 0 <= res["freshness_score"] <= 100
        assert isinstance(res["sources"], list)
        for s in res["sources"]:
            assert s["url"].startswith("http")
        if res["verdict"] != "Outdated":
            assert res["updated_fact"] is None
    done = events[-1][1]
    assert set(done["counts"]) == {"Current", "Outdated", "Uncertain"}
    assert sum(done["counts"].values()) == len(results)
    assert done["overall_score"] == round(sum(x["freshness_score"] for x in results) / len(results))
    # these are known-stale facts
    assert any(x["verdict"] == "Outdated" for x in results)
