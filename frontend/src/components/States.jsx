import { AlertTriangle, FileSearch, Globe, ListChecks, RotateCw } from "lucide-react";

const STEPS = [
  { icon: ListChecks, title: "Extract", text: "A fast model splits the answer into atomic, checkable claims." },
  { icon: Globe, title: "Search", text: "Each claim is searched on the live web with Tavily." },
  { icon: FileSearch, title: "Judge", text: "A stronger model compares claim vs evidence — no evidence, no verdict." },
];

export const EmptyState = () => (
  <details className="group rounded-3xl nm-flat p-5 sm:p-6 text-xs text-slate-600 transition-all" data-testid="empty-state">
    <summary className="cursor-pointer font-bold text-slate-800 hover:text-indigo-600 flex items-center justify-between select-none list-none">
      <span className="flex items-center gap-2 text-sm">
        <ListChecks className="w-4 h-4 text-indigo-600" />
        How FreshCheck works
      </span>
      <span className="text-slate-500 group-open:rotate-180 transition-transform font-bold">▾</span>
    </summary>
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4 border-t border-white/60">
      {STEPS.map(({ icon: Icon, title, text }, i) => (
        <div key={title} className="space-y-2">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <span className="w-6 h-6 rounded-lg nm-inset-sm flex items-center justify-center font-mono text-indigo-700 text-xs">
              0{i + 1}
            </span>
            <Icon className="w-4 h-4 text-indigo-600" />
            <span>{title}</span>
          </div>
          <p className="text-slate-600 leading-relaxed font-normal">{text}</p>
        </div>
      ))}
    </div>
  </details>
);

export const ErrorState = ({ message, onRetry }) => (
  <section className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-3xl nm-flat border-l-4 border-l-rose-500 p-6 text-slate-800" data-testid="error-state">
    <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
    <div className="flex-1">
      <p className="font-bold text-rose-900 text-base">The check couldn't finish</p>
      <p className="text-sm text-rose-800/80 font-medium" data-testid="error-message">{message}</p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      data-testid="btn-retry"
      className="nm-btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-rose-700 hover:text-rose-800 transition-all"
    >
      <RotateCw className="w-4 h-4" /> Try again
    </button>
  </section>
);

export const Footer = ({ config }) => (
  <footer className="pt-8 pb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 font-mono">
    <span
      data-testid="route-badge"
      title={config ? `extract: ${config.extract_model} · verdict: ${config.verdict_model}` : ""}
      className={`nm-pill inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full font-semibold ${
        config?.route === "bifrost" ? "text-sky-800 bg-sky-50" : "text-slate-700"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${config?.route === "bifrost" ? "bg-sky-500" : "bg-slate-400"}`} />
      {config ? (config.route === "bifrost" ? "Routed via Bifrost" : "Direct") : "…"}
    </span>
    <span className="font-medium text-slate-500">Evidence from live Tavily search · sources are never invented</span>
  </footer>
);
