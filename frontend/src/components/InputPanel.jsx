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

export const InputPanel = ({ answer, setAnswer, date, setDate, onCheck, onReset, onCancel, running }) => (
  <section className="relative bg-slate-900/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5" data-testid="input-panel">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-slate-500 mr-1">
        <Sparkles className="w-3.5 h-3.5" /> Try an example
      </span>
      {EXAMPLES.map((ex) => (
        <button
          key={ex.id}
          type="button"
          disabled={running}
          onClick={() => setAnswer(ex.text)}
          data-testid={`chip-example-${ex.id}`}
          className="group text-left rounded-full border border-white/10 bg-slate-950/60 px-3.5 py-1.5 transition-colors hover:border-indigo-400/60 hover:bg-indigo-500/10 disabled:opacity-40"
        >
          <span className="text-sm font-medium text-slate-200">{ex.title}</span>
          <span className="hidden sm:inline text-xs text-slate-500 ml-2 group-hover:text-slate-400">{ex.label}</span>
        </button>
      ))}
    </div>

    <textarea
      value={answer}
      onChange={(e) => setAnswer(e.target.value)}
      disabled={running}
      placeholder="Paste an AI-generated answer here…"
      data-testid="input-answer-textarea"
      className="w-full bg-slate-950/80 border border-white/[0.08] rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/70 focus:border-transparent text-sm sm:text-base leading-relaxed resize-y min-h-[160px] transition-shadow"
    />
    <CharCounter length={answer.length} />

    <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
      <label className="flex flex-col gap-1.5 text-xs font-mono uppercase tracking-widest text-slate-500">
        <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Generated on (optional)</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={running}
          data-testid="input-date"
          className="bg-slate-950/80 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 normal-case tracking-normal font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500/70 [color-scheme:dark]"
        />
      </label>
      <div className="flex gap-3">
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
          disabled={running || answer.trim().length < 10 || answer.length > MAX_CHARS}
          data-testid="btn-check-freshness"
          className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-[background-color,transform] hover:bg-indigo-400 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
          {running ? "Checking…" : "Check freshness"}
        </button>
      </div>
    </div>
  </section>
);
