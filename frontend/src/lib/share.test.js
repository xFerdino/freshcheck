/** @jest-environment node */
import { decodeReport, encodeReport } from "./share";

test("share link round-trips a report and drops unsafe source URLs", async () => {
  const report = {
    answer: "Python 3.11 is the latest stable version.",
    date: "2023-01-15",
    timestamp: "2026-11-14T17:00:00.000Z",
    corrected: { changed: true, rewritten: "Python 3.15 is the latest stable version [1].", sources: [{ n: 1, title: "Python", url: "https://python.org" }] },
    claims: [
      { id: "c1", claim: "Python 3.11 is latest", quote: "Python 3.11", category: "version", verdict: "Outdated", freshness_score: 5,
        updated_fact: "Python 3.15 is latest", reason: "Newer release", state: "done",
        sources: [{ title: "ok", url: "https://python.org/downloads" }, { title: "evil", url: "javascript:alert(1)" }] },
      { id: "c2", claim: "still checking", verdict: undefined, sources: [] },
    ],
  };
  const r = await decodeReport(await encodeReport(report));
  expect(r.answer).toBe(report.answer);
  expect(r.claims).toHaveLength(1); // unfinished claims are not shared
  expect(r.claims[0].sources.map((s) => s.url)).toEqual(["https://python.org/downloads"]);
  expect(r.summary).toEqual({ overall_score: 5, counts: { Current: 0, Outdated: 1, Uncertain: 0 } });
  expect(r.corrected.rewritten).toContain("3.15");
});

test("tampered verdicts and scores are clamped", async () => {
  const body = "j" + Buffer.from(JSON.stringify({ v: 1, a: "x", c: [{ verdict: "<img>", freshness_score: 999 }] })).toString("base64url");
  const r = await decodeReport(body);
  expect(r.claims[0].verdict).toBe("Uncertain");
  expect(r.claims[0].freshness_score).toBe(100);
});
