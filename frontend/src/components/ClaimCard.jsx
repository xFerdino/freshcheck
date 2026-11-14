import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { ArrowUpRight, Copy, Loader2, RefreshCw, Link2Off } from "lucide-react";
import { VERDICT_STYLES, copyText, recheckClaim, scoreColor } from "../lib/freshcheck";

const formatDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

const Sources = ({ claim }) =>
  claim.sources.length === 0 ? (
    <p className="flex items-center gap-2 text-xs text-slate-500 font-medium" data-testid={`no-sources-${claim.id}`}>
      <Link2Off className="w-3.5 h-3.5" /> No sources found — nothing is invented.
    </p>
  ) : (
    <ul className="space-y-1.5">
      {claim.sources.map((s, i) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`link-source-${claim.id}-${i}`}
            className="group flex items-start gap-2.5 rounded-xl px-3 py-2 -mx-2 transition-all hover:nm-flat-sm text-slate-800 hover:text-indigo-700"
          >
            <ArrowUpRight className="w-4 h-4 mt-0.5 text-slate-400 group-hover:text-indigo-600 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{s.title}</span>
              <span className="block font-mono text-xs text-slate-500">
                {hostOf(s.url)}{formatDate(s.date) ? ` · ${formatDate(s.date)}` : ""}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );

export const ClaimCard = ({ claim, index, runId, generatedDate, onUpdateClaim, onLog }) => {
  const shouldReduceMotion = useReducedMotion();
  const [rechecking, setRechecking] = useState(false);
  const [editingQuery, setEditingQuery] = useState(false);
  const [queryInput, setQueryInput] = useState(claim.search_query || "");
  const [editingFact, setEditingFact] = useState(false);
  const [factInput, setFactInput] = useState(claim.updated_fact || "");
  const v = claim.verdict;
  const style = VERDICT_STYLES[v || "Pending"];
  const useFix = claim.useFix !== false;

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      const res = await recheckClaim({
        runId,
        claim,
        generatedDate,
        searchQuery: queryInput.trim() || claim.search_query,
      });
      if (res.result) {
        onUpdateClaim?.(res.result);
        if (res.logs && onLog) {
          res.logs.forEach((l) => onLog(l));
        }
        toast.success(`Claim re-checked: ${res.result.verdict}`);
      }
    } catch (e) {
      toast.error(e.message || "Re-check failed");
    } finally {
      setRechecking(false);
    }
  };

  return (
    <motion.article
      initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.35, delay: index * 0.04 }}
      data-testid={`card-claim-${claim.id}`}
      className="relative nm-flat rounded-3xl p-6 sm:p-7 overflow-hidden transition-all"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: style.color }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2.5 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${style.badge}`} data-testid={`badge-verdict-${claim.id}`}>
              {!v && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{v || "Checking"}
            </span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{claim.category}</span>
            {v && runId && (
              <div className="inline-flex items-center gap-2 ml-auto sm:ml-0">
                <button
                  type="button"
                  disabled={rechecking}
                  onClick={handleRecheck}
                  data-testid={`btn-recheck-claim-${claim.id}`}
                  className="nm-btn inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 rounded-full px-3 py-1 font-semibold transition-all disabled:opacity-50"
                  title="Re-check this claim with live search"
                >
                  <RefreshCw className={`w-3 h-3 ${rechecking ? "animate-spin text-indigo-600" : ""}`} />
                  <span>{rechecking ? "Re-checking…" : "Re-check"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingQuery((s) => !s)}
                  className="text-xs text-slate-500 hover:text-indigo-600 underline font-medium"
                  title="Edit search query for re-checking"
                >
                  {editingQuery ? "hide query" : "edit query"}
                </button>
              </div>
            )}
          </div>
          {editingQuery && (
            <div className="flex gap-2 pt-1 pb-1">
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search query…"
                data-testid={`input-recheck-query-${claim.id}`}
                className="flex-1 nm-inset-sm rounded-xl px-3 py-1.5 text-xs text-slate-800 font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                disabled={rechecking}
                onClick={handleRecheck}
                className="nm-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all disabled:opacity-50"
              >
                Run
              </button>
            </div>
          )}
          <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">{claim.claim}</h3>
        </div>
        {v && (
          <div className="text-right shrink-0" data-testid={`score-claim-${claim.id}`}>
            <div className="text-3xl font-display font-black" style={{ color: scoreColor(claim.freshness_score) }}>{claim.freshness_score}</div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500 font-bold">fresh</div>
          </div>
        )}
      </div>
      {v && (
        <div className="mt-5 space-y-4">
          {claim.updated_fact && (
            <div className={`space-y-2 rounded-2xl p-4 transition-all ${useFix ? "nm-inset border border-emerald-500/30" : "nm-inset opacity-60 border border-slate-300"}`} data-testid={`box-corrected-fact-${claim.id}`}>
              <div className="flex items-start gap-3">
                <RefreshCw className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Up-to-date fact</p>
                    {!useFix && <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold">Ignored</span>}
                  </div>
                  {editingFact ? (
                    <div className="space-y-2 pt-1">
                      <input
                        type="text"
                        value={factInput}
                        onChange={(e) => setFactInput(e.target.value)}
                        data-testid={`input-edit-fact-${claim.id}`}
                        className="w-full nm-inset-sm rounded-xl px-3 py-1.5 text-xs text-slate-900 font-sans focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateClaim?.({ ...claim, updated_fact: factInput.trim() });
                            setEditingFact(false);
                            toast.success("Fact updated");
                          }}
                          data-testid={`btn-save-fact-${claim.id}`}
                          className="nm-btn-primary rounded-xl px-3 py-1 text-xs font-bold text-white transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFactInput(claim.updated_fact || "");
                            setEditingFact(false);
                          }}
                          className="nm-btn rounded-xl px-3 py-1 text-xs font-medium text-slate-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-slate-900 leading-snug">{claim.updated_fact}</p>
                  )}
                </div>
              </div>
              {runId && (<div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-white/60">
                <button
                  type="button"
                  onClick={() => {
                    const nextUseFix = !useFix;
                    onUpdateClaim?.({ ...claim, useFix: nextUseFix });
                    toast(nextUseFix ? "Fix included for rewrite" : "Fix ignored for rewrite");
                  }}
                  data-testid={`btn-toggle-fix-${claim.id}`}
                  className={`nm-pill inline-flex items-center gap-1.5 text-xs font-bold rounded-full px-3 py-1 transition-all ${
                    useFix
                      ? "text-emerald-800 bg-emerald-500/10 border-emerald-400/40"
                      : "text-slate-500"
                  }`}
                >
                  {useFix ? "✓ Use this fix" : "✕ Ignored"}
                </button>
                {!editingFact && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingFact(true);
                      setFactInput(claim.updated_fact || "");
                    }}
                    data-testid={`btn-edit-fact-${claim.id}`}
                    className="text-xs text-slate-500 hover:text-indigo-600 underline font-medium px-1"
                  >
                    Edit fact
                  </button>
                )}
              </div>)}
            </div>
          )}
          <p className="text-sm text-slate-700 leading-relaxed" data-testid={`reason-${claim.id}`}>{claim.reason}</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {claim.updated_fact && (
              <button
                type="button"
                onClick={async () => {
                  const src = claim.sources[0];
                  await copyText(`${claim.updated_fact}${src ? ` (Source: ${src.title} — ${src.url})` : ""}`);
                  toast.success("Corrected fact copied");
                }}
                data-testid={`btn-copy-fix-${claim.id}`}
                className="nm-btn inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900 rounded-full px-3.5 py-1.5"
              >
                <Copy className="w-3.5 h-3.5 text-emerald-600" /> Copy fix with citation
              </button>
            )}
            {v && runId && v !== "Current" && (
              <button
                type="button"
                onClick={() => {
                  onUpdateClaim?.({
                    ...claim,
                    verdict: "Current",
                    freshness_score: 100,
                    updated_fact: null,
                    reason: "Manually marked as current by user.",
                  });
                  toast.success("Marked as current");
                }}
                data-testid={`btn-mark-current-${claim.id}`}
                className="nm-btn inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 rounded-full px-3 py-1.5 ml-auto"
                title="Override: treat this claim as current and up to date"
              >
                Mark as current
              </button>
            )}
          </div>
          <div className="border-t border-white/60 pt-3.5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Sources</p>
            <Sources claim={claim} />
          </div>
        </div>
      )}
    </motion.article>
  );
};
