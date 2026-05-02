# Hetzner deploy — co-tenant with Paperclip

Host: `178.104.88.187` (alias tailnet `100.98.52.74`), user `suyashraj`, Ubuntu 24.04.
Already running on the box: Paperclip (Docker, host-net, ports 3100/3101/54329) + openclaw-gateway (user systemd, 18789).

Athena slots in cleanly: separate compose project, separate Postgres on 54330, separate Redis on 6380, Caddy on 80/443.

## Pre-flight (run from your Mac)

```bash
# 1. Confirm 80/443 are free.
ssh suyashraj@178.104.88.187 "sudo ss -tlnp '( sport = :80 or sport = :443 )'"

# 2. Confirm Paperclip's pg port is taken so 54329 is reserved.
ssh suyashraj@178.104.88.187 "sudo ss -tlnp 'sport = :54329'"

# 3. Confirm docker group membership for sg docker -c.
ssh suyashraj@178.104.88.187 "id -nG"
```

## DNS

Point `athena.app` (or whatever domain) A-record at `178.104.88.187`. Wait for propagation (`dig athena.app +short`). Caddy issues TLS automatically on first request to that hostname.

## First deploy

```bash
ssh suyashraj@178.104.88.187
cd /home/suyashraj
git clone <athena-repo-url> athena
cd athena
cp infra/.env.example infra/.env
nano infra/.env
# REQUIRED:
#   ATHENA_DOMAIN=athena.app
#   POSTGRES_PASSWORD=<openssl rand -base64 32>
#   JWT_ACCESS_SECRET=<openssl rand -base64 48>
#   JWT_REFRESH_SECRET=<openssl rand -base64 48>
# OPTIONAL but you should set:
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...
#   DEEPGRAM_API_KEY=...
#   SENTRY_DSN=...

sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build"
./infra/release.sh
```

## Smoke test (from your Mac)

```bash
curl -I https://athena.app/                 # 200 (public landing)
curl -I https://athena.app/healthz          # 200 from api
curl -I https://athena.app/privacy          # 200
curl -I https://athena.app/terms            # 200

# Signup
curl -X POST https://athena.app/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you+launchtest@yourdomain.com","password":"a-strong-password","name":"Launch","workspaceName":"Launch Test","workspaceSlug":"launch-test"}'
# → 201 with accessToken + workspace id

# WebSocket
ssh suyashraj@178.104.88.187 "docker logs athena-prod-realtime-gateway-1 --tail 20"
```

## Rolling update

```bash
ssh suyashraj@178.104.88.187 'cd /home/suyashraj/athena && git pull && sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env build" && sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d" && ./infra/release.sh'
```

## Rollback

```bash
ssh suyashraj@178.104.88.187 'cd /home/suyashraj/athena && git checkout <previous-sha> && sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build"'
```

## Backups

Add to root crontab next to the existing `paperclip-backup-rotate`:

```cron
30 3 * * * sudo docker exec athena-prod-postgres-1 pg_dump -U athena athena | gzip > /home/suyashraj/backups/athena-$(date +\%F).sql.gz && find /home/suyashraj/backups -name 'athena-*.sql.gz' -mtime +14 -delete
```

## Tearing it down (without touching Paperclip)

```bash
sg docker -c "docker compose -f infra/docker-compose.prod.yml --env-file infra/.env down"
# Volumes survive; data is preserved. Add `--volumes` to wipe.
```

## Watching it

```bash
ssh suyashraj@178.104.88.187 'sg docker -c "docker compose -f /home/suyashraj/athena/infra/docker-compose.prod.yml logs -f --tail=50"'
```

## What does NOT happen

- No change to Paperclip's container, network, or port bindings.
- No change to openclaw-gateway, Joey/Chandler bots, cron, or `~/.openclaw`.
- No new system service. Athena lives entirely inside the `athena-prod` Docker project.
