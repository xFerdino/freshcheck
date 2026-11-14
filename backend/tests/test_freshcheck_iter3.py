# FreshCheck iteration 3: score clamp per verdict, source ordering, rewrite grammar
import json
import os
import re
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
PRICES = ("ChatGPT Plus costs $20 per month. The PlayStation 5 Digital Edition is priced at $399 in the US, and the base "
          "iPhone 15 starts at $799. Netflix's Standard plan without ads costs $15.49 per month in the United States.")


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


# Fix 1 + Fix 2: score clamp and supporting-source ordering on a real run
def test_prices_score_clamp_and_sources():
    r = requests.post(f"{BASE_URL}/api/check", json={"answer": PRICES, "generated_date": "2023-06-01"}, timeout=240)
    assert r.status_code == 200
    events = parse_sse(r.text)
    results = [d for e, d in events if e == "claim_result"]
    done = [d for e, d in events if e == "done"][0]
    assert results
    for c in results:
        print(c["id"], c["verdict"], c["freshness_score"], c["claim"], "|", c.get("updated_fact"))
        for s in c["sources"]:
            print("    ", s.get("date"), s["title"][:80], s["url"])
        if c["verdict"] == "Outdated":
            assert c["freshness_score"] <= 30
            assert c["updated_fact"]
            assert c["sources"]
        elif c["verdict"] == "Uncertain":
            assert 35 <= c["freshness_score"] <= 65
        else:
            assert c["freshness_score"] >= 70
    print("done", done)
    assert done["overall_score"] == round(sum(c["freshness_score"] for c in results) / len(results))
    with open("/tmp/prices_results.json", "w") as f:
        json.dump(results, f)


# Fix 3: rewrite keeps grammar when a claim is part of a sentence
def test_rewrite_grammar_inline_citations():
    claims = [
        {"claim": "PS5 Digital Edition is $399", "quote": "The PlayStation 5 Digital Edition is priced at $399 in the US",
         "verdict": "Outdated", "updated_fact": "The PlayStation 5 Digital Edition is priced at $499.99 in the US.",
         "sources": [{"title": "PS Blog price update", "url": "https://example.com/ps5"}]},
        {"claim": "Netflix Standard $15.49", "quote": "Netflix's Standard plan without ads costs $15.49 per month in the United States",
         "verdict": "Outdated", "updated_fact": "Netflix's Standard plan costs $17.99 per month in the US.",
         "sources": [{"title": "Netflix help", "url": "https://example.com/nf"}, {"title": "News", "url": "https://example.com/news"}]},
        {"claim": "iPhone 15 $799", "quote": "the base iPhone 15 starts at $799", "verdict": "Current", "updated_fact": None, "sources": []},
    ]
    r = requests.post(f"{BASE_URL}/api/rewrite", json={"answer": PRICES, "claims": claims}, timeout=120)
    assert r.status_code == 200, r.text
    d = r.json()
    out = d["rewritten"]
    print(out)
    assert d["changed"] is True and [s["n"] for s in d["sources"]] == [1, 2, 3]
    assert "$499.99" in out and "$17.99" in out
    assert "iPhone 15" in out
    # no ". and" / "].[n] and" lowercase continuation after a sentence end
    assert not re.search(r"[.!?](\s*\[\d\])*\s+[a-z]", out), out
    # citations placed before final punctuation, not after
    assert not re.search(r"[.!?]\[\d\]", out), out
    assert re.search(r"\[1\]", out) and re.search(r"\[2\]", out)
