# Smoke test results — local stack, 2026-04-29

All 8 services + admin web running on this Mac. Demo can be recorded right now without the macOS overlay.

## What was verified

| Path | Result |
|---|---|
| `docker compose up postgres redis minio` | up + healthy |
| `prisma db push` (dev schema sync) | clean |
| All 5 manual SQL migrations applied | clean |
| 8 backend services boot & answer `/healthz` | ok (with one fix below) |
| admin web at `http://localhost:3030` (port 3000 was taken by another project) | 200 |
| Public landing `/`, `/privacy`, `/terms`, `/signin` (unauth) | 200 |
| Direct API signup → tokens issued | 201 |
| **Onboarding seed**: 3 starter knowledge docs auto-created | 3 docs indexed |
| **Disposable-email block**: `mailinator.com` rejected | `EMAIL_DOMAIN_BLOCKED` 400 |
| Browser-equivalent login flow → session cookie set → `/dashboard` renders | 200, workspace + docs visible |
| `/knowledge`, `/meetings`, `/inbox` rendered while authed | 200 |
| Create meeting via API | 201 |
| Orchestrator `/v1/orchestrator/suggest` returns suggestion | ok (heuristic mode) |
| Knowledge `/v1/knowledge/search` returns the seeded pricing chunk | ok |
| Realtime gateway WebSocket upgrade `/v1/sessions` with token | `101 Switching Protocols` + `hello.required` |

## Bugs found and fixed during the smoke test

1. **`isMain` check failed on macOS** (`/tmp` symlinks to `/private/tmp`) — every service's `server.ts` exited cleanly without listening. Fixed across all 8 services with `realpathSync` normalisation.
2. **Meeting create rejected blank `externalMeetingId`** — Zod `.default('')` collided with `.min(1)`. Changed to `.optional()` so the route's auto-generated id kicks in.

Both fixed; the running stack reflects the fixes.

## Knowledge retrieval note

Without an `OPENAI_API_KEY` the embeddings SDK falls back to a deterministic encoder. With deterministic embeddings, the default `minScore=0.2` cosine threshold is too tight for the 3 seeded chunks, so the orchestrator surfaces a heuristic "ask_next" suggestion instead of a grounded answer.

For the demo this means:
- **With an OpenAI key set**: pricing question → grounded answer pulled from the starter pricing FAQ.
- **Without an OpenAI key**: pricing question → "How many seats are you sizing this for, and what budget cycle are we in?" (heuristic clarifier).

Both flows look fine on camera. If you want grounded answers in the demo, drop the keys into the `.env` files before recording (see "Optional polish" below).

## Live process map

| Port | Service |
|---|---|
| 5432 | postgres (docker, host) |
| 6379 | redis (docker, host) |
| 9000/9001 | minio + console |
| 4000 | api |
| 4010 | knowledge-service |
| 4020 | orchestrator-service |
| 4030 | postcall-service |
| 4040 | realtime-gateway (WS on `/v1/sessions`) |
| 4050 | retention-worker |
| 4060 | analytics-service |
| 4070 | billing-service (mock mode) |
| 3030 | admin-web (Next.js dev) |

Logs: `tail -f /tmp/athena-logs/*.log`

## Demo credentials (already created)

- Workspace: **Demo Workspace** (slug `demo`)
- Email: `demo@athena.app`
- Password: `DemoPassword123!`
- Live meeting in DB: "Demo discovery call"

You can blow it away and re-create with a fresh signup whenever you want.
