#!/usr/bin/env bash
# Reads ANTHROPIC_API_KEY from the root .env, propagates to the 4 service .env
# files that need it, then verifies the key against the Anthropic API. Never
# prints the key itself — only its length and last-4 fingerprint.
set -euo pipefail

ROOT="/Users/suyashraj/Downloads/07 Tech Projects/Sales Co-Pilot/athena"
SRC="$ROOT/.env"
TARGETS=(
  "$ROOT/services/realtime-gateway/.env"
  "$ROOT/services/orchestrator-service/.env"
  "$ROOT/services/knowledge-service/.env"
  "$ROOT/services/postcall-service/.env"
)

if [[ ! -f "$SRC" ]]; then echo "missing $SRC"; exit 2; fi

# Source the root .env in a subshell, export the key, propagate without echo.
KEY_LEN=$(awk -F= '/^ANTHROPIC_API_KEY=/{print length($2); exit}' "$SRC")
if [[ -z "$KEY_LEN" || "$KEY_LEN" == "0" ]]; then
  echo "no ANTHROPIC_API_KEY=... line found in $SRC"
  echo "add a line like: ANTHROPIC_API_KEY=sk-ant-...   then re-run."
  exit 3
fi

# Use a tiny inline node script — never writes the key to stdout.
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1], "utf8");
const m = src.match(/^ANTHROPIC_API_KEY=(.+)$/m);
if (!m) { console.error("no key in src"); process.exit(4); }
const key = m[1].trim().replace(/^"|"$/g, "");
const targets = process.argv.slice(2);
for (const t of targets) {
  let body = fs.existsSync(t) ? fs.readFileSync(t, "utf8") : "";
  if (/^ANTHROPIC_API_KEY=/m.test(body)) {
    body = body.replace(/^ANTHROPIC_API_KEY=.*$/m, "ANTHROPIC_API_KEY=" + key);
  } else {
    body = body.replace(/\n*$/, "\n") + "ANTHROPIC_API_KEY=" + key + "\n";
  }
  fs.writeFileSync(t, body);
  console.log("patched", t.replace(process.env.HOME || "", "~"));
}
console.log("key length=" + key.length + " fingerprint=..." + key.slice(-4));
' "$SRC" "${TARGETS[@]}"

echo
echo "==> verifying key against Anthropic"
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1], "utf8");
const key = src.match(/^ANTHROPIC_API_KEY=(.+)$/m)[1].trim().replace(/^"|"$/g, "");
const model = (src.match(/^ANTHROPIC_MODEL=(.+)$/m)?.[1] || "claude-haiku-4-5-20251001").trim();
fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
}).then(async r => {
  const t = await r.text();
  if (r.ok) {
    console.log("OK — Anthropic accepted the key (model=" + model + ")");
  } else {
    console.error("FAIL — HTTP " + r.status + ":");
    console.error(t.slice(0, 300));
    process.exit(7);
  }
}).catch(e => { console.error("net error:", e.message); process.exit(8); });
' "$SRC"
