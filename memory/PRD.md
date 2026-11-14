# FreshCheck PRD

## Original problem statement
Build FreshCheck, a web app that detects stale facts in AI-generated answers. The user pastes an answer and an optional generated date. An LLM extracts atomic claims. Tavily search (advanced, include_answer, max_results 5, TAVILY_API_KEY) finds evidence for each claim. An LLM then gives each claim a verdict (Current/Outdated/Uncertain), a score from 0 to 100, the updated fact, a reason and sources. The UI has a gauge, inline green/red/amber highlights, claim cards, 3 example answers, live progress per claim, and a dark, mobile-friendly design. LLM_BASE_URL and LLM_MODEL are set by env (for a Bifrost gateway). Sources are never invented: if Tavily returns nothing, the verdict is Uncertain.

## User choices
- Emergent LLM key (gpt-5.4 via emergentintegrations). Set LLM_BASE_URL (+ optional LLM_API_KEY) to route calls through an OpenAI-compatible gateway using the openai SDK.
- No history is saved.

## Architecture
- Backend: FastAPI with `POST /api/check`, which returns an SSE stream (status, claims, claim_start, claim_result, done). Claims are verified in parallel (semaphore 4). Sources map only to Tavily results.
- Frontend: React single page. Code in lib/freshcheck.js plus InputPanel, LiveProgress, ScoreGauge, HighlightedAnswer and ClaimCard components.

## Implemented (2026-06)
- Full MVP flow, 3 example chips, live progress, gauge, highlights, cards, and Reset/Cancel.
- Hardening: worker crash leads to Uncertain, tasks are cancelled on disconnect, scores are parsed defensively, and corrected facts are limited to the evidence.

## Iteration 2 (2026-06)
- Bifrost gateway layer (backend/llm_gateway.py). BIFROST_BASE_URL and BIFROST_API_KEY route calls to the OpenAI-compatible /v1. If unset, the Emergent key is used. EXTRACT_MODEL (fast) and VERDICT_MODEL (strong) use provider/model names. LLM_BASE_URL and LLM_MODEL were removed.
- SSE meta and llm_call events feed the Run details panel. The footer shows a Bifrost/Direct badge. Added GET /api/config.
- POST /api/rewrite returns a corrected, cited answer. Each claim card has Copy fix. Copy Markdown and Export .md are available. Added empty and error states and the new hero tagline.
- Scores are clamped per verdict, and the supporting source is listed first.
- docker-compose.yml (bifrost, mongo, backend, frontend), Dockerfiles, bifrost/config.json, README with mermaid diagram, MIT LICENSE and docs/screenshots.
- The Bifrost route was verified with a local Bifrost v2.5.1 binary. Preview runs Direct.

## Backlog
- P1: Shareable result links (would need storage)
- P2: Export report as PDF/Markdown, a browser extension, and a per-claim re-check button
