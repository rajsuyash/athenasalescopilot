#!/usr/bin/env bash
# Release script — runs after the prod stack is up and before traffic is sent.
# Idempotent: safe to re-run on every deploy.
#
# Usage (from repo root):
#   ./infra/release.sh

set -euo pipefail

# Use `sg docker -c` on hosts where the user is in the docker group via
# secondary membership (matches how Paperclip is run on the shared Hetzner box).
COMPOSE_CMD="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"
if id -nG | grep -qw docker; then
  COMPOSE="$COMPOSE_CMD"
else
  COMPOSE="sg docker -c \"$COMPOSE_CMD\""
fi

echo "→ Apply Prisma migrations"
$COMPOSE exec -T api pnpm --filter @athena/db prisma migrate deploy

echo "→ Apply manual SQL migrations (idempotent)"
for sql in packages/db/prisma/migrations/manual/*.sql; do
  echo "    $(basename "$sql")"
  $COMPOSE exec -T -e PGPASSWORD="${POSTGRES_PASSWORD:-athena}" \
    postgres psql -U athena -d athena < "$sql" >/dev/null
done

echo "→ Health check sweep"
for svc in api knowledge orchestrator postcall realtime-gateway billing analytics retention; do
  port=$(case $svc in
    api) echo 4000;;
    knowledge) echo 4010;;
    orchestrator) echo 4020;;
    postcall) echo 4030;;
    realtime-gateway) echo 4040;;
    retention) echo 4050;;
    analytics) echo 4060;;
    billing) echo 4070;;
  esac)
  printf "  %-20s " "$svc:"
  if $COMPOSE exec -T "$svc" curl -fsS "http://localhost:$port/healthz" >/dev/null; then
    echo "ok"
  else
    echo "FAIL"
    exit 1
  fi
done

echo "✓ Release complete"
