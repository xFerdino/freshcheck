# FreshCheck — Audit & Improvement Plan

_Date: 2026-11-14 · Scope: whole repo (commit `8f59f56`) + live preview UI_

## 0. How to use this document
- Every task has an ID (`SEC-1`, `UX-4`…), the files it touches, the change, and an **acceptance check**.
- Tasks are atomic: one PR each, mostly < 1 hour. Do them in phase order; inside a phase, any order.
- `P0` = fix before showing to anyone else · `P1` = next sprint · `P2` = growth bets (build only when a user asks).

## 1. Executive summary
FreshCheck is a small, well-scoped app (≈ 700 lines of real code): FastAPI SSE backend
(`backend/server.py`, `backend/llm_gateway.py`) and a single-page React UI (`frontend/src/App.js` + 8 components).
The core pipeline (extract → Tavily search → judge → rewrite) is sound, and "sources are never invented" is
enforced in code (`server.py:121-123`). Main problems:

1. **Security / cost exposure**: public, unauthenticated endpoints that spend Tavily + LLM credits with no
   rate limit; `/api/rewrite` is effectively a free LLM proxy; `.env` is not git-ignored; CORS `*` with credentials.
2. **Privacy**: `public/index.html` ships PostHog **session recording** with a hard-coded key — every answer a
   user pastes is recorded by a third party. Title/description still say "Emergent | Fullstack App".
3. **Verdict quality bugs visible in the screenshots**: the corrected answer cites a *stale* source as `[1]`
   ("PS5 launches at $399"), and uses a **resale** price (Swappa $330) despite the like-for-like rule.
4. **UX bug with data loss**: "Cancel" during a run calls `onReset`, which **wipes the pasted answer**.
5. **Dependency bloat**: ~25 unused Python packages (Mongo, pandas, boto3, jwt…), ~45 unused shadcn
   components and ~15 unused npm deps; CRA (`react-scripts`) is deprecated.
6. **No offline tests / no CI**: all 3 test files hit a deployed URL with real API keys.
7. **Missing features users expect**: history, share links, per-claim re-check, accept/reject corrections,
   API/CI usage, URL/file input, trusted-domain settings.

## 2. Audit findings

### 2.1 Backend
| # | Severity | Finding | Where |
|---|---|---|---|
| B1 | High | No rate limiting or auth on `/api/check` (up to 12 Tavily *advanced* searches + 13 LLM calls per request) | `server.py:241` |
| B2 | High | `/api/rewrite` trusts client-supplied `answer`, `updated_fact`, `sources` → free LLM proxy + prompt-injection surface | `server.py:219-238` |
| B3 | High | `allow_origins='*'` together with `allow_credentials=True` | `server.py:251-257` |
| B4 | Med | Rewrite cites `c.sources[:2]`; when the judge returns no valid `source_ids`, `sources` falls back to **all** results (incl. stale ones) → stale citation `[1]` | `server.py:121`, `server.py:227` |
| B5 | Med | Judge accepts resale/secondary-market evidence (Swappa) for list-price claims despite the prompt | `VERIFY_SYSTEM` `server.py:56-67` |
| B6 | Med | `EXTRACT_MODEL` / `VERDICT_MODEL` read with `os.environ[...]` at import → `KeyError` crash, no defaults | `llm_gateway.py:9-10` |
| B7 | Med | `requirements.txt` has ~25 unused deps (pymongo, motor, boto3, pandas, numpy, jwt, bcrypt, passlib, jq, typer, black, mypy…); Mongo service in compose is unused | `backend/requirements.txt`, `docker-compose.yml` |
| B8 | Med | Hard dependency on private `emergentintegrations` index in the Dockerfile; "direct" route only works on Emergent | `backend/Dockerfile:4`, `llm_gateway.py:46-52` |
| B9 | Med | No caching: identical claims re-run Tavily + judge every time | `verify_claim` |
| B10 | Low | Claims beyond 12 are silently dropped; UI is never told | `server.py:155` |
| B11 | Low | No retry/backoff on Tavily 429/5xx or LLM transient errors | `tavily_search`, `chat_json` |
| B12 | Low | Tavily options unused that fit the domain: `topic:"news"` for roles, `time_range`, `include_domains` | `server.py:77` |
| B13 | Low | No `/api/health`, no request id in logs, no total-run timeout | `server.py` |
| B14 | Low | `parse_json` greedy regex can grab the wrong span when the model emits two objects | `llm_gateway.py:31-33` |

### 2.2 Frontend
| # | Severity | Finding | Where |
|---|---|---|---|
| F1 | High | **Cancel wipes the input**: Cancel button is `onReset`, which `setAnswer("")` | `InputPanel.jsx:50-56`, `App.js:75-79` |
| F2 | High | PostHog session recording with hard-coded key records pasted content; `emergent-main.js` third-party script | `public/index.html` |
| F3 | Med | `<title>` "Emergent \| Fullstack App", description "A product of emergent.sh", no favicon, no OG tags, theme-color `#000` | `public/index.html` |
| F4 | Med | Textarea has no label (only placeholder); `<mark>` highlights are click-only (no keyboard, no role); Run-details toggle lacks `aria-expanded`; live progress has no `aria-live` | `InputPanel.jsx`, `HighlightedAnswer.jsx`, `RunDetails.jsx`, `LiveProgress.jsx` |
| F5 | Med | 422 for >8000 chars shows "Please paste a longer answer"; no character counter | `freshcheck.js:60`, `InputPanel.jsx` |
| F6 | Med | "Copy corrected answer" silently does two things (paid LLM rewrite + clipboard); "Regenerate & copy" costs again | `CorrectedAnswer.jsx` |
| F7 | Med | Editing the textarea after a run leaves old results on screen with no "results are for previous text" hint | `App.js` (`checkedText` vs `answer`) |
| F8 | Med | No `prefers-reduced-motion` handling (framer-motion cards, gauge, `animate-pulse`, smooth scroll) | `ClaimCard.jsx`, `ScoreGauge.jsx`, `HighlightedAnswer.jsx` |
| F9 | Low | Example chips overwrite typed text without undo | `InputPanel.jsx:15` |
| F10 | Low | Colors hard-coded in JS/SVG (`#10B981`…) while CSS tokens exist in `index.css` and `design_guidelines.json` | `freshcheck.js`, `ScoreGauge.jsx` |
| F11 | Low | Fonts loaded twice (`index.html` Inter 600 + render-blocking `@import` of 3 families in CSS) | `index.html`, `index.css:1` |
| F12 | Low | ~45 unused `components/ui/*`, unused deps (axios, react-query, swr, recharts, zod, react-router, dayjs, date-fns, react-hook-form…), dead `constants/testIds/auth.js` | `frontend/` |
| F13 | Low | CRA/`react-scripts@5` is unmaintained; craco shim needed for webpack-dev-server 5 | `package.json`, `craco.config.js` |

### 2.3 Repo, tests, infra
| # | Severity | Finding |
|---|---|---|
| R1 | High | `.env` is **not** in any `.gitignore` (the "Environment files" section is empty) — one `git add .` leaks keys |
| R2 | Med | Tests are integration-only against `REACT_APP_BACKEND_URL` with real keys; no unit tests for score clamp, source mapping, quote validation, `buildSegments`, `streamCheck` parser |
| R3 | Med | No CI workflow, no lint step, no pinned Python lockfile |
| R4 | Low | Generated artefacts committed (`test_reports/*.xml/json`, `test_result.md`, root `yarn.lock`, `tests/__init__.py`) |
| R5 | Low | `docker-compose` uses `maximhq/bifrost:latest` (unpinned); frontend built with `REACT_APP_BACKEND_URL=http://localhost:8001` baked in |
| R6 | Low | `memory/PRD.md` still mentions `LLM_BASE_URL`/`LLM_MODEL` in places; README and PRD drift |

### 2.4 Live UI review (UX/UI)
What works: strong hero promise, 3 one-click examples, live per-claim progress, inline colored highlights
linked to cards, clear verdict cards with sources, run-details transparency.

Problems seen on the live page and screenshots:
1. **Above the fold is all marketing on repeat visits.** Hero takes ~45% of the first screen; the tool starts below.
2. **Input panel hierarchy**: "TRY AN EXAMPLE" chips sit *above* the textarea and wrap to two rows on desktop at
   1024px; the date field label is tiny mono caps (10–12px) and "Generated on" is unclear (why does it matter?).
3. **Primary button disabled state** (indigo at 50% opacity) reads almost like enabled; no hint why it's disabled
   (< 10 chars). _Contrast UNMEASURED._
4. **Results overview**: "Original answer" panel is stretched to gauge height → large empty area (screenshot 03).
   Gauge repeats info the 3 count tiles already give.
5. **No triage order**: claims are in extraction order; the user has to scan for red cards. No filter by verdict.
6. **Fix & share** sits *between* overview and claims — the user is asked to fix before seeing what's wrong.
7. **Corrected answer has no diff**: user can't see what changed vs original; citations `[1][2]` stack without spaces.
8. **Feedback is toast-only**: copy actions don't change the button state; toasts appear top-center over content.
9. **Mobile (screenshot 06)**: chips take 2 rows, the sticky action isn't sticky — on long answers the Check
   button scrolls off; progress list is good.
10. **Micro-typography**: heavy use of 10–11px uppercase mono labels with wide tracking ("FRESH", "SOURCES",
    "UP-TO-DATE FACT") — hard to read, low contrast on slate-500. _Contrast UNMEASURED._
11. **Trust cues are hidden**: "sources are never invented" is only in the footer in 12px slate-600.
12. **No light theme**, no keyboard shortcut (Ctrl/⌘+Enter), no focus-visible styles on chips/marks.

## 3. Potential users & what they want
| Persona | Job to be done | Must-have features |
|---|---|---|
| Support-bot / RAG team lead | Catch stale facts in bot answers before customers do | API + batch check, CI/regression run on a set of Q&A pairs, trusted-domain list, history |
| Docs / content editor | Keep articles and FAQs current | URL & file input, diff of corrected text, accept/reject per fix, scheduled re-check + alert |
| Journalist / researcher | Fact-check an AI draft quickly | Per-claim re-check, evidence snippets, export with footnotes, share link |
| Agent builder | Let an agent self-check before answering | MCP server / JSON endpoint, low latency mode, cached results |

## 4. Task plan

### Phase 0 — Safety, privacy, correctness (P0)

**SEC-1 · Ignore env files**
- Files: `.gitignore`
- Change: add `.env`, `.env.*`, `!.env.example` under "Environment files".
- Check: `git check-ignore backend/.env frontend/.env` prints both paths.

**SEC-2 · Add `.env.example` files**
- Files: `backend/.env.example`, `frontend/.env.example`
- Change: list `TAVILY_API_KEY`, `EXTRACT_MODEL`, `VERDICT_MODEL`, `BIFROST_BASE_URL`, `BIFROST_API_KEY`,
  `EMERGENT_LLM_KEY`, `CORS_ORIGINS`, `REACT_APP_BACKEND_URL` with dummy values; link from README "Run locally".
- Check: fresh clone + copy examples + `docker compose up` starts without KeyError.

**SEC-3 · Fix CORS**
- Files: `backend/server.py:251-257`
- Change: `allow_credentials=False` (no cookies are used), `allow_methods=["GET","POST"]`, default
  `CORS_ORIGINS` to the frontend origin instead of `*`.
- Check: preflight from an unlisted origin is rejected; app still works from its origin.

**SEC-4 · Rate-limit paid endpoints**
- Files: `backend/server.py`
- Change: in-memory per-IP token bucket (dict + timestamps, no new dep) on `/api/check` and `/api/rewrite`,
  e.g. 10 checks / 10 min, configurable `RATE_LIMIT_PER_10MIN`. Return 429 + `Retry-After`. Comment the
  ceiling (`# ponytail: single-process limiter; move to Redis when >1 worker`).
- Check: 11th request in 10 min returns 429; UI shows a readable message (see UX-12).

**SEC-5 · Stop `/api/rewrite` being a free LLM proxy**
- Files: `backend/server.py`
- Change: cap `claims` to 12, cap `updated_fact` to 300 chars, require every `sources[].url` to have been
  issued by a check — keep an LRU (`functools.lru_cache`-style dict, max 1000) of `run_id → {claim_id: result}`
  filled in `run_check`; rewrite takes `{run_id, answer}` and reads claims server-side.
  Emit `run_id` in the `meta` SSE event.
- Check: rewrite with unknown `run_id` → 404; with valid id → same output as today.

**SEC-6 · Remove third-party session recording**
- Files: `frontend/public/index.html`
- Change: delete the PostHog snippet and `emergent-main.js` from production builds (keep behind
  `%REACT_APP_ENABLE_ANALYTICS%` if wanted, with `session_recording` disabled and `mask_all_text: true`).
- Check: Network tab on the built app shows no `ap.emergent.sh` requests.

**SEC-7 · Brand metadata**
- Files: `frontend/public/index.html`, `frontend/public/favicon.svg`
- Change: `<title>FreshCheck — catch stale AI answers</title>`, real meta description, OG/Twitter tags,
  `theme-color #0B0F17`, SVG favicon (radar icon).
- Check: tab shows FreshCheck + icon; link preview renders title/description.

**BUG-1 · Cancel must not wipe the input**
- Files: `frontend/src/App.js`, `frontend/src/components/InputPanel.jsx`
- Change: add `onCancel = () => abortRef.current?.abort()`; the button calls `onCancel` while running and
  `onReset` otherwise. Reset asks no confirmation but offers "Undo" in the toast (restore previous text).
- Check: start a run, press Cancel → text stays, progress disappears, no error state.

**BUG-2 · Never cite stale sources in corrections**
- Files: `backend/server.py:121`, `server.py:227`
- Change: when the judge returns no valid `source_ids` for an **Outdated** verdict, downgrade to Uncertain
  (no evidence trail = no correction). In rewrite, cite only `sources[0]` (the judge's top supporting source)
  plus `sources[1]` only if its date ≥ `sources[0]` date or unknown.
- Check: unit test (TEST-2) with fake results where ids are invalid → verdict Uncertain, no `updated_fact`.

**BUG-3 · Like-for-like evidence for prices**
- Files: `backend/server.py` (`EXTRACT_SYSTEM`, `VERIFY_SYSTEM`)
- Change: extraction adds `"region"` and `"condition":"new|used|n/a"` hints to each claim and the search query
  includes "official price"; judge rule: "evidence from resale/used marketplaces (Swappa, eBay, Back Market)
  cannot change a list-price verdict → Uncertain". Also: a discontinued product's last list price is
  "Outdated: discontinued", not a new price.
- Check: run the "Product prices" example; iPhone 15 verdict no longer cites Swappa.

**BUG-4 · Model env defaults**
- Files: `backend/llm_gateway.py:9-10`
- Change: `os.environ.get("EXTRACT_MODEL", "openai/gpt-4o-mini")`, same for VERDICT; log effective config at startup.
- Check: backend boots with no model vars set.

**BUG-5 · Correct the "too long" message + counter**
- Files: `frontend/src/lib/freshcheck.js:60`, `InputPanel.jsx`
- Change: map 422 by checking length client-side; show `1,234 / 8,000` counter under the textarea, turning amber
  at 90% and blocking submit above 8,000 with an inline message.
- Check: paste 8,001 chars → button disabled, message "Answer is too long (max 8,000 characters)".

**BUG-6 · Tell the user when claims were truncated**
- Files: `backend/server.py:155`, `App.js`
- Change: include `"truncated": true, "total_found": n` in the `claims` event; UI shows a one-line note
  "Checked the first 12 of 17 claims. Split the answer to check the rest."
- Check: long answer → note appears.

### Phase 1 — Hygiene & tests (P1)

**DEP-1 · Trim Python deps**
- Files: `backend/requirements.txt` → `requirements.txt` (runtime) + `requirements-dev.txt`
- Runtime: `fastapi uvicorn httpx pydantic python-dotenv openai` (+ `emergentintegrations` optional).
  Dev: `pytest pytest-asyncio respx ruff`.
- Check: `pip install -r requirements.txt` in a clean venv; server starts; image size drops (record before/after).

**DEP-2 · Remove Mongo**
- Files: `docker-compose.yml`, README
- Change: drop `mongo` service and `MONGO_URL`/`DB_NAME` (nothing reads them). Re-add only with HIST-2.
- Check: `docker compose up` runs 3 services; app works.

**DEP-3 · Make the Emergent route optional**
- Files: `llm_gateway.py`, `backend/Dockerfile`
- Change: add a third route `openai` (direct OpenAI-compatible: `LLM_BASE_URL` + `LLM_API_KEY`, same code path as
  Bifrost); only import `emergentintegrations` when `EMERGENT_LLM_KEY` is set; Dockerfile installs it via
  build-arg only.
- Check: `docker build` works without the private index.

**DEP-4 · Prune frontend deps and unused UI kit**
- Files: `frontend/package.json`, `frontend/src/components/ui/*`, `frontend/src/hooks/use-toast.js`,
  `frontend/src/constants/testIds/auth.js`
- Change: delete every `ui/*` file not imported (currently all of them), and deps not imported anywhere
  (grep each). Keep `sonner`, `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge`.
- Check: `yarn build` succeeds; record bundle size before/after.

**DEP-5 · Pin images**
- Files: `docker-compose.yml`
- Change: pin `maximhq/bifrost:<version verified in PRD: v2.5.1>`.

**DEP-6 · Delete committed artefacts**
- Files: `test_reports/`, `test_result.md`, root `yarn.lock`, `tests/__init__.py`; add to `.gitignore`.

**TEST-1 · Offline backend tests**
- Files: `backend/tests/test_unit.py`
- Change: test `uncertain()`, score clamping, source-id mapping, quote validation, `parse_json`, rate limiter,
  using fake `chat_json` and `respx`-mocked Tavily. Move live tests behind `@pytest.mark.live`.
- Check: `pytest -m "not live"` passes with no network and no keys.

**TEST-2 · SSE contract test**
- Files: `backend/tests/test_unit.py`
- Change: run `run_check` with mocks, assert event order `meta → status → claims → (claim_start|llm_call|claim_result)* → done`.

**TEST-3 · Frontend unit tests**
- Files: `frontend/src/lib/freshcheck.test.js`
- Change: `buildSegments` (overlaps, repeated quotes, empty quote), SSE parser split across chunks, `buildMarkdown`.
- Check: `yarn test --watchAll=false` passes.

**CI-1 · GitHub Actions**
- Files: `.github/workflows/ci.yml`
- Change: jobs `backend` (ruff + `pytest -m "not live"`) and `frontend` (`yarn build` + `yarn test`).
- Check: green on a PR.

**OBS-1 · Health + request id**
- Files: `server.py`
- Change: `GET /api/health` (checks env presence only), log `run_id` on every log line of a run, total run timeout
  (`asyncio.timeout(120)`) that emits `error`.

**PERF-1 · Cache verdicts**
- Files: `server.py`
- Change: in-memory TTL dict keyed by normalized `search_query` (24h) for Tavily results; show "cached" in Run
  details. Comment ceiling (single process).
- Check: second run of the same example makes 0 Tavily calls.

**PERF-2 · Retry transient errors**
- Files: `server.py` (`tavily_search`), `llm_gateway.py`
- Change: 2 retries with 0.5s/1.5s backoff on 429/5xx/timeouts; log each attempt in `llm_call`.

### Phase 1 — UX / UI (P1)

**UX-1 · Tool-first layout**
- Files: `App.js` (`Header`)
- Change: shrink hero to one line (`text-3xl`) + subline; after the first run, collapse hero entirely. Put a small
  "How it works" disclosure under the input instead of the 3 empty-state cards.
- Check: at 1280×800 the textarea and Check button are fully above the fold.

**UX-2 · Input panel order and labels**
- Files: `InputPanel.jsx`
- Change: textarea first with a visible label "AI answer to check"; examples become a single row of text links
  below ("or try: Tech versions · Prices · Leadership"); date field gets helper text
  "When was this answer written? Helps judge what changed since." Mono caps labels → sentence case 13px.
- Check: screen reader announces the textarea label; chips fit one row at 1024px.

**UX-3 · Keyboard submit + disabled-state hint**
- Files: `InputPanel.jsx`
- Change: Ctrl/⌘+Enter runs the check; show `⌘↵` hint on the button; when disabled show "Paste at least 10
  characters" under the button.

**UX-4 · Sticky action bar on mobile**
- Files: `InputPanel.jsx`
- Change: below `sm`, make the button row `sticky bottom-0` with a backdrop.
- Check: 375px viewport, long answer → Check button stays visible.

**UX-5 · Results order: problems first**
- Files: `App.js` (claims section)
- Change: sort finished claims Outdated → Uncertain → Current; add a segmented filter "All · Outdated (3) ·
  Uncertain (0) · Current (1)"; the count tiles in the gauge become the filter buttons.
- Check: clicking "Outdated" tile shows only red cards.

**UX-6 · Reorder sections**
- Files: `App.js`
- Change: Overview → Claims → Fix & share → Run details. Add a compact sticky "Fix 3 outdated facts" button
  that scrolls to Fix & share once results are done.

**UX-7 · Overview panel sizing**
- Files: `App.js:95` (`items-stretch` → `items-start`), `HighlightedAnswer.jsx`
- Change: let the answer panel size to content; put the legend counts inline with the legend.

**UX-8 · Corrected answer diff**
- Files: `CorrectedAnswer.jsx`
- Change: toggle "Show changes": render original vs corrected with removed text struck through (rose) and new
  text underlined (emerald) using a word-level diff (~30 lines, no dependency). Add a space before citation markers.
- Check: each corrected clause is visibly marked.

**UX-9 · Split "generate" from "copy"**
- Files: `CorrectedAnswer.jsx`
- Change: primary button "Generate corrected answer" (shows result, doesn't copy); a separate "Copy" button in the
  result; copy buttons swap to a ✓ "Copied" state for 2s (toast optional).

**UX-10 · Stale-results hint**
- Files: `App.js`
- Change: if `answer !== checkedText` after a run, show a banner over results: "Text changed since this check —
  Re-check".

**UX-11 · Accessibility pass** (run `ux-ui-agent-skills:a11y-audit` with a browser installed to measure)
- Files: `HighlightedAnswer.jsx`, `RunDetails.jsx`, `LiveProgress.jsx`, `InputPanel.jsx`, `index.css`
- Change: highlights become `<button>`s inside the text (or `role="button" tabIndex=0` + Enter/Space);
  `aria-expanded`/`aria-controls` on Run details; `aria-live="polite"` region announcing "3 of 5 claims checked";
  visible `focus-visible` ring on all interactive elements; verdict conveyed by icon + text, not color alone
  (add ✓ / ✕ / ? glyph in highlights).
- Check: keyboard-only user can run a check, jump from a highlight to its card, and copy a fix; axe = 0 serious.

**UX-12 · Human error messages**
- Files: `freshcheck.js` (`streamCheck`), `States.jsx`
- Change: map 429 → "You've hit the limit. Try again in N min", 503 → "Search isn't configured on this server",
  network → "Lost connection — your text is safe, try again".

**UX-13 · Reduced motion**
- Files: `ClaimCard.jsx`, `ScoreGauge.jsx`, `HighlightedAnswer.jsx`, `index.css`
- Change: `useReducedMotion()` from framer-motion to skip animations; `motion-safe:` on `animate-pulse`;
  `behavior: "auto"` scroll when reduced.

**UX-14 · Readable micro-labels**
- Files: all components using `text-[10px]`/`text-[11px] font-mono uppercase tracking-widest`
- Change: minimum 12px; reserve mono caps for numbers/ids; raise muted text from `slate-500/600` to `slate-400`
  where it carries information. _Measure contrast ≥ 4.5:1 after the change._

**UX-15 · Trust cue near results**
- Files: `HighlightedAnswer.jsx` or overview header
- Change: one line under the gauge: "Every verdict links to live sources. No source → Uncertain."; show
  "Checked {date, time}" and the search date range.

**UX-16 · Evidence snippet per source**
- Files: `server.py` (include first 200 chars of Tavily `content` per source), `ClaimCard.jsx`
- Change: expandable "Why" under each source with the quoted snippet that supports the verdict.

**UI-1 · Use design tokens instead of hex**
- Files: `index.css`, `tailwind.config.js`, `freshcheck.js`, `ScoreGauge.jsx`
- Change: add `--verdict-current/outdated/uncertain/pending` CSS vars; reference via Tailwind theme and
  `var(--…)` in SVG; delete hex from JS.
- Check: `ux-ui-agent-skills` `lint_hardcodes` reports 0 hex in components.

**UI-2 · Font loading**
- Files: `index.html`, `index.css`
- Change: single `<link>` with `display=swap` for the 3 families in `index.html`; delete CSS `@import`.

**UI-3 · Light theme**
- Files: `index.css`, `App.js`
- Change: light token set under `@media (prefers-color-scheme: light)` + a toggle stored in `localStorage`.
  Do after UI-1 (tokens make it a CSS-only change).

**UI-4 · Gauge simplification**
- Files: `ScoreGauge.jsx`
- Change: keep the number + label, make the arc thinner, drop the blurred color orb; add one-line meaning:
  "Average freshness of 4 claims".

### Phase 1 — Features users asked for (P1)

**FEAT-1 · Per-claim re-check**
- Files: `server.py` (`POST /api/check/claim` reusing `verify_claim`), `ClaimCard.jsx`
- Change: "Re-check" icon button on each card; optional edited search query.
- Check: re-check one Uncertain claim without rerunning the rest.

**FEAT-2 · Accept / reject / edit corrections**
- Files: `ClaimCard.jsx`, `App.js`, `freshcheck.js` (`rewriteAnswer`)
- Change: each Outdated card gets "Use this fix" (default on) / "Ignore" / "Edit fact"; rewrite sends only accepted
  fixes (server validates against the stored run, SEC-5). Also allow "Mark as current" override on any card.

**HIST-1 · Local history**
- Files: `App.js`, new `components/History.jsx`
- Change: save last 20 runs (answer, claims, summary, timestamp) in `localStorage` (try/catch); a "History"
  drawer to reopen a run. No backend needed.
- Check: reload page → previous run is reopenable.

**EXP-1 · Better exports**
- Files: `freshcheck.js`, `CorrectedAnswer.jsx`
- Change: citation style picker (Markdown footnotes `[^1]`, inline links, plain numbered); "Copy as HTML" for
  CMS paste; JSON export of the raw run.

**API-1 · JSON (non-streaming) mode**
- Files: `server.py`
- Change: `POST /api/check?stream=false` collects events and returns `{claims, summary, run_id}`; document with
  curl in README. Enables scripts/CI.

**IN-1 · Check a URL**
- Files: `server.py` (Tavily `/extract` for the page text), `InputPanel.jsx` (tabs "Paste text · URL")
- Change: fetch article text (cap 8,000 chars) then run the normal pipeline.

**SET-1 · Check settings**
- Files: `InputPanel.jsx` ("Options" disclosure), `server.py` (`CheckRequest`)
- Change: region/currency (default US/USD) passed to extract + judge; trusted domains → Tavily `include_domains`;
  blocked domains → `exclude_domains`.

### Phase 2 — Growth bets (build only on real demand)

**G-1 · Share link** — needs storage (re-add Mongo or SQLite): `POST /api/runs` → `/r/{id}` read-only page.
**G-2 · Batch / CSV** — upload Q&A CSV, run with concurrency limit, download results CSV. For support-bot teams.
**G-3 · Scheduled re-checks + alerts** — save an answer, re-check weekly, email/Slack when a verdict flips. Needs G-1.
**G-4 · MCP server** — expose `check_answer` tool so agents self-verify before replying; thin wrapper over API-1.
**G-5 · GitHub Action** — check changed `.md` files in docs PRs and comment outdated claims. Wrapper over API-1.
**G-6 · Browser extension** — "Check with FreshCheck" on selected text in ChatGPT/Claude/any page. Wrapper over API-1.
**G-7 · Cost display** — per-run estimated $ (tokens × model price + Tavily credits) in Run details.
**G-8 · Vite migration** — replace CRA + craco with Vite when CRA blocks an upgrade (not before).
**G-9 · i18n** — non-English answers: pass detected language to extract/judge; translate UI later.

## 5. Suggested order (first two weeks)
1. Day 1: SEC-1, SEC-2, SEC-3, SEC-6, SEC-7, BUG-1, BUG-4, BUG-5 (all small).
2. Day 2–3: SEC-4, SEC-5, BUG-2, BUG-3, BUG-6, TEST-1, TEST-2, CI-1.
3. Day 4–5: DEP-1…DEP-6, TEST-3, OBS-1, PERF-1, PERF-2.
4. Week 2: UX-1…UX-16, UI-1, UI-2, UI-4, then FEAT-1, FEAT-2, HIST-1, API-1.
5. Then pick from SET-1, IN-1, EXP-1, UI-3, and Phase 2 based on user feedback.

## 6. Definition of done (every task)
- Acceptance check passes and is written down in the PR.
- `pytest -m "not live"` and `yarn build` green.
- UI tasks: checked at 375px and 1280px, keyboard-only, reduced motion; contrast measured, not eyeballed.
- README/PRD updated if behavior or env vars changed.
