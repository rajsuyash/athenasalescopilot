# Athena PRD v2 — Live Coach Quality Overhaul

**Status:** Proposed · **Date:** 2026-07-24 · **Supersedes:** `docs/PRD.md` F3–F5 for the live path (all other v1 features remain canon)
**Trigger:** Founder feedback — "not happy with the kind of responses provided by the agent during the call" — plus a full code audit of the shipped extension-first pipeline.

---

## 0. Product-reality note (drift from PRD v1)

PRD v1 assumes a macOS desktop app as the primary client. The shipped product is **Chrome-extension-first**: the extension captures Meet tab audio + rep mic, streams to `realtime-gateway`, and renders coach cards as an in-tab overlay. This PRD treats the extension as the primary client and updates the live-coaching pipeline (F3/F4/F5 equivalents). Desktop app remains future scope.

---

## 1. Audit — why in-call responses are weak

Findings from a line-level audit (2026-07-24). Ordered by impact on response quality.

### A1. The Sales Objection skill's *methodology* never runs statefully on the live path — **root cause #1**

**Corrected after line-level source read (2026-07-24) — the first audit pass overstated this:**

- The framework *content* DOES reach the live path. The reframe library, tonality, and source files live in `services/api/src/seed/objection-framework/` and are seeded per-workspace as `objection-handling-*` chunks by `seed-workspace.ts`. The live gateway `coach.ts retrieve()` **already runs the objection-first two-pass** (source lines 320–352) — the `void category;` bug exists only in a stale committed `dist/` artifact, not in current source. **Retrieval of the objection matrix on the live path is not broken.**
- What IS true and load-bearing: the live gateway's reactive `SUGGEST_SYSTEM` only gave the model a vague hint ("isolate → reframe → tie back") instead of the explicit 7-step selection logic the orchestrator already hardcodes. **Fixed in Phase 1** (see §3 status) — the live prompt now carries the full DISARM→…→IDENTITY-CLOSE loop with per-step next-move selection, converged with the orchestrator's wording.
- Still open: the packaged `objection-reframer.skill` zip contains only `SKILL.md`; its `references/*.md` are missing (they exist under `services/api/src/seed/objection-framework/`). This degrades only the **offline** BMC matrix generator, which is told to read files not in the bundle. Fix tracked in F23.2.

### A2. One-shot answers vs. a multi-turn loop — **root cause #2**

The skill is a *stateful 7-step conversation loop*. The live coach is a *stateless one-shot* generator: each customer turn independently produces one ≤30-word line from 3 chunks. There is no memory of which step of the loop the rep is in, whether the objection was isolated, or what the prospect admitted two turns ago. The rep gets disconnected one-liners instead of "the next move in the loop." This is the structural mismatch between what you built in the skill and what the pipeline can express.

### A3. Speaker attribution is unreliable by design

- Rep mic and prospect tab audio are **mixed into one mono channel** before STT (`offscreen/index.ts:135-142`), then Deepgram acoustic diarization guesses speakers on the mixed stream.
- Speaker→role mapping is **first-speaker-wins**: the first diarized label becomes "rep" (`handler.ts:103-110`). If the customer talks first, roles are swapped for the entire call — coach fires on rep speech and ignores the prospect.
- Mic capture is silently optional: if mic `getUserMedia` fails, capture continues tab-only with no signal to the rep.

### A4. Intent detection is English-only regex

- Live intent/objection detection is keyword regex + question-mark counting (`coach.ts:168-215`). Paraphrased, soft, or non-English objections are missed entirely.
- History proved it: prod telemetry showed the urgency gate suppressed **98 of 98 customer turns** in a 24h window before the threshold was lowered. The current 0.35 threshold is still gating on regex signals.
- An LLM intent classifier exists (`orchestrator-service/src/modules/intent/service.ts`) but is never called by the gateway.

### A5. Prompt context poverty

The live LLM call sees only: customer turn + **last 3 transcript turns** + **3 chunks** (minScore floor 0.1 — near-random chunks pass) + ≤600 chars of stage script. It does NOT see: the workspace's BMC/offer/pricing profile, buyer persona, deal context, a rolling call summary, prior objections in this call, or which reframe was already attempted. Embeddings are truncated to **256 dims**, degrading retrieval precision on the only grounding source the model has.

### A6. Latency choices that also cost quality

- Haiku 4.5 everywhere on the hot path, ≤30-word cap — no escalation to a stronger model even for `objection_handling`, the moment the product exists for.
- 200ms Deepgram endpointing fragments natural pauses into multiple "finals"; single-flight lock drops earlier turns when a coach call is inflight.
- Prompt caching is a **no-op**: `cache_control` requires ≥1024 system tokens; `SUGGEST_SYSTEM` is ~250 words. The claimed 100–200ms TTFT saving never materialized.
- 12s LLM deadline — a "live" suggestion can legally arrive 12s late.

### A7. No quality feedback loop

No eval harness, no golden transcripts, no LLM-judge, no A/B on prompts or models. Every prompt/model/threshold change ships blind. (Planned in SESSION-05-10 follow-ups #2/#3/#8; never built.)

### A8. Engineering debts that block iteration

- **Two diverged coach implementations** (gateway `coach.ts` vs orchestrator `suggest/service.ts`) that "must stay in sync" and already differ in topK, minScore, prompts, and retrieval priority. (Phase 1 converged the objection prompt + topK; full extraction is F19.)
- `ANTHROPIC_MODEL` env precedence (`server.ts:75`): **corrected** — this is a confusing comment, not a functional bug. Prod sets only `ANTHROPIC_MODEL_HOT_PATH`, so Haiku wins as intended; `ANTHROPIC_MODEL` is the deliberate emergency-rollback override. Comment cleanup only (F19).
- Post-call recap is broken in prod (`autoRecap 401 TOKEN_INVALID`) — reps lose the recap that would justify retention.
- Blocking DB writes (segment + turn insert) sit in front of every coach call.
- No entailment check: a suggestion citing a valid chunk ID can still say something the chunk doesn't support.

---

## 2. Product thesis for v2

> The differentiator is not "an AI that answers questions." It is **the objection-reframer methodology, executed live**: the coach knows which step of the 7-step loop the conversation is in and always tells the rep the *single next move*, grounded in this business's pre-baked objection matrix and offer facts.

Everything below serves that thesis. Latency stays a hard constraint (first token ≤1.2s from turn-end), but quality decisions are no longer sacrificed for milliseconds that telemetry showed we weren't even measuring.

---

## 3. Revised feature specifications

Feature IDs continue PRD v1 numbering. F17–F19 are P0 (they fix the complaint); F20–F22 are P1.

---

### F17 · Deterministic dual-channel speaker attribution — P0

**Problem it fixes:** A3. The coach cannot be trusted if it doesn't reliably know who is speaking.

**Change:** Stop pre-mixing. Send **tab audio and mic as two channels** and let the channel — not acoustic diarization — determine the role.

- Extension: keep both MediaStreams separate; interleave into stereo PCM (L = tab/customer-side, R = mic/rep) in `pcm-worklet.js`.
- Gateway/STT: Deepgram `multichannel=true, channels=2`; segments arrive with a channel index → `speaker_type` is assigned deterministically (`channel 0 → customer`, `channel 1 → rep`). Diarization retained only *within* the tab channel for multi-party prospect calls.
- Remove first-speaker-wins `SpeakerMap`. Keep `forceCustomer` as a dev flag only.
- Mic-capture failure becomes a **visible degraded state** in the coach chip ("mic not captured — rep-side coaching off"), not a silent downgrade.

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Customer speaks first on a call | Session runs | Their turns are labeled `customer`; rep's labeled `rep`; zero role swaps for the whole call |
| AC2 | Rep and customer overlap | STT processes | Each channel's segment keeps its own deterministic role; no cross-channel bleed in labels |
| AC3 | Mic permission denied | Capture starts | Session continues tab-only; coach chip shows degraded badge; `rep_silence` proactive triggers are disabled |
| AC4 | Bandwidth cost | Stereo vs mono | Uplink ≤2× mono PCM; if measured uplink >256 kbps, drop to 8kHz rep channel before dropping the feature |

---

### F18 · Live objection loop engine (the skill, made stateful) — P0

**Problem it fixes:** A1 + A2. This is the core of the overhaul.

**Change:** Introduce an **objection episode** state machine in the session, directly implementing the 7-step loop from `objection-reframer.skill`.

**Data model (new table `objection_episodes`):** `id, workspace_id, meeting_id, opened_turn_id, archetype (price|stall|authority|comparison|time|skepticism|self_doubt|resistance|avoidance), current_step (disarm|isolate|uncover|reframe|justify|consequence|identity_close|resolved|abandoned), reframe_used, closed_at`.

**Behavior:**

1. When intent detection (F20) flags an objection, an episode opens with the classified **archetype** (the skill's table maps surface objection → archetype).
2. Every subsequent turn (rep AND customer) updates the episode: a small classifier prompt decides "which step did the rep just execute / how did the prospect respond" (advance / deflect / resolved).
3. The suggestion for each turn inside an episode is **the next step of the loop**, not a generic answer: e.g. after the rep disarms and the prospect confirms value, the card says the ISOLATE→UNCOVER line; after the reframe lands, the card is literally *"Ask: 'Why?' — make them justify it."*
4. Deflection branches come from the skill's "If they deflect" patterns; after 2 deflections the coach falls back to answer-mode grounding.
5. Episode context (archetype, step, what the prospect admitted) is **injected into every prompt** for the rest of the episode.

**Prompt source of truth:** the system prompt for objection episodes is **built from the skill bundle at build time** (`packages/skills` → generated TS constant), not hand-copied. One source; gateway and orchestrator import it. Repackage the bundle to include `references/reframe-library.md` + `tonality-and-delivery.md`; the reframe library ships into the generated prompt per-archetype (only the active archetype's section is injected, to keep tokens bounded).

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Prospect says "it's too expensive, I need to think about it" | Episode opens | Archetype `price`(+`stall`) classified; first card is a DISARM+ISOLATE line grounded in this workspace's offer facts, ≤2 sentences |
| AC2 | Rep delivers the reframe; prospect concedes | Next turn | Card advances to JUSTIFY ("Ask why — let them defend it"), not a repeated reframe |
| AC3 | Prospect deflects mid-loop with a new concern | Classifier runs | Episode either re-classifies archetype or branches per the skill's deflection recovery; card reflects the branch |
| AC4 | The 7-step system prompt | Is compared to `SKILL.md` | Generated from the bundle in CI; a drift test fails if the bundle changes and the constant wasn't regenerated |
| AC5 | Episode ends (resolved/abandoned) | Post-call runs | Recap lists each episode: archetype, steps executed, where it stalled — feeding manager coaching (F13) |

---

### F19 · One coach engine, objection-first retrieval — P0

**Problem it fixes:** A8 divergence + the `void category;` bug that orphans the objection matrix.

**Change:**

- Extract a single `packages/coach` package (prompts, retrieval, grounding, episode engine). Gateway imports it in-process (latency unchanged); orchestrator imports the same package. Delete the duplicated logic. The "MUST stay in sync" comment dies.
- Fix retrieval on the live path: implement the objection-first two-pass **in the shared package** — pass 1 restricted to `objection-handling-matrix` (this business's pre-baked answers), pass 2 `objection-handling-*` framework docs, pass 3 unrestricted. Matrix hits rank first.
- Retrieval budget: topK 5, `minScore` floor raised 0.1 → 0.25, re-embed knowledge base at **1536 dims** (drop the 256-dim truncation; pgvector cost at current corpus size is trivial).
- System prompt rebuilt to exceed 1024 tokens deliberately (it now carries the skill framework) so Anthropic **prompt caching actually engages** — bigger prompt, same or better TTFT on cache hits, 70–90% input-cost cut.
- Fix `ANTHROPIC_MODEL` precedence so the hot-path model var wins on the gateway.
- Move segment/turn DB inserts off the hot path (fire-and-forget with ordered queue) — coach call starts immediately on turn-final.

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | An objection turn with a matching matrix entry | Retrieval runs on the gateway | The matrix chunk is rank 1 in the prompt; verified by integration test |
| AC2 | Gateway and orchestrator | Given identical inputs | Produce byte-identical prompts (shared-package contract test) |
| AC3 | 20-turn synthetic call | Latency check (PRD §7 harness) | First streamed token ≤1.2s P95 from turn-final; suggestion complete ≤2.5s P95 |
| AC4 | Prompt cache | Second coached turn in a call | `cache_read_input_tokens > 0` in usage telemetry |

---

### F20 · Semantic intent + tiered model routing — P1

**Problem it fixes:** A4 + A6.

**Change:**

- Replace regex-as-gatekeeper with a **two-stage gate**: regex stays as a zero-cost fast-path for obvious hits; everything else goes to a Haiku classifier call (≤1s deadline, the one already built in orchestrator) instead of being dropped. Nothing is suppressed by regex alone.
- **Tiered generation:** Haiku 4.5 for ack/simple-answer turns; **Sonnet for objection episodes** (the archetype classification + reframe steps — the quality-critical 10% of turns). Config per-stage, defaulting from measured eval results (F22).
- Endpointing: raise 200ms → 300ms and add a 400ms turn-merge window (two finals within the window on the same channel merge into one coached turn) to stop fragment-spam and single-flight drops.
- Language: pass workspace language to Deepgram + prompts (EN/FR to match the admin-web i18n work).

**Acceptance criteria:** classifier gate suppresses <20% of customer turns without an LLM look (vs 100% regex-gated today); objection turns route to Sonnet (telemetry-verified); merged-turn rate visible in analytics.

---

### F21 · Business context in every prompt — P1

**Problem it fixes:** A5 (generic answers).

**Change:** Build a per-workspace **coach context block** (~300 tokens, cached): offer one-liner, price points, ICP/persona, top 3 differentiators, tone rules — generated from the BMC at onboarding (the wizard already collects this) and editable in admin-web. Add a **rolling call summary** (one Haiku call every ~10 turns, stored in session state) so the prompt carries call history beyond the 3-turn window. Context turns raised 3 → 6 now that caching pays for it.

**Acceptance criteria:** every live prompt contains the context block (integration test); reframes reference the prospect's actual numbers/goal when they were stated earlier in the call (eval-verified, F22).

---

### F22 · Suggestion-quality eval harness — P1 (build second, gate everything after)

**Problem it fixes:** A7 — you cannot tune what you cannot measure.

**Change:**

- `tools/coach-eval/`: 50–100 golden fixtures (real anonymized transcripts + synthetic objection scripts covering all 9 archetypes, EN+FR).
- Metrics per run: source-id validity, entailment of `answer_text` vs cited chunk (LLM-judge), loop-step correctness inside episodes (did the coach recommend the right next step), latency, ≤30-word compliance where applicable.
- Runs in CI on any change to `packages/coach`, prompts, models, or thresholds; a run report is required in PRs touching those paths.
- Prod loop: weekly report of `useful` / `not_useful` rates by suggestion type, archetype, and model — closing follow-ups #2/#3/#8 from SESSION-05-10.

**Acceptance criteria:** eval runs green in CI; Haiku-vs-Sonnet on objection fixtures produces a documented routing decision; thumbs-rate by archetype visible in `/analytics`.

---

### F23 · Reliability debts (bundled, small) — P0 hygiene

1. Fix gateway→API `autoRecap`/`autoEndMeeting` 401 (broken recap in prod — reps currently lose all post-call output).
2. Repackage skill bundles with their `references/` files; CI check that a bundle's declared references exist inside the zip.
3. Entailment spot-check: LLM-judge samples N% of prod suggestions daily for chunk-support; report drift in analytics.
4. Remove the dead caption-scraper bootstrap or wire it as the documented no-audio fallback (currently commented-out dead code).

---

## 4. Explicit non-goals for v2

- No desktop macOS work.
- No new STT/LLM vendors (Deepgram + Anthropic stay; provider abstraction already exists).
- No autonomous rep-replacement — coach whispers, human speaks.
- No cross-call memory (per-account long-term memory is v3).
- No new spend: everything here runs on existing Deepgram/Anthropic/Railway accounts. Sonnet-on-objections raises LLM cost only on the small objection-turn fraction and is offset by real prompt caching (currently a no-op).

---

## 5. Success metrics

| Metric | Today (audited) | Target 30d post-ship |
|---|---|---|
| Customer turns receiving any coach evaluation (not regex-dropped) | ~0% reactive (98/98 suppressed pre-fix; regex-gated since) | 100% evaluated (≥80% via fast-path, rest via classifier) |
| Speaker-role accuracy | Unmeasured; swaps whole calls | ≥99% (deterministic by channel) |
| Objection turns answered from pre-baked matrix | ~0% (category discarded) | ≥70% of matrix-covered objections cite a matrix chunk |
| Suggestion useful-rate (rep thumbs) | Unmeasured per-archetype | ≥35% overall; measured per archetype |
| First streamed token from turn-final | Unmeasured (12s deadline) | ≤1.2s P95 |
| Loop-step correctness on eval fixtures | N/A (no harness) | ≥80% |
| Post-call recap delivery | 0% (401 in prod) | ≥99% |

---

## 6. Build order

1. **F23.1** recap 401 fix (prod is silently broken today) + **F19** shared `packages/coach` extraction with retrieval fixes — foundation everything else lands in.
2. **F17** dual-channel attribution (extension + gateway; ship as ext 0.2.0).
3. **F18** objection loop engine + skill-derived prompts + bundle repackage (F23.2).
4. **F22** eval harness — before any model/threshold tuning.
5. **F20** semantic intent + tiered routing (decided by F22 numbers).
6. **F21** business-context block + rolling summary.
7. **F23.3/23.4** entailment sampling + dead-code cleanup.

Each step is a ≤5-file-per-phase sequence per CLAUDE.md working agreements; F17 and F18 are independent and can proceed in parallel.

---

## 7. Open questions

- [ ] Stereo PCM doubles uplink (~512 kbps raw). Acceptable, or encode (Opus) client-side first? (Deepgram accepts Opus containerized; adds encoder complexity to the worklet.)
- [ ] Should episode state be visible to the rep (mini step-tracker in the overlay: DISARM ✓ → ISOLATE ✓ → REFRAME ←) or is it noise under call pressure? Propose: hidden by default, visible in the side panel.
- [ ] French objection archetypes: translate the reframe library or generate FR variants per workspace at onboarding? Propose: per-workspace generation via the existing matrix job.
- [ ] `not_useful` threshold for auto-raising the classifier gate — define after 2 weeks of F22 prod data.
