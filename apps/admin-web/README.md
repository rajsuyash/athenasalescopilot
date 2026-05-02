# admin-web

Next.js 15 + React 19 + Tailwind admin console. PRD F7 (knowledge), parts of F8 (auth UI), F12 (meetings list).

## Run

```bash
cp apps/admin-web/.env.example apps/admin-web/.env.local
# point ATHENA_*_URL at your running services (defaults work for local docker)
pnpm --filter @athena/admin-web dev    # :3000
```

## Architecture

- All authenticated calls go through Next.js route handlers under `src/app/api/*`.
- Each route reads the `athena_session` httpOnly cookie, attaches `Authorization: Bearer ...`, and forwards to the appropriate backend service. The browser never sees the access token.
- Server components fetch via the same path; client components POST through the route handlers.

## Routes

| Path                     | Description                                       |
| ------------------------ | ------------------------------------------------- |
| /signin                  | sign-in / signup forms                            |
| /                        | dashboard (workspace + recent docs/meetings)      |
| /knowledge               | drop-zone upload + paste text + search + list     |
| /meetings                | list of hosted meetings                           |
| /api/auth/{login,signup,logout,me} | session lifecycle                       |
| /api/knowledge/{upload,text,documents,search} | proxies to knowledge-service |

## Build

```bash
pnpm --filter @athena/admin-web build      # production bundle
pnpm --filter @athena/admin-web start      # node start on :3000
```

## Responsibilities

- Workspace + team + user + role management (F8).
- Knowledge ingestion UI: upload, tag, version, publish (F7).
- Script collection editor (F7).
- Audit log viewer (F11).
- Analytics dashboards (F12).
- Coaching workflows (F13).
- CRM integration setup (F14).
- Billing + plan management (F16).

## Stack

- Next.js (app router)
- TypeScript strict
- shared types from `packages/shared-types`
- shared UI from `packages/ui`

## Tests

Vitest unit + Playwright E2E.
