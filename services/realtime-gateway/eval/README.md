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

## The baseline finding (why the gate is 40%, not 80%)

Current **EN recall is ~45%** — the English regex gate misses more than half of realistic objections. Single-signal turns (e.g. _"I'll have to run this by my boss"_, _"you're being pushy"_, _"now isn't a good time"_) score ~0.30 and fall under the 0.35 threshold. This is the **A4** weakness quantified.

So the gate is a **characterization baseline** (40%, just under current) — it locks in today's behavior and fails on a _regression_, while the report prints the real number and the exact misses. **Target is 80%**, reached when **F20** (semantic intent classifier) replaces regex-only gating. Ratchet `EN_RECALL_GATE` up as F20 lands.

French recall (~10%) is reported for information only — the regex is English-only (also F20).

## Extending

- **Add fixtures:** drop real anonymized objection turns into `fixtures/objections.json`, or scripted episodes into `fixtures/episodes.json`. More coverage = a tighter gate.
- **Live LLM judge (not in v1):** a `--live` mode gated on `ANTHROPIC_API_KEY` can run each fixture through the real `SUGGEST_SYSTEM` prompt and LLM-judge entailment (`answer_text` supported by the cited chunk) and loop-step correctness. Kept out of the default path so CI stays key-free and fast.

## CI

Add to the pipeline alongside typecheck/test:

```yaml
- run: pnpm --filter @athena/realtime-gateway eval
```

When the coach logic moves to `packages/coach` (F19), relocate this harness to `tools/coach-eval` and repoint the imports.
