// Shareable report links: the whole report lives in the URL hash (#r=...), so there's no backend and nothing is stored.
// ponytail: hash links get long (~2-6 KB for typical reports); move to server-stored ids (G-1) if links must be short.

const PREFIX = "#r=";
const MAX_CLAIMS = 12;

const b64url = (bytes) => {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Shared links are untrusted input: only plain http(s) URLs may become hrefs.
const safeUrl = (u) => {
  try { const p = new URL(u); return p.protocol === "https:" || p.protocol === "http:" ? p.href : null; } catch { return null; }
};
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const VERDICTS = ["Current", "Outdated", "Uncertain"];

function cleanSources(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6)
    .map((s) => ({ title: str(s?.title, 300), url: safeUrl(s?.url), date: str(s?.date, 40) || null, n: Number.isInteger(s?.n) ? s.n : undefined }))
    .filter((s) => s.url);
}

function cleanReport(r) {
  const claims = (Array.isArray(r?.c) ? r.c : []).slice(0, MAX_CLAIMS).map((c, i) => ({
    id: str(c?.id, 10) || `c${i + 1}`,
    claim: str(c?.claim, 500),
    quote: str(c?.quote, 500),
    category: str(c?.category, 20) || "other",
    verdict: VERDICTS.includes(c?.verdict) ? c.verdict : "Uncertain",
    freshness_score: Math.max(0, Math.min(100, Number(c?.freshness_score) || 0)),
    updated_fact: str(c?.updated_fact, 500) || null,
    reason: str(c?.reason, 500),
    sources: cleanSources(c?.sources),
    state: "done",
  }));
  const counts = Object.fromEntries(VERDICTS.map((k) => [k, claims.filter((c) => c.verdict === k).length]));
  const overall = claims.length ? Math.round(claims.reduce((a, c) => a + c.freshness_score, 0) / claims.length) : null;
  const x = r?.x && typeof r.x.rewritten === "string"
    ? { rewritten: str(r.x.rewritten, 10000), sources: cleanSources(r.x.sources), changed: true }
    : null;
  return {
    answer: str(r?.a, 8000),
    date: str(r?.d, 20),
    timestamp: str(r?.t, 40) || null,
    claims,
    summary: { overall_score: overall, counts },
    corrected: x,
  };
}

export async function encodeReport({ answer, date, claims, corrected, timestamp }) {
  const payload = {
    v: 1,
    a: answer,
    d: date || "",
    t: timestamp || new Date().toISOString(),
    c: claims.filter((c) => c.verdict).map(({ id, claim, quote, category, verdict, freshness_score, updated_fact, reason, sources }) => ({
      id, claim, quote, category, verdict, freshness_score, updated_fact, reason,
      sources: (sources || []).map(({ title, url, date: d }) => ({ title, url, date: d })),
    })),
    x: corrected?.changed ? { rewritten: corrected.rewritten, sources: corrected.sources } : undefined,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return typeof CompressionStream === "function" ? `z${b64url(await pipe(bytes, new CompressionStream("deflate-raw")))}` : `j${b64url(bytes)}`;
}

export async function decodeReport(body) {
  let bytes = unb64url(body.slice(1));
  if (body[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  return cleanReport(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function buildShareUrl(report) {
  return `${window.location.origin}${window.location.pathname}${PREFIX}${await encodeReport(report)}`;
}

export const hasSharedReport = () => window.location.hash.startsWith(PREFIX);

export async function readSharedReport() {
  return hasSharedReport() ? decodeReport(window.location.hash.slice(PREFIX.length)) : null;
}

export const clearShareHash = () => window.history.replaceState(null, "", window.location.pathname + window.location.search);
