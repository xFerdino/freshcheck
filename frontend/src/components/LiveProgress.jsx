import { CheckCircle2, Loader2, Circle, XCircle, HelpCircle } from "lucide-react";
import { VERDICT_STYLES } from "../lib/freshcheck";

const StateIcon = ({ claim }) => {
  if (claim.verdict === "Current") return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (claim.verdict === "Outdated") return <XCircle className="w-4 h-4 text-rose-600 shrink-0" />;
  if (claim.verdict === "Uncertain") return <HelpCircle className="w-4 h-4 text-amber-600 shrink-0" />;
  if (claim.state === "checking") return <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-400 shrink-0" />;
};

export const LiveProgress = ({ stage, claims }) => {
  const done = claims.filter((c) => c.verdict).length;
  const pct = claims.length ? Math.round((done / claims.length) * 100) : 6;
  return (
    <section className="nm-flat rounded-3xl p-6 sm:p-7 space-y-4" data-testid="live-progress-bar">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {claims.length ? `${done} of ${claims.length} claims checked` : "Extracting checkable claims"}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-slate-900 font-bold" data-testid="progress-stage">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          {stage === "extracting" ? "Extracting checkable claims…" : `Verifying claims against the live web`}
        </span>
        <span className="font-mono text-xs text-slate-600 font-bold" data-testid="progress-count">{done}/{claims.length || "?"}</span>
      </div>
      <div className="h-2.5 w-full nm-inset-sm rounded-full overflow-hidden p-0.5" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Verification progress">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-sky-500 rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2.5 pt-1">
        {claims.map((c) => (
          <li key={c.id} className="flex items-start gap-3 text-sm" data-testid={`progress-item-${c.id}`}>
            <StateIcon claim={c} />
            <span className={`flex-1 ${c.verdict ? VERDICT_STYLES[c.verdict].text : c.state === "checking" ? "text-slate-900 font-medium" : "text-slate-500"}`}>{c.claim}</span>
            <span className="font-mono text-xs uppercase tracking-wider text-slate-500 font-bold shrink-0">
              {c.verdict || (c.state === "checking" ? "searching" : "queued")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
