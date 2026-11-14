import { motion, useReducedMotion } from "framer-motion";
import { scoreColor } from "../lib/freshcheck";

const R = 80;
const C = Math.PI * R;

export const ScoreGauge = ({ score, counts, running, filter, onSelectFilter }) => {
  const shouldReduceMotion = useReducedMotion();
  const color = scoreColor(score);
  const offset = C - ((score ?? 0) / 100) * C;
  const label = score == null ? (running ? "Checking…" : "No claims") : score >= 70 ? "Mostly fresh" : score >= 40 ? "Partly stale" : "Stale";
  return (
    <div className="md:col-span-5 lg:col-span-4 bg-slate-900/80 border border-white/[0.08] rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden" data-testid="gauge-overall-score">
      <div className="absolute inset-x-0 -top-24 h-48 rounded-full blur-3xl opacity-20" style={{ background: color }} />
      <p className="relative font-mono text-xs uppercase tracking-widest text-slate-500 mb-4">Overall freshness</p>
      <svg viewBox="0 0 200 115" className="relative w-56 max-w-full">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#1F2937" strokeWidth="14" strokeLinecap="round" />
        <motion.path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={shouldReduceMotion ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: offset }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 1.2, ease: "easeOut" }}
        />
        <text x="100" y="92" textAnchor="middle" fill="#F9FAFB" fontSize="40" fontWeight="800" fontFamily="Outfit" data-testid="gauge-score-value">
          {score ?? "–"}
        </text>
      </svg>
      <p className="relative mt-2 text-lg font-display font-semibold" style={{ color }} data-testid="gauge-label">{label}</p>
      <div className="relative mt-5 grid grid-cols-3 gap-2 w-full">
        {[["Current", "text-emerald-300"], ["Outdated", "text-rose-300"], ["Uncertain", "text-amber-300"]].map(([k, cls]) => {
          const isSelected = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelectFilter?.(isSelected ? "all" : k)}
              className={`rounded-lg py-2 transition-all cursor-pointer border ${
                isSelected
                  ? "bg-slate-900 border-indigo-400 ring-2 ring-indigo-400/40"
                  : "bg-slate-950/60 border-white/[0.06] hover:border-white/20"
              }`}
              data-testid={`count-${k.toLowerCase()}`}
            >
              <div className={`text-xl font-display font-bold ${cls}`}>{counts?.[k] ?? 0}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{k}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
