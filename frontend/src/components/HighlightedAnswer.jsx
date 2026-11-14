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
    <div className="md:col-span-7 lg:col-span-7 nm-flat rounded-3xl p-6 sm:p-7 flex flex-col gap-4" data-testid="panel-highlighted-answer">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/60">
        <h2 className="text-xl font-bold font-display text-slate-900">Original answer</h2>
        <div className="flex flex-wrap gap-2.5 text-xs font-semibold">
          <span className="nm-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-emerald-800 bg-emerald-500/10">
            <span className="font-bold">✓</span> Current
          </span>
          <span className="nm-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-rose-800 bg-rose-500/10">
            <span className="font-bold">✕</span> Outdated
          </span>
          <span className="nm-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-amber-800 bg-amber-500/10">
            <span className="font-bold">?</span> Uncertain
          </span>
        </div>
      </div>
      <p className="text-sm sm:text-base leading-8 text-slate-800 whitespace-pre-wrap">
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
              className={`px-1.5 py-0.5 rounded-lg cursor-pointer transition-all inline-block align-baseline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${VERDICT_STYLES[verdict].highlight}`}
            >
              <span aria-hidden="true" className="font-mono text-xs font-bold mr-1 opacity-90">{glyph}</span>
              <span>{s.text}</span>
            </mark>
          );
        })}
      </p>
    </div>
  );
};
