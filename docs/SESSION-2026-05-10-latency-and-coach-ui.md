# Session 2026-05-10 / 11 — Latency overhaul + coach UI feedback + telemetry fix

Two-day session covering the full latency overhaul (Phases 1-3), a
post-hoc engineering review that caught a real bug, user-feedback-driven
UI changes to the coach card, and the discovery that the prod latency
metrics were measuring almost nothing useful.

Every change pushed to `main`. Railway auto-deploys admin-web,
realtime-gateway, analytics-service. Chrome extension shipped to
`apps/admin-web/public/downloads/rocket-sales-agent-0.1.12.zip` for
sideload while the Web Store v0.1.12 re-submission is pending.

## Block summary (in commit order)

| Commit | Surface | What changed | Why |
|---|---|---|---|
| `4942ccb` | gateway, sdk-llm, sdk-stt | Phase 1 latency wins — Nova-3 STT + Anthropic prompt cache + smaller prompt + tighter endpointing | Baseline `coach_total` budget was 2000ms; industry standard is sub-800ms. |
| `628614c` | gateway, sdk-llm, chrome-ext | Phase 2 — parallel retrieve + token-streaming overlay | Sequential retrieve+script-fetch wasted ~50-150ms; JSON-blob output meant the rep saw nothing until the full LLM call finished. |
| `cc7ff66` | gateway, infra | Phase 3 — Haiku 4.5 on the realtime hot path | Sonnet 4.6 TTFT was 800-1200ms; Haiku 4.5 is ~360ms with negligible quality drop on grounded one-sentence answers. |
| `c0066b1` | docs | Move chrome-ext-robustness guide into docs/ | Was sitting untracked at repo root; CLAUDE.md keeps top-level for source dirs only. |
| `8502cd5` | gateway | Phase 1 follow-up — cut retrieve outer LIMIT 5 → 3 | Phase 1 commit message claimed it but the outer SELECT was left at LIMIT 5. /plan-eng-review caught it. |
| `227c937` | admin-web, chrome-ext (v0.1.12) | Drop "Ask next:" prefix, bump font 12-14px → 16-17px | User feedback: "only print the text you want the sales team to speak" and "increase the font size". |
| `ae3081e` | gateway, analytics-service | Instrument proactive coach + lower urgency threshold 0.5 → 0.35 + tag urgency-skip events as degraded | 24h prod data showed coach_total p50/p95 = 0/1ms because reactive coach was firing 0/98 times and proactive path had zero emitLatency calls. |

## Phase 1 — Quick wins (commit `4942ccb`)

**Goal.** Shave easy ms from the hot path without touching architecture.

Four changes:

1. **Deepgram STT model nova-2 → nova-3** (`packages/sdk/stt/src/deepgram.ts`). Nova-3 sub-300ms P95 streaming finals vs Nova-2's ~450ms. Drop-in compatible. ~100-150ms saved at the head of the pipeline.
2. **Deepgram endpointing 300ms → 200ms.** Cuts utterance-end signal by 100ms while staying above the false-final floor.
3. **Anthropic prompt caching** (`packages/sdk/llm/src/anthropic.ts`). Switched the `system` payload from a string to `[{type:'text', text: system, cache_control: {type:'ephemeral'}}]`. `SUGGEST_SYSTEM` is identical every reactive turn — within a 5-minute call window the cache hit rate approaches 100%. ~100-200ms TTFT save on hit + 70-90% input cost cut. Below-threshold prompts (<1024 tokens) are no-op so it's safe everywhere.
4. **Prompt size cuts** (`services/realtime-gateway/src/lib/coach.ts`, `handler.ts`):
   - `contextTurns` from `rolling.slice(-6)` to `-3` in handler.ts at both reactive and proactive call sites
   - `retrieve()` semantic + keyword CTEs from `LIMIT 5` to `LIMIT 3`
   - User prompt context cap dropped to `-3` for consistency

**Estimated impact:** −400 to −700 ms P95 per coached turn.

**Known gap caught later** in `/plan-eng-review`: the outer `LIMIT 5` on the final SELECT in `retrieve()` was left untouched. Fixed in commit `8502cd5`.

## Phase 2 — Pipeline restructure (commit `628614c`)

**Goal.** Stop waiting for full JSON before showing anything; stop running independent operations sequentially.

### 2.1 Parallel retrieve + script-fetch (`coach.ts`)

`retrieve()` and `getActiveScriptForStage()` are independent DB calls. Wrapped both in `Promise.all`. ~30-100ms saved per coached turn depending on script-cache state.

### 2.2 Token streaming through 5 layers

Anthropic streams tokens via SSE. We added an `onPartialText` callback that fires on every text delta, plumbed through:

```
Anthropic SSE response
  ↓
sdk-llm consumeStream() parses content_block_delta + message_delta + message_start
  ↓
coachAndPersist() forwards via input.onPartialText
  ↓
handler.ts drainPending() callback parses partial JSON via tiny regex
  (handles backslash-escaped quotes inside JSON strings)
  ↓
WS frame: { type: 'suggestion.streaming', answerText, followupText }
  ↓
offscreen relay → SW broadcast to active Meet tab
  ↓
content/index.ts renderOrUpdateStreamingCard() — glass card with "typing…"
  indicator that fills in as the model writes
  ↓
On final `suggestion.generated`, commitStreamingCard() removes the
streaming placeholder; final renderSuggestion() takes over with citations
+ progress bar + dismiss button.
```

**Why partial-JSON regex instead of a full parser:** the streaming text is incomplete JSON. We don't need to parse it — we just need to pull the `answer_text` / `followup_text` string values out as they grow. Single regex per field: `"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`. The character class handles backslash-escapes (`\"`, `\n`, `\t`) inside the value.

**Source-id validation:** runs ONLY on the final parsed JSON, not on partial frames. Partial frames are display-only; the final commit re-renders with cited card or `suppressed` if validation fails.

**Estimated impact:** −300 to −500 ms actual + 50-70% perceived (rep sees first words at ~300ms vs ~600ms total).

## Phase 3 — Hot-path model swap (commit `cc7ff66`)

**Goal.** Move from premium-tier model (Sonnet 4.6, 800-1200ms TTFT) to fast-tier (Haiku 4.5, ~360ms TTFT) on the reactive path.

Three files:

- `services/realtime-gateway/src/config/env.ts` — new `ANTHROPIC_MODEL_HOT_PATH` env var with default `'claude-haiku-4-5'`. `ANTHROPIC_MODEL` stays as the explicit override knob for emergency Sonnet rollback without redeploy.
- `services/realtime-gateway/src/server.ts` — `hotPathModel = env.ANTHROPIC_MODEL ?? env.ANTHROPIC_MODEL_HOT_PATH`.
- `infra/docker-compose.prod.yml` — realtime-gateway service env override sets `ANTHROPIC_MODEL_HOT_PATH=claude-haiku-4-5` explicitly. Sonnet stays for postcall recap, knowledge BMC extractor, orchestrator suggest (quality-first paths).

**Estimated impact:** −500 to −800 ms TTFT per coached turn.

**Stacked Phase 1+2+3 estimate:** ~1.5-2.5s off P95. Coach budget from ~2s → ~500-800ms.

## Phase 1 follow-up (commit `8502cd5`) — `/plan-eng-review` catch

Post-hoc engineering review reading the actual shipped code line-by-line caught that `services/realtime-gateway/src/lib/coach.ts:218` still said `LIMIT 5`. The Phase 1 commit message claimed `LIMIT 5 → LIMIT 3 across all three CTE stages (semantic, keyword, final)` but only the inner CTEs were cut. Inner CTEs dedup to ≤6 unique IDs; the outer ranking step still returned up to 5. Net: prompt was still carrying up to 2 extra chunks (~1000 tokens / ~50-100ms TTFT) the commit said it had reclaimed.

One-line fix: `LIMIT 5` → `LIMIT 3` on the outer SELECT.

Lesson recorded: commit messages aren't proof. The next post-deploy review should read the diff hunks against the message claims.

## User feedback round — coach card UI (commit `227c937`)

User shared a screenshot of the admin-web Coach prompts panel with two specific complaints:

1. *"Only print the text you want the sales team to speak."* Every card was prefixed with `Ask next:` (admin-web), `→ Ask next:` (chrome-ext final card), `→ Ask next:` (streaming card), and `→` (chrome-ext history panel). The rep reads the line out loud; the label is noise.
2. *"Increase the font size."* Body text was 12-14px depending on surface. Too small to scan under time pressure on a live call.

### Changes

Single unified "speak this" style across every coach surface. No prefix, no italic dim treatment on followup, same color and weight as answer text:

```
SPEAK_STYLE = color:#F8FAFC; font-weight:500; font-size:17px;
              line-height:1.5; margin-bottom:6px
```

- **admin-web `MeetingDetail.tsx:385-388`** — `text-white/95 text-lg leading-relaxed` for both `answerText` and `followupText`. No "Ask next:" prefix.
- **chrome-ext final card `content/index.ts:241-256`** — extracted `SPEAK_STYLE` const, applied to both answer + followup. Card base font 14px → 17px, padding 14/16 → 16/18.
- **chrome-ext streaming card `content/index.ts:323-330`** — same `SPEAK_STYLE` so the streaming preview is visually identical to the final commit. Dropped the `→ Ask next:` prefix from the streaming followup.
- **chrome-ext side panel `content/panel.ts:165-166`** — `.followup` class now matches `.answer`: white text, 16px, weight 500. Dropped the `→` arrow prefix.

Type prefix kept ONLY in panel filter chips (Ask / Answer / Coach / Risk) — those are navigation labels, not card content.

Version bumped 0.1.11 → 0.1.12. ZIP repackaged at 25KB. Install page footer updated: `v0.1.12 · Bigger speak-this text · cleaner cards`.

## Telemetry investigation + fix (commit `ae3081e`)

**Trigger.** User: *"the sales coach is taking more than 1 sec to come back with suggestion can you check the log"*.

Queried prod `latency_events` for the last 24h via `railway run psql` against the public `tramway.proxy.rlwy.net` proxy:

```
stage              n   p50    p95    p99    max
transcript_final   105  11ms   31ms   46ms   119ms     ← Deepgram fast
intent              98  0ms     0ms    1ms    1ms      ← regex, free
coach_total         98  0ms     1ms    1ms    1ms      ← PROBLEM
retrieval            0  —      —      —      —         ← never recorded
suggestion           0  —      —      —      —         ← never recorded
```

`coach_total = 1ms` is not the coach being fast. Two distinct findings hiding inside this:

### Finding 1 — Reactive coach not firing

`coach_total` n=98, `intent` n=98 — they match exactly. The only path that emits `coach_total` AND `intent` with no `retrieval` is the urgency-skip early-return at `coach.ts:681`:

```typescript
if (intent.urgencyScore < deps.urgencyThreshold) {
  emitLatency({ stage: 'coach_total', latencyMs: Date.now() - tStart });
  return suppressed(intent, 'urgency below threshold');
}
```

**All 98 customer turns in the last 24h were filtered out by the urgency gate before retrieve() or the LLM ran.**

The urgency formula:

```
urgencyScore = clamp01(
  (questionMarks > 0 ? 0.4 : 0) +
  (intent keyword match ? 0.3 : 0) +
  (objection words ? 0.2 : 0) +
  min(0.1, length / 1000)
)
```

Threshold 0.5 required two signals minimum. A bare conversational question like "How much does it cost?" — if `cost` isn't in our intent keyword list — scores 0.4 + 0.02 = 0.42. Below the gate.

**Fix:** lowered `URGENCY_THRESHOLD` default 0.5 → 0.35 in `config/env.ts`. Single-signal turns now surface to the LLM. Quality is still gated downstream by `MIN_DISPLAY_CONFIDENCE` (0.4 default) — the urgency gate exists for cost control, not card quality. With Haiku 4.5 on the hot path, the extra LLM calls are economically fine.

### Finding 2 — proactiveCoach had zero instrumentation

```bash
grep -c emitLatency proactiveCoach   # 0
```

The path that generated every card the rep actually saw — proactive opening prompts, rep-silence nudges, stage-transition cues — had no `emitLatency` calls at any return path. The `/analytics` dashboard's `coach_total` was 100% noise from the reactive urgency-skip branch; the real cards were completely invisible to telemetry.

**Fix:** added three emit points to `proactiveCoach()`:

- After `getActiveScriptForStage()` — new stage `script_fetch`
- After `llm.complete()` — reuse stage `suggestion`
- At every return path (success + 3 null-return cases for `!scriptBody`, LLM failure, dedup reject, empty cleaned text) — stage `coach_total` via a local `emitTotal()` helper

Extended `LatencyStage` union with `'script_fetch'`. Added `script_fetch: 100` to the analytics budget map.

### Finding 3 — Urgency-skip events polluted dashboard percentiles

`coach_total` rows from the urgency-skip branch represent NON-events from the rep's perspective. Mixing them into p50/p95 hides the real coach distribution behind a wall of 0ms early-returns.

**Fix:**
- `coach.ts:682` urgency-skip emit now sets `degraded: true`.
- `analytics-service/src/modules/aggregate/service.ts:69` filters `degraded: false` in the `latency()` aggregator.
- proactiveCoach's `emitTotal()` helper passes `degraded:true` on null-return paths (no card surfaced to rep) and `false` on success.

### Surfaced but deferred — production bugs found in logs

While reading Railway logs for `realtime-gateway`, every call ended with:

```
autoEndMeeting failed: endMeeting 401
autoRecap failed: recap.run 401: TOKEN_INVALID
```

The gateway is calling back into the API at end-of-call with a token the API rejects. Recap is broken in prod. **Not fixed in this session** — separate auth-handshake bug between realtime-gateway and api services. Reps are silently losing post-call recap. Recorded as out-of-scope for this session.

## Files touched (cumulative, this session)

```
apps/admin-web/src/app/install/page.tsx            227c937 (version + footer copy)
apps/admin-web/src/components/MeetingDetail.tsx    227c937 (speak-this style, no prefix)
apps/admin-web/public/downloads/                   227c937 (0.1.11 → 0.1.12 zip)
apps/chrome-extension/                             227c937 (full v0.1.12 rebuild)
  ├── package.json, src/manifest.json              227c937 (version bump)
  ├── src/content/index.ts                         227c937 (final + streaming card UX)
  └── src/content/panel.ts                         227c937 (history panel UX)
docs/chrome-ext-robustness.md                      c0066b1 (moved from repo root)
infra/docker-compose.prod.yml                      cc7ff66 (Haiku hot-path env override)
packages/sdk/llm/src/anthropic.ts                  4942ccb + 628614c (prompt cache + SSE stream)
packages/sdk/llm/src/types.ts                      628614c (onPartialText)
packages/sdk/stt/src/deepgram.ts                   4942ccb (nova-3 + 200ms endpointing)
services/analytics-service/src/modules/aggregate/  ae3081e (script_fetch budget + degraded filter)
services/realtime-gateway/src/
  ├── config/env.ts                                cc7ff66 + ae3081e (hot-path model + urgency 0.35)
  ├── lib/coach.ts                                 4942ccb + 628614c + 8502cd5 + ae3081e
  ├── lib/latency.ts                               ae3081e (script_fetch stage)
  ├── modules/session/handler.ts                   4942ccb + 628614c (slice + streaming forward)
  └── server.ts                                    cc7ff66 (hotPathModel wiring)
```

## Open follow-ups (recorded, deferred)

1. **Watch the new dashboard for 24h** after `ae3081e` deploys. Expected: `coach_total` p95 ~600-1000ms, `suggestion` p95 ~500-900ms, `script_fetch` p95 <30ms after cache warmup, `retrieval` p95 <200ms. If `script_fetch` p95 >100ms the in-process cache is missing.
2. **Eval suite for Haiku quality** vs Sonnet — 50-turn fixture comparing source-id validity + structural match. Worth doing once we have data on whether reps prefer Haiku's terser output.
3. **Tiered routing** — Haiku for most turns, Sonnet for `objection_handling` stage if the eval shows quality drop.
4. **The `autoEndMeeting / autoRecap 401` prod bug.** Gateway→API token handshake is broken. Recap is silently failing for every call. Needs its own session.
5. **Pre-existing `rejects bad hello payload` test failure** in `services/realtime-gateway/src/server.test.ts`. Was already red before Phase 1. Likely a test-contract bug — the test probably doesn't send the auth frame first, so `closeUnauth` fires before the hello schema runs.
6. **Sentry custom metric for `coach_cache_hit_rate`** — derive from `usage.cache_read_input_tokens / usage.input_tokens` in `anthropic.ts`. DB-based dashboard suffices for now; Sentry would give realtime alerting.
7. **Chrome Web Store v0.1.12 re-submission.** Sideload via `/install` works today; Web Store listing still on v0.1.10 pending audio-capture review.
8. **Eval the lowered urgency threshold.** 0.35 may produce too many spurious reactive cards. Check the `not_useful` thumbs-down rate at 24h. If it climbs, raise to 0.40 or add a per-category override.
