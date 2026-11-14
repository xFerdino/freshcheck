import { useEffect, useRef, useState } from "react";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { Radar } from "lucide-react";
import { MAX_CHARS, fetchConfig, streamCheck } from "./lib/freshcheck";
import { InputPanel } from "./components/InputPanel";
import { LiveProgress } from "./components/LiveProgress";
import { ScoreGauge } from "./components/ScoreGauge";
import { HighlightedAnswer } from "./components/HighlightedAnswer";
import { ClaimCard } from "./components/ClaimCard";
import { RunDetails } from "./components/RunDetails";
import { CorrectedAnswer } from "./components/CorrectedAnswer";
import { EmptyState, ErrorState, Footer } from "./components/States";

const Header = () => (
  <header className="space-y-4 pt-4">
    <div className="flex items-center gap-2.5">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-400/30">
        <Radar className="w-5 h-5 text-indigo-300" />
      </span>
      <span className="font-display text-xl font-bold tracking-tight" data-testid="brand-name">FreshCheck</span>
    </div>
    <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-50 max-w-4xl leading-[1.05]" data-testid="hero-tagline">
      Catch <span className="text-rose-400">stale</span> AI answers before your users do.
    </h1>
    <p className="text-base md:text-lg text-slate-400 max-w-2xl">
      Paste any AI-generated answer. FreshCheck pulls out every checkable fact, verifies it against the live web, and hands you a corrected, cited version.
    </p>
  </header>
);

export default function App() {
  const [answer, setAnswer] = useState("");
  const [date, setDate] = useState("");
  const [running, setRunning] = useState(false);
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
  const abortRef = useRef(null);

  useEffect(() => { fetchConfig().then(setConfig).catch(() => {}); }, []);

  const patch = (id, data) => setClaims((cs) => cs.map((c) => (c.id === id ? { ...c, ...data } : c)));

  const onEvent = (event, data) => {
    if (event === "meta") setMeta(data);
    if (event === "llm_call") setLogs((l) => [...l, data]);
    if (event === "status") setStage(data.stage);
    if (event === "claims") {
      setStage("verifying");
      setClaims(data.claims.map((c) => ({ ...c, state: "queued" })));
      setTruncation(data.truncated ? { shown: data.claims.length, total: data.total_found } : null);
    }
    if (event === "claim_start") patch(data.id, { state: "checking" });
    if (event === "claim_result") patch(data.id, { ...data, state: "done" });
    if (event === "done") setSummary(data);
    if (event === "error") setError(data.message);
  };

  const clearResults = () => {
    setClaims([]); setSummary(null); setCheckedText(""); setLogs([]); setMeta(null);
    setError(null); setCorrected(null); setTruncation(null);
  };

  const onCheck = async () => {
    if (answer.length > MAX_CHARS) { toast.error("Answer is too long (max 8,000 characters)"); return; }
    clearResults(); setRunning(true); setStage("extracting"); setCheckedText(answer);
    abortRef.current = new AbortController();
    try {
      await streamCheck({ answer, generatedDate: date, onEvent, signal: abortRef.current.signal });
    } catch (e) {
      if (e.name !== "AbortError") { setError(e.message || "Check failed"); toast.error(e.message || "Check failed"); }
    } finally {
      setRunning(false); setStage(null);
    }
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

  const showResults = (claims.length > 0 || summary) && !(error && !summary);

  return (
    <div className="App grain relative overflow-x-hidden">
      <div className="glow-orb bg-indigo-600 -top-40 -left-40" />
      <div className="glow-orb bg-rose-600 top-1/2 -right-60" />
      <Toaster theme="dark" position="top-center" />
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <Header />
        <InputPanel answer={answer} setAnswer={setAnswer} date={date} setDate={setDate} onCheck={onCheck} onReset={onReset} onCancel={onCancel} running={running} />
        {running && <LiveProgress stage={stage} claims={claims} />}
        {error && !running && <ErrorState message={error} onRetry={onCheck} />}
        {!running && !error && !showResults && <EmptyState />}
        {showResults && (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch" data-testid="results-overview">
            <ScoreGauge score={summary?.overall_score ?? null} counts={summary?.counts} running={running} />
            <HighlightedAnswer text={checkedText} claims={claims} />
          </section>
        )}
        {summary && claims.length === 0 && (
          <p className="text-slate-400" data-testid="no-claims-message">No checkable factual claims were found in this answer.</p>
        )}
        {summary && claims.length > 0 && (
          <CorrectedAnswer runId={meta?.run_id} text={checkedText} claims={claims} summary={summary} meta={meta}
            corrected={corrected} setCorrected={setCorrected} onLog={(l) => setLogs((ls) => [...ls, l])} />
        )}
        {showResults && claims.length > 0 && (
          <section className="space-y-4" data-testid="claims-list">
            <h2 className="text-lg font-semibold text-slate-100">Claims <span className="font-mono text-sm text-slate-500">({claims.length})</span></h2>
            {truncation && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-2.5 text-sm text-amber-200" data-testid="truncation-notice">
                Checked the first {truncation.shown} of {truncation.total} claims. Split the answer to check the rest.
              </p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {claims.map((c, i) => <ClaimCard key={c.id} claim={c} index={i} />)}
            </div>
          </section>
        )}
        {logs.length > 0 && <RunDetails logs={logs} meta={meta} />}
        <Footer config={config} />
      </main>
    </div>
  );
}
