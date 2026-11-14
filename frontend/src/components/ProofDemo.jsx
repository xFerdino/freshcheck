import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";

// ds-allow-hardcode:start Tailwind palette classes match every other component here (InputPanel, ClaimCard...).
// Migrate all components to semantic tokens in one pass, not piecemeal.

// Recorded from a real run of the "Tech versions" example on 14 Nov 2026 (docs/HANDOFF.md, FRESH-1).
// ponytail: static replay, no API call; refresh the facts when the example's live verdicts change.
const PARTS = [
  "The latest stable version of Python is ",
  { stale: "3.11", fresh: "3.15", label: "Python" },
  ", and React ",
  { stale: "18", fresh: "19", label: "React" },
  " is the newest major release of React. Next.js 13 introduced the App Router ",
  { stale: "and is the current major version", fresh: "but 16 is now current", label: "Next.js" },
  ". Node.js ",
  { stale: "18", fresh: "24", label: "Node.js" },
  " is the active LTS release that most teams should use.",
];
const CLAIMS = PARTS.filter((p) => typeof p !== "string");
const FINAL_STEP = CLAIMS.length * 2; // each claim: scanning, then resolved
const STEP_MS = 650;

// phase of claim i at a given step: idle | scanning | resolved
const phaseOf = (i, step) => (step >= i * 2 + 2 ? "resolved" : step >= i * 2 + 1 ? "scanning" : "idle");

// Map part indices to claim indices for clean, pure lookups
const CLAIM_INDEX_BY_PART = new Map();
let claimCounter = 0;
PARTS.forEach((p, i) => {
  if (typeof p !== "string") {
    CLAIM_INDEX_BY_PART.set(i, claimCounter++);
  }
});

const Segment = ({ part, phase }) => {
  if (phase === "resolved") {
    return (
      <>
        <del className="text-rose-700/80 decoration-rose-500 decoration-2">{part.stale}</del>
        <motion.ins
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="no-underline ml-1 rounded-md box-decoration-clone bg-emerald-500/15 px-1.5 font-semibold text-emerald-800 ring-1 ring-emerald-600/30"
        >
          {part.fresh}
        </motion.ins>
      </>
    );
  }
  if (phase === "scanning") {
    return (
      <mark className="rounded bg-indigo-500/15 px-0.5 text-slate-900 underline decoration-dashed decoration-2 decoration-indigo-500 underline-offset-4 motion-safe:animate-pulse">
        {part.stale}
      </mark>
    );
  }
  return <span>{part.stale}</span>;
};

const ClaimChip = ({ label, phase }) => (
  <li
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold transition-colors border ${
      phase === "resolved"
        ? "bg-rose-500/10 text-rose-800 border-rose-500/20"
        : phase === "scanning"
        ? "bg-indigo-500/10 text-indigo-800 border-indigo-500/20"
        : "nm-inset-sm text-slate-500 border-transparent"
    }`}
  >
    {phase === "resolved" ? (
      <XCircle className="w-3.5 h-3.5 shrink-0" />
    ) : phase === "scanning" ? (
      <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" />
    ) : (
      <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-slate-300" />
    )}
    <span>{label}</span>
    <span className="font-mono font-medium opacity-80 inline-block w-[62px] text-left shrink-0">
      {phase === "resolved" ? "outdated" : phase === "scanning" ? "searching" : "queued"}
    </span>
  </li>
);

export const ProofDemo = () => {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? FINAL_STEP : 0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduce) { setStep(FINAL_STEP); return undefined; }
    setStep(0);
    const timers = Array.from({ length: FINAL_STEP }, (_, i) => setTimeout(() => setStep(i + 1), 900 + i * STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [run, reduce]);

  const done = step >= FINAL_STEP;
  const outdated = CLAIMS.filter((_, i) => phaseOf(i, step) === "resolved").length;

  return (
    <figure className="nm-flat-lg rounded-3xl p-5 sm:p-6 space-y-4" data-testid="proof-demo" aria-label="Example: FreshCheck correcting a stale AI answer">
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-bold text-slate-800">Watch it fix a real AI answer</span>
          <span className="font-mono text-xs text-slate-500">Recorded run · 14 Nov 2026</span>
        </span>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          disabled={!done || reduce}
          data-testid="btn-replay-demo"
          className="nm-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-slate-600 hover:text-indigo-700 disabled:opacity-0 transition-opacity"
          aria-label="Replay the demo"
        >
          <RotateCcw className="w-3 h-3" /> Replay
        </button>
      </div>

      <blockquote className="nm-inset relative rounded-2xl p-4 sm:p-5 text-sm sm:text-base leading-7 text-slate-700" data-testid="proof-demo-text">
        {/* Invisible sizer: maintains full resolved height at all times so replay never shifts content */}
        <div className="invisible select-none pointer-events-none" aria-hidden="true">
          {PARTS.map((p, i) => {
            if (typeof p === "string") return <span key={i}>{p}</span>;
            return (
              <span key={i}>
                <del className="text-rose-700/80 decoration-rose-500 decoration-2">{p.stale}</del>
                <ins className="no-underline ml-1 rounded-md box-decoration-clone bg-emerald-500/15 px-1.5 font-semibold text-emerald-800 ring-1 ring-emerald-600/30">
                  {p.fresh}
                </ins>
              </span>
            );
          })}
        </div>

        {/* Visible animated text */}
        <div className="absolute inset-0 p-4 sm:p-5">
          {PARTS.map((p, i) => {
            if (typeof p === "string") return <span key={i}>{p}</span>;
            return <Segment key={i} part={p} phase={phaseOf(CLAIM_INDEX_BY_PART.get(i), step)} />;
          })}
        </div>
      </blockquote>

      <ul className="flex flex-wrap gap-2" aria-hidden="true">
        {CLAIMS.map((c, i) => <ClaimChip key={c.label} label={c.label} phase={phaseOf(i, step)} />)}
      </ul>

      <figcaption className="flex items-center justify-between gap-3 border-t border-white/60 pt-3 text-sm min-h-[36px]" aria-live="polite">
        <span className="flex items-center gap-2 font-semibold text-slate-800">
          {done ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <Loader2 className="w-4 h-4 shrink-0 text-indigo-600 motion-safe:animate-spin" />}
          <span>{done ? "Corrected with live sources" : "Checking against the live web…"}</span>
        </span>
        <span className="font-mono text-xs font-bold text-rose-700 shrink-0" data-testid="proof-demo-count">{outdated} / {CLAIMS.length} stale</span>
      </figcaption>
    </figure>
  );
};
// ds-allow-hardcode:end
