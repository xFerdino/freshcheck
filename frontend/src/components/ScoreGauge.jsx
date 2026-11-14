import { motion, useReducedMotion } from "framer-motion";
import { scoreColor } from "../lib/freshcheck";

const R = 80;
const C = Math.PI * R;

export const ScoreGauge = ({ score, counts, running, filter, onSelectFilter, checkedAt }) => {
  const shouldReduceMotion = useReducedMotion();
  const color = scoreColor(score);
  const offset = C - ((score ?? 0) / 100) * C;
  const label = score == null ? (running ? "Checking…" : "No claims") : score >= 70 ? "Mostly fresh" : score >= 40 ? "Partly stale" : "Stale";
  const totalClaims = counts ? (counts.Current || 0) + (counts.Outdated || 0) + (counts.Uncertain || 0) : 0;

  return (
    <div className="md:col-span-5 lg:col-span-4 nm-flat rounded-3xl p-6 sm:p-7 flex flex-col items-center justify-center text-center relative overflow-hidden" data-testid="gauge-overall-score">
      <p className="relative font-mono text-xs uppercase tracking-wider text-slate-500 font-bold mb-3">Overall freshness</p>
      <div className="relative w-56 max-w-full flex items-center justify-center">
        <svg viewBox="0 0 200 115" className="w-full">
          <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--gauge-track)" strokeWidth="10" strokeLinecap="round" />
          <motion.path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={shouldReduceMotion ? false : { strokeDashoffset: C }}
            animate={{ strokeDashoffset: offset }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 1.2, ease: "easeOut" }}
          />
          <text x="100" y="92" textAnchor="middle" fill="var(--gauge-text)" fontSize="42" fontWeight="800" fontFamily="Outfit" data-testid="gauge-score-value">
            {score ?? "–"}
          </text>
        </svg>
      </div>
      <p className="relative mt-2 text-xl font-display font-extrabold" style={{ color }} data-testid="gauge-label">{label}</p>
      {score != null && (
        <p className="relative mt-0.5 text-xs text-slate-500 font-medium">Average freshness of {totalClaims} {totalClaims === 1 ? "claim" : "claims"}</p>
      )}
      <div className="relative mt-6 grid grid-cols-3 gap-2.5 w-full">
        {[["Current", "text-emerald-700"], ["Outdated", "text-rose-700"], ["Uncertain", "text-amber-800"]].map(([k, cls]) => {
          const isSelected = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelectFilter?.(isSelected ? "all" : k)}
              className={`rounded-2xl py-2.5 transition-all cursor-pointer ${
                isSelected
                  ? "nm-inset ring-2 ring-indigo-500/50"
                  : "nm-btn hover:scale-[1.02]"
              }`}
              data-testid={`count-${k.toLowerCase()}`}
            >
              <div className={`text-xl font-display font-extrabold ${cls}`}>{counts?.[k] ?? 0}</div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-600 font-bold">{k}</div>
            </button>
          );
        })}
      </div>
      <div className="relative mt-5 pt-3.5 border-t border-white/60 text-center w-full space-y-1" data-testid="trust-cue">
        <p className="text-xs text-slate-600 font-medium">Every verdict links to live sources. No source → Uncertain.</p>
        <p className="text-[11px] font-mono text-slate-400">
          Checked {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{checkedAt ? ` ${checkedAt}` : ""} · Live search
        </p>
      </div>
    </div>
  );
};
