#!/usr/bin/env bash
#
# Anti-recurrence tripwire for the 2026-06-04 "Token has expired" incident.
#
# Root cause was 8 hand-copied auth guards that drifted; a fix applied to 3 of
# them left 5 broken. This makes that class of bug fail the build:
#
#   1. The JWT expiry literals (FST_JWT_AUTHORIZATION_TOKEN_EXPIRED /
#      FAST_JWT_EXPIRED) may appear ONLY in packages/auth/src/codes.ts.
#   2. The raw JWT libraries (@fastify/jwt, fast-jwt) may be imported ONLY
#      inside packages/auth.
#
# During the migration (PR-D/E/H) the not-yet-migrated services are listed in
# LEGACY_ALLOWLIST. Each entry is DELETED as its service moves to @athena/auth,
# so the allowlist shrinks to empty and the guard becomes fully fail-closed.
#
# Usage: scripts/check-no-rogue-auth.sh   (exit 0 = clean, 1 = violation)
set -euo pipefail
cd "$(dirname "$0")/.."

# Files permitted to still reference the literals / import the JWT libs while
# their service is mid-migration. SHRINK this as each PR migrates a service.
LEGACY_ALLOWLIST=(
  "services/api/src/plugins/auth.ts"
  "services/realtime-gateway/src/lib/auth.ts"
  "services/postcall-service/src/lib/auth.ts"
  "services/analytics-service/src/lib/auth.ts"
  "services/billing-service/src/lib/auth.ts"
  "services/knowledge-service/src/lib/auth.ts"
  "services/orchestrator-service/src/lib/auth.ts"
  "services/retention-worker/src/lib/auth.ts"
)

# Files that are ALWAYS allowed (the single source of truth + this script).
ALWAYS_ALLOWED=(
  "packages/auth/"
  "scripts/check-no-rogue-auth.sh"
)

is_allowed() {
  local file="$1"
  for a in "${ALWAYS_ALLOWED[@]}"; do
    case "$file" in "$a"*) return 0 ;; esac
  done
  for a in "${LEGACY_ALLOWLIST[@]}"; do
    [ "$file" = "$a" ] && return 0
  done
  return 1
}

violations=0

# 1. Expiry literals outside the single codes.ts.
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ "$file" = "packages/auth/src/codes.ts" ] && continue
  if is_allowed "$file"; then continue; fi
  echo "ROGUE AUTH: JWT expiry literal in $file — classification belongs in @athena/auth only."
  violations=1
done < <(git grep -l -E 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED|FAST_JWT_EXPIRED' -- '*.ts' 2>/dev/null || true)

# 2. Raw JWT libraries imported outside packages/auth.
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if is_allowed "$file"; then continue; fi
  echo "ROGUE AUTH: raw JWT import (@fastify/jwt or fast-jwt) in $file — use @athena/auth instead."
  violations=1
done < <(git grep -l -E "from '(@fastify/jwt|fast-jwt)'|require\('(@fastify/jwt|fast-jwt)'\)" -- '*.ts' 2>/dev/null || true)

# 3. A new services/**/src/{lib,plugins}/auth.ts that isn't allow-listed.
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if is_allowed "$file"; then continue; fi
  echo "ROGUE AUTH: new per-service auth file $file — services must import @athena/auth, not roll their own."
  violations=1
done < <(git ls-files 'services/*/src/lib/auth.ts' 'services/*/src/plugins/auth.ts' 2>/dev/null || true)

if [ "$violations" -ne 0 ]; then
  echo ""
  echo "Auth classification must live ONLY in @athena/auth. See docs/incidents/2026-06-04-token-expired-meeting-start.md"
  exit 1
fi
echo "check-no-rogue-auth: OK ($(( ${#LEGACY_ALLOWLIST[@]} )) legacy file(s) still pending migration)"
