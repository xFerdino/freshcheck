import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, FileText, GitCompare, Loader2, Wand2 } from "lucide-react";
import { buildMarkdown, copyText, correctedMarkdown, rewriteAnswer } from "../lib/freshcheck";

function formatCitations(str) {
  if (!str) return "";
  return str.replace(/([^\s[])(\[\d+\])/g, "$1 $2").replace(/(\[\d+\])(\[\d+\])/g, "$1 $2");
}

function computeWordDiff(origText, newText) {
  const words1 = (origText || "").match(/\S+|\s+/g) || [];
  const words2 = (newText || "").match(/\S+|\s+/g) || [];
  const n = words1.length;
  const m = words2.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (words1[i] === words2[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  let i = n, j = m;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && words1[i - 1] === words2[j - 1]) {
      ops.push({ type: "same", text: words1[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", text: words2[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: "del", text: words1[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

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
            {corrected ? "Regenerate corrected answer" : "Generate corrected answer"}
          </button>
          <Btn onClick={handleCopyMarkdown} data-testid="btn-copy-markdown">
            {copiedMarkdown ? <Check className="w-4 h-4 text-emerald-400" /> : <FileText className="w-4 h-4" />}
            <span>{copiedMarkdown ? "Copied" : "Copy Markdown"}</span>
          </Btn>
          <Btn onClick={download} data-testid="btn-download-markdown">
            <Download className="w-4 h-4" /> Export .md
          </Btn>
        </div>
      </div>
      {corrected && (
        <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4 space-y-3" data-testid="corrected-answer-output">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-medium">Corrected answer</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiff((s) => !s)}
                data-testid="btn-toggle-diff"
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                  showDiff ? "bg-indigo-500/20 text-indigo-300 border-indigo-400/40" : "bg-slate-900 border-white/10 text-slate-400 hover:text-slate-200"
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>{showDiff ? "Hide changes" : "Show changes"}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCorrected}
                data-testid="btn-copy-corrected-again"
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                  copiedCorrected
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
                    : "bg-slate-900 border-white/10 text-slate-300 hover:text-white"
                }`}
                title="Copy corrected text"
              >
                {copiedCorrected ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCorrected ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
          {showDiff ? (
            <div className="text-sm sm:text-base leading-relaxed text-slate-200 whitespace-pre-wrap font-sans p-3 bg-slate-900/60 rounded-lg border border-white/[0.06]" data-testid="corrected-answer-diff">
              {diffOps.map((op, i) => {
                if (op.type === "del") {
                  return (
                    <del key={i} className="line-through text-rose-300 bg-rose-500/20 px-0.5 rounded mx-0.5">
                      {op.text}
                    </del>
                  );
                }
                if (op.type === "add") {
                  return (
                    <ins key={i} className="text-emerald-300 bg-emerald-500/20 px-0.5 rounded mx-0.5 underline decoration-emerald-400">
                      {op.text}
                    </ins>
                  );
                }
                return <span key={i}>{op.text}</span>;
              })}
            </div>
          ) : (
            <p className="text-sm sm:text-base leading-relaxed text-slate-200 whitespace-pre-wrap" data-testid="corrected-answer-text">{formattedRewritten || corrected.rewritten}</p>
          )}
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
