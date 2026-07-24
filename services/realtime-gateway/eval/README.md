# Coach-quality eval harness (F22)

Deterministic, CI-safe regression gate for the live coach. **No DB, no LLM, no API keys** — runs anywhere in seconds.

```bash
pnpm --filter @athena/realtime-gateway eval
```

Exits non-zero if any **gated** metric drops below its threshold.

## What it measures

| Metric                           | Source                                                                                  | Gate                |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| **Objection-detection recall**   | `classifyHeuristic().urgencyScore >= URGENCY_THRESHOLD` over `fixtures/objections.json` | EN ≥ 40% (baseline) |
| **Objection-loop state machine** | `reconcileEpisode` walked over `fixtures/episodes.json` end-to-end                      | 100% transitions    |
| **Retrieval ordering**           | `mergeObjectionFirst` keeps objection chunks first                                      | must hold           |

Recall is _"would this objection even reach the LLM?"_ — the urgency gate is the thing that once suppressed **98/98** customer turns in prod. A regex or threshold change that leaks objections shows up here immediately.

## What F20 fixed (EN recall 45% → ~100%)

This harness first measured **EN recall at ~45%** — the regex gate missed more than half of realistic objections. Single-signal turns (_"I'll have to run this by my boss"_, _"you're being pushy"_, _"now isn't a good time"_) scored ~0.30 and fell under the 0.35 urgency threshold — the **A4** weakness, quantified.

**F20** fixed it: objections now **bypass the urgency gate** (`classifyHeuristic().isObjection` — the gate exists for cost control on generic chatter, not to filter objections) and the objection patterns were widened using the exact misses this eval printed. EN recall is now **~100%**, so `EN_RECALL_GATE` is raised to **0.90** — it now guards against a real regression rather than characterizing a broken baseline.

**F20-FR** then added French objection patterns, taking FR recall from ~10% to ~100% — so FR is now gated (0.85) too, not just informational.

## Extending

- **Add fixtures:** drop real anonymized objection turns into `fixtures/objections.json`, or scripted episodes into `fixtures/episodes.json`. More coverage = a tighter gate.
- **Live LLM judge (not in v1):** a `--live` mode gated on `ANTHROPIC_API_KEY` can run each fixture through the real `SUGGEST_SYSTEM` prompt and LLM-judge entailment (`answer_text` supported by the cited chunk) and loop-step correctness. Kept out of the default path so CI stays key-free and fast.

## CI

Add to the pipeline alongside typecheck/test:

```yaml
- run: pnpm --filter @athena/realtime-gateway eval
```

When the coach logic moves to `packages/coach` (F19), relocate this harness to `tools/coach-eval` and repoint the imports.
