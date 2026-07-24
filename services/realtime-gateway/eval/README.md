# Coach-quality eval harness (F22)

Deterministic, CI-safe regression gate for the live coach. **No DB, no LLM, no API keys** — runs anywhere in seconds.

```bash
pnpm --filter @athena/realtime-gateway eval
```

Exits non-zero if any **gated** metric drops below its threshold.

## What it measures

| Metric                           | Source                                                             | Gate                |
| -------------------------------- | ------------------------------------------------------------------ | ------------------- |
| **Objection recall** (EN / FR)   | `classifyHeuristic().isObjection` over `fixtures/objections.json`  | EN ≥ 85% / FR ≥ 80% |
| **Precision** (benign quiet)     | benign turns NOT flagged, over `fixtures/benign.json`              | ≥ 95%               |
| **Objection-loop state machine** | `reconcileEpisode` walked over `fixtures/episodes.json` end-to-end | 100% transitions    |
| **Retrieval ordering**           | `mergeObjectionFirst` keeps objection chunks first                 | must hold           |

**Recall + precision are both gated.** Recall = real objections reach the coach. Precision = benign turns stay silent. The eval measures both because recall-only is what let the F20 regression ship.

## Why precision exists (the "random advice" incident)

F20 lifted recall to ~100% by making objections bypass the urgency gate — but it keyed `isObjection` off loose common words ("but", "think", "already", "commit", "busy"), so **benign turns fired objection advice**. On a real call the coach gave reframes for objections that weren't there — "random advice unrelated to what the customer said." The recall-only eval stayed green throughout.

The fix narrowed `isObjection` to **specific objection phrases only** (never a lone word) and added this **precision corpus** as a hard gate. Benign precision went from **39% → 100%** while recall stayed at 100%. Any future pattern that fires on normal speech now trips the gate.

Relevance is enforced in three layers, all biased toward silence: precise trigger (here), a retrieval relevance floor (`RETRIEVAL_MIN_SCORE` 0.2), and an output gate (the LLM returns `type:"none"` when nothing fits).

## Extending

- **Add fixtures:** drop real anonymized objection turns into `fixtures/objections.json`, or scripted episodes into `fixtures/episodes.json`. More coverage = a tighter gate.
- **Live LLM judge (not in v1):** a `--live` mode gated on `ANTHROPIC_API_KEY` can run each fixture through the real `SUGGEST_SYSTEM` prompt and LLM-judge entailment (`answer_text` supported by the cited chunk) and loop-step correctness. Kept out of the default path so CI stays key-free and fast.

## CI

Add to the pipeline alongside typecheck/test:

```yaml
- run: pnpm --filter @athena/realtime-gateway eval
```

When the coach logic moves to `packages/coach` (F19), relocate this harness to `tools/coach-eval` and repoint the imports.
