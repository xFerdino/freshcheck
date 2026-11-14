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
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm transition-opacity" data-testid="history-drawer-backdrop" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Check history"
        data-testid="history-drawer"
        className="relative w-full max-w-md bg-[var(--nm-bg)] border-l border-white/60 h-full shadow-2xl flex flex-col p-6 space-y-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/60">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-indigo-600" />
            <h2 className="text-xl font-bold text-slate-900 font-display">Check History</h2>
            <span className="text-xs font-mono text-slate-500 font-semibold">({items.length}/20)</span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                data-testid="btn-clear-history"
                className="nm-btn text-xs text-rose-700 hover:text-rose-800 px-3 py-1 rounded-full flex items-center gap-1 font-semibold"
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
              className="nm-btn text-slate-600 hover:text-slate-900 p-1.5 rounded-full"
              aria-label="Close history"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
          {items.length === 0 ? (
            <div className="text-center py-16 text-slate-500 space-y-3">
              <Clock className="w-10 h-10 mx-auto text-slate-400" />
              <p className="text-sm font-semibold text-slate-700">No saved checks yet.</p>
              <p className="text-xs text-slate-500">Past checks are stored locally in your browser.</p>
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
                  className={`group rounded-2xl p-4 cursor-pointer transition-all ${
                    isCurrent
                      ? "nm-inset ring-2 ring-indigo-500/50"
                      : "nm-flat hover:scale-[1.01]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs font-mono text-slate-500 font-medium">{dateStr}</span>
                    {score != null && (
                      <span
                        className="text-xs font-bold font-display px-2.5 py-0.5 rounded-full nm-pill"
                        style={{ color: scoreColor(score) }}
                      >
                        {score}/100
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2 leading-relaxed font-sans mb-3 font-medium">
                    {item.answer}
                  </p>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-2 border-t border-white/60">
                    <span className="font-semibold">{item.claims?.length || 0} claims</span>
                    <span className="flex items-center gap-1 text-indigo-600 font-bold group-hover:translate-x-1 transition-transform">
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
