import { buildSegments, VERDICT_STYLES } from "../lib/freshcheck";

const focusCard = (id) => {
  const el = document.querySelector(`[data-testid="card-claim-${id}"]`);
  if (!el) return;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
  if (!prefersReduced) {
    el.classList.remove("claim-flash");
    void el.offsetWidth;
    el.classList.add("claim-flash");
  }
};

const VERDICT_GLYPHS = {
  Current: "✓",
  Outdated: "✕",
  Uncertain: "?",
  Pending: "…",
};

export const HighlightedAnswer = ({ text, claims }) => {
  const segments = buildSegments(text, claims);
  return (
    <div className="md:col-span-7 lg:col-span-8 bg-slate-900/80 border border-white/[0.08] rounded-2xl p-6 flex flex-col gap-4" data-testid="panel-highlighted-answer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Original answer</h2>
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-sm bg-emerald-500/20 text-emerald-400 font-bold inline-flex items-center justify-center text-xs">✓</span>Current</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-sm bg-rose-500/20 text-rose-400 font-bold inline-flex items-center justify-center text-xs">✕</span>Outdated</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-sm bg-amber-500/20 text-amber-400 font-bold inline-flex items-center justify-center text-xs">?</span>Uncertain</span>
        </div>
      </div>
      <p className="text-sm sm:text-base leading-8 text-slate-300 whitespace-pre-wrap">
        {segments.map((s, i) => {
          if (!s.claim) return <span key={i}>{s.text}</span>;
          const verdict = s.claim.verdict || "Pending";
          const glyph = VERDICT_GLYPHS[verdict] || "";
          return (
            <mark
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => focusCard(s.claim.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  focusCard(s.claim.id);
                }
              }}
              title={`${verdict}: ${s.claim.reason || s.claim.claim}`}
              aria-label={`${verdict} claim: ${s.claim.claim}. Press Enter to view card.`}
              data-testid={`claim-highlight-${s.claim.id}`}
              className={`px-1 py-0.5 rounded cursor-pointer transition-all inline-block align-baseline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${VERDICT_STYLES[verdict].highlight}`}
            >
              <span aria-hidden="true" className="font-mono text-xs font-bold mr-1 opacity-80">{glyph}</span>
              <span>{s.text}</span>
            </mark>
          );
        })}
      </p>
    </div>
  );
};
