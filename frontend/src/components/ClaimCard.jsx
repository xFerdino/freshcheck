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
    <p className="flex items-center gap-2 text-xs text-slate-500" data-testid={`no-sources-${claim.id}`}>
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
            className="group flex items-start gap-2 rounded-lg px-2.5 py-2 -mx-2.5 transition-colors hover:bg-white/[0.04]"
          >
            <ArrowUpRight className="w-3.5 h-3.5 mt-0.5 text-slate-500 group-hover:text-sky-400 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm text-slate-200 group-hover:text-sky-300 truncate">{s.title}</span>
              <span className="block font-mono text-xs text-slate-400">
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
  const v = claim.verdict;
  const style = VERDICT_STYLES[v || "Pending"];

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
      className="relative bg-slate-900/80 border border-white/[0.08] rounded-2xl p-5 sm:p-6 overflow-hidden"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: style.color }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`} data-testid={`badge-verdict-${claim.id}`}>
              {!v && <Loader2 className="w-3 h-3 animate-spin" />}{v || "Checking"}
            </span>
            <span className="text-xs font-medium text-slate-400 capitalize">{claim.category}</span>
            {v && (
              <div className="inline-flex items-center gap-1.5 ml-auto sm:ml-0">
                <button
                  type="button"
                  disabled={rechecking}
                  onClick={handleRecheck}
                  data-testid={`btn-recheck-claim-${claim.id}`}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-300 rounded px-2 py-0.5 border border-white/10 hover:border-indigo-400/40 bg-slate-950/40 transition-colors disabled:opacity-50"
                  title="Re-check this claim with live search"
                >
                  <RefreshCw className={`w-3 h-3 ${rechecking ? "animate-spin text-indigo-400" : ""}`} />
                  <span>{rechecking ? "Re-checking…" : "Re-check"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingQuery((s) => !s)}
                  className="text-xs text-slate-400 hover:text-slate-200 underline"
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
                className="flex-1 bg-slate-950 border border-white/10 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                type="button"
                disabled={rechecking}
                onClick={handleRecheck}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
              >
                Run
              </button>
            </div>
          )}
          <h3 className="text-base sm:text-lg font-semibold text-slate-100 leading-snug">{claim.claim}</h3>
        </div>
        {v && (
          <div className="text-right shrink-0" data-testid={`score-claim-${claim.id}`}>
            <div className="text-3xl font-display font-extrabold" style={{ color: scoreColor(claim.freshness_score) }}>{claim.freshness_score}</div>
            <div className="font-mono text-xs uppercase tracking-wider text-slate-400">fresh</div>
          </div>
        )}
      </div>
      {v && (
        <div className="mt-4 space-y-4">
          {claim.updated_fact && (
            <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5" data-testid={`box-corrected-fact-${claim.id}`}>
              <RefreshCw className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-400 mb-1">Up-to-date fact</p>
                <p className="text-sm text-emerald-100">{claim.updated_fact}</p>
              </div>
            </div>
          )}
          <p className="text-sm text-slate-300" data-testid={`reason-${claim.id}`}>{claim.reason}</p>
          {claim.updated_fact && (
            <button
              type="button"
              onClick={async () => {
                const src = claim.sources[0];
                await copyText(`${claim.updated_fact}${src ? ` (Source: ${src.title} — ${src.url})` : ""}`);
                toast.success("Corrected fact copied");
              }}
              data-testid={`btn-copy-fix-${claim.id}`}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200"
            >
              <Copy className="w-3.5 h-3.5" /> Copy fix with citation
            </button>
          )}
          <div className="border-t border-white/[0.06] pt-3">
            <p className="text-xs font-medium text-slate-400 mb-2">Sources</p>
            <Sources claim={claim} />
          </div>
        </div>
      )}
    </motion.article>
  );
};
