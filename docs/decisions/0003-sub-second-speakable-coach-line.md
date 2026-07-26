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

3. **TTFT reduction** (−250 ms). Record `cacheCreationTokens` alongside
   `cacheReadTokens` to distinguish "never cached" from "cached, never read",
   then make the stable system prefix actually cacheable, and trim per-chunk
   prefill payload (currently 5 × 700 chars) without reducing chunk COUNT.

Resulting budget: ~150 + ~0 + ~600 + ~300 ≈ **1050 ms**.

Unblocking correctness fix shipped alongside: the authority objection pattern
required `my` immediately before `partner`, so "talk to my **business**
partner" scored 0.295 against the 0.35 urgency gate and the coach stayed
silent. Silent failure on a core objection outranks latency.

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
