import { CheckCircle2, Loader2, Circle, XCircle, HelpCircle } from "lucide-react";
import { VERDICT_STYLES } from "../lib/freshcheck";

const StateIcon = ({ claim }) => {
  if (claim.verdict === "Current") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (claim.verdict === "Outdated") return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
  if (claim.verdict === "Uncertain") return <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />;
  if (claim.state === "checking") return <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-600 shrink-0" />;
};

export const LiveProgress = ({ stage, claims }) => {
  const done = claims.filter((c) => c.verdict).length;
  const pct = claims.length ? Math.round((done / claims.length) * 100) : 6;
  return (
    <section className="bg-slate-900/80 border border-white/[0.08] rounded-2xl p-5 space-y-4" data-testid="live-progress-bar">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {claims.length ? `${done} of ${claims.length} claims checked` : "Extracting checkable claims"}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-slate-200 font-medium" data-testid="progress-stage">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          {stage === "extracting" ? "Extracting checkable claims…" : `Verifying claims against the live web`}
        </span>
        <span className="font-mono text-xs text-slate-500" data-testid="progress-count">{done}/{claims.length || "?"}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Verification progress">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2">
        {claims.map((c) => (
          <li key={c.id} className="flex items-start gap-3 text-sm" data-testid={`progress-item-${c.id}`}>
            <StateIcon claim={c} />
            <span className={`flex-1 ${c.verdict ? VERDICT_STYLES[c.verdict].text : c.state === "checking" ? "text-slate-200" : "text-slate-500"}`}>{c.claim}</span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500 shrink-0">
              {c.verdict || (c.state === "checking" ? "searching" : "queued")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
