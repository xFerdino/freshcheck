import { buildSegments, VERDICT_STYLES } from "../lib/freshcheck";

const focusCard = (id) => {
  const el = document.querySelector(`[data-testid="card-claim-${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("claim-flash");
  void el.offsetWidth;
  el.classList.add("claim-flash");
};

export const HighlightedAnswer = ({ text, claims }) => {
  const segments = buildSegments(text, claims);
  return (
    <div className="md:col-span-7 lg:col-span-8 bg-slate-900/80 border border-white/[0.08] rounded-2xl p-6 flex flex-col gap-4" data-testid="panel-highlighted-answer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Original answer</h2>
        <div className="flex gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Current</span>
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-rose-500" />Outdated</span>
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-amber-500" />Uncertain</span>
        </div>
      </div>
      <p className="text-sm sm:text-base leading-8 text-slate-300 whitespace-pre-wrap">
        {segments.map((s, i) =>
          s.claim ? (
            <mark
              key={i}
              onClick={() => focusCard(s.claim.id)}
              title={s.claim.reason || s.claim.claim}
              data-testid={`claim-highlight-${s.claim.id}`}
              className={`px-1 py-0.5 rounded cursor-pointer transition-colors ${VERDICT_STYLES[s.claim.verdict || "Pending"].highlight}`}
            >
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          )
        )}
      </p>
    </div>
  );
};
