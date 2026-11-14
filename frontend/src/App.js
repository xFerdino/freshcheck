import { useEffect, useRef, useState } from "react";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { AlertTriangle, ClipboardPaste, History as HistoryIcon, Play, Radar, RefreshCw } from "lucide-react";
import { EXAMPLES, MAX_CHARS, fetchConfig, streamCheck } from "./lib/freshcheck";
import { InputPanel } from "./components/InputPanel";
import { ProofDemo } from "./components/ProofDemo";
import { LiveProgress } from "./components/LiveProgress";
import { ScoreGauge } from "./components/ScoreGauge";
import { HighlightedAnswer } from "./components/HighlightedAnswer";
import { ClaimCard } from "./components/ClaimCard";
import { RunDetails } from "./components/RunDetails";
import { CorrectedAnswer } from "./components/CorrectedAnswer";
import { EmptyState, ErrorState, Footer } from "./components/States";
import { HistoryDrawer, loadHistory, saveHistoryEntry } from "./components/History";

const Header = ({ collapsed, onOpenHistory, historyCount, onRunDemo, onPasteOwn }) => (
  <header className="space-y-3 pt-2">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-2xl nm-flat-sm text-indigo-600">
          <Radar className="w-5 h-5" />
        </span>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-extrabold tracking-tight text-slate-900" data-testid="brand-name">FreshCheck</span>
          <span className="hidden sm:inline text-xs text-slate-500 font-mono tracking-wide">stale-answer detector</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenHistory}
        data-testid="btn-open-history"
        className="nm-btn inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold text-slate-700 hover:text-slate-900 transition-all"
        aria-label="Open check history"
      >
        <HistoryIcon className="w-3.5 h-3.5 text-indigo-600" />
        <span>History</span>
        {historyCount > 0 && (
          <span className="ml-0.5 px-2 py-0.5 rounded-full nm-inset-sm text-indigo-600 text-[10px] font-mono font-bold leading-none">
            {historyCount}
          </span>
        )}
      </button>
    </div>
    {!collapsed && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center pt-4 sm:pt-6">
        <div className="lg:col-span-5 space-y-5">
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.08]" data-testid="hero-tagline">
            Catch <span className="text-rose-600">stale</span> AI answers before your users do.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
            Every checkable fact, verified on the live web. Outdated ones come back fixed, with real sources.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRunDemo}
              data-testid="btn-run-demo-live"
              className="nm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"
            >
              <Play className="w-4 h-4" /> Run this example live
            </button>
            <button
              type="button"
              onClick={onPasteOwn}
              data-testid="btn-paste-own"
              className="nm-btn inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-slate-700"
            >
              <ClipboardPaste className="w-4 h-4 text-indigo-600" /> Paste your own
            </button>
          </div>
          <p className="text-xs text-slate-500">Free · no sign-up · sources are never invented</p>
        </div>
        <div className="lg:col-span-7">
          <ProofDemo />
        </div>
      </div>
    )}
  </header>
);

export default function App() {
  const [answer, setAnswer] = useState("");
  const [date, setDate] = useState("");
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [stage, setStage] = useState(null);
  const [claims, setClaims] = useState([]);
  const [summary, setSummary] = useState(null);
  const [checkedText, setCheckedText] = useState("");
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [corrected, setCorrected] = useState(null);
  const [truncation, setTruncation] = useState(null);
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [checkedAt, setCheckedAt] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const abortRef = useRef(null);
  const currentRunRef = useRef({ claims: [], meta: null, summary: null, answer: "", date: "" });

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => {});
    setHistoryCount(loadHistory().length);
  }, []);

  const patch = (id, data) => setClaims((cs) => cs.map((c) => (c.id === id ? { ...c, ...data } : c)));

  const onEvent = (event, data) => {
    if (event === "meta") {
      setMeta(data);
      currentRunRef.current.meta = data;
    }
    if (event === "llm_call") setLogs((l) => [...l, data]);
    if (event === "status") setStage(data.stage);
    if (event === "claims") {
      setStage("verifying");
      const initial = data.claims.map((c) => ({ ...c, state: "queued" }));
      setClaims(initial);
      currentRunRef.current.claims = initial;
      setTruncation(data.truncated ? { shown: data.claims.length, total: data.total_found } : null);
    }
    if (event === "claim_start") patch(data.id, { state: "checking" });
    if (event === "claim_result") {
      patch(data.id, { ...data, state: "done" });
      currentRunRef.current.claims = currentRunRef.current.claims.map((c) =>
        c.id === data.id ? { ...c, ...data, state: "done" } : c
      );
    }
    if (event === "done") {
      setSummary(data);
      currentRunRef.current.summary = data;
      const entry = {
        id: currentRunRef.current.meta?.run_id || `run_${Date.now()}`,
        timestamp: new Date().toISOString(),
        answer: currentRunRef.current.answer,
        date: currentRunRef.current.date,
        claims: currentRunRef.current.claims,
        summary: data,
        meta: currentRunRef.current.meta,
      };
      saveHistoryEntry(entry);
      setHistoryCount(loadHistory().length);
    }
    if (event === "error") setError(data.message);
  };

  const clearResults = () => {
    setClaims([]); setSummary(null); setCheckedText(""); setLogs([]); setMeta(null);
    setError(null); setCorrected(null); setTruncation(null); setVerdictFilter("all");
    setCheckedAt(null);
  };

  const onCheck = async (textArg) => {
    const text = typeof textArg === "string" ? textArg : answer;
    if (text.length > MAX_CHARS) { toast.error("Answer is too long (max 8,000 characters)"); return; }
    setHasRun(true);
    clearResults(); setRunning(true); setStage("extracting"); setCheckedText(text);
    currentRunRef.current = { claims: [], meta: null, summary: null, answer: text, date };
    setCheckedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    abortRef.current = new AbortController();
    try {
      await streamCheck({ answer: text, generatedDate: date, onEvent, signal: abortRef.current.signal });
    } catch (e) {
      if (e.name !== "AbortError") { setError(e.message || "Check failed"); toast.error(e.message || "Check failed"); }
    } finally {
      setRunning(false); setStage(null);
    }
  };

  const onRunDemo = () => {
    const text = EXAMPLES[0].text;
    setAnswer(text);
    onCheck(text);
  };

  const onPasteOwn = () => {
    const el = document.getElementById("input-answer-textarea");
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const onCancel = () => {
    abortRef.current?.abort();
    clearResults();
    toast("Check cancelled. Your text is still here.");
  };

  const onReset = () => {
    const saved = { answer, date };
    clearResults(); setAnswer(""); setDate("");
    if (saved.answer) {
      toast("Cleared", {
        action: { label: "Undo", onClick: () => { setAnswer(saved.answer); setDate(saved.date); } },
        duration: 6000,
      });
    }
  };

  const onSelectRun = (item) => {
    abortRef.current?.abort();
    setRunning(false);
    setStage(null);
    setHasRun(true);
    clearResults();
    setAnswer(item.answer || "");
    setCheckedText(item.answer || "");
    setDate(item.date || "");
    setClaims(item.claims || []);
    setSummary(item.summary || null);
    setMeta(item.meta || null);
    setCheckedAt(item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null);
    currentRunRef.current = {
      answer: item.answer || "",
      date: item.date || "",
      claims: item.claims || [],
      summary: item.summary || null,
      meta: item.meta || null,
    };
    toast.success("Loaded check from history");
  };

  const handleUpdateClaim = (updatedClaim) => {
    setClaims((cs) => {
      const updated = cs.map((c) => (c.id === updatedClaim.id ? { ...c, ...updatedClaim, state: "done" } : c));
      currentRunRef.current.claims = updated;
      return updated;
    });
    setSummary((s) => {
      if (!s) return s;
      const newClaims = claims.map((c) => (c.id === updatedClaim.id ? { ...c, ...updatedClaim } : c));
      const counts = { Current: 0, Outdated: 0, Uncertain: 0 };
      let totalScore = 0;
      let scored = 0;
      newClaims.forEach((c) => {
        if (c.verdict && counts[c.verdict] !== undefined) counts[c.verdict]++;
        if (c.freshness_score != null) { totalScore += c.freshness_score; scored++; }
      });
      const updatedSummary = {
        ...s,
        counts,
        overall_score: scored ? Math.round(totalScore / scored) : s.overall_score,
      };
      currentRunRef.current.summary = updatedSummary;
      if (meta?.run_id) {
        saveHistoryEntry({
          id: meta.run_id,
          timestamp: new Date().toISOString(),
          answer: checkedText,
          date,
          claims: newClaims,
          summary: updatedSummary,
          meta,
        });
        setHistoryCount(loadHistory().length);
      }
      return updatedSummary;
    });
  };

  const showResults = (claims.length > 0 || summary) && !(error && !summary);
  const isStale = Boolean(checkedText && answer !== checkedText && !running && showResults);

  const VERDICT_PRIORITY = { Outdated: 0, Uncertain: 1, Current: 2 };
  const sortedClaims = [...claims].sort((a, b) => {
    const pa = a.verdict ? (VERDICT_PRIORITY[a.verdict] ?? 3) : 4;
    const pb = b.verdict ? (VERDICT_PRIORITY[b.verdict] ?? 3) : 4;
    return pa - pb;
  });
  const displayedClaims = verdictFilter === "all"
    ? sortedClaims
    : sortedClaims.filter((c) => c.verdict === verdictFilter);

  return (
    <div className="App relative overflow-x-hidden min-h-screen bg-[var(--nm-bg)]">
      <Toaster theme="light" position="top-center" />
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <Header collapsed={hasRun} onOpenHistory={() => setHistoryOpen(true)} historyCount={historyCount} onRunDemo={onRunDemo} onPasteOwn={onPasteOwn} />
        <InputPanel answer={answer} setAnswer={setAnswer} date={date} setDate={setDate} onCheck={onCheck} onReset={onReset} onCancel={onCancel} running={running} />
        {running && <LiveProgress stage={stage} claims={claims} />}
        {error && !running && <ErrorState message={error} onRetry={onCheck} />}
        {!running && !error && !showResults && <EmptyState />}
        {isStale && (
          <div className="nm-flat flex flex-wrap items-center justify-between gap-3 rounded-2xl border-l-4 border-l-amber-500 px-5 py-4 text-sm text-slate-800" data-testid="stale-results-banner">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span className="font-medium">Text changed since this check was run.</span>
            </div>
            <button
              type="button"
              onClick={onCheck}
              data-testid="btn-recheck-stale"
              className="nm-btn inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Re-check
            </button>
          </div>
        )}
        {showResults && (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch" data-testid="results-overview">
            <ScoreGauge
              score={summary?.overall_score ?? null}
              counts={summary?.counts}
              running={running}
              filter={verdictFilter}
              onSelectFilter={setVerdictFilter}
              checkedAt={checkedAt}
            />
            <HighlightedAnswer text={checkedText} claims={claims} />
          </section>
        )}
        {summary && claims.length === 0 && (
          <p className="text-slate-500 font-medium" data-testid="no-claims-message">No checkable factual claims were found in this answer.</p>
        )}
        {showResults && claims.length > 0 && (
          <section className="space-y-4" data-testid="claims-list">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold font-display text-slate-900">
                Claims <span className="font-mono text-sm font-normal text-slate-500">({displayedClaims.length}{verdictFilter !== "all" ? ` of ${claims.length}` : ""})</span>
              </h2>
              <div className="nm-inset-sm inline-flex flex-wrap rounded-xl p-1 text-xs gap-1" data-testid="claims-filter">
                {[
                  ["all", `All (${claims.length})`],
                  ["Outdated", `Outdated (${summary?.counts?.Outdated ?? claims.filter((c) => c.verdict === "Outdated").length})`],
                  ["Uncertain", `Uncertain (${summary?.counts?.Uncertain ?? claims.filter((c) => c.verdict === "Uncertain").length})`],
                  ["Current", `Current (${summary?.counts?.Current ?? claims.filter((c) => c.verdict === "Current").length})`],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVerdictFilter(key)}
                    data-testid={`filter-${key.toLowerCase()}`}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                      verdictFilter === key
                        ? "nm-flat-sm text-indigo-700 bg-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {truncation && (
              <p className="nm-flat rounded-xl border-l-4 border-l-amber-500 px-4 py-2.5 text-sm text-amber-800" data-testid="truncation-notice">
                Checked the first {truncation.shown} of {truncation.total} claims. Split the answer to check the rest.
              </p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {displayedClaims.map((c, i) => (
                <ClaimCard
                  key={c.id}
                  claim={c}
                  index={i}
                  runId={meta?.run_id}
                  generatedDate={date}
                  onUpdateClaim={handleUpdateClaim}
                  onLog={(l) => setLogs((ls) => [...ls, l])}
                />
              ))}
            </div>
          </section>
        )}
        {summary && claims.length > 0 && (
          <CorrectedAnswer runId={meta?.run_id} text={checkedText} claims={claims} summary={summary} meta={meta}
            corrected={corrected} setCorrected={setCorrected} onLog={(l) => setLogs((ls) => [...ls, l])} />
        )}
        {summary && (summary.counts?.Outdated > 0 || claims.some((c) => c.verdict === "Outdated")) && (
          <aside className="fixed bottom-6 right-6 z-30" aria-label="Quick jump to corrections">
            <button
              type="button"
              onClick={() => {
                const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                document.getElementById("fix-and-share")?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
              }}
              data-testid="btn-jump-fix"
              className="nm-btn-danger inline-flex items-center gap-2 rounded-full px-5 py-3 text-xs sm:text-sm font-bold shadow-xl transition-all"
            >
              <span>Fix {summary.counts?.Outdated ?? claims.filter((c) => c.verdict === "Outdated").length} outdated fact{((summary.counts?.Outdated ?? claims.filter((c) => c.verdict === "Outdated").length) > 1 ? "s" : "")}</span>
              <span aria-hidden="true" className="text-base font-bold">↓</span>
            </button>
          </aside>
        )}
        {logs.length > 0 && <RunDetails logs={logs} meta={meta} />}
        <Footer config={config} />
      </main>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectRun={onSelectRun}
        currentRunId={meta?.run_id}
        onHistoryChange={() => setHistoryCount(loadHistory().length)}
      />
    </div>
  );
}
