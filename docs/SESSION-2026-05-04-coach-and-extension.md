# Session 2026-05-04 — Proactive coach + Playbooks UX + chrome ext panel

Single-day record of every change shipped. All commits pushed to `main`,
auto-deployed via Railway (admin-web + realtime gateway). Extension
changes shipped to the local `dist/` and require a manual reload in
`chrome://extensions/`.

## Block summary (in commit order)

| Commit | Surface | What changed | Why |
|---|---|---|---|
| `b312d3b` | gateway + admin-web | Proactive script-driven coaching + Playbooks landing | Coach was reactive-only; nav had two confusable items. |
| `de379c6` | chrome ext | CSP header + signedFetch timeout + 4001 fast-path | Robustness audit gaps. |
| `22a5f37` | admin-web | Render proactive suggestions in a dedicated pane | Synthetic Turn (startMs=0) hid them from inline render. |
| `4c2e709` | chrome ext | In-Meet suggestion history panel | Reps couldn't see prior suggestions after the toast faded. |
| `7cd7802` | chrome ext | Fix admin-web URL + use internal UUID in panel link | Naive host-replace produced 404; Meet code ≠ workspace UUID. |
| `ff889cd` | chrome ext | Popup "Open in Athena" routes through SW | Was hardcoded to `athena://` desktop deep-link. |
| `7ff463a` | gateway | Normalize script stage names + alias common synonyms | Workspace stages "Discovery"/"Pitching"/"Probing" failed exact-string lookup. |
| `87cb72d` | chrome ext | Always relay suggestions to panel | Filter on `answerText|followupText` dropped suppressed entries from history. |

## Block N (the headline) — Proactive script-driven coaching + Playbooks UX

**Problem.** User uploaded their full discovery + pitching script to the
**Knowledge** tab and complained the coach only suggests objection
reframes — never opens, qualifies, or pitches. Two roots:

1. `services/realtime-gateway/src/modules/session/handler.ts` only
   triggered the coach on `customer` turns (`if (speaker !== 'customer') return;`).
2. The Knowledge tab is for RAG grounding; the **Scripts** tab (with
   stage-organized `ScriptStageBlock` rows) is what the coach was
   designed to consume — but the LLM coach wasn't wired to read it.

**Fix — Track 1 (gateway):**
- New `proactiveCoach()` in `services/realtime-gateway/src/lib/coach.ts`
  that grounds in the workspace's published `ScriptStageBlock` for the
  current stage (no chunk grounding; if no script, returns null).
- Session-level state machine in
  `services/realtime-gateway/src/modules/session/handler.ts` tracks
  `captureStartedAt`, `lastRepFinalAt`, `currentStage`. Triggers fire on:
  - 3 s after capture starts → opening prompt
  - 12 s rep silence in opener / qualification / discovery → next-question prompt
  - stage transition (heuristic detects rep moves to new stage) → fresh stage prompt
- Throttled to 1 suggestion / 8 s. The reactive customer-turn objection
  path is unchanged.

**Fix — Track 2 (admin-web):**
- New `apps/admin-web/src/app/playbooks/page.tsx` landing with two cards
  (Documents, Scripts) explaining the difference + a "not sure where to
  put it?" cheat sheet.
- Single nav entry **Playbooks** replaces the previous Knowledge +
  Scripts top-nav links (`apps/admin-web/src/components/Shell.tsx`).
- Old `/knowledge` and `/scripts` routes still work — no breakage.

## Block O — Chrome extension robustness audit fixes

Audit pass against `chrome-ext-robustness.md` (11 sections). Most
sections passed (popup uses `escapeHtml`, content overlay uses
`textContent`, messaging is structured, `chrome.alarms.create` is
idempotent by name). Three gaps:

1. **CSP** (`apps/chrome-extension/src/manifest.json`) — added
   `content_security_policy.extension_pages` allowing `script-src 'self'`
   plus `connect-src https: wss:` for the gateway WS.
2. **Fetch timeout** (`apps/chrome-extension/src/background/index.ts`) —
   wrapped `signedFetch` in `AbortController(15s)` so a hung backend
   doesn't wedge the 30 s inbox-poll alarm callback.
3. **4001 fast-path reconnect**
   (`apps/chrome-extension/src/offscreen/index.ts`) — when gateway closes
   `4001 unauthorized`, skip the 1–16 s exponential backoff for the FIRST
   reconnect attempt only; refresh happens immediately via the existing
   `capture.refreshToken` SW handler.

## In-Meet suggestion history panel (`4c2e709`)

Floating "Athena · N" pill button at bottom-right of every Meet tab.
Click toggles a slide-in side panel listing every suggestion from the
session, newest on top, filterable by chip (All / Ask / Answer / Coach /
Risk). Persists last 50 per `meetingId` to `chrome.storage.local`.
Renders inside a closed Shadow DOM so Meet's DOM rewrites can't
remove it. Footer link "Open meeting in Athena →" hits the SW handler.

Files:
- `apps/chrome-extension/src/content/panel.ts` (NEW) — pure DOM module.
- `apps/chrome-extension/src/content/index.ts` — call `panel.attach(meetingId)`
  on `meet.detected`, `panel.add(suggestion)` inside the existing
  `overlay.suggestion` listener.
- `apps/chrome-extension/src/background/index.ts` — `panel.openInAthena`
  message handler that maps the api host to admin-web host and resolves
  the workspace meeting UUID.

## Bug-fix tail

| Commit | Symptom | Root cause | Fix |
|---|---|---|---|
| `22a5f37` | Meeting page header said "25 suggestions" but UI showed 0 cards | Proactive `Turn` rows have `startMs=0`; `MeetingDetail.tsx` joined suggestions to segments by `turnStartMs` so orphans never rendered | New "Coach prompts" pane above transcript renders any suggestion whose `turnStartMs` doesn't match a segment |
| `7cd7802` | Open-in-Athena → "Not Found / The train has not arrived" | `apiUrl.replace('athena-api','athena-admin-web')` produced an invalid host (`athena-admin-web-production-aa5b…`). Also Meet code passed instead of UUID | Hostname map by full Railway domain + use `active.internalMeetingId` |
| `ff889cd` | Popup "Open in Athena" did nothing | Hardcoded to `athena://start?meeting_id=` desktop deep-link with no app installed | Route through the same `panel.openInAthena` SW handler |
| `7ff463a` | Popup showed `suggestions 0` despite published script with `Discovery`/`Pitching`/`Probing` blocks | `getActiveScriptForStage` did exact-string `Map.get(stage)`. Gateway looks for lowercase canonical (`discovery`/`demo`/...) → never matched | Normalize key to lowercase + map common synonyms (pitching→demo, probing→discovery, opening→opener…). Fallback: discovery → first available block |
| `87cb72d` | Panel said "No suggestions yet" while popup counter showed 20 | Offscreen relay short-circuited when both `answerText` AND `followupText` were empty; counter still incremented | Always relay every suggestion to the panel; toast still gates on speakable text |

## Files touched (cumulative this session)

**Gateway (`services/realtime-gateway/`):**
- `src/lib/coach.ts` — `proactiveCoach()`, `detectStage()`,
  `PROACTIVE_STAGES`, stage normalization + alias map.
- `src/modules/session/handler.ts` — session state, proactive ticker,
  multi-trigger logic.

**Admin-web (`apps/admin-web/`):**
- `src/app/playbooks/page.tsx` — NEW Playbooks landing.
- `src/components/Shell.tsx` — nav consolidation.
- `src/components/MeetingDetail.tsx` — Coach prompts pane for orphan
  suggestions.

**Chrome extension (`apps/chrome-extension/`):**
- `src/manifest.json` — CSP.
- `src/background/index.ts` — `signedFetch` timeout, `panel.openInAthena`
  handler, admin-web host map.
- `src/offscreen/index.ts` — 4001 fast-path reconnect, always-relay.
- `src/content/index.ts` — panel hookup, gated toast.
- `src/content/panel.ts` — NEW Shadow-DOM history panel.
- `src/popup/index.ts` — popup "Open in Athena" routes through SW.

## Verification status

- All packages: `pnpm typecheck` + `pnpm build` clean.
- Gateway + admin-web auto-deployed to Railway on each push (last:
  `7ff463a` deploy in progress at session end).
- Extension `dist/` rebuilt with prod URLs and ready for sideload — user
  must `chrome://extensions/` → Reload after each push.

## Known follow-ups (not done this session)

- Smart-router upload (Block N6) that auto-classifies content into
  Documents vs Scripts via Haiku 4.5.
- Persona-aware scripts (`ScriptStageBlock.persona` column exists,
  unused).
- Multi-language scripts (column exists, unused).
- LLM-tuned stage transitions (state machine is regex/time-based for v1).
- Re-enable solo-test toggle in prod (currently hidden when gatewayUrl
  is non-localhost; blocks single-user demos).
- Re-classification migration for users who already uploaded scripts as
  Knowledge.

## Reference: deployed Railway services

| Service | Public URL |
|---|---|
| api | https://athena-api-production-aa5b.up.railway.app |
| realtime-gateway | https://athena-realtime-production.up.railway.app |
| admin-web | https://athena-admin-web-production.up.railway.app |
| billing | https://athena-billing-production.up.railway.app |

UAT test user: `uat-prod-1777844720@athena.app` / `UatProdPassword123!`.

## Prior context

Earlier sessions (commits before `b312d3b`) shipped:
- Initial Railway deployment of all 9 services.
- pgvector embedding column preservation across `prisma db push`
  (`76490b8`) — fixed the silent retrieval-returns-zero bug.
- X-Forwarded-Host honoring for admin-web auth redirects (`daa48e3`).
- CORS allowing `chrome-extension://*` origins on api + realtime
  (`804f1ee`).
- Block A–M of `~/.claude/plans/sleepy-swinging-anchor.md` —
  extension's tab-audio capture pipeline replacing the brittle
  caption-DOM scraper.
