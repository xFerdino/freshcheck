import { AlertTriangle, FileSearch, Globe, ListChecks, RotateCw } from "lucide-react";

const STEPS = [
  { icon: ListChecks, title: "Extract", text: "A fast model splits the answer into atomic, checkable claims." },
  { icon: Globe, title: "Search", text: "Each claim is searched on the live web with Tavily." },
  { icon: FileSearch, title: "Judge", text: "A stronger model compares claim vs evidence — no evidence, no verdict." },
];

export const EmptyState = () => (
  <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="empty-state">
    {STEPS.map(({ icon: Icon, title, text }, i) => (
      <div key={title} className="rounded-2xl border border-dashed border-white/10 p-5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-600">0{i + 1}</span>
          <Icon className="w-4 h-4 text-indigo-300" />
          <h3 className="font-display font-semibold text-slate-200">{title}</h3>
        </div>
        <p className="text-sm text-slate-500">{text}</p>
      </div>
    ))}
  </section>
);

export const ErrorState = ({ message, onRetry }) => (
  <section className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] p-5" data-testid="error-state">
    <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
    <div className="flex-1">
      <p className="font-semibold text-rose-200">The check couldn't finish</p>
      <p className="text-sm text-rose-200/70" data-testid="error-message">{message}</p>
    </div>
    <button type="button" onClick={onRetry} data-testid="btn-retry" className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/15 transition-colors">
      <RotateCw className="w-4 h-4" /> Try again
    </button>
  </section>
);

export const Footer = ({ config }) => (
  <footer className="pt-6 pb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600 font-mono">
    <span
      data-testid="route-badge"
      title={config ? `extract: ${config.extract_model} · verdict: ${config.verdict_model}` : ""}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${config?.route === "bifrost" ? "border-sky-400/40 text-sky-300 bg-sky-500/10" : "border-white/10 text-slate-400"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config?.route === "bifrost" ? "bg-sky-400" : "bg-slate-500"}`} />
      {config ? (config.route === "bifrost" ? "Routed via Bifrost" : "Direct") : "…"}
    </span>
    <span>Evidence from live Tavily search · sources are never invented</span>
  </footer>
);
