import { useState } from "react";
import { ChevronDown, Cpu, Search } from "lucide-react";

const Row = ({ log, i }) => (
  <tr className="border-t border-slate-300/60" data-testid={`run-log-row-${i}`}>
    <td className="py-2.5 pr-3">
      <span className="inline-flex items-center gap-1.5 text-slate-800 font-semibold">
        {log.kind === "search" ? <Search className="w-3.5 h-3.5 text-sky-600" /> : <Cpu className="w-3.5 h-3.5 text-indigo-600" />}
        {log.stage}
      </span>
    </td>
    <td className="py-2.5 pr-3 text-slate-500 font-medium">{log.ref || "—"}</td>
    <td className="py-2.5 pr-3 text-slate-700 whitespace-nowrap font-medium">{log.model}</td>
    <td className="py-2.5 pr-3 text-slate-500">{log.route}</td>
    <td className="py-2.5 pr-3 text-right text-slate-700 font-semibold">{log.latency_ms ?? "—"}ms</td>
    <td className="py-2.5 pr-3 text-right text-slate-600 whitespace-nowrap">
      {log.kind === "llm" ? `${log.prompt_tokens} / ${log.completion_tokens}` : (
        <>
          {`${log.results ?? 0} results`}
          {log.cached && <span className="ml-2 rounded-full nm-pill px-2 py-0.5 text-xs text-sky-700 font-bold" data-testid={`run-log-cached-${i}`}>cached</span>}
        </>
      )}
    </td>
    <td className={`py-2.5 text-right font-bold ${log.status === "ok" ? "text-emerald-700" : "text-rose-700"}`} title={log.error}>{log.status}</td>
  </tr>
);

export const RunDetails = ({ logs, meta }) => {
  const [open, setOpen] = useState(false);
  const llm = logs.filter((l) => l.kind === "llm");
  const tokens = llm.reduce((a, l) => a + (l.prompt_tokens || 0) + (l.completion_tokens || 0), 0);
  const llmMs = llm.reduce((a, l) => a + (l.latency_ms || 0), 0);
  return (
    <section className="nm-flat rounded-3xl overflow-hidden" data-testid="run-details-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="run-details-body"
        data-testid="run-details-toggle"
        className="w-full flex flex-wrap items-center justify-between gap-3 px-6 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-all hover:bg-white/30"
      >
        <span className="font-display font-bold text-slate-900 text-base">Run details</span>
        <span className="flex items-center gap-4 font-mono text-xs text-slate-600 font-medium">
          <span data-testid="run-details-llm-calls">{llm.length} LLM calls</span>
          <span data-testid="run-details-tokens">{tokens.toLocaleString()} tokens</span>
          <span className="hidden sm:inline">{(llmMs / 1000).toFixed(1)}s LLM time</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="px-6 pb-6 space-y-4 pt-1 border-t border-white/60" data-testid="run-details-body">
          {meta && (
            <p className="font-mono text-xs text-slate-600">
              route: <span className="text-slate-900 font-bold">{meta.route}</span> · extract: <span className="text-slate-900 font-bold">{meta.extract_model}</span> · verdict: <span className="text-slate-900 font-bold">{meta.verdict_model}</span>
            </p>
          )}
          <div className="overflow-x-auto nm-inset rounded-2xl p-4 bg-[#e2e8f0]">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-left text-slate-500 uppercase tracking-wider text-[11px] font-bold">
                  <th className="pb-2.5 pr-3">Stage</th><th className="pb-2.5 pr-3">Claim</th>
                  <th className="pb-2.5 pr-3">Model</th><th className="pb-2.5 pr-3">Route</th>
                  <th className="pb-2.5 pr-3 text-right">Latency</th><th className="pb-2.5 pr-3 text-right">Tokens in/out</th>
                  <th className="pb-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody>{logs.map((l, i) => <Row key={i} log={l} i={i} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
