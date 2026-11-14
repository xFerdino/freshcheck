import { useState } from "react";
import { ChevronDown, Cpu, Search } from "lucide-react";

const Row = ({ log, i }) => (
  <tr className="border-t border-white/[0.05]" data-testid={`run-log-row-${i}`}>
    <td className="py-2 pr-3">
      <span className="inline-flex items-center gap-1.5 text-slate-300">
        {log.kind === "search" ? <Search className="w-3 h-3 text-sky-400" /> : <Cpu className="w-3 h-3 text-indigo-400" />}
        {log.stage}
      </span>
    </td>
    <td className="py-2 pr-3 text-slate-500">{log.ref || "—"}</td>
    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{log.model}</td>
    <td className="py-2 pr-3 text-slate-500">{log.route}</td>
    <td className="py-2 pr-3 text-right text-slate-300">{log.latency_ms ?? "—"}ms</td>
    <td className="py-2 pr-3 text-right text-slate-400 whitespace-nowrap">
      {log.kind === "llm" ? `${log.prompt_tokens} / ${log.completion_tokens}` : (
        <>
          {`${log.results ?? 0} results`}
          {log.cached && <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-300 font-medium" data-testid={`run-log-cached-${i}`}>cached</span>}
        </>
      )}
    </td>
    <td className={`py-2 text-right ${log.status === "ok" ? "text-emerald-400" : "text-rose-400"}`} title={log.error}>{log.status}</td>
  </tr>
);

export const RunDetails = ({ logs, meta }) => {
  const [open, setOpen] = useState(false);
  const llm = logs.filter((l) => l.kind === "llm");
  const tokens = llm.reduce((a, l) => a + (l.prompt_tokens || 0) + (l.completion_tokens || 0), 0);
  const llmMs = llm.reduce((a, l) => a + (l.latency_ms || 0), 0);
  return (
    <section className="bg-slate-900/80 border border-white/[0.08] rounded-2xl" data-testid="run-details-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="run-details-body"
        data-testid="run-details-toggle"
        className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-2xl"
      >
        <span className="font-display font-semibold text-slate-100">Run details</span>
        <span className="flex items-center gap-4 font-mono text-xs text-slate-400">
          <span data-testid="run-details-llm-calls">{llm.length} LLM calls</span>
          <span data-testid="run-details-tokens">{tokens.toLocaleString()} tokens</span>
          <span className="hidden sm:inline">{(llmMs / 1000).toFixed(1)}s LLM time</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3" data-testid="run-details-body">
          {meta && (
            <p className="font-mono text-xs text-slate-500">
              route: <span className="text-slate-300">{meta.route}</span> · extract: <span className="text-slate-300">{meta.extract_model}</span> · verdict: <span className="text-slate-300">{meta.verdict_model}</span>
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-left text-slate-400 uppercase tracking-wider text-xs">
                  <th className="pb-2 pr-3 font-medium">Stage</th><th className="pb-2 pr-3 font-medium">Claim</th>
                  <th className="pb-2 pr-3 font-medium">Model</th><th className="pb-2 pr-3 font-medium">Route</th>
                  <th className="pb-2 pr-3 font-medium text-right">Latency</th><th className="pb-2 pr-3 font-medium text-right">Tokens in/out</th>
                  <th className="pb-2 font-medium text-right">Status</th>
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
