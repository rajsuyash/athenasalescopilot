# Athena

**Real-time sales coach for Google Meet.** Athena listens to your discovery calls, detects customer questions and objections, and surfaces grounded answers — pulled from your own playbook — in under two seconds. When the call ends, it ships a recap, a draft follow-up email, and a list of CRM updates.

> Status: public beta. Free tier — 3 seats, 5 meeting hours / month, no credit card.

## Try it

- **Hosted**: sign up at <https://athena.app> · install the [Chrome extension](https://chrome.google.com/webstore) · open a Meet.
- **Self-host**: see [Self-hosting](#self-hosting) below — Docker compose + a single domain.

## What you get

- **Live coaching** — a whisper-quiet overlay shows the answer or follow-up to ask, scored against your knowledge base. Suggestions arrive in under 2 s P95.
- **Grounded in your stack** — every suggestion maps back to a real chunk in a document you uploaded. No hallucinated pricing.
- **Auto recap + follow-up** — call ends, summary + draft email + CRM update list appear in the inbox.
- **Manager surfaces** — flag suggestions, comment threads, audit log, latency dashboards.
- **Tenant isolated** — every record scoped to a workspace. Your knowledge never leaks.

Surfaces:

- Web admin (Next.js) — knowledge, scripts, meetings, recap, inbox, audit.
- macOS overlay (SwiftUI) — borderless always-on-top coach near the camera notch.
- Chrome extension (MV3) — Meet detection + caption shipping + native notifications.
- CLI — for scripting and headless test runs.

## Self-hosting

Single-host Docker stack with Caddy in front, all 8 services + admin web on one domain.

```bash
git clone https://github.com/athena-app/athena
cd athena

cp infra/.env.example infra/.env
$EDITOR infra/.env                          # ATHENA_DOMAIN, JWT secrets, AI keys

docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build
./infra/release.sh                          # apply migrations + smoke healthchecks

# Visit https://${ATHENA_DOMAIN}/
```

Reference: [`infra/ENV.md`](./infra/ENV.md) for every env var.

---

## Repository layout

```
apps/{cli,desktop-macos,admin-web,chrome-extension}
services/{api,realtime-gateway,knowledge-service,orchestrator-service,
          postcall-service,retention-worker,analytics-service,billing-service}
packages/{db,shared-types,policies,sdk/{stt,llm,embeddings}}
infra/                  # Dockerfile, Caddyfile, docker-compose.prod.yml, ENV.md
docs/                   # PRD, architecture, decisions, runbooks
```

## Development

Three terminals; see `infra/docker-compose.yml` for the dev infra (Postgres + Redis + MinIO).

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio
pnpm install
pnpm --filter @athena/db prisma migrate deploy
psql "$DATABASE_URL" -f packages/db/prisma/migrations/manual/01_pgvector_chunk_embedding.sql

# Boot every service in dev mode (8 terminals or use a runner like overmind).
pnpm --filter @athena/api dev                 # :4000
pnpm --filter @athena/knowledge-service dev   # :4010
pnpm --filter @athena/orchestrator-service dev # :4020
pnpm --filter @athena/postcall-service dev    # :4030
pnpm --filter @athena/realtime-gateway dev    # :4040
pnpm --filter @athena/retention-worker dev    # :4050
pnpm --filter @athena/analytics-service dev   # :4060
pnpm --filter @athena/billing-service dev     # :4070
pnpm --filter @athena/admin-web dev           # :3000
```

Then drive everything from the CLI:

```bash
pnpm --filter @athena/cli build
alias athena="node $(pwd)/apps/cli/dist/index.js"
athena signup
athena kb add --text "Pricing: ..." --category faq --name pricing
athena listen --gateway --meeting "Acme Discovery"
```

### macOS overlay

```bash
cd apps/desktop-macos
swift build -c release
.build/release/AthenaOverlay
```

The overlay reads `~/.athena/config.json` for tokens — sign in with the CLI once and both surfaces work.

### Chrome extension (unpacked)

```bash
cd apps/chrome-extension
pnpm build                # outputs ./dist
# Chrome → Extensions → Developer mode → Load unpacked → select dist/
```

## Stack

| Layer | Choice |
|---|---|
| Desktop | Swift + SwiftUI (macOS 13+) |
| Chrome extension | TypeScript + Manifest V3 + esbuild |
| Admin web | Next.js 15 + React 19 + Tailwind |
| Backend | TypeScript + Fastify 5 |
| Realtime | WebSockets (`@fastify/websocket`) |
| Primary DB | PostgreSQL 16 |
| Vector | pgvector + pg_trgm (hybrid retrieval) |
| Cache / pub-sub | Redis (ioredis) |
| Object store | S3-compatible (MinIO in dev) |
| Auth | JWT 15m access + 30d refresh, argon2id |
| Billing | Stripe (graceful mock fallback) |
| Reverse proxy | Caddy 2 |

## Hard rules

1. **Tenant isolation** — every domain table has `workspace_id`; every query filters on it.
2. **Provider abstraction** — STT, LLM, embeddings only via `packages/sdk/*`.
3. **Grounded outputs only** — suggestion text references real chunk IDs; hallucinated sources are rejected server-side.
4. **No raw audio retention** by default; opt-in per workspace.
5. **Append-only audit log** — `audit_logs` rows are immutable.
6. **Soft-delete by default** — hard-delete only via retention worker.

See [`CLAUDE.md`](./CLAUDE.md) for the full working agreement.

## Documentation

- [`docs/PRD.md`](./docs/PRD.md) — Product Requirements (every feature ID, AC, glossary).
- [`docs/architecture/`](./docs/architecture/) — system design + data flow.
- [`docs/decisions/`](./docs/decisions/) — Architecture Decision Records.
- [`docs/runbooks/`](./docs/runbooks/) — operational runbooks.
- [`docs/launch/`](./docs/launch/) — launch assets (PH copy, demo notes).

## License

Source-available — see [`LICENSE`](./LICENSE) (TBD before public launch).

## Contact

[hello@athena.app](mailto:hello@athena.app) · [@athena](https://twitter.com/athena) (placeholder handles).
