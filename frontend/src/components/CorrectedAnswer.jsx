import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, FileText, GitCompare, Loader2, Wand2 } from "lucide-react";
import { buildMarkdown, copyText, correctedMarkdown, rewriteAnswer } from "../lib/freshcheck";
import { computeWordDiff } from "../lib/diff";
import { ShareButton } from "./ShareButton";

function formatCitations(str) {
  if (!str) return "";
  return str.replace(/([^\s[])(\[\d+\])/g, "$1 $2").replace(/(\[\d+\])(\[\d+\])/g, "$1 $2");
}

const Btn = ({ children, ...props }) => (
  <button
    type="button"
    {...props}
    className="nm-btn inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {children}
  </button>
);

export const CorrectedAnswer = ({ runId, text, date, claims, summary, meta, corrected, setCorrected, onLog, shared }) => {
  const [loading, setLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [copiedCorrected, setCopiedCorrected] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const outdated = summary?.counts?.Outdated ?? 0;

  const formattedRewritten = useMemo(() => formatCitations(corrected?.rewritten), [corrected?.rewritten]);
  const diffOps = useMemo(() => (showDiff && corrected ? computeWordDiff(text, formattedRewritten) : []), [showDiff, text, formattedRewritten, corrected]);

  const generate = async () => {
    setLoading(true);
    try {
      const acceptedIds = claims
        .filter((c) => c.verdict === "Outdated" && c.useFix !== false)
        .map((c) => c.id);
      const editedFacts = {};
      claims.forEach((c) => {
        if (c.updated_fact) editedFacts[c.id] = c.updated_fact;
      });
      const res = await rewriteAnswer(runId, text, acceptedIds, editedFacts);
      setCorrected(res);
      if (res.log) onLog(res.log);
      toast.success("Corrected answer generated");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCorrected = async () => {
    if (!corrected) return;
    await copyText(correctedMarkdown(corrected));
    setCopiedCorrected(true);
    toast.success("Corrected answer copied to clipboard");
    setTimeout(() => setCopiedCorrected(false), 2000);
  };

  const handleCopyMarkdown = async () => {
    await copyText(md());
    setCopiedMarkdown(true);
    toast.success("Markdown report copied");
    setTimeout(() => setCopiedMarkdown(false), 2000);
  };

  const md = () => buildMarkdown({ text, claims, summary, corrected, meta });
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "freshcheck-report.md" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section id="fix-and-share" className="nm-flat rounded-3xl p-6 sm:p-8 space-y-5" data-testid="corrected-answer-section">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/60">
        <div>
          <h2 className="text-xl font-bold font-display text-slate-900">Fix &amp; share</h2>
          <p className="text-sm text-slate-600 mt-0.5 font-medium">
            {outdated ? `${outdated} outdated fact${outdated > 1 ? "s" : ""} can be fixed with citations.` : "No outdated facts to fix — export the report as is."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {/* Shared reports have no server run, so they can't be rewritten; show the stored result instead. */}
          {runId && (
          <button
            type="button"
            onClick={generate}
            disabled={loading || !outdated}
            data-testid="btn-copy-corrected-answer"
            className="nm-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {corrected ? "Regenerate corrected answer" : "Generate corrected answer"}
          </button>
          )}
          {!shared && <ShareButton variant="secondary" report={{ answer: text, date, claims, corrected }} />}
          <Btn onClick={handleCopyMarkdown} data-testid="btn-copy-markdown">
            {copiedMarkdown ? <Check className="w-4 h-4 text-emerald-600" /> : <FileText className="w-4 h-4 text-indigo-600" />}
            <span>{copiedMarkdown ? "Copied" : "Copy Markdown"}</span>
          </Btn>
          <Btn onClick={download} data-testid="btn-download-markdown">
            <Download className="w-4 h-4 text-indigo-600" /> Export .md
          </Btn>
        </div>
      </div>
      {corrected && (
        <div className="nm-inset rounded-2xl p-5 sm:p-6 space-y-4" data-testid="corrected-answer-output">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-emerald-700 font-bold">Corrected answer</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiff((s) => !s)}
                data-testid="btn-toggle-diff"
                className={`nm-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  showDiff ? "text-indigo-800 bg-indigo-50 border-indigo-400" : "text-slate-700"
                }`}
              >
                <GitCompare className="w-3.5 h-3.5 text-indigo-600" />
                <span>{showDiff ? "Hide changes" : "Show changes"}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCorrected}
                data-testid="btn-copy-corrected-again"
                className={`nm-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  copiedCorrected ? "text-emerald-800 bg-emerald-50 border-emerald-400" : "text-slate-700"
                }`}
                title="Copy corrected text"
              >
                {copiedCorrected ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copiedCorrected ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
          {showDiff ? (
            <div className="nm-inset-sm text-sm sm:text-base leading-relaxed text-slate-900 whitespace-pre-wrap font-sans p-4 rounded-xl bg-[#e2e8f0]" data-testid="corrected-answer-diff">
              {diffOps.map((op, i) => {
                if (op.type === "del") {
                  return (
                    <del key={i} className="line-through text-rose-800 bg-rose-500/15 px-1 py-0.5 rounded mx-0.5 font-medium">
                      {op.text}
                    </del>
                  );
                }
                if (op.type === "add") {
                  return (
                    <ins key={i} className="text-emerald-900 bg-emerald-500/15 px-1 py-0.5 rounded mx-0.5 font-medium underline decoration-emerald-600">
                      {op.text}
                    </ins>
                  );
                }
                return <span key={i}>{op.text}</span>;
              })}
            </div>
          ) : (
            <p className="text-sm sm:text-base leading-relaxed text-slate-900 whitespace-pre-wrap font-medium" data-testid="corrected-answer-text">
              {formattedRewritten || corrected.rewritten}
            </p>
          )}
          {corrected.sources.length > 0 && (
            <ol className="space-y-1.5 border-t border-white/60 pt-3">
              {corrected.sources.map((s) => (
                <li key={s.n} className="text-xs text-slate-600 font-medium">
                  <span className="font-mono text-indigo-700 font-bold">[{s.n}]</span>{" "}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 underline font-semibold" data-testid={`corrected-source-${s.n}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};
