const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const VERDICT_STYLES = {
  Current: {
    text: "text-emerald-300",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    highlight: "bg-emerald-500/15 text-emerald-200 border-b-2 border-emerald-500 hover:bg-emerald-500/25",
    color: "var(--verdict-current)",
  },
  Outdated: {
    text: "text-rose-300",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    highlight: "bg-rose-500/20 text-rose-200 border-b-2 border-rose-500 hover:bg-rose-500/30 font-medium",
    color: "var(--verdict-outdated)",
  },
  Uncertain: {
    text: "text-amber-300",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    highlight: "bg-amber-500/15 text-amber-200 border-b-2 border-amber-500 hover:bg-amber-500/25",
    color: "var(--verdict-uncertain)",
  },
  Pending: {
    text: "text-slate-400",
    badge: "bg-slate-700/40 text-slate-300 border-slate-600/40",
    highlight: "bg-indigo-500/10 text-slate-200 border-b-2 border-dashed border-indigo-400/60 animate-pulse",
    color: "var(--verdict-pending)",
  },
};

export const EXAMPLES = [
  {
    id: "tech-versions",
    title: "Tech versions",
    label: "Frameworks & languages",
    text: "The latest stable version of Python is 3.11, and React 18 is the newest major release of React. Next.js 13 introduced the App Router and is the current major version. Node.js 18 is the active LTS release that most teams should use.",
  },
  {
    id: "product-prices",
    title: "Product prices",
    label: "Gadgets & subscriptions",
    text: "ChatGPT Plus costs $20 per month. The PlayStation 5 Digital Edition is priced at $399 in the US, and the base iPhone 15 starts at $799. Netflix's Standard plan without ads costs $15.49 per month in the United States.",
  },
  {
    id: "company-leadership",
    title: "Company leadership",
    label: "CEOs & key roles",
    text: "Satya Nadella is the CEO of Microsoft and Sundar Pichai is the CEO of Alphabet. Intel is led by CEO Pat Gelsinger, while Bob Chapek runs Disney as its chief executive. Twitter's CEO is Parag Agrawal.",
  },
];

export const MAX_CHARS = 8000;

function errorMessage(res, body) {
  if (res.status === 429) {
    const sec = parseInt(res.headers.get("Retry-After") || "0", 10);
    const min = Math.ceil(sec / 60);
    return min > 1
      ? `You've hit the rate limit. Try again in ${min} min.`
      : sec > 0
      ? `You've hit the rate limit. Try again in ${sec} seconds.`
      : "You've hit the limit. Try again in a few minutes.";
  }
  if (res.status === 503) {
    return "Search isn't configured on this server.";
  }
  if (res.status === 502 || res.status === 504) {
    return "Lost connection — your text is safe, try again.";
  }
  if (Array.isArray(body?.detail)) {
    const type = body.detail[0]?.type || "";
    if (type.includes("too_long")) return "Answer is too long (max 8,000 characters)";
    if (type.includes("too_short")) return "Please paste a longer answer (at least 10 characters).";
    return body.detail[0]?.msg || "Invalid request";
  }
  return body?.detail || `Request failed (${res.status})`;
}

export async function streamCheck({ answer, generatedDate, onEvent, signal }) {
  let res;
  try {
    res = await fetch(`${API}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer, generated_date: generatedDate || null }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Lost connection — your text is safe, try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(errorMessage(res, body));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const event = part.match(/^event: (.*)$/m)?.[1];
      const data = part.match(/^data: (.*)$/m)?.[1];
      if (event === "done" || event === "error") finished = true;
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
  if (!finished) throw new Error("Lost connection — your text is safe, try again.");
}

export function buildSegments(text, claims) {
  const ranges = [];
  claims.forEach((c) => {
    if (!c.quote) return;
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(c.quote, from);
      if (start === -1) return;
      const end = start + c.quote.length;
      if (!ranges.some((r) => start < r.end && end > r.start)) {
        ranges.push({ start, end, claim: c });
        return;
      }
      from = start + 1;
    }
  });
  ranges.sort((a, b) => a.start - b.start);
  const segments = [];
  let pos = 0;
  ranges.forEach((r) => {
    if (r.start > pos) segments.push({ text: text.slice(pos, r.start) });
    segments.push({ text: text.slice(r.start, r.end), claim: r.claim });
    pos = r.end;
  });
  if (pos < text.length) segments.push({ text: text.slice(pos) });
  return segments;
}

export function scoreColor(score) {
  if (score == null) return "var(--verdict-pending)";
  if (score >= 70) return "var(--verdict-current)";
  if (score >= 40) return "var(--verdict-uncertain)";
  return "var(--verdict-outdated)";
}

export async function fetchConfig() {
  const res = await fetch(`${API}/config`);
  return res.json();
}

export async function rewriteAnswer(runId, answer) {
  let res;
  try {
    res = await fetch(`${API}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, answer }),
    });
  } catch (err) {
    throw new Error("Lost connection — your text is safe, try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(res, body));
  return body;
}

export function correctedMarkdown({ rewritten, sources }) {
  if (!sources?.length) return rewritten;
  return `${rewritten}\n\nSources:\n${sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n")}`;
}

export function buildMarkdown({ text, claims, summary, corrected, meta }) {
  const lines = [
    "# FreshCheck report",
    "",
    `- Checked: ${new Date().toISOString().slice(0, 10)}`,
    `- Overall freshness: **${summary?.overall_score ?? "–"}/100**`,
    `- Current: ${summary?.counts?.Current ?? 0} · Outdated: ${summary?.counts?.Outdated ?? 0} · Uncertain: ${summary?.counts?.Uncertain ?? 0}`,
    meta ? `- LLM route: ${meta.route === "bifrost" ? "Bifrost gateway" : "Direct"} (extract: ${meta.extract_model}, verdict: ${meta.verdict_model})` : null,
    "",
    "## Original answer",
    "",
    `> ${text.replace(/\n/g, "\n> ")}`,
    "",
    "## Claims",
    "",
  ].filter((l) => l !== null);
  claims.filter((c) => c.verdict).forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.claim}`, "", `- Verdict: **${c.verdict}** (${c.freshness_score}/100)`);
    if (c.updated_fact) lines.push(`- Up-to-date: ${c.updated_fact}`);
    lines.push(`- Reason: ${c.reason}`);
    if (c.sources.length) lines.push("- Sources:", ...c.sources.map((s) => `  - [${s.title}](${s.url})${s.date ? ` (${s.date})` : ""}`));
    else lines.push("- Sources: none found");
    lines.push("");
  });
  if (corrected) lines.push("## Corrected answer", "", correctedMarkdown(corrected), "");
  return lines.join("\n");
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
