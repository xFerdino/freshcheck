import { Loader2, ScanSearch, RotateCcw, CalendarDays, Sparkles, X } from "lucide-react";
import { EXAMPLES, MAX_CHARS } from "../lib/freshcheck";

const CharCounter = ({ length }) => {
  const over = length > MAX_CHARS;
  const near = !over && length >= MAX_CHARS * 0.9;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 -mt-3 text-xs font-mono">
      <span className="text-rose-400" data-testid="error-too-long">{over ? "Answer is too long (max 8,000 characters)" : ""}</span>
      <span data-testid="char-counter" className={over ? "text-rose-400" : near ? "text-amber-400" : "text-slate-500"}>
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
    <section className="relative bg-slate-900/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4" data-testid="input-panel">
      <div className="space-y-2">
        <label htmlFor="input-answer-textarea" className="block text-sm font-medium text-slate-200">
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
          className="w-full bg-slate-950/80 border border-white/[0.08] rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/70 focus:border-transparent text-sm sm:text-base leading-relaxed resize-y min-h-[160px] transition-shadow"
        />
        <CharCounter length={answer.length} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
        <span className="flex items-center gap-1 text-slate-400 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> or try:
        </span>
        {EXAMPLES.map((ex, i) => (
          <span key={ex.id} className="inline-flex items-center">
            {i > 0 && <span className="text-slate-600 mx-1.5">·</span>}
            <button
              type="button"
              disabled={running}
              onClick={() => setAnswer(ex.text)}
              data-testid={`chip-example-${ex.id}`}
              className="text-indigo-400 hover:text-indigo-300 hover:underline disabled:opacity-40 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
            >
              {ex.title}
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between pt-1">
        <label className="flex flex-col gap-1 text-xs text-slate-300 max-w-sm">
          <span className="flex items-center gap-1.5 font-medium text-slate-200 text-sm">
            <CalendarDays className="w-4 h-4 text-indigo-400" /> Answer generated on (optional)
          </span>
          <span className="text-xs text-slate-400">When was this answer written? Helps judge what changed since.</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={running}
            data-testid="input-date"
            className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 normal-case tracking-normal font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500/70 [color-scheme:dark] mt-0.5"
          />
        </label>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={running ? onCancel : onReset}
              data-testid={running ? "btn-cancel" : "btn-reset"}
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5"
            >
              {running ? <X className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />} {running ? "Cancel" : "Reset"}
            </button>
            <button
              type="button"
              onClick={onCheck}
              disabled={isDisabled}
              data-testid="btn-check-freshness"
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-[background-color,transform] hover:bg-indigo-400 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              <span>{running ? "Checking…" : "Check freshness"}</span>
              {!running && <span className="hidden sm:inline-block text-xs font-mono opacity-80 bg-indigo-600/70 border border-white/15 rounded px-1.5 py-0.5 ml-1">⌘↵</span>}
            </button>
          </div>
          {answer.trim().length < 10 && !running && (
            <span className="text-xs text-slate-400 text-right pr-2" data-testid="hint-disabled">Paste at least 10 characters</span>
          )}
        </div>
      </div>
    </section>
  );
};
