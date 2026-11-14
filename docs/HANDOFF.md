# FreshCheck handoff (for Antigravity or any local agent)

Status as of 2026-11-14 15:05 Warsaw. Hackathon prototype deadline: 15 Nov 2026, 11:59 PM IST (19:29 Warsaw).

## What FreshCheck is
Stale-answer detector for Problem #6 of the Global AI Hackathon by Geek Room (Tavily + Bifrost track).
Paste an AI answer, it extracts factual claims, searches each with Tavily, judges Current / Outdated / Uncertain
with cited sources, and rewrites the answer with fresh facts. LLM calls go through Bifrost (OpenAI-compatible
gateway) when `BIFROST_BASE_URL` is set, otherwise through the Emergent LLM key.

## Stack
- backend/: FastAPI, SSE streaming. `server.py` (pipeline, endpoints), `llm_gateway.py` (Bifrost or Emergent route), `runtime.py` (rate limit, run store, cache, retries).
- frontend/: React (CRA + craco), Tailwind, framer-motion. Main: `src/App.js`, `src/components/*`, `src/lib/freshcheck.js`.
- bifrost/config.json + docker-compose.yml for a local Bifrost.
- Env templates: `backend/.env.example`, `frontend/.env.example`. Never commit real `.env` files.

## Done
- Batch 1 in Emergent: SEC-1..7, BUG-1..6, OBS-1, PERF-1, PERF-2, TEST-1, TEST-2.
- Locally (Antigravity): UX-1, UX-2, UX-3, UX-5, UX-6, UX-8 to UX-15, UI-1, UI-2, UI-4, FEAT-1, FEAT-2, HIST-1, API-1, BUG-7.
- Bifrost: BIFROST-1..3 (OpenRouter provider, free default model `openrouter/nvidia/nemotron-3.5-lightning:free`, fixed binary path in the multi-stage Dockerfile).
- Deploy config: DEPLOY-1, DEPLOY-2 (Render free plan for backend + Bifrost via `render.yaml`, Cloudflare Pages for the frontend, CORS for `https://freshcheck.pages.dev`).
- DOCS-1: README updated after the audit.

Offline tests: `cd backend && pytest -m "not live" tests/test_unit.py` (35 passed after batch 1; re-run after the later changes).

## To do next (in this order)
1. Verify Bifrost end to end on the deployed backend: `GET /api/config` shows `"route": "bifrost"`, and Run details shows calls routed via Bifrost. Record it in a screenshot for the submission.
2. Verify the deployed frontend runs a full check (Tech versions example) and the corrected answer.
3. Leftover UX: UX-4 (sticky action bar on mobile), UX-7 (overview panel sizing), UX-16 (evidence snippet per source).
4. Hygiene if time: TEST-3 (frontend unit tests), CI-1 (GitHub Actions), DEP-1..6.
5. Refresh `docs/screenshots/` with the new UI.
Skip Phase 2 growth bets before the deadline.

## Rules
- Do not use Emergent's Publish button (cost). Hosting later on a clearance43.online subdomain, self-hosted.
- No real keys in the repo, no invented metrics in README or pitch.
- Keep `yarn build` and `pytest -m "not live"` green.
