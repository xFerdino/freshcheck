import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileText, Loader2, Wand2 } from "lucide-react";
import { buildMarkdown, copyText, correctedMarkdown, rewriteAnswer } from "../lib/freshcheck";

const Btn = ({ children, ...props }) => (
  <button
    type="button"
    {...props}
    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-indigo-400/60 hover:bg-indigo-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {children}
  </button>
);

export const CorrectedAnswer = ({ runId, text, claims, summary, meta, corrected, setCorrected, onLog }) => {
  const [loading, setLoading] = useState(false);
  const outdated = summary?.counts?.Outdated ?? 0;

  const generate = async () => {
    setLoading(true);
    try {
      const res = await rewriteAnswer(runId, text);
      setCorrected(res);
      if (res.log) onLog(res.log);
      await copyText(correctedMarkdown(res));
      toast.success("Corrected answer copied to clipboard");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const md = () => buildMarkdown({ text, claims, summary, corrected, meta });
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "freshcheck-report.md" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section id="fix-and-share" className="bg-slate-900/80 border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4" data-testid="corrected-answer-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Fix &amp; share</h2>
          <p className="text-sm text-slate-400">
            {outdated ? `${outdated} outdated fact${outdated > 1 ? "s" : ""} can be fixed with citations.` : "No outdated facts to fix — export the report as is."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={loading || !outdated}
            data-testid="btn-copy-corrected-answer"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-[background-color,transform] hover:bg-emerald-400 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {corrected ? "Regenerate & copy" : "Copy corrected answer"}
          </button>
          <Btn onClick={async () => { await copyText(md()); toast.success("Markdown report copied"); }} data-testid="btn-copy-markdown">
            <FileText className="w-4 h-4" /> Copy Markdown
          </Btn>
          <Btn onClick={download} data-testid="btn-download-markdown">
            <Download className="w-4 h-4" /> Export .md
          </Btn>
        </div>
      </div>
      {corrected && (
        <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4 space-y-3" data-testid="corrected-answer-output">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/80">Corrected answer</span>
            <button type="button" onClick={async () => { await copyText(correctedMarkdown(corrected)); toast.success("Copied"); }} data-testid="btn-copy-corrected-again" className="text-slate-400 hover:text-slate-100">
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm sm:text-base leading-relaxed text-slate-200 whitespace-pre-wrap" data-testid="corrected-answer-text">{corrected.rewritten}</p>
          {corrected.sources.length > 0 && (
            <ol className="space-y-1 border-t border-white/[0.06] pt-3">
              {corrected.sources.map((s) => (
                <li key={s.n} className="text-xs text-slate-400">
                  <span className="font-mono text-slate-500">[{s.n}]</span>{" "}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-sky-300 underline decoration-white/10" data-testid={`corrected-source-${s.n}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};
