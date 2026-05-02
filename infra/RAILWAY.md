# Railway deployment

Production hosting target for Athena. Replaces the single-host
`docker-compose.prod.yml` path for everything except local dev. Each Athena
service deploys as a separate Railway service, all in one project, sharing a
private network and a managed Postgres + Redis.

Repo: https://github.com/rajsuyash/athenasalescopilot

---

## What gets deployed

| Railway service       | Source dir                          | Public? | Notes                                  |
| --------------------- | ----------------------------------- | ------- | -------------------------------------- |
| `athena-postgres`     | Railway plugin (managed)            | no      | pgvector extension required            |
| `athena-redis`        | Railway plugin (managed)            | no      |                                        |
| `athena-api`          | `services/api`                      | yes     | REST + auth + meetings                 |
| `athena-realtime`     | `services/realtime-gateway`         | yes     | WebSocket; needs always-on plan        |
| `athena-knowledge`    | `services/knowledge-service`        | no      | private (called by api + orchestrator) |
| `athena-orchestrator` | `services/orchestrator-service`     | no      |                                        |
| `athena-postcall`     | `services/postcall-service`         | no      |                                        |
| `athena-billing`      | `services/billing-service`          | yes     | Stripe webhooks                        |
| `athena-analytics`    | `services/analytics-service`        | no      |                                        |
| `athena-retention`    | `services/retention-worker`         | no      | background worker, no inbound          |
| `athena-admin-web`    | `apps/admin-web`                    | yes     | Next.js dashboard                      |

Each service has a `railway.json` at its root that tells Railway how to
build (`pnpm --filter <pkg>... build`) and start it. `nixpacks.toml` at the
repo root pins Node 20 + pnpm 9 + openssl.

---

## One-time provisioning

1. **Create Railway project** — point it at
   `https://github.com/rajsuyash/athenasalescopilot` (main branch).

2. **Add managed plugins** in the project:
   - `Postgres` (16, with pgvector enabled — see "pgvector" below)
   - `Redis` (latest)

3. **Add 9 services**, all from the same GitHub repo, each with **Root Directory**
   pointing at the matching folder above. Railway auto-discovers
   `railway.json` per service.

4. **Set shared env vars** at the project level (every service inherits):
   ```
   NODE_ENV=production
   LOG_LEVEL=info
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   JWT_ACCESS_SECRET=<≥48 random chars>
   JWT_REFRESH_SECRET=<≥48 random chars>
   ANTHROPIC_API_KEY=<sk-ant-...>
   ANTHROPIC_MODEL=claude-haiku-4-5-20251001
   OPENAI_API_KEY=<sk-...>
   EMBEDDING_DIMENSION=256
   DEEPGRAM_API_KEY=<...>
   DEEPGRAM_MODEL=nova-2
   STRIPE_SECRET_KEY=<sk_live_... or empty for mock>
   STRIPE_WEBHOOK_SECRET=<whsec_... or empty>
   SENTRY_DSN=<https://... or empty>
   ```

5. **Set per-service env vars** so internal calls hit Railway's private
   network (substitute `RAILWAY_PRIVATE_DOMAIN` from each service):
   ```
   API_URL=http://${{athena-api.RAILWAY_PRIVATE_DOMAIN}}:${{athena-api.PORT}}
   KNOWLEDGE_URL=http://${{athena-knowledge.RAILWAY_PRIVATE_DOMAIN}}:${{athena-knowledge.PORT}}
   ORCHESTRATOR_URL=http://${{athena-orchestrator.RAILWAY_PRIVATE_DOMAIN}}:${{athena-orchestrator.PORT}}
   POSTCALL_URL=http://${{athena-postcall.RAILWAY_PRIVATE_DOMAIN}}:${{athena-postcall.PORT}}
   ANALYTICS_URL=http://${{athena-analytics.RAILWAY_PRIVATE_DOMAIN}}:${{athena-analytics.PORT}}
   BILLING_URL=http://${{athena-billing.RAILWAY_PRIVATE_DOMAIN}}:${{athena-billing.PORT}}
   GATEWAY_URL=http://${{athena-realtime.RAILWAY_PRIVATE_DOMAIN}}:${{athena-realtime.PORT}}
   RETENTION_URL=http://${{athena-retention.RAILWAY_PRIVATE_DOMAIN}}:${{athena-retention.PORT}}
   ```

6. **Set `CORS_ORIGINS` on api + gateway + billing**:
   ```
   CORS_ORIGINS=https://app.athena.app
   ```

7. **Set `PORT`** on each service (Railway also injects it):
   - `athena-api` → 4000
   - `athena-knowledge` → 4010
   - `athena-orchestrator` → 4020
   - `athena-postcall` → 4030
   - `athena-realtime` → 4040
   - `athena-retention` → 4050
   - `athena-analytics` → 4060
   - `athena-billing` → 4070
   - `athena-admin-web` → Railway's default (`$PORT`)

8. **Public domains** (Railway → Settings → Networking → Generate domain or
   add your own):
   - `app.athena.app` → `athena-admin-web`
   - `api.athena.app` → `athena-api`
   - `ws.athena.app` → `athena-realtime` (WebSocket; enable HTTP/2 OFF if you hit upgrade issues)
   - `billing.athena.app` → `athena-billing`

9. **Chrome extension prod build** — set the prod URLs at build time:
   ```bash
   cd apps/chrome-extension
   ATHENA_API_URL=https://api.athena.app \
   ATHENA_GATEWAY_URL=https://ws.athena.app \
     pnpm build:prod
   ```
   The resulting `dist/` (and the `athena-companion-0.1.0.zip` artifact) hits
   the Railway-hosted backend.

---

## pgvector on Railway Postgres

Railway's managed Postgres is plain Postgres 16. To enable pgvector:

1. After provisioning the Postgres plugin, open the Postgres service →
   **Data** tab → **Query**.
2. Run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
3. Run the manual migration (matches `infra/postgres/init/`):
   ```sql
   -- (see packages/db/prisma/migrations/manual/01_pgvector_chunk_embedding.sql)
   ```

If Railway's image doesn't have `vector` available, switch the Postgres
plugin to a custom image that bundles it (e.g. `pgvector/pgvector:pg16`)
via Railway's "Custom Source" → Docker image option.

---

## First deploy + smoke test

1. Push to `main` on
   `github.com/rajsuyash/athenasalescopilot`. Railway auto-builds every
   service whose Watch Paths intersect the diff.

2. Watch the build logs. The `athena-api` service runs
   `prisma migrate deploy` as part of `startCommand` — first boot creates
   the schema. Re-deploy is a no-op once migrations are applied.

3. Smoke checks:
   ```bash
   curl https://api.athena.app/healthz       # → {"ok":true}
   curl https://api.athena.app/readyz        # → {"ok":true,"db":"up"}
   curl -i https://ws.athena.app/healthz     # → 200
   open https://app.athena.app               # admin web loads
   ```

4. Sign in via the chrome extension popup — token mints against
   `api.athena.app`, capture connects to `ws.athena.app`, suggestions
   render in the in-Meet overlay.

---

## Cost note

Estimated baseline at ~zero traffic:

| Item                         | $/mo |
| ---------------------------- | ---- |
| 9 services × Hobby           | ~$45 |
| Managed Postgres             | ~$10 |
| Managed Redis                | ~$5  |
| **Total at idle**            | ~$60 |

Egress + compute scales linearly. At ~10 paying reps × 5 calls/day,
expect $80–$120/mo total. Migrate to Terraform-managed AWS/GCP at the
~$300/mo flip point (or earlier if multi-region failover becomes a
requirement).

---

## Going back to docker-compose

`infra/docker-compose.prod.yml` is still the source of truth for self-hosted
single-VPS deployments. The two paths share the same image build (Nixpacks
on Railway, multi-stage Dockerfile on compose) and the same env contract.
