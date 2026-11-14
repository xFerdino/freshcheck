# Hardening batch 1 regression tests: SEC-3 CORS, SEC-4 rate limit, SEC-5 rewrite by run_id, OBS-1 health, BUG-3/6 claims schema
import json
import os
import uuid

import pytest
import requests

pytestmark = pytest.mark.live

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except OSError:
        pass
LOCAL = "http://localhost:8001"  # only for rate-limit/bucketed tests (fake XFF ip per test)
PRICES = ("ChatGPT Plus costs $20 per month. The PlayStation 5 Digital Edition is priced at $399 in the US, and the base "
          "iPhone 15 starts at $799. Netflix's Standard plan without ads costs $15.49 per month in the United States.")


def fake_ip_headers():
    ip = f"203.0.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}-{uuid.uuid4().hex[:6]}"
    return {"X-Forwarded-For": f"{ip}, 10.0.0.1, 10.0.0.2", "Content-Type": "application/json"}


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


# OBS-1 health
class TestHealth:
    def test_health_booleans_only(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok"
        assert all(isinstance(v, bool) for v in d["env"].values())
        assert d["env"]["TAVILY_API_KEY"] is True


# SEC-3 CORS
class TestCors:
    def test_preflight_methods_no_credentials(self):
        r = requests.options(f"{BASE_URL}/api/check", headers={
            "Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"}, timeout=20)
        print("CORS headers:", dict(r.headers))
        assert r.status_code == 200
        methods = r.headers.get("access-control-allow-methods", "")
        assert set(m.strip() for m in methods.split(",")) == {"GET", "POST"}
        assert r.headers.get("access-control-allow-credentials") != "true"

    def test_preflight_delete_rejected(self):
        r = requests.options(f"{BASE_URL}/api/check", headers={
            "Origin": "https://evil.example.com", "Access-Control-Request-Method": "DELETE"}, timeout=20)
        assert r.status_code == 400 or "DELETE" not in r.headers.get("access-control-allow-methods", "")


# SEC-5 rewrite schema / errors
class TestRewriteErrors:
    def test_unknown_run_404(self):
        r = requests.post(f"{BASE_URL}/api/rewrite", json={"run_id": "nope123", "answer": PRICES}, timeout=20)
        assert r.status_code == 404
        assert "Unknown" in r.json()["detail"]

    def test_old_body_422(self):
        r = requests.post(f"{BASE_URL}/api/rewrite", json={"answer": PRICES, "claims": []}, timeout=20)
        assert r.status_code == 422


# BUG-5 validation on /api/check (localhost, fake ip bucket so the external quota is not consumed)
class TestCheckValidation:
    def test_too_long_422(self):
        r = requests.post(f"{LOCAL}/api/check", json={"answer": "a" * 8001}, headers=fake_ip_headers(), timeout=20)
        assert r.status_code == 422
        assert r.json()["detail"][0]["type"] == "string_too_long"

    def test_too_short_422(self):
        r = requests.post(f"{LOCAL}/api/check", json={"answer": "short"}, headers=fake_ip_headers(), timeout=20)
        assert r.status_code == 422
        assert r.json()["detail"][0]["type"] == "string_too_short"


# SEC-4 rate limiting (localhost + fake XFF; separate buckets per endpoint)
class TestRateLimit:
    def test_rewrite_11th_is_429(self):
        h = fake_ip_headers()
        codes = [requests.post(f"{LOCAL}/api/rewrite", json={"run_id": "x", "answer": PRICES}, headers=h, timeout=20)
                 for _ in range(11)]
        assert [c.status_code for c in codes[:10]] == [404] * 10
        assert codes[10].status_code == 429
        assert int(codes[10].headers["Retry-After"]) > 0

    def test_check_bucket_separate_and_429(self):
        h = fake_ip_headers()
        # exhaust rewrite bucket first; check must still be allowed
        for _ in range(11):
            requests.post(f"{LOCAL}/api/rewrite", json={"run_id": "x", "answer": PRICES}, headers=h, timeout=20)
        codes = [requests.post(f"{LOCAL}/api/check", json={"answer": "short"}, headers=h, timeout=20).status_code
                 for _ in range(11)]
        print("check codes:", codes)
        assert codes[0] == 422  # not 429 -> separate bucket
        assert codes[10] == 429

    def test_spoofed_single_xff_not_bucketed_via_proxy(self):
        # external: a client-supplied XFF is prepended by the proxy chain, so the server should still bucket by real ip
        r = requests.get(f"{BASE_URL}/api/health", headers={"X-Forwarded-For": "1.2.3.4"}, timeout=20)
        assert r.status_code == 200


# SEC-5 / BUG-3 / BUG-6 full live run (localhost fake ip) + rewrite by run_id
@pytest.mark.live
class TestLiveRunAndRewrite:
    state = {}

    def test_live_check(self):
        h = fake_ip_headers()
        r = requests.post(f"{LOCAL}/api/check", json={"answer": PRICES}, headers=h, timeout=180)
        assert r.status_code == 200
        ev = parse_sse(r.text)
        names = [e for e, _ in ev]
        print("events:", names)
        assert names[0] == "meta" and names[-1] == "done"
        meta = ev[0][1]
        assert isinstance(meta["run_id"], str) and meta["run_id"]
        claims_ev = next(d for e, d in ev if e == "claims")
        assert claims_ev["truncated"] is False and claims_ev["total_found"] == len(claims_ev["claims"])
        for c in claims_ev["claims"]:
            assert "region" in c and c["condition"] in ("new", "used", "n/a")
            if c["category"] == "price":
                assert "official price" in c["search_query"].lower()
        results = [d for e, d in ev if e == "claim_result"]
        for res in results:
            if res["verdict"] == "Outdated":
                assert res["sources"], "Outdated must cite sources"
        print("verdicts:", [(x["id"], x["verdict"], x.get("updated_fact")) for x in results])
        self.state.update(run_id=meta["run_id"], results=results, headers=h)

    def test_rewrite_mismatch_409(self):
        if "run_id" not in self.state:
            pytest.skip("no run")
        r = requests.post(f"{LOCAL}/api/rewrite", json={"run_id": self.state["run_id"], "answer": PRICES + " extra"},
                          headers=self.state["headers"], timeout=30)
        assert r.status_code == 409

    def test_rewrite_accepted_empty_unchanged(self):
        if "run_id" not in self.state:
            pytest.skip("no run")
        r = requests.post(f"{LOCAL}/api/rewrite", json={"run_id": self.state["run_id"], "answer": PRICES,
                                                         "accepted_claim_ids": []}, headers=self.state["headers"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["changed"] is False and d["rewritten"] == PRICES and d["sources"] == []

    def test_rewrite_full_with_citations(self):
        if "run_id" not in self.state:
            pytest.skip("no run")
        outdated = [x for x in self.state["results"] if x["verdict"] == "Outdated" and x.get("updated_fact")]
        if not outdated:
            pytest.skip("no outdated claims in this run")
        ids = [outdated[0]["id"]]
        r = requests.post(f"{LOCAL}/api/rewrite", json={"run_id": self.state["run_id"], "answer": PRICES,
                                                         "accepted_claim_ids": ids}, headers=self.state["headers"], timeout=90)
        assert r.status_code == 200
        d = r.json()
        print("rewrite:", d["rewritten"], d["sources"])
        assert d["changed"] is True
        assert 1 <= len(d["sources"]) <= 2  # only one accepted claim -> at most 2 citations
        assert "[1]" in d["rewritten"]
