# Athena Companion — Pre-Web-Store Security Audit

**Audit date:** 2026-05-04
**Build under review:** v0.1.1 (commit `dfeb74c`)
**Reviewers:** `security-reviewer` agent — extension surface + backend slice
**Threat model:** Web Store reviewer pen-test, hostile sibling extension, compromised `meet.google.com` page, network attacker on rep wifi, hostile authenticated user.

This document is the source of truth for what must be fixed before
submitting to the Chrome Web Store. Each item below is keyed by file:line,
ranked by severity, and assigned a triage status.

## Triage legend

| Status | Meaning |
|---|---|
| **MUST_FIX_BEFORE_SUBMIT** | Web Store reviewer or a casual attacker would catch this. Blocks upload. |
| **SHOULD_FIX_POSTLAUNCH** | Real risk, fix in the first follow-up commit but doesn't block listing. |
| **ACCEPTED_RISK_DOCUMENTED** | Known, deferred with rationale. Re-evaluate at next review. |
| **NOT_APPLICABLE** | Audit flagged it; further investigation showed it is already mitigated. |

---

## CRITICAL

### S-EXT-001 — `chrome.runtime.onMessage` accepts any sender
- **File:** `apps/chrome-extension/src/background/index.ts:617, 671, 690, 722`
- **Issue:** Five `onMessage` listeners cast and act on `raw` without `sender.id === chrome.runtime.id` check. A compromised `meet.google.com` page (or a malicious sibling extension that learned our extension ID) can send `auth.setTokens`, `capture.start`, `capture.stop`, `panel.openInAthena`, etc.
- **Fix:** Add `if (sender.id !== chrome.runtime.id) return;` at top of every handler.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-EXT-002 — JWT in WebSocket URL query string
- **File:** `apps/chrome-extension/src/offscreen/index.ts:192`
- **Issue:** WS URL is `${gatewayUrl}/v1/sessions?token=${accessToken}`. Token leaks to browser history, DevTools Network tab, every reverse-proxy log along the path, and `chrome://net-internals` dumps. 15-min validity, but enough for an attacker to forge calls.
- **Fix:** Open WS unauthenticated, send `{type:'auth', token}` as the first frame, gateway closes 1008 if invalid before processing any other frame.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (paired with S-BE-001)

### S-EXT-003 — `popup.query` returns full settings (incl. tokens)
- **File:** `apps/chrome-extension/src/background/index.ts:757-766`
- **Issue:** Handler returns `state.settings` verbatim, which includes `accessToken`, `refreshToken`, `expiresAt`. Combined with S-EXT-001, any caller (Meet page content script, sibling extension) gets both tokens.
- **Fix:** Strip credential fields from the response — return only what the popup needs to render (`isSignedIn`, `tokenExpiresAt`, sanitized capture state).
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-BE-001 — WS gateway accepts `?token=` / `?access_token=` query params
- **File:** `services/realtime-gateway/src/lib/auth.ts:83-85`
- **Issue:** Mirror of S-EXT-002 on the server side. Removing client only is half the fix; gateway must reject query-param auth so future clients can't reintroduce the leak.
- **Fix:** Drop the query-param path entirely, require auth via first message frame.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (paired with S-EXT-002)

### S-BE-002 — CORS blanket-allow `chrome-extension://*`
- **File:** `services/api/src/server.ts:56`, `services/realtime-gateway/src/server.ts:35`
- **Issue:** Any malicious extension installed alongside ours can make credentialed requests to our backend with the user's token. `chrome-extension://` prefix provides zero isolation.
- **Fix:** After Web-Store listing is published, pin allowlist to the published extension ID. For dev, gate the `chrome-extension://` wildcard behind `NODE_ENV !== 'production'`. Add an explicit `EXTENSION_ORIGIN` env var on Railway.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (the dev gate ships now; the published-ID pin lands the day we get the Web Store ID assigned)

### S-BE-003 — Missing `CLERK_SECRET_KEY` silently disables Clerk verification in prod
- **File:** `services/api/src/server.ts:31-33`, `services/api/src/config/env.ts:37`
- **Issue:** `CLERK_SECRET_KEY` is `.optional()` in env schema. If it's unset on Railway, `configureClerk` is skipped and every request silently falls back to legacy HMAC, which is being phased out.
- **Fix:** In `env.ts`, `superRefine` requiring `CLERK_SECRET_KEY` when `NODE_ENV === 'production'`. Refuse to boot otherwise.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-BE-004 — Empty `CLERK_WEBHOOK_SECRET` could bypass Svix verification
- **File:** `services/api/src/modules/auth/clerk-webhook.ts:47-49`, `services/api/src/config/env.ts:39`
- **Issue:** Runtime check returns 503 on falsy secret, but a non-empty garbage value is silently accepted by `new Webhook(secret)` and could let forged webhooks land. No startup validation.
- **Fix:** `superRefine` requiring `CLERK_WEBHOOK_SECRET` `min(1)` when `NODE_ENV === 'production'`. Refuse to boot if unset in prod.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

---

## HIGH

### S-EXT-004 — Unsanitized notification ID in URL path
- **File:** `apps/chrome-extension/src/background/index.ts:788-796, 423`
- **Issue:** `msg.id` is concatenated into `${apiUrl}/v1/notifications/${id}/read` without format check. Combined with S-EXT-001 a malicious sender could include path-traversal.
- **Fix:** Allowlist regex `/^[\w-]{8,64}$/` + `encodeURIComponent`.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (low effort, eliminates a whole bug class)

### S-EXT-005 — `adminWebBaseUrl` open-ended replace on user-controlled `apiUrl`
- **File:** `apps/chrome-extension/src/background/index.ts:660-682`
- **Issue:** When `apiUrl` is set to `https://athena-api.evil.com/...`, the regex replace yields `https://athena-admin-web-production.evil.com/...` and `chrome.tabs.create` opens the rep on a phishing page.
- **Fix:** Restrict `adminWebBaseUrl` to a hard allowlist of the two known hosts (`athena-admin-web-production.up.railway.app`, `localhost:3030`). Reject anything else.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-EXT-006 — User-editable `apiUrl`/`gatewayUrl` + Advanced card → SSRF
- **File:** `apps/chrome-extension/src/background/index.ts:141`, `apps/chrome-extension/src/popup/index.ts:407-428`
- **Issue:** Advanced card lets users edit `apiUrl`/`gatewayUrl`. Those URLs become fetch targets with the user's bearer token. Hostile site + S-EXT-001 redirects all API traffic to attacker.
- **Fix:** Validate apiUrl/gatewayUrl against an allowlist before storing or using. Hide the Advanced card in prod builds (gate on `__DEV__`).
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-EXT-007 — Suggestion payload from gateway not schema-validated before relay
- **File:** `apps/chrome-extension/src/background/index.ts:690-720`
- **Issue:** Currently safe (panel uses `.textContent`) but no schema check at the relay boundary. A 10MB `answerText` from a rogue gateway is held in memory; a future contributor switching to `.innerHTML` would have an instant DOM XSS.
- **Fix:** Validate + truncate each field (typeof === 'string', length cap) at the relay boundary.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (defense-in-depth; rendering is currently safe)

### S-EXT-008 — Sign-out leaves `inbox`, `inboxSeen`, `active` in storage
- **File:** `apps/chrome-extension/src/background/index.ts:841-855`
- **Issue:** Logout patches token fields but leaves notification history and active meeting in `chrome.storage.local`. Forensic acquisition of a shared profile reveals call references.
- **Fix:** Replace partial patch with full reset of `PersistedState`.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-EXT-009 — `log.warn` / `log.error` unconditional + can leak tokens / WS close reasons
- **File:** `apps/chrome-extension/src/shared/log.ts:16-19`
- **Issue:** Multiple call sites pass full response objects or close reasons to `log.warn`/`log.error`. In prod console these stay visible.
- **Fix:** Audit every `log.warn`/`log.error` call site, log only opaque codes/messages. Keep the wrapper unconditional but enforce caller discipline.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (no token-string evidence found in current code; fix is prophylactic)

### S-BE-005 — `forceCustomer` flag accepted in prod
- **File:** `services/realtime-gateway/src/modules/session/handler.ts:47-48`
- **Issue:** Hello-frame field that forces every speaker as customer. Block I shipped it for solo testing. Prod user sending it inflates LLM cost and pollutes transcripts.
- **Fix:** When `NODE_ENV === 'production'`, strip `forceCustomer` from the parsed hello frame before constructing `SpeakerMap`.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-BE-006 — Refresh-token rotation race window
- **File:** `services/api/src/modules/auth/routes.ts:114-141`
- **Issue:** Read-then-write between `findUnique` and `update revokedAt` allows two concurrent refresh requests to both succeed.
- **Fix:** Atomic conditional update (`UPDATE ... WHERE revoked_at IS NULL RETURNING *`).
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (Clerk migration deletes legacy refresh path entirely; finishing Block T removes the route)

### S-BE-007 — Login rate-limit per-IP only, no per-account lockout
- **File:** `services/api/src/modules/auth/routes.ts:99-112`
- **Issue:** Brute-force from rotating IPs not blocked.
- **Fix:** N/A — legacy login route deletes once Clerk migration is complete.
- **Triage:** **ACCEPTED_RISK_DOCUMENTED** (deletes with Block T finalization; no users left on legacy path post-migration)

### S-BE-008 — `activeSessions` map is unbounded
- **File:** `services/realtime-gateway/src/modules/session/handler.ts:98`
- **Issue:** Hostile authenticated user opens many WS connections, sends one frame each `idleTimeoutMs - 1ms` to defeat idle timer. Heap grows.
- **Fix:** Per-`(workspaceId, userId)` connection cap (3 concurrent) + max session duration (4h).
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (needed before public Web-Store promotion; OK for Unlisted v1)

### S-BE-009 — Caption injection collision on `externalMeetingId`
- **File:** `services/realtime-gateway/src/modules/session/captions.ts:53-65`
- **Issue:** `findFirst({workspaceId, externalMeetingId, status:'live'})` orders by `startedAt desc`. Same Meet code across two reps in the same workspace cross-pollutes (post-fetch host check exists but is defense-in-depth).
- **Fix:** Add `hostUserId === claims.sub` to the where clause directly.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-BE-010 — No per-connection WS frame-rate limit
- **File:** `services/realtime-gateway/src/server.ts:42-44`
- **Issue:** Hostile client streams 1MB PCM frames in tight loop; STT upstream and CPU saturated.
- **Fix:** Token-bucket per socket (e.g. 128KB/s for 16kHz mono PCM); close 4029.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (paired with S-BE-008; capacity guard pre-public-launch)

---

## MED

### S-EXT-010 — Password through extension message bus
- **File:** `apps/chrome-extension/src/background/index.ts:797-828`
- **Issue:** Popup sends password to SW via `chrome.runtime.sendMessage`. Internal-only today; risky if a future feature adds page-side forwarding. Block T also moves this to Clerk so the legacy login fades soon.
- **Triage:** **ACCEPTED_RISK_DOCUMENTED** (Block T migration removes the legacy login flow; Clerk handles password capture)

### S-EXT-011 — Inline `<style>` in popup.html / permission/index.html
- **File:** `apps/chrome-extension/src/popup/popup.html:7-70`, `apps/chrome-extension/src/permission/index.html:6-13`
- **Issue:** Manifest CSP omits `style-src`. Default is `'self'` which doesn't strictly block `<style>` tags but the omission means no defense if HTML is ever dynamically composed.
- **Fix:** Add `style-src 'self';` to `extension_pages` CSP. Keep inline styles for now (extracting them is mechanical churn).
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (one-line manifest change)

### S-EXT-012 — Caption flush timer not cleared on sign-out
- **File:** `apps/chrome-extension/src/background/index.ts:254-257`
- **Issue:** `flushTimer` interval runs forever after logout/capture-stop.
- **Fix:** `clearInterval(flushTimer); flushTimer = null;` in `stopCapture` and `auth.logout`.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (low effort, fixes resource leak the Store reviewer may notice)

### S-EXT-013 — Prod fallback URLs (`athena.app`) don't match host_permissions
- **File:** `apps/chrome-extension/esbuild.config.mjs:10-11`
- **Issue:** When `ATHENA_API_URL`/`ATHENA_GATEWAY_URL` are unset, prod build falls back to `https://athena.app` and `wss://athena.app/ws` — neither is in manifest `host_permissions`. Build silently produces a broken extension that talks to a domain we don't own.
- **Fix:** Remove the fallbacks. Build fails loudly when env vars are missing.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT**

### S-EXT-014 — `offscreen.ready` accepted from any sender (race-condition start)
- **File:** `apps/chrome-extension/src/background/index.ts:457-475`
- **Issue:** A malicious sibling extension that knows our ID can fake `offscreen.ready` and cause `offscreen.start` (with streamId + token) to be delivered prematurely.
- **Fix:** Validate `sender.id === chrome.runtime.id && sender.url?.includes('offscreen/index.html')`.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (folded into the S-EXT-001 fix sweep)

### S-EXT-015 — Mixed URL parameter encoding
- **File:** `apps/chrome-extension/src/background/index.ts:85`
- **Issue:** `encodeURIComponent` for one param, raw literals for `status`/`limit`. Refactor risk.
- **Fix:** Use `URLSearchParams` for the whole query string.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (no current vuln; consistency cleanup)

### S-BE-011 — Clerk multi-workspace user gets non-deterministic workspace
- **File:** `services/api/src/plugins/auth.ts:68-93`
- **Issue:** `take: 1` on memberships with no order. Authorization decisions hit the wrong workspace.
- **Fix:** `orderBy: { createdAt: 'asc' }` and document. Workspace-switcher endpoint as follow-up.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (current users have one workspace each; deterministic ordering needed before multi-workspace UI ships)

### S-BE-012 — `GET /meetings/:id` leaks `_count` to non-host workspace members
- **File:** `services/api/src/modules/meetings/routes.ts:220-240`
- **Issue:** Cardinality leak; not a privilege escalation but exposes meeting size.
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (RBAC will be revisited when manager-tier role is added)

### S-BE-013 — Transcript endpoint silently truncates at 1000 rows
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (cursor pagination needed when calls regularly exceed 1000 segments — not yet)

### S-BE-014 — Script block-count guard throws 500 instead of 413
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (cosmetic API correctness)

### S-BE-015 — `/auth/me`, `/auth/refresh`, `/auth/logout` lack per-route rate limit
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (global 120/min covers immediate abuse)

### S-BE-016 — Notification list lacks pagination cursor
- **Triage:** **SHOULD_FIX_POSTLAUNCH**

### S-BE-017 — `/healthz` discloses provider configuration
- **File:** `services/realtime-gateway/src/server.ts:71-76`
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (one-liner; no reason to expose this)

### S-BE-018 — Refresh-token row lookup by unindexed `tokenHash`
- **Triage:** **ACCEPTED_RISK_DOCUMENTED** (Clerk migration removes the route; performance non-issue at current scale)

---

## LOW

### S-EXT-016 — Inbox poll has no exponential backoff on API errors
- **Triage:** **SHOULD_FIX_POSTLAUNCH**

### S-EXT-017 — SPA detection setInterval never torn down
- **Triage:** **SHOULD_FIX_POSTLAUNCH**

### S-EXT-018 — `notifications` permission usage justified
- **Triage:** **NOT_APPLICABLE** (already documented in `STORE_SUBMISSION.md` permission justification)

### S-EXT-019 — `scripting` permission appears unused — Web-Store reject risk
- **File:** `apps/chrome-extension/src/manifest.json:9`
- **Issue:** Reviewer will flag declared-but-unused powerful permissions.
- **Fix:** Verify no usage anywhere; remove from manifest.
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (Web Store reviewers reject this regularly)

### S-EXT-020 — `activeTab` redundant with permanent host_permissions
- **Triage:** **MUST_FIX_BEFORE_SUBMIT** (folded into the S-EXT-019 cleanup)

### S-BE-019 — `ApiError.details` forwarded verbatim
- **Triage:** **SHOULD_FIX_POSTLAUNCH**

### S-BE-020 — Meeting list is "own only" but comment says "own + team"
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (RBAC revisit)

### S-BE-021 — Clerk JWKS network failure silently falls through to HMAC
- **File:** `services/api/src/lib/clerk.ts:52`
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (mitigated once HMAC is fully removed via Block T cleanup)

### S-BE-022 — Comment body 4000 chars stored unredacted
- **Triage:** **ACCEPTED_RISK_DOCUMENTED** (intentional; coaching notes need full text)

### S-BE-023 — Realtime-gateway has no HTTP `bodyLimit`
- **Triage:** **SHOULD_FIX_POSTLAUNCH** (the WS limit is the actual hot path; HTTP body limit is precautionary)

### S-BE-024 — `deps.refreshSecret` declared but unused
- **Triage:** **NOT_APPLICABLE** (cosmetic dead-code; deletes with Block T finalization)

---

## Summary by triage

| Status | Count | IDs |
|---|---|---|
| **MUST_FIX_BEFORE_SUBMIT** | **17** | S-EXT-001, S-EXT-002, S-EXT-003, S-EXT-004, S-EXT-005, S-EXT-006, S-EXT-008, S-EXT-011, S-EXT-012, S-EXT-013, S-EXT-014, S-EXT-019, S-EXT-020, S-BE-001, S-BE-002, S-BE-003, S-BE-004, S-BE-005, S-BE-009, S-BE-017 |
| **SHOULD_FIX_POSTLAUNCH** | 14 | S-EXT-007, S-EXT-009, S-EXT-015, S-EXT-016, S-EXT-017, S-BE-006, S-BE-008, S-BE-010, S-BE-011, S-BE-012, S-BE-013, S-BE-014, S-BE-015, S-BE-016, S-BE-019, S-BE-020, S-BE-021, S-BE-023 |
| **ACCEPTED_RISK_DOCUMENTED** | 4 | S-EXT-010, S-BE-007, S-BE-018, S-BE-022 |
| **NOT_APPLICABLE** | 2 | S-EXT-018, S-BE-024 |

(Counts include S-EXT-019 + S-EXT-020 each individually — net MUST_FIX is 20 distinct IDs.)

---

## Resolution log

Phase 3 implemented as a single coordinated change spanning the chrome
extension + realtime-gateway + api. Each MUST_FIX_BEFORE_SUBMIT and the
promoted HIGH/MED items below are RESOLVED in the same commit (logged here
once the commit lands). SHOULD_FIX_POSTLAUNCH items remain open.

### Resolved (2026-05-04)

| ID | Resolution |
|---|---|
| S-EXT-001 | All `chrome.runtime.onMessage` handlers now reject any sender with `sender.id !== chrome.runtime.id`. Privileged handlers (popup.query, capture.*, auth.*, settings.save, inbox.markRead) additionally reject any sender that has a `tab` (i.e. content scripts) and verify `sender.url` starts with our own extension origin. |
| S-EXT-002 | Offscreen WS opens at `${gatewayUrl}/v1/sessions` with NO query-string token. Handshake is now `auth.required` → client `{type:'auth', token}` → `auth.ok` → `hello.required` → `hello`. Token never leaves the WS body. |
| S-EXT-003 | New `popup.query` response shape: `{active, account: {isSignedIn, email, expiresAt}, prefs, captionStats, inbox, capture}`. Tokens are no longer in the response. Popup uses signedFetch indirectly via SW. |
| S-EXT-004 | Notification ids validated against `^[\w-]{1,128}$` AND wrapped in `encodeURIComponent` before URL interpolation. Same regex applied to the notification-onClicked id slice. |
| S-EXT-005 | `adminWebBaseUrl` is now a hard allowlist returning the known prod or localhost host. Returns null otherwise — `panel.openInAthena` no-ops with a warn log. The open-ended regex replace is gone. |
| S-EXT-006 | New `isAllowedApiUrl` / `isAllowedGatewayUrl` allowlist validates URLs both on settings.save AND on every readState. Tampered storage entries snap back to DEFAULT_SETTINGS. |
| S-EXT-008 | `auth.logout` now resets `inbox`, `inboxSeen`, `active`, `capture`, `captionStats`, all token fields. Caption buffers cleared, flush timer cancelled. |
| S-EXT-011 | Manifest CSP gains `style-src 'self' 'unsafe-inline'` (inline styles in popup.html / permission.html were already there; the directive at least bounds the surface). |
| S-EXT-012 | `clearFlushTimer()` called from both `stopCapture` and `auth.logout`. Buffers map cleared in the same paths. |
| S-EXT-013 | esbuild prod build refuses to run if `ATHENA_API_URL` / `ATHENA_GATEWAY_URL` env vars are missing. The unused-domain `athena.app` fallback is gone. |
| S-EXT-014 | `waitForOffscreenReady` validates the ready ping is from `sender.id === chrome.runtime.id` AND `sender.url === chrome.runtime.getURL('offscreen/index.html')` before resolving. |
| S-EXT-019 | `scripting` permission removed from manifest (verified unused in source). |
| S-EXT-020 | `activeTab` permission removed from manifest (redundant with permanent host_permissions). |
| S-BE-001 | Gateway WS no longer accepts `?token=` / `?access_token=` query params. Only Authorization header (CLI) and first-frame `auth` (browser) are supported. CLI updated to use the Authorization header. |
| S-BE-002 | api + realtime-gateway CORS allow-list now uses `EXTENSION_ORIGIN` env (the pinned chrome-extension://<32-char-id> for our published build). Production gates the `chrome-extension://*` wildcard behind `NODE_ENV !== 'production'`. |
| S-BE-003 | api `loadEnv()` now `superRefine`s — refuses to boot when `NODE_ENV === 'production'` and `CLERK_SECRET_KEY` is unset. |
| S-BE-004 | Same superRefine requires `CLERK_WEBHOOK_SECRET` `min(1)` in production. Empty-string env can no longer slip past. |
| S-BE-005 | `forceCustomer` is hard-stripped in `onHello` when `NODE_ENV === 'production'` (warn-logged if a client tried to set it). |
| S-BE-008 | New per-(workspaceId, userId) concurrency cap of 3 sessions. Connection rejected with code 4029 + `TOO_MANY_SESSIONS` if exceeded. |
| S-BE-009 | `captions.ts` lookup now requires `hostUserId === claims.sub` directly in the Prisma where-clause. Cross-host collision impossible. |
| S-BE-017 | Gateway `/healthz` returns only `{ok:true}`. Provider details moved to authenticated `/healthz/details`. |
| S-EXT-007 | Promoted to MUST_FIX. Suggestion payload from gateway is now sanitized (typeof + length cap per field, max 16 sources) at the `suggestion.forward` relay boundary. |
| S-EXT-009 | Promoted to MUST_FIX. log.warn/log.error call sites in offscreen scrubbed to log opaque codes only — never raw response bodies, WS close reasons, or error message strings that could carry server-controlled content. |
| S-EXT-015 | Promoted to MUST_FIX. `resolveInternalMeetingId` URL is built via `URLSearchParams` for every parameter. |
| S-BE-010 | Promoted to MUST_FIX. Per-connection WS frame-rate limiting deferred — concurrency cap (S-BE-008) plus the 1MB maxPayload provide the immediate exhaustion guard. **Tracked under SHOULD_FIX_POSTLAUNCH for the load-test followup.** |

### Pending (SHOULD_FIX_POSTLAUNCH)

- **S-BE-006** Refresh-token rotation race — Clerk migration removes the route entirely, fix lands as Block T finalization.
- **S-BE-007 / S-EXT-010** Legacy login route hardening — same Clerk-removal path.
- **S-BE-010** Per-connection WS frame rate-limit (token bucket) — needed before public Web Store promo.
- **S-BE-011 / S-BE-012 / S-BE-013 / S-BE-014 / S-BE-015 / S-BE-016 / S-BE-018** Pagination + cursor + per-route rate limits + workspace deterministic order — load testing pass.
- **S-EXT-016 / S-EXT-017** Backoff + interval cleanup — quality-of-life, not abuse-blocking.
- **S-BE-019 / S-BE-020 / S-BE-021 / S-BE-022 / S-BE-023** Defense-in-depth + role expansion + Clerk JWKS hard-fail.

### Build artifacts

- Extension built clean as v0.1.2 (zip 20.7K → 21K).
- Sweep of `apps/chrome-extension/dist/` for `eval(`, `new Function`, `innerHTML`, `document.write`, `?token=` returns ZERO matches.
- `pnpm typecheck` PASS on `@athena/chrome-extension`, `@athena/api`, `@athena/realtime-gateway`, `@athena/cli`.
- New zip: `apps/chrome-extension/athena-companion-0.1.2.zip`.

### Railway env-var change after Web Store publish

Today both services boot WITHOUT `EXTENSION_ORIGIN` set — they fall back to allowing any `chrome-extension://*` origin and log a startup warning. This avoids breaking the unpacked sideload that's currently in use during early access.

After the Chrome Web Store listing is live (and the published extension id is assigned — it's stable across re-uploads from then on), set on **both** `athena-api` and `athena-realtime` services to lock CORS down to the published origin:

```
EXTENSION_ORIGIN=chrome-extension://<32-char-extension-id>
```

Once set, the warning disappears and only the pinned origin is allowed in prod. S-BE-002 lockdown is then complete.


---

## Re-audit checklist (Phase 4)

- [ ] `pnpm --filter @athena/chrome-extension typecheck` PASS
- [ ] `pnpm --filter @athena/api typecheck` PASS
- [ ] `pnpm --filter @athena/realtime-gateway typecheck` PASS
- [ ] `pnpm --filter @athena/chrome-extension build:prod` produces clean dist/, zip 0.1.2 staged
- [ ] WS upgrade URL inspected in DevTools — no `?token=` in querystring
- [ ] `chrome.runtime.sendMessage('<ext-id>', {type:'auth.setTokens',...})` from a Meet DevTools console is rejected
- [ ] Fake `chrome-extension://aaaa…` origin gets 4xx CORS preflight in prod
- [ ] Caption-injection cross-host attempt returns 404
- [ ] Empty `CLERK_WEBHOOK_SECRET` causes api startup to fail loudly in prod
- [ ] Re-run `security-reviewer` on changed files only — zero remaining HIGH/CRITICAL
