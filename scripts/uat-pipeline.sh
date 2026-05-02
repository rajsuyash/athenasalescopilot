#!/usr/bin/env bash
# Athena end-to-end UAT — caption → coach → suggestion pipeline.
#
# Drives the same path the chrome extension uses (POST /v1/sessions/captions
# on the gateway). Verifies that within ~15s the api returns >=3 suggestions
# for the meeting we just created.
#
# Usage: ./scripts/uat-pipeline.sh [email] [password]
# Defaults to the andres-v5 demo workspace.
set -euo pipefail

API_URL="${ATHENA_API_URL:-http://localhost:4000}"
GATEWAY_URL="${ATHENA_GATEWAY_URL:-http://localhost:4040}"
ADMIN_URL="${ATHENA_ADMIN_URL:-http://localhost:3030}"
EMAIL="${1:-andres-v5@athena.app}"
PASSWORD="${2:-DemoPassword123!}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { red "missing dep: $1"; exit 2; }; }
need curl
need jq

blue "==> health check"
for url in "$API_URL/v1/auth/login" "$GATEWAY_URL/v1/sessions/captions"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" -H "content-type: application/json" -d '{}' || echo "000")
  case "$code" in
    400|401|403|422) dim "  $url -> $code (reachable)";;
    *) red "  $url unreachable (got $code) — start services first"; exit 3;;
  esac
done

blue "==> login as $EMAIL"
LOGIN=$(curl -s -X POST "$API_URL/v1/auth/login" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')")
TOKEN=$(echo "$LOGIN" | jq -r '.accessToken // empty')
if [[ -z "$TOKEN" ]]; then
  red "login failed:"; echo "$LOGIN" | jq .
  exit 4
fi
dim "  got access token (len=${#TOKEN})"

EXT_ID="uat-$(date +%s)-$$"
blue "==> create meeting (externalMeetingId=$EXT_ID)"
MEETING=$(curl -s -X POST "$API_URL/v1/meetings" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "$(jq -n --arg e "$EXT_ID" '{title:"UAT — caption pipeline",externalPlatform:"google_meet",externalMeetingId:$e,consentMode:"rep_only"}')")
MID=$(echo "$MEETING" | jq -r '.id // empty')
if [[ -z "$MID" ]]; then
  red "meeting create failed:"; echo "$MEETING" | jq .
  exit 5
fi
dim "  meeting id: $MID"

blue "==> inject 3 canned objections via gateway"
PAYLOAD=$(jq -n --arg e "$EXT_ID" '{
  externalMeetingId: $e,
  captions: [
    { text: "Honestly, this is way too expensive for what we get.", speakerLabel: "Customer" },
    { text: "We already have a vendor that handles this for us.",   speakerLabel: "Customer" },
    { text: "Just send me an email and I will think about it.",     speakerLabel: "Customer" }
  ]
}')
INJECT=$(curl -s -X POST "$GATEWAY_URL/v1/sessions/captions" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "$PAYLOAD")
INJECTED=$(echo "$INJECT" | jq -r '.injected // 0')
ROUTED_MID=$(echo "$INJECT" | jq -r '.meetingId // empty')
if [[ "$INJECTED" -lt 3 ]]; then
  red "inject failed (injected=$INJECTED):"; echo "$INJECT" | jq .
  exit 6
fi
if [[ "$ROUTED_MID" != "$MID" ]]; then
  red "ROUTING BUG — captions landed on $ROUTED_MID, not $MID (the meeting we just created)"
  red "  → check services/realtime-gateway/src/modules/session/captions.ts findFirst orderBy"
  exit 7
fi
green "  injected=$INJECTED, routed to correct meeting"

blue "==> poll for suggestions (up to 30s)"
DEADLINE=$((SECONDS + 30))
COUNT=0
while [[ $SECONDS -lt $DEADLINE ]]; do
  SUGG=$(curl -s "$API_URL/v1/meetings/$MID/suggestions" -H "authorization: Bearer $TOKEN")
  COUNT=$(echo "$SUGG" | jq -r '.suggestions | length')
  printf '\r  suggestions=%s elapsed=%ss   ' "$COUNT" "$SECONDS"
  if [[ "$COUNT" -ge 3 ]]; then break; fi
  sleep 1
done
printf '\n'

if [[ "$COUNT" -lt 3 ]]; then
  red "FAIL — only $COUNT suggestions after 30s"
  echo "$SUGG" | jq .
  exit 8
fi

green "==> PASS — $COUNT suggestions persisted"
echo "$SUGG" | jq -r '.suggestions[] | "\n--- " + .suggestionType + " (conf " + (.confidenceScore|tostring) + ") ---\n" + (.answerText // .followupText // "(no text)") + "\n  rationale: " + (.rationale // "—")'

echo
green "==> dashboard URL"
echo "  $ADMIN_URL/meetings/$MID"
