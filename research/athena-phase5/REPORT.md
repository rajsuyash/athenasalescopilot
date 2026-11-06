# Athena phase 5 — direct, concise reactive coaching

2026-11-06. Local implementation; no deployment. This phase changes three source/test files and adds this report plus `results.json`.

## Changes

- `coach-prompt.ts`: information requests override objection reframing and open episodes. Explicit capability limitations get direct answers; missing evidence means silence. The shortened prompt retains all nine objection archetypes and the loop, with one spoken field, a 12-word target, an 18-word maximum and short nonspoken rationale.
- `coach.ts`: failed, cancelled, invalid or truncated model results no longer quote the first sentence of a retrieved chunk. No model means silence on the generated path. Complete reactive output must have one nonempty spoken field within 18 words; it is suppressed rather than truncated if it fails. Actual objections retain existing instant templates.
- Information questions may produce an answer or silence, not a coaching reframe. Answers require an explicit source ID from the retrieved chunks; the gateway no longer invents a citation by attaching the top chunk. Preview emission waits for complete spoken fields, a permitted type and valid source IDs, then emits once. The same type/source/length guards apply to final output.
- `coach.test.ts`: the real reactive entry point is exercised with stubbed retrieval/model/persistence for provider error, cancellation, malformed JSON, token limit, overlong/two-field output, 18-word boundary, escaped strings, malformed escapes, late failure after a preview, absent model, missing/invalid citations, and a question mislabelled as coaching. No retries or extra model calls were added.

Word count splits whitespace and counts tokens containing a Unicode letter or digit; punctuation-only tokens are ignored. This is a practical English speech-length bound, not a language-independent linguistic tokenizer.

## Evaluation method

The final source revision is rerun through the unchanged phase 4 benchmark: 24 sessions / 30 synthetic utterances; real Deepgram Nova-3, OpenAI embeddings, local PostgreSQL/pgvector and Haiku 4.5; real gateway and extension message/rendering code with VM Chrome API adapters and Chromium DOM observations. See [phase 4 methodology](../athena-phase4/REPORT.md). This excludes real Meet capture and production transport.

Phase 4 raw evidence is preserved byte-for-byte; its SHA-256 and the final source hashes are recorded in phase 5 `results.json`. The benchmark's fixed output path was temporarily used under a launcher that restores the original phase 4 file in `finally`; final phase 5 results are separate. Intermediate phase 5 timing runs are excluded after source changes.

Additional regression prompts exposed an uncited offline-capability inference. The model explicitly returned no source IDs, but the previous gateway attached the top chunk automatically. This finding motivated the new explicit-source guards. The initial probes are retained under `excludedCalibration` and are not counted as final measurements or held-out validation. Once used for a correction, those prompts are regression cases rather than held-out cases.

## Final results

| Measurement from end of synthetic speech | Phase 4 | Phase 5 |
| --- | ---: | ---: |
| Generated complete primary line, median | 3,252 ms (n=17) | 3,627 ms (n=18) |
| Generated committed card, median | 5,241 ms (n=17) | 4,114 ms (n=18) |
| Generated committed card, maximum | 7,919 ms | 5,060 ms |
| Instant template, median | 868 ms (n=6) | 893 ms (n=6) |
| Fallback output | 1 irrelevant answer | 0 |

Committed completion was 1,127 ms (21.5%) lower, while first complete line was 375 ms (11.5%) higher. Waiting for explicit citations changes preview eligibility; these sequential runs also include provider/network variation, so neither difference is a controlled causal estimate. **The one-second generated-line target is not met.** Phase 4 excludes one failed generation from its n=17 generated timing distribution; phase 5 has 18 successful generated answers, so these are not matched success-only pairs.

For successful model calls, median input/output tokens changed from 3,062/240 to 1,764/144; model duration from 3,561 to 2,394 ms. Phase 5 median STT delay was 752 ms, embedding 868 ms and raw model TTFT 1,173 ms. Raw TTFT is not visible-line latency.

Manual assistant review of every recognized transcript and response against the synthetic knowledge fixtures found:

- Pricing questions: direct price/inclusions answers 3/3, versus objection reframes 3/3 previously.
- HIPAA/BAA questions: explicit lack of support 3/3; no unrelated fallback.
- Generated spoken lines: 18/18 within 18 words and one spoken field. Previously 6/17 primary lines exceeded 18 words and some cards also had a follow-up.
- Implementation and EU-residency answers remained relevant, including concern changes. Some answers still add a supported SOC 2 fact that was not requested.
- Benign turns: silence 3/3. Interrupted stale generations were cancelled in all three trials; their replacement answers displayed. No browser or gateway errors were recorded.

Six additional text-input regression probes on the final source passed assistant review: month-to-month price $1,450; Pipedrive explicitly unsupported; HIPAA explicitly unavailable; no discounts; silence for undocumented offline capability; a genuine budget objection retains its instant coaching question. These use real retrieval/model/persistence but exclude STT/browser and are stored separately under `regressionProbes`. They are regression cases, not held-out or human-rated quality evidence.

Verification: gateway tests **70/70**, gateway and extension typechecks, Prettier on the three changed source/test files, and `git diff --check` passed. No executable project ESLint check is configured (root lint is a placeholder). Final source hashes and the unchanged phase 4 baseline hash were checked against `results.json`.

Reproduction uses the unchanged `services/realtime-gateway/eval/phase4.mjs` and `phase4-summary.mjs`, three repeats, the model recorded in results, an isolated local `athena_phase4_eval` database and scoped provider credentials. The runner writes to the phase 4 path: back up that file byte-for-byte, run and summarize, copy the result to a new destination, and restore the original in `finally`, verifying its hash. Do not overwrite the preserved baseline with a new experiment. Database setup and the full harness prerequisites are documented in the phase 4 report.

## Limits and next step

These changes enforce the **in-process reactive** coaching path. The separate orchestrator and proactive generator were not changed. Strict rejection can produce silence when a useful answer is too long; it never cuts a sentence mid-negation or invents a fallback.

An explicit retrieved citation proves source membership, not semantic entailment. A model can still misinterpret a cited chunk. Previews pass type/source/length guards before final confidence, duplicate and full-schema checks; a preview may be retracted after a later provider failure. These changes do not make provisional text universally verified.

No production deployment, real-call capture test or sales-rep acceptance testing was performed. Small sequential samples do not establish production percentiles or isolate provider/network variance. Any first-line latency target must be tested separately from committed-card completion.
