# 0003. Sub-second speakable coach line

- Status: accepted
- Date: 2026-07-26
- Deciders: Suyash Raj
- PRD refs: F4, F5 (live coach), PRD §7 latency budgets, PRD v2 A6

## Context

Founder goal: the rep must have a **complete line they can say out loud** within
**1 second** of the prospect finishing their sentence.

Prior latency work optimised the wrong metric. Both PRD §7 ("suggestion
published ≤2000 ms P95") and the `llm_ttft` telemetry added earlier measure
_first token_. A rep cannot speak half a sentence, so first token is not a
deliverable. The deliverable is the first **complete** `answer_text` /
`followup_text`.

### Measured baseline (prod, 2026-07-26, `claude-haiku-4-5-20251001`)

Measured end-to-end against the deployed gateway by injecting synthetic
customer turns through `POST /v1/sessions/captions` into a live WS session
(see `docs/runbooks/` — harness scripts are session-local).

| Segment                                             | Measured     |
| --------------------------------------------------- | ------------ |
| Turn-boundary wait (coalesce window)                | 800 ms       |
| Retrieval (embed + pgvector)                        | 411 ms       |
| LLM TTFT                                            | 848 ms       |
| Streaming the ~40-token spoken line                 | ~300 ms      |
| **Complete speakable line**                         | **~2360 ms** |
| Remaining JSON (ids, rationale, episode, new_facts) | ~2100 ms     |
| `coach_total`                                       | ~4500 ms     |

Two facts reframe the problem:

1. The extension already renders `suggestion.streaming` progressively
   (`renderOrUpdateStreamingCard`), and `answer_text` sits near the front of
   the JSON. The rep therefore reads a complete line at ~2360 ms — the ~4500 ms
   `coach_total` is a **metadata tail the rep never waits on**. That tail is a
   cost and output-size problem, not a latency problem.
2. `cache_read_tokens = 0` on every measured call. Prompt caching has never
   engaged, so the 100–200 ms TTFT saving assumed since 2026-05-10 was never
   real. PRD v2 A6 was correct; later speculation that the grown prompt had
   crossed the 1024-token threshold was wrong.

Gap to close: **2360 ms → 1000 ms.**

## Decision

Close the gap with three levers on the critical path. Do **not** change model
or provider.

1. **Punctuation-aware turn boundary** (−650 ms). Replace the fixed 800 ms
   quiet window with a semantic flush: emit the coalesced turn as soon as the
   buffered text ends in terminal punctuation (`. ? !`) and clears a minimum
   word count. Deepgram runs `smart_format=true`, so a finished utterance
   carries punctuation. Retain the timer as a fallback for unpunctuated speech.
   Safe because measured turn boundaries are ~10 s apart (customer
   inter-segment gap p90 = 9970 ms) while intra-utterance gaps are 0–930 ms
   (p50 = 0 ms), so the distribution is sharply bimodal.

2. **Speculative prefix retrieval** (−411 ms). Start retrieval on the FIRST
   fragment, concurrently with continued listening, so chunks are warm by
   flush time. Sound because fragments are strictly appended: fragment 1 is a
   **prefix** of the final utterance, and prefix retrieval returns the same
   topical chunks. Cost is one extra `text-embedding-3-small` call
   (~$0.02/1M tokens).

3. **TTFT reduction** (−250 ms). Trim per-chunk prefill payload (currently
   5 × 700 chars) without reducing chunk COUNT, and decide what to do about
   prompt caching — see the amendment below.

Resulting budget: ~150 + ~0 + ~600 + ~300 ≈ **1050 ms**.

### Amendment (2026-07-26, post-measurement)

Two corrections to the numbers above, both from measuring rather than reasoning.

**Retrieval is not worth 411 ms.** Measured per-stage after lever 1 shipped:
retrieval averages **99 ms** (0 / 0 / 297 ms across three turns) because the
existing `episodeChunkCache` already serves mid-episode turns. Speculative
prefix retrieval is therefore worth ~100 ms, not 411 ms, and only on the first
turn of an episode. Still correct, much smaller.

**Prompt caching cannot engage on Haiku 4.5 at the current prompt size.** The
minimum cacheable prefix is per-model and NOT monotonic across generations:
512 (Opus 5 / Fable 5), 1024 (Opus 4.8 / Sonnet 5 / Sonnet 4.6), 2048
(Opus 4.7), and **4096 for Haiku 4.5** (also Opus 4.6 / 4.5). `SUGGEST_SYSTEM`
is ~1300–1400 tokens — it clears Sonnet's 1024 but sits ~3× below Haiku's
floor, and the failure is silent (`cache_read_input_tokens = 0`, no error).
PRD v2 A6 was right that caching is a no-op; the earlier note in this ADR
guessed the threshold was 1024 and was wrong. `packages/sdk/llm` carried the
same wrong figure in a comment since 2026-05-10, which is why the claimed
100–200 ms saving was never questioned.

Engaging it therefore requires the stable prefix to exceed **4096** tokens —
roughly 2 800 tokens more than today. That is worth doing only if the added
content is genuinely useful, and it happens that F18 already calls for exactly
this: inject the objection-reframer reference material (reframe library per
archetype, tonality guidance) into the system prompt. Real content that also
crosses the threshold, rather than padding.

Revised lever-3 budget: caching is deferred to its own phase (prompt rebuild +
eval), so the achievable near-term budget is ~150 + ~99 + ~760 + ~300 ≈
**1300 ms**, matching the measured 1272 ms. Reaching ~1000 ms needs either the
prompt rebuild above or a faster provider (still gated on the eval judge).

Unblocking correctness fix shipped alongside: the authority objection pattern
required `my` immediately before `partner`, so "talk to my **business**
partner" scored 0.295 against the 0.35 urgency gate and the coach stayed
silent. Silent failure on a core objection outranks latency.

## Outcome (2026-07-26) — target met, by a different route than decided

The three levers above were all shipped and all measured. Two behaved as
predicted (punctuation flush, chunk trim); the third was refuted; and the
target was ultimately met by a mechanism this ADR did not originally contain.

### What the levers actually delivered

| Change                              | Predicted | Measured                                                                                                                                                                                                                                      |
| ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Punctuation-aware flush (800→110ms) | −650 ms   | as predicted                                                                                                                                                                                                                                  |
| Chunk excerpt cap 700→400 chars     | —         | ~−130 ms; paid for the reframe library                                                                                                                                                                                                        |
| Retrieval (speculative prefix)      | −411 ms   | **wrong: retrieval is 64-99 ms avg**, the episode cache already served mid-loop turns. Not worth implementing.                                                                                                                                |
| Prompt caching by crossing 4096     | −250 ms   | **refuted: TTFT got 2.5x WORSE** (760→1903 ms) with the cache confirmed engaged (`cache_read_input_tokens = 4958`). Caching saves prefill compute; the model still attends over the full context. True for cost, false for latency. Reverted. |

### The measurement that changed the design

Built `eval/live-judge.ts` — the `--live` mode `eval/run.ts` had always
promised — because hand-measured n=3 runs produced means of 1287 ms and 1530 ms
with no latency-affecting change between them: ~250 ms of run-to-run noise
swamping the 100-150 ms effects being tuned. Over 16 judged samples:

    TTFT           mean  933 ms   p50  866 ms   p90 1317 ms
    line complete  mean 1833 ms   p50 1651 ms   p90 2713 ms

**TTFT p90 alone exceeds the entire budget before a word streams.** No amount
of prompt or retrieval tuning closes that, and no fast-inference provider key
(Groq / Cerebras) is available to route around it.

### The decision that met the target

The judged output revealed the way through: for a freshly-raised objection the
LLM was reproducing the library template almost verbatim every time. The
opening disarm+isolate is determined by the ARCHETYPE, not the conversation —
which is why a trained rep delivers it reflexively. The same holds for
uncover / justify / consequence / identity_close, which are determined by WHICH
STEP the loop is on.

So the model is now spent only where adaptation is real:

| Loop step                              | Served by | Measured (end-to-end, incl. network) |
| -------------------------------------- | --------- | ------------------------------------ |
| disarm + isolate (fresh objection)     | template  | **252 ms**                           |
| uncover                                | template  | **297 ms**                           |
| **reframe**                            | **LLM**   | ~1950 ms                             |
| justify / consequence / identity_close | template  | ~250-300 ms                          |

Server-side `instant_opener` is **10-17 ms** for the whole coach path; the rest
of the client-observed figure is the 110 ms settle beat plus network. Six of the
seven loop steps are now an order of magnitude inside the budget, and the one
that is not is the step where landing in the prospect's own words and numbers is
the entire value.

`deps.instantOpeners = false` forces everything back through the LLM for A/B.

### Guardrails against the obvious regression

This is deliberately not the canned-`askNext` mistake that a 2026-07-24 field
report killed. Those were context-blind and re-asked answered ground. These fire
only on a detected objection, are archetype- and step-matched rather than
generic, ask about the prospect's own goal rather than for new information, run
through the same dedup and display gate as LLM output, and decline outright
when the prospect asked a question (they want an answer, and the model can give
one from the chunks) or when the next step is `reframe`.

`eval:live` now gates any model change on strict-JSON adherence,
speakable-verbatim rate, and placeholder-leak rate. Its judge had to be taught
the reframe loop first: an uninformed judge failed two canonical moves as
"pivots away from price" and "deflects comparison", and used as a gate would
have driven the coach toward exactly the generic direct rebuttals the product
exists to avoid.

## Consequences

**Positive**

- Complete speakable line inside ~1 s without a model change, so no quality gamble.
- Turn coalescing (shipped 2026-07-26) already cut ~3 LLM calls per turn to 1;
  these levers add no calls back except one cheap embedding.
- `turn_to_first_token` deliberately counts the coalesce window, so the metric
  cannot hide our own added delay.

**Negative**

- Punctuation flush depends on STT formatting. If `smart_format` is disabled or
  a provider stops punctuating, behaviour silently degrades to the timer path.
  Mitigated by keeping the timer, but the dependency is real and undertested.
- Speculative retrieval performs work that is discarded when a turn is
  urgency-gated.
- Metadata tail (~2100 ms) remains. Episode state and `new_facts` still land
  late relative to the spoken line; acceptable while turn boundaries are ~10 s
  apart, but it is the next thing to break if call pace increases.

**Neutral**

- PRD §7's "suggestion published ≤2000 ms P95" should be restated as a
  complete-speakable-line budget. First-token targets are not user-visible.

## Alternatives considered

- **Two-call split (fast line + background metadata).** Pros: minimal hot
  schema. Cons: the streaming card already delivers the line early, so this
  buys ~0 ms of felt latency while doubling calls and lagging episode state by
  a turn. Rejected — solves a problem we do not have.
- **Faster provider (Groq / Cerebras Llama).** Pros: largest theoretical lever
  (~10× tok/s), and `packages/sdk/llm` already abstracts the provider. Cons: no
  live-LLM eval judge exists, so a rule-dense strict-JSON prompt could regress
  silently. Rejected **for now**; blocked on the judge, not the integration.
- **Reduce `RETRIEVAL_TOP_K` 5→3 or reactive context 10→6 turns.** Cons: both
  are documented field regressions — topK 3 starved objection turns of the
  reframe library, and 6 turns caused the coach to re-ask answered questions.
  Rejected.
- **Tighten the LLM deadline.** Already tried and reverted the same day: a
  2500 ms deadline aborted every call into `heuristicAnswer()`, which emits the
  top chunk's first sentence verbatim, showing reps raw training material.
  Deadlines bound pathological tails only; they are not a latency lever.
- **HNSW instead of ivfflat.** ~60 ms class against a 2360 ms budget. Deferred.

## References

- PRD §7 latency budgets; PRD v2 §1 A6 (endpointing, prompt caching)
- ADR 0002 (Prisma) — note `prisma db push` drops raw-SQL indexes incl.
  `idx_knowledge_chunks_embedding`; use additive DDL until migrations are seeded
- `services/realtime-gateway/src/lib/coach.ts`,
  `services/realtime-gateway/src/modules/session/handler.ts`
