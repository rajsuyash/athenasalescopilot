# Hostinger DNS API — runbook

> Source of truth for managing DNS for `rocketsalesagent.com` (and any
> future Athena-owned domains) hosted at Hostinger.
>
> Compiled from the Hostinger API Python SDK docs (`/hostinger/api-python-sdk`)
> and the Hostinger CLI docs (`/hostinger/api-cli`) via Context7.

---

## Why this doc exists

Athena ships URLs in three places that need brand-clean values once
`rocketsalesagent.com` is live:

1. Chrome Web Store listing (`homepage_url`, privacy URL).
2. Customer-facing share links (the marketing site, sign-up CTA).
3. Email-from addresses on transactional mail (later).

We're on Hostinger's name servers. DNS changes can be made via:

- **Hostinger hPanel** (web UI) — easiest one-off.
- **Hostinger Public API** (REST) — scriptable, idempotent, audit-friendly.

This runbook covers both, biased toward the API for anything we want to
reproduce in CI later.

---

## Get an API token (one-time)

1. Log in to **Hostinger hPanel** → top-right avatar → **API**.
2. Click **Create token** → name it `athena-railway-deploys` →
   permission scope: `domains:dns:read`, `domains:dns:write`. Save
   the token immediately — it's shown only once.
3. Save to `~/.athena/hostinger.env` (do NOT commit):

   ```bash
   export HOSTINGER_API_TOKEN="hPxxxxxxxxxxxxxxxxxxxxxx"
   ```

Source the file before running any of the commands below
(`source ~/.athena/hostinger.env`).

---

## API basics

- **Base URL:** `https://developers.hostinger.com`
- **Authentication:** `Authorization: Bearer $HOSTINGER_API_TOKEN`
- **Content type:** `application/json`
- **Rate limit:** ~60 req/min per token (undocumented but observed).
  Snapshot-and-restore makes recovery cheap if you hit it.

### DNS-zone endpoints (the only ones we use today)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/dns/v1/zones/{domain}` | List all DNS records on `domain`. |
| `PUT`  | `/api/dns/v1/zones/{domain}` | Replace OR merge records (controlled by `overwrite` body field). |
| `DELETE` | `/api/dns/v1/zones/{domain}` | Delete a subset of records by `(name, type)` filter. |
| `POST` | `/api/dns/v1/zones/{domain}/validate` | Dry-run validate a body without touching the live zone. |
| `GET`  | `/api/dns/snapshot/v1/zones/{domain}` | List zone snapshots (auto-taken before every change). |
| `POST` | `/api/dns/snapshot/v1/zones/{domain}/{snapshot_id}/restore` | Restore a snapshot. |

### Request body shape (PUT)

```json
{
  "overwrite": false,
  "zone": [
    {
      "name": "@",
      "type": "CNAME",
      "ttl": 300,
      "records": [
        { "content": "5d62fjah.up.railway.app" }
      ]
    },
    {
      "name": "www",
      "type": "CNAME",
      "ttl": 300,
      "records": [
        { "content": "b18rh1s8.up.railway.app" }
      ]
    },
    {
      "name": "_railway-verify",
      "type": "TXT",
      "ttl": 300,
      "records": [
        { "content": "railway-verify=b70c58fa91ca41f935ce2f2d485cf6f939498b5b07044fde8989d1051b3578be" }
      ]
    }
  ]
}
```

Fields:

- **`name`** — record subdomain (`@` for apex, `www`, `_railway-verify`,
  etc). Hostinger normalises both with and without the trailing dot.
- **`type`** — `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `NS`, `SRV`, `CAA`.
- **`ttl`** — seconds. Use `300` during cutovers, `3600` once stable.
- **`records[]`** — array of values. For `MX`, each has `{content, priority}`.
- **`overwrite`**:
  - `false` (default) — merge. Records with the same `(name, type)` get
    replaced; records of other types on the same `name` are preserved.
  - `true` — wholesale replace the entire zone with the body. Dangerous
    — auto-snapshots beforehand make this recoverable but don't rely on it.

### Apex-CNAME quirk

Hostinger does NOT accept a literal `CNAME` on `@` via the API or hPanel
UI. They flatten it server-side IF you submit it via this API as
`type: "CNAME"` with `name: "@"`. The hPanel UI also accepts an
**ALIAS** alternative which is the same thing under the hood.

If the API rejects with `INVALID_RECORD_TYPE`, fall back to:

1. `dig +short cname.railway.app` → IPv4.
2. Submit as `type: "A"` with that IP. Update on every Railway IP
   rotation (rare; they email when it happens). Or set up a tiny
   Cloudflare Workers proxy that does CNAME flattening for free.

---

## End-to-end recipe — point `rocketsalesagent.com` at Railway admin-web

Full, copy-pasteable. Replace the placeholder values with the ones
from `railway domain --service athena-admin-web …` (already done — see
`memory/chrome_extension_id.md` and the chat log for current targets).

### Step 1 — Snapshot first (cheap insurance)

```bash
curl -s "https://developers.hostinger.com/api/dns/snapshot/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN"
```

The latest snapshot rolls back any mistakes — Hostinger auto-snapshots
before each PUT, but eyeballing the list confirms the safety net.

### Step 2 — Inspect current zone

```bash
curl -s "https://developers.hostinger.com/api/dns/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" | jq
```

Expected default zone for a freshly-bought domain: nameserver +
parking-page A records. We replace the parking A on `@` and `www`.

### Step 3 — Validate the new records (no changes yet)

```bash
curl -s -X POST "https://developers.hostinger.com/api/dns/v1/zones/rocketsalesagent.com/validate" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "overwrite": false,
  "zone": [
    { "name": "@",   "type": "CNAME", "ttl": 300, "records": [{ "content": "5d62fjah.up.railway.app" }] },
    { "name": "www", "type": "CNAME", "ttl": 300, "records": [{ "content": "b18rh1s8.up.railway.app" }] },
    { "name": "_railway-verify",     "type": "TXT", "ttl": 300, "records": [{ "content": "railway-verify=b70c58fa91ca41f935ce2f2d485cf6f939498b5b07044fde8989d1051b3578be" }] },
    { "name": "_railway-verify.www", "type": "TXT", "ttl": 300, "records": [{ "content": "railway-verify=1b08c65cd476d746a58118674d1fb058635f8a6df25731f35d9083532e91e570" }] }
  ]
}
EOF
```

Expect HTTP 200 with `{"success": true}`. If it returns
`INVALID_RECORD_TYPE` for the apex CNAME, see the apex-CNAME quirk above.

### Step 4 — Apply

Same body, swap `validate` → `zones/{domain}` with `PUT`:

```bash
curl -s -X PUT "https://developers.hostinger.com/api/dns/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "overwrite": false,
  "zone": [
    { "name": "@",   "type": "CNAME", "ttl": 300, "records": [{ "content": "5d62fjah.up.railway.app" }] },
    { "name": "www", "type": "CNAME", "ttl": 300, "records": [{ "content": "b18rh1s8.up.railway.app" }] },
    { "name": "_railway-verify",     "type": "TXT", "ttl": 300, "records": [{ "content": "railway-verify=b70c58fa91ca41f935ce2f2d485cf6f939498b5b07044fde8989d1051b3578be" }] },
    { "name": "_railway-verify.www", "type": "TXT", "ttl": 300, "records": [{ "content": "railway-verify=1b08c65cd476d746a58118674d1fb058635f8a6df25731f35d9083532e91e570" }] }
  ]
}
EOF
```

### Step 5 — Watch propagation

```bash
# Apex CNAME (or A if Hostinger flattened)
dig +short rocketsalesagent.com
# Should resolve to a Railway IP within ~5 min if TTL was 300.

# www CNAME
dig +short www.rocketsalesagent.com
# Expect: b18rh1s8.up.railway.app + Railway IPs.

# Verification TXT
dig +short TXT _railway-verify.rocketsalesagent.com
# Expect: "railway-verify=b70c…"
```

Once Railway sees both CNAME + verify TXT, the domain status flips
green in the Railway dashboard and Let's Encrypt issues the cert (~5 min).

### Step 6 — Smoke test

```bash
curl -I "https://rocketsalesagent.com/"
# Expect: HTTP/2 200 (after cert issues), Server: railway-edge
```

### Step 7 — Bump TTL once stable

After 24h of clean traffic, raise TTLs to 3600 to reduce DNS query load:

```bash
# Same PUT body but with ttl: 3600
```

---

## Common operations cookbook

### Add a single TXT record without touching anything else

`overwrite: false` + a body containing only the new record:

```bash
curl -s -X PUT "https://developers.hostinger.com/api/dns/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overwrite": false, "zone": [{"name": "_dmarc", "type": "TXT", "ttl": 3600, "records": [{"content": "v=DMARC1; p=none; rua=mailto:rajsuyash@gmail.com"}]}]}'
```

### Delete a record by name + type

`DELETE` with a `DNSV1ZoneDestroyRequest` body listing what to drop:

```bash
curl -s -X DELETE "https://developers.hostinger.com/api/dns/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filters": [{"name": "_railway-verify", "type": "TXT"}]}'
```

### Restore a snapshot

```bash
# 1. List snapshots
curl -s "https://developers.hostinger.com/api/dns/snapshot/v1/zones/rocketsalesagent.com" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" | jq '.[] | {id, createdAt}'

# 2. Restore a specific one
curl -s -X POST "https://developers.hostinger.com/api/dns/snapshot/v1/zones/rocketsalesagent.com/53513053/restore" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN"
```

---

## hPanel manual fallback (when CLI/API isn't worth it)

For one-off changes, the web UI is faster:

1. **Domains → rocketsalesagent.com → Manage**.
2. **DNS / Nameservers** tab.
3. Use the `+ Add record` button. Same fields as the API: Type, Name, Value, TTL.
4. Save → propagation typically <5 min on Hostinger NS.

The UI doesn't show snapshots — for those use the API.

---

## Other Hostinger APIs we don't use yet

Listed for awareness; documented in `/hostinger/api-python-sdk` if/when
we need them:

- **DomainsApi** — register/transfer/renew, set NS, set EPP, WHOIS.
- **VPSApi** — full VPS provisioning + lifecycle (we're on Railway, not VPS).
- **EmailApi** — email forwarding & mailbox provisioning. Will need
  this when `hello@rocketsalesagent.com` forwarding is set up.
- **BillingApi** — invoices, payment methods.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Token revoked / expired / missing scope | Re-issue a token in hPanel with `domains:dns:write`. |
| `403 Forbidden` on a domain you own | Token scoped to wrong account | Check the avatar → Subscriptions → token belongs to the right Hostinger account. |
| `INVALID_RECORD_TYPE` on apex CNAME | Hostinger UI sometimes rejects `CNAME` on `@` even though API often flattens it | Use an `A` record with the resolved IP, or front the apex with Cloudflare for free CNAME flattening. |
| `429 Too Many Requests` | Burst of writes | Backoff 60s and re-PUT. The DNS state didn't change — your last successful write is still in effect. |
| Records show in API GET but not in propagation | DNS resolver cached old value | Wait the prior TTL (5 min if you used the recommended `ttl: 300`); use `dig @1.1.1.1 …` to bypass local resolver caching. |
| Cert pending in Railway > 30 min | Verify TXT record not yet visible to Railway | `dig TXT _railway-verify.rocketsalesagent.com` — if empty, re-check the record was saved. Railway re-checks on a ~5-min cron. |

---

## Security notes

- **Treat the API token like a password.** It can wholesale rewrite any
  zone on this Hostinger account. Rotate immediately if exposed.
- Keep tokens out of CI logs — pass via masked secrets only.
- The `overwrite: true` flag can blank an entire zone in one call.
  Always run `validate` first when using it.
- Auto-snapshots are kept for 30 days. If you need longer, dump and
  commit the zone JSON to git before any large change.

---

## References

- Hostinger API Python SDK (Context7 ID `/hostinger/api-python-sdk`) — most complete schema reference.
- Hostinger CLI (`hapi`) docs (Context7 ID `/hostinger/api-cli`) — primarily VPS-focused; thin DNS coverage.
- Public API portal: <https://developers.hostinger.com/> — try-it-out console with auth.
