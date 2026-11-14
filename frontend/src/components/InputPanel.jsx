import { Loader2, ScanSearch, RotateCcw, CalendarDays, Sparkles, X } from "lucide-react";
import { EXAMPLES, MAX_CHARS } from "../lib/freshcheck";

const CharCounter = ({ length }) => {
  const over = length > MAX_CHARS;
  const near = !over && length >= MAX_CHARS * 0.9;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pt-1">
      <span className="text-rose-600 font-semibold" data-testid="error-too-long">
        {over ? "Answer is too long (max 8,000 characters)" : ""}
      </span>
      <span data-testid="char-counter" className={over ? "text-rose-600 font-bold" : near ? "text-amber-600 font-bold" : "text-slate-500"}>
        {length.toLocaleString("en-US")} / {MAX_CHARS.toLocaleString("en-US")}
      </span>
    </div>
  );
};

export const InputPanel = ({ answer, setAnswer, date, setDate, onCheck, onReset, onCancel, running }) => {
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (!running && answer.trim().length >= 10 && answer.length <= MAX_CHARS) {
        e.preventDefault();
        onCheck();
      }
    }
  };

  const isDisabled = running || answer.trim().length < 10 || answer.length > MAX_CHARS;

  return (
    <section className="relative nm-flat rounded-3xl p-6 sm:p-8 space-y-5" data-testid="input-panel">
      <div className="space-y-2">
        <label htmlFor="input-answer-textarea" className="block text-sm font-bold text-slate-800 tracking-tight">
          AI answer to check
        </label>
        <textarea
          id="input-answer-textarea"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          placeholder="Paste an AI-generated answer here…"
          data-testid="input-answer-textarea"
          className="w-full nm-inset rounded-2xl p-5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm sm:text-base leading-relaxed resize-y min-h-[170px] transition-all"
        />
        <CharCounter length={answer.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 pt-1">
        <span className="flex items-center gap-1.5 text-slate-600 font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" /> Examples:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              type="button"
              disabled={running}
              onClick={() => setAnswer(ex.text)}
              data-testid={`chip-example-${ex.id}`}
              className="nm-pill px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {ex.title}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-5 sm:justify-between pt-2 border-t border-white/60">
        <label className="flex flex-col gap-1 text-xs text-slate-600 max-w-sm">
          <span className="flex items-center gap-1.5 font-bold text-slate-800 text-sm">
            <CalendarDays className="w-4 h-4 text-indigo-600" /> Answer generated on (optional)
          </span>
          <span className="text-xs text-slate-500">When was this answer written? Helps judge what changed since.</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={running}
            data-testid="input-date"
            className="nm-inset-sm rounded-xl px-3.5 py-2 text-sm text-slate-800 font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:light] mt-1"
          />
        </label>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={running ? onCancel : onReset}
              data-testid={running ? "btn-cancel" : "btn-reset"}
              className="nm-btn flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-all"
            >
              {running ? <X className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />} {running ? "Cancel" : "Reset"}
            </button>
            <button
              type="button"
              onClick={onCheck}
              disabled={isDisabled}
              data-testid="btn-check-freshness"
              className="nm-btn-primary flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full px-7 py-2.5 text-sm font-bold text-white shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              <span>{running ? "Checking…" : "Check freshness"}</span>
              {!running && <span className="hidden sm:inline-block text-[11px] font-mono opacity-90 bg-indigo-700/50 rounded-md px-1.5 py-0.5 ml-1">⌘↵</span>}
            </button>
          </div>
          {answer.trim().length < 10 && !running && (
            <span className="text-xs text-slate-500 text-right pr-2" data-testid="hint-disabled">Paste at least 10 characters</span>
          )}
        </div>
      </div>
    </section>
  );
};
