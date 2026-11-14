import { useState, useEffect } from "react";
import { History as HistoryIcon, X, Trash2, ArrowRight, Clock } from "lucide-react";
import { scoreColor } from "../lib/freshcheck";

const STORAGE_KEY = "freshcheck_history";

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry) {
  try {
    const current = loadHistory().filter((item) => item.id !== entry.id && item.answer !== entry.answer);
    const next = [entry, ...current].slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export function clearHistoryStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  } catch {
    return [];
  }
}

export const HistoryDrawer = ({ open, onClose, onSelectRun, currentRunId, onHistoryChange }) => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (open) {
      setItems(loadHistory());
    }
  }, [open]);

  if (!open) return null;

  const handleClear = () => {
    clearHistoryStorage();
    setItems([]);
    if (onHistoryChange) onHistoryChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity" data-testid="history-drawer-backdrop" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Check history"
        data-testid="history-drawer"
        className="relative w-full max-w-md bg-slate-900 border-l border-white/[0.08] h-full shadow-2xl flex flex-col p-6 space-y-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-slate-100 font-display">Check History</h2>
            <span className="text-xs font-mono text-slate-500">({items.length}/20)</span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                data-testid="btn-clear-history"
                className="text-xs text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-500/10 flex items-center gap-1"
                title="Clear all history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              data-testid="btn-close-history"
              className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-white/5"
              aria-label="Close history"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {items.length === 0 ? (
            <div className="text-center py-12 text-slate-500 space-y-2">
              <Clock className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm">No saved checks yet.</p>
              <p className="text-xs text-slate-600">Past checks are stored locally in your browser.</p>
            </div>
          ) : (
            items.map((item) => {
              const isCurrent = item.id === currentRunId;
              const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }) : "Recent";
              const score = item.summary?.overall_score;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectRun(item);
                    onClose();
                  }}
                  data-testid={`history-item-${item.id}`}
                  className={`group rounded-xl border p-3.5 cursor-pointer transition-all ${
                    isCurrent
                      ? "bg-indigo-950/40 border-indigo-500/40 ring-1 ring-indigo-500/30"
                      : "bg-slate-950/60 border-white/[0.06] hover:border-indigo-400/40 hover:bg-slate-950"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-xs font-mono text-slate-400">{dateStr}</span>
                    {score != null && (
                      <span
                        className="text-xs font-bold font-display px-2 py-0.5 rounded-full border border-white/10"
                        style={{ color: scoreColor(score) }}
                      >
                        {score}/100
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-sans mb-2">
                    {item.answer}
                  </p>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-white/[0.04]">
                    <span>{item.claims?.length || 0} claims</span>
                    <span className="flex items-center gap-1 text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                      Reopen <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
