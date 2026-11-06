# Athena production release — 2026-11-06

User authorized deployment after phase 6. Released the verified gateway changes and the earlier extension lifecycle changes as **Athena Companion 0.1.24**.

## Running deployments

- Realtime: `8c8be4d9-c039-486b-a27c-1bdfa2174a4c` — Railway SUCCESS.
- Dashboard/download: `e64610a3-076b-4de3-824e-b3a2f193be64` — Railway SUCCESS.
- Project: `f576aa29-309e-4c33-b0cc-5d829c4e2295`, production environment.
- Initial gateway upload: `c99aa1cc-562e-43b6-936a-95dcc137da45`; replaced by the same-source deployment above after credential repair.
- Previous gateway/dashboard deployments: `7e9e9ca1-5314-4f2f-898a-1a7a07d28c06` / `53fd865c-76ac-4606-86df-60c9bac64f44`.

Deployment used an isolated source snapshot through Railway CLI. It included the changed application sources and required new cancellation helper, and excluded local credentials and reverse-engineering/benchmark evidence. No database migrations, customer-record writes or unrelated service deployments were performed. GitHub was not pushed: future autodeployment from the older `main` branch can replace these changes until source history is synchronized.

## Verification

- Fresh snapshot dependency installation and gateway build passed; gateway tests 70/70. Extension typecheck and tests 22/22 passed, including Chromium cancellation coverage. Dashboard production build, including type/lint checks and extension packaging, passed locally and on Railway.
- Runtime source hashes for coach, prompt, session handler and cancellation helper matched the release; compiled code contains the compact-reference implementation. The final restarted gateway's coach hash also matched.
- Gateway `/healthz` and dashboard `/api/healthz` returned 200. WebSocket auth challenge worked; an invalid token was rejected with close code 4001.
- `/install` shows 0.1.24. All 15 files in the downloaded ZIP match the locally tested package byte-for-byte after extraction. ZIP checksum and source hashes are in `deployment-source.json`.
- From inside the final gateway: Haiku `claude-haiku-4-5-20251001` completed a synthetic request; OpenAI `text-embedding-3-small` returned 256 finite dimensions; read-only database `SELECT 1` succeeded.
- A synthetic audio request using the production Deepgram credential and existing Nova-2 setting returned “athena deployment test.” This verifies transcription capability, not live Meet capture or full streaming latency.

The first provider smoke test exposed pre-existing invalid Anthropic and OpenAI credentials: both returned 401. Verified existing credentials were applied only to `athena-realtime`, through stdin without writing secret values to files or logs. The service was redeployed and the provider checks repeated successfully. Other services' credentials were not changed or verified. Nova-2 remains configured; phase 4–6 benchmarks used Nova-3, so their latency figures are not production measurements.

Temporary SSH verification access was revoked after the checks; Railway reports no registered keys, and the temporary local private/public key pair was deleted.

## Access and limits

Install page: https://www.rocketsalesagent.com/install

Package: https://www.rocketsalesagent.com/downloads/rocket-sales-agent-0.1.24.zip

Existing 0.1.23 installations need updating to receive scoped preview retraction; publishing the ZIP does not update unpacked Chrome installations automatically. A gateway rollback to the old unscoped protocol after scoped traffic requires a Meet-tab reload. No Chrome Web Store publication or real Google Meet acceptance test was performed. The incomplete benchmark session and outstanding benchmark completion-condition fix remain documented in `REPORT.md`; the one-second generated-line target remains unmet.
