import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { ArrowUpRight, Copy, Loader2, RefreshCw, Link2Off } from "lucide-react";
import { VERDICT_STYLES, copyText, scoreColor } from "../lib/freshcheck";

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
              <span className="block font-mono text-[11px] text-slate-500">
                {hostOf(s.url)}{formatDate(s.date) ? ` · ${formatDate(s.date)}` : ""}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );

export const ClaimCard = ({ claim, index }) => {
  const shouldReduceMotion = useReducedMotion();
  const v = claim.verdict;
  const style = VERDICT_STYLES[v || "Pending"];
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
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`} data-testid={`badge-verdict-${claim.id}`}>
              {!v && <Loader2 className="w-3 h-3 animate-spin" />}{v || "Checking"}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{claim.category}</span>
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-slate-100 leading-snug">{claim.claim}</h3>
        </div>
        {v && (
          <div className="text-right shrink-0" data-testid={`score-claim-${claim.id}`}>
            <div className="text-3xl font-display font-extrabold" style={{ color: scoreColor(claim.freshness_score) }}>{claim.freshness_score}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">fresh</div>
          </div>
        )}
      </div>
      {v && (
        <div className="mt-4 space-y-4">
          {claim.updated_fact && (
            <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5" data-testid={`box-corrected-fact-${claim.id}`}>
              <RefreshCw className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/80 mb-1">Up-to-date fact</p>
                <p className="text-sm text-emerald-100">{claim.updated_fact}</p>
              </div>
            </div>
          )}
          <p className="text-sm text-slate-400" data-testid={`reason-${claim.id}`}>{claim.reason}</p>
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
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">Sources</p>
            <Sources claim={claim} />
          </div>
        </div>
      )}
    </motion.article>
  );
};
