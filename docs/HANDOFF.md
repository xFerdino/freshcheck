# FreshCheck handoff (for Antigravity or any local agent)

Status as of 2026-11-14 13:45 Warsaw. Hackathon prototype deadline: 15 Nov 2026, 11:59 PM IST (19:29 Warsaw).

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

## Done (in Emergent, batch 1 of docs/IMPROVEMENT_PLAN.md)
SEC-1..7, BUG-1..6, OBS-1, PERF-1, PERF-2, TEST-1, TEST-2.
Offline tests: `cd backend && pytest -m "not live" tests/test_unit.py` (35 passed locally).
Verified in the preview: Tech versions example works; Cancel keeps the pasted text.

## To do next (in this order)
1. Bifrost running for real (required by Problem #6): self-host Bifrost on a free host, set `BIFROST_BASE_URL` and `BIFROST_API_KEY`, confirm Run details shows calls routed via Bifrost.
2. UX batch: UX-1, UX-2, UX-3, UX-5, UX-6, UX-8, UX-9, UX-10, UX-12, UX-11 (a11y), UX-13, UX-14, UX-15, UI-1, UI-2, UI-4.
3. Features: FEAT-1 (per-claim re-check), FEAT-2 (accept/reject fixes), HIST-1 (local history), API-1 (JSON mode).
4. Hygiene if time: DEP-1..6, TEST-3, CI-1.
Skip Phase 2 growth bets before the deadline.

## Rules
- Do not use Emergent's Publish button (cost). Hosting later on a clearance43.online subdomain, self-hosted.
- No real keys in the repo, no invented metrics in README or pitch.
- Keep `yarn build` and `pytest -m "not live"` green.
