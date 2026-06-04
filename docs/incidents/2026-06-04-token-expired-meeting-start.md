# Incident: "Token has expired" on meeting start (Chrome extension)

**Severity:** SEV-2 (active, live client, core flow blocked) · **Date:** 2026-06-04
**Affected:** F15 (Chrome extension), F2/F3 (realtime capture), F8/F10 (auth)
**Source:** multi-agent root-cause workflow (7 agents, verified against live code)

---

## 1. Incident summary

A logged-in rep sees "Signed in as <user>" but clicking **Start** fails with
"Failed: could not start meeting: Token has expired." The 15-minute access token
had expired; the extension's silent refresh failed to produce a usable token; and
the API's correct `401 {code:"TOKEN_EXPIRED", message:"Token has expired."}` body
leaked verbatim into the popup. "Signed in" still showed because that label checks
token *presence*, not *validity*.

## 2. Root cause

### Proximate (this screenshot) — 100% client-side
The `services/api` guard is **correct** (fixed in `1f90bd8`) and returns a proper
refreshable `401 TOKEN_EXPIRED`. The client failed to act on it because three
defects compound:

1. **No proactive refresh before the call.** `background/index.ts` `startCapture()`
   (~659) → `ensureApiMeeting()` (~681) → `signedFetch()` sends the **expired**
   token first. The only proactive guard (`<60s`) sits at ~696-701, *after* the
   failing call.
2. **Refresh double-spend race → `refreshAccessToken()` returns `null`.** Refresh
   coalescing lasts only **50 ms** (`setTimeout(...,50)` ~286-288). Three callers
   401 concurrently (fire-and-forget `ensureApiMeeting` in `setActive` ~121, 30s
   `pollInbox` ~503, manual Start). Two refreshes >50 ms apart present the **same**
   refresh token; the route **rotates+revokes** on use (`auth/routes.ts` ~130-143),
   so the second gets 401 → refresh returns `null`. Non-atomic `writeState`
   (~108-111) can also clobber the fresh token.
3. **`signedFetch` surfaces the raw 401** on refresh failure (~320-322) → the API's
   "Token has expired." string renders verbatim.

### Systemic (why it keeps happening)
1. **8 hand-copied, divergent auth guards, no shared owner.** Each service has its
   own `lib/auth.ts`/`plugins/auth.ts` differing only on the expiry line. `1f90bd8`
   fixed **3**, left **5** broken (the prior audit even missed `retention-worker` —
   proof of the recurrence). No `packages/auth` exists.
2. **WS path can't signal expiry.** Gateway `verifyTokenString()` (~109-118)
   `catch { return null }`; `closeUnauth()` (~155-162) hardcodes `TOKEN_INVALID` +
   close `4001`.
3. **Client never proactively refreshes**, no single token chokepoint.
4. **"Signed in" = presence, not validity** (`isSignedIn: !!accessToken` ~1140).

## 3. Complete defect list

| # | Defect | Location | Effect |
|---|--------|----------|--------|
| D1-D5 | Expiry check only `FAST_JWT_EXPIRED` | `analytics:42`, `billing:42`, `knowledge:44`, `orchestrator:42`, `retention-worker:42` (each `src/lib/auth.ts`) | expired → `TOKEN_INVALID` |
| D6 | WS `verifyTokenString` swallows expired-vs-invalid | `realtime-gateway/src/lib/auth.ts:109-118` | WS can't classify |
| D7 | WS `closeUnauth` hardcodes `TOKEN_INVALID`/`4001` | `realtime-gateway/src/modules/session/handler.ts:155-162` | WS never emits expiry |
| D8 | No proactive refresh; ordering bug | `background/index.ts` signedFetch ~304-325; startCapture ~681 vs ~696-701 | raw 401 leaks |
| D9 | 50ms coalesce + non-atomic writeState → double-spend | `background/index.ts` ~257-292, ~108-111 | refresh returns null |
| D10 | Offscreen WS refreshes only on close 4001 | `offscreen/index.ts` ~319-330 | can't recover mid-call |
| D11 | "Signed in" = presence not validity | `background/index.ts:1140` | dead-token shows signed-in |
| D12 (latent) | Refresh revoke→mint not transactional | `api/src/modules/auth/routes.ts:140-143` | crash mid-rotation wedges account |

*(`integration-service`, `transcript-service` have no JWT guard — nothing to fix.)*

## 4. Permanent fix (summary)

- **`packages/auth`** — new internal package: the ONLY place defining `EXPIRED_JWT_CODES`,
  `classifyJwtError`, `AccessTokenClaims`, the Fastify `authPlugin` (with `preVerify`
  hook so `api` keeps Clerk), and WS verify returning `{ok,code}`. All services import it;
  the 8 copies are deleted.
- **Refresh-route hardening** — wrap revoke+mint in a transaction + a ~10-30s rotation
  reuse-grace window (kills double-spend server-side).
- **WS expired-token contract** — `closeUnauth` reason-aware: expiry → close **`4011`**
  + `{code:'TOKEN_EXPIRED'}`; everything else stays `4001`/`TOKEN_INVALID` (additive,
  old clients unaffected).
- **Client chokepoint** — `getValidAccessToken()` (proactive refresh, `TOKEN_SKEW_MS=120s`),
  all call sites routed through it; `refreshAccessToken` → promise-lifetime coalescing +
  refresh-token CAS + dead-refresh clear **only on 401/403** (network blip ≠ logout);
  three-state `AuthState = valid | refreshable | signed-out` for the UI; offscreen treats
  refresh (not the close code) as source of truth.

## 5. Anti-recurrence guard
- **Structural:** zero `services/*/src/{lib,plugins}/auth.ts` after migration; one
  `EXPIRED_JWT_CODES`. A new service physically can't classify auth without `@athena/auth`.
- **CI tripwire:** `scripts/check-no-rogue-auth.sh` (fails on the JWT literals outside
  `packages/auth`, or any new service `auth.ts`) + ESLint `no-restricted-imports` banning
  `@fastify/jwt`/`fast-jwt` outside `packages/auth` + client grep test (no `.accessToken`
  in a header outside `getValidAccessToken`).
- **Contract test matrix:** expired token → asserts `401` **AND `code==='TOKEN_EXPIRED'`**
  (401-only would pass against the broken code) for every service; WS asserts `4011`.

## 6. Phased rollout (stop the bleed first; ≤5 files/phase)

> The backend refactor fixes **zero** of the live symptom — the screenshot is 100%
> client-side via `services/api` (already correct). **Ship the client hotfix first.**

- ✅ **PR-A — EMERGENCY client hotfix** (fixes the screenshot) — SHIPPED `9f5f2ad`.
  `getValidAccessToken` + rewritten `refreshAccessToken` (promise-lifetime coalesce +
  CAS + status-branched dead-clear + min-interval); `signedFetch`/startCapture/pollInbox
  routed through it; pure logic in `background/auth-logic.ts` (10 tests); `AuthState` +
  WS close-code constants in `shared/types.ts`. Extension 0.1.18.
- ✅ **PR-B — one-line OR-fix** to the 5 broken services (analytics, billing, knowledge,
  orchestrator, retention-worker) — SHIPPED `9f5f2ad`. All now classify expiry correctly.
- ✅ **PR-C — `@athena/auth` package + CI tripwire** — SHIPPED `e9f2249`. No service wired
  (zero prod risk). 16 tests. `scripts/check-no-rogue-auth.sh` (8 legacy files allow-listed).

- ✅ **PR-D/E** — SHIPPED `f3d298b`. Migrated analytics, billing, knowledge, orchestrator,
  retention-worker, postcall to `@athena/auth` (deleted 6 `lib/auth.ts`). Net −347 lines.
- ✅ **PR-F** — SHIPPED `e85e43a`. Gateway → `@athena/auth`; WS `4011`/`TOKEN_EXPIRED`
  contract (additive, backward-safe); `lib/auth.ts` → `lib/ws-auth.ts`. Fixed the 10 stale
  `server.test.ts` failures (real auth handshake + race-robust reader). Tripwire down to 1.

- ✅ **PR-H** — SHIPPED `d8cce2d`. api migrated to `@athena/auth` via a Clerk `preVerify`
  adapter (all provisioning preserved); error handler gained the generic `{statusCode,code}`
  branch so `AuthError` serializes byte-identically; expired/malformed contract tests added.
  **Tripwire allow-list now EMPTY — fully fail-closed. 8/8 services share one auth impl.**

- ✅ **PR-G** — SHIPPED `da6fbb2` (ext 0.1.19). offscreen: WS close `4011` → fast-path
  refresh+reconnect; reconnect no longer signs out on a TRANSIENT refresh failure (only
  on `signed_out`); popup `account.state` now derives the three-state `AuthState`.

  --- REMAINING (only the deferred refresh-route hardening) ---

- ⬜ **DEFERRED: refresh-route hardening** (was PR-H's second half). Two pieces, both
  defense-in-depth that the PR-A client fix already substantially covers, so neither was
  shipped to avoid refactoring live token issuance + migrating the schema in a long session:
  1. Wrap revoke+mint in a `prisma.$transaction` (D12 — crash-mid-rotation atomicity).
     Requires making `issueTokens` tx-aware (shared by signup/login/refresh).
  2. Rotation reuse-grace window (`rotatedToId` column + ~10-30s replay grace) — the
     server-side double-spend defense. Needs a DB migration (open Q1).

**Handoff note (2026-06-04):** A/B/C/D/E/F/H shipped to `main`. **Live incident resolved;
systemic root cause (8 divergent auth copies) eliminated — all 8 services on `@athena/auth`,
tripwire fail-closed, the 10 stale gateway tests fixed.** Remaining work is PR-G (client
polish) + the deferred refresh-route hardening above — both non-incident-critical.
`deriveAuthState` for PR-G is already implemented + tested in `auth-logic.ts`.

## 7. Verification
- HTTP guard matrix per service: expired→`401`+`TOKEN_EXPIRED`, malformed/wrong-secret→`TOKEN_INVALID`,
  missing workspace→`MISSING_WORKSPACE_CLAIM`, valid→ok. **Expired row must assert `code`, not just 401.**
- WS matrix: expired→`4011`/`TOKEN_EXPIRED`; invalid/timeout→`4001`/`TOKEN_INVALID`; valid+bad hello→`VALIDATION_ERROR`.
- Extension: expired→refresh-before-fetch, single refresh under concurrency, dead-refresh→signed-out,
  network blip→NOT signed out.
- Manual repro: force-expire `expiresAt` in storage → Start → silent refresh, no error string.
- Failing gateway tests: mint a fresh valid token in the harness (don't edit assertions) — likely the
  test token lacks `workspaceId`/uses wrong secret and was passing on a weaker guard.

## 8. Open questions
1. Refresh reuse-grace window (`rotatedToId` + 10-30s) now (PR-H) or defer? Touches auth schema.
2. Confirm WS expiry close code **`4011`**.
3. Does the WS hello frame already carry a client version (needed to version-gate `4011`)? If not, PR-F needs a tiny client change first.
4. OK to switch the client to read `code` instead of parsing `body.message`?
5. `TOKEN_SKEW_MS = 120s` acceptable (refresh ~13m into a 15m token)? Lower to 60s if refresh volume matters.
6. PR-A canary: the one affected client first, or all installs (it's purely additive + strictly-better)?
