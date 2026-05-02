# Athena · Production env handbook

Single-file reference for every env var read by every service. Use this when filling out `infra/.env` (referenced by `docker-compose.prod.yml`).

## Required (all services)

| Var | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | Mode | `production` in prod |
| `DATABASE_URL` | Postgres | `postgresql://athena:<pw>@postgres:5432/athena` |
| `REDIS_URL` | Cross-process pub/sub + cache invalidation | `redis://redis:6379` |
| `JWT_ACCESS_SECRET` | Sign 15m access tokens | ≥32 chars, generate `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | Sign 30d refresh tokens | Different from access secret |
| `CORS_ORIGINS` | Comma-separated list | `https://${ATHENA_DOMAIN}` |
| `LOG_LEVEL` | Pino level | `info` recommended |
| `SENTRY_DSN` | Optional error tracking | Errors go to stdout when blank |
| `SENTRY_ENVIRONMENT` | Optional Sentry tag | `production` |

## Per-service ports

| Service | Port | Public path (via Caddy) |
|---|---|---|
| `api` | 4000 | `/v1/*` |
| `knowledge` | 4010 | `/knowledge/*` |
| `orchestrator` | 4020 | `/orchestrator/*` |
| `postcall` | 4030 | `/postcall/*` |
| `realtime-gateway` | 4040 | `/ws` (WebSocket upgrade) |
| `retention` | 4050 | `/retention/*` |
| `analytics` | 4060 | `/analytics/*` |
| `billing` | 4070 | `/billing/*` |
| `admin-web` | 3000 | `/`, `/dashboard`, `/api/*` |

All services expose `/healthz`.

## Service-specific

### api
| Var | Purpose |
|---|---|
| `KNOWLEDGE_URL` | URL of knowledge-service for signup-time seed |

### knowledge-service
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Embeddings provider (falls back to deterministic when blank) |
| `EMBEDDING_DIMENSION` | Vector size — keep at `256` to match the migration |
| `EMBEDDING_MODEL` | Default `text-embedding-3-small` |

### orchestrator-service
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | LLM provider for grounded suggestions |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| `KNOWLEDGE_URL` | Where to fetch retrieval results |

### realtime-gateway
| Var | Purpose |
|---|---|
| `DEEPGRAM_API_KEY` | STT provider (falls back to mock when blank) |
| `DEEPGRAM_MODEL` | `nova-2` |
| `STT_PROVIDER` | `auto` (deepgram if key, else mock) |
| `LLM_PROVIDER` | `auto` |
| `EMBEDDING_PROVIDER` | `auto` |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Same as upstream services |
| `POSTCALL_URL` | For auto-recap on session end |
| `API_URL` | For auto end-meeting on session close |
| `AUTO_RECAP`, `AUTO_END_MEETING` | `true` |
| `IDLE_TIMEOUT_MS` | `120000` |

### billing-service
| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Live mode. Blank = mock plan tier |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature validation |
| `STRIPE_PRICE_PRO` | Stripe price id for Pro tier |
| `STRIPE_PRICE_ENTERPRISE` | Stripe price id for Enterprise tier |

### admin-web
| Var | Purpose |
|---|---|
| `ATHENA_API_URL` | Internal URL of api (`http://api:4000`) |
| `ATHENA_KNOWLEDGE_URL`, `ATHENA_ORCHESTRATOR_URL`, etc. | One per backend service |
| `ATHENA_PUBLIC_URL` | `https://${ATHENA_DOMAIN}` — for absolute links in emails |

## Deploying alongside Paperclip on the existing Hetzner box (178.104.88.187)

That host already runs Paperclip + openclaw-gateway. Athena is built to co-exist:

| Resource | Paperclip / openclaw | Athena | Conflict? |
|---|---|---|---|
| Postgres host port | `127.0.0.1:54329` | `127.0.0.1:54330` | no |
| Postgres compose network | (host net) | `postgres:5432` (internal) | no |
| Redis | not used | `127.0.0.1:6380` | no |
| App ports | `3100`, `3101`, `18789`, `3456` | `4000–4070`, `3000` (internal only) | no |
| Public ports | none (all loopback / tailnet) | `80`, `443` (Caddy) | none today — verify |
| Compose project | `paperclip` | `athena-prod` | no |
| Docker volumes | `paperclip_*` | `athena-prod_pgdata` etc. | no |

Before bringing the stack up, confirm 80/443 are free on the host:

```bash
ssh suyashraj@178.104.88.187 "sudo ss -tlnp '( sport = :80 or sport = :443 )'"
```

If anything answers, stop it (or repurpose Caddy to serve both). Paperclip's UI on `100.98.52.74:3100` is tailnet-only and unaffected by Caddy taking 80/443.

DNS: point `${ATHENA_DOMAIN}` (e.g. `athena.app`) A-record at `178.104.88.187`. Caddy auto-issues a Let's Encrypt cert on first request — make sure the host's outbound HTTPS to `acme-v02.api.letsencrypt.org` is open.

The `athena-prod` compose project is fully self-contained (its own pg, its own redis, its own user network). Restarting or rebuilding Athena does not touch Paperclip, and vice versa. Each maintains its own backup cadence — see the `paperclip-backup-rotate` cron for Paperclip's snapshots; Athena's `pgdata` volume should be added to the same daily rotation.

Repo location convention on the host: `/home/suyashraj/athena` (parallel to `/home/suyashraj/paperclip`).

```bash
ssh suyashraj@178.104.88.187
cd /home/suyashraj
git clone <athena-repo-url> athena
cd athena
cp infra/.env.example infra/.env
$EDITOR infra/.env                         # ATHENA_DOMAIN=..., JWT secrets, AI keys
sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build"
./infra/release.sh
```

(`sg docker -c` mirrors how Paperclip is brought up on the same host so the
non-root user reaches the Docker socket.)

## Bootstrap sequence (greenfield host)

```bash
# 0. Provision a host with Docker + docker-compose v2.
# 1. Clone the repo and create infra/.env from infra/.env.example.
cp infra/.env.example infra/.env
$EDITOR infra/.env

# 2. Build and bring everything up.
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build

# 3. Run release migrations + health checks.
./infra/release.sh

# 4. Verify externally.
curl -I https://${ATHENA_DOMAIN}/healthz
```

## Smoke test (post-deploy)

1. `https://${ATHENA_DOMAIN}/` → public landing renders.
2. Create a workspace via `/signin?mode=signup`.
3. `https://${ATHENA_DOMAIN}/dashboard` → onboarding banner + 3 seeded knowledge docs visible on `/knowledge`.
4. `wss://${ATHENA_DOMAIN}/ws` accepts upgrade with a valid access token.
5. `https://${ATHENA_DOMAIN}/privacy` and `/terms` render unauthenticated.

## Rolling updates

```bash
git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d
./infra/release.sh
```

## Backups

Postgres is the single source of truth. Daily snapshots of the `pgdata` volume are sufficient for v1. Promote to managed Postgres (RDS, Neon) before exceeding 50GB.
