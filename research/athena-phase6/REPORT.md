# Athena phase 6 — compact citations before safe preview

2026-11-06. Local implementation; not deployed.

## Change and boundary

The reactive model now cites short request-local references (`c1`, `c2`, …) instead of copying 36-character UUIDs. The gateway creates that map from the already-authorized retrieval result, validates each reference before preview, and resolves references to real chunk IDs before constructing sources or persisting a suggestion. No reference map is shared across calls or tenants. The external suggestion and database contracts remain unchanged.

This removes unnecessary generated tokens before preview eligibility and shortens the input prompt. The information-question directive now follows the retrieved evidence and requests at most 12 spoken words; the runtime ceiling remains 18 to preserve essential qualifiers. Capability answers are instructed to omit unrelated features or certifications. It adds no provider calls, cache, dependencies or speculative generation. Explicit citations, one complete spoken field, cancellation and final validation remain in force. The three implementation/test files are `coach.ts`, `coach-prompt.ts` and `coach.test.ts`; no clearly unused code was found in the touched block, and no structural cleanup was needed.

Regression tests exercise character-by-character streaming, unknown references, rejection of raw UUIDs, missing citations, two different retrieval results using `c1`, multiple references in reversed order, and conversion to real IDs in output and persistence. Existing failure, cancellation, length and question-precedence checks remain. The new prompt assertion failed against phase 5 before the implementation and passed afterward.

## Measurement

The unchanged phase 4 harness runs 24 sessions / 30 synthetic audio utterances with real Deepgram, OpenAI embeddings and Haiku 4.5, isolated local PostgreSQL, extension relay adapters and Chromium DOM observations. See [measurement definitions and reproduction](../athena-phase4/REPORT.md). Phase 5 is the immediate comparison; both older result files are preserved byte-for-byte. The full source and baseline hashes are recorded in `results.json`.

| Observed interval | Phase 5 | Phase 6 |
| --- | ---: | ---: |
| Speech end → complete primary generated line, median | 3,627 ms (n=18) | 3,177 ms (n=17) |
| Speech end → committed generated card, median | 4,114 ms (n=18) | 3,642 ms (n=17) |
| Speech end → instant template, median | 893 ms (n=6) | 825 ms (n=6) |
| Successful model call duration, median | 2,394 ms | 1,905 ms |
| Successful model input/output tokens, median | 1,764 / 144 | 1,733 / 117 |

The observed successful-response medians are lower by 450 ms for a complete line and 472 ms for commitment. **These are conditional timings, not a full-pipeline latency pass.** The run contains 29 final transcripts for 30 audio utterances. Implementation repeat 1 received no transcript before the runner stopped on a proactive `capture_start` completion. The runner's termination check in `eval/phase4.mjs` accepts the latest `suggestion.ended` without requiring a matching customer transcript/reactive generation. No provider error was reported, and the data cannot establish why STT had not arrived. The session is retained as incomplete and contributes no successful timing; it is neither zero latency nor successful silence. The harness needs that completion guard fixed before release acceptance.

For the same 17 scenario/repeat/input keys that completed in phase 6, the historical phase 5 medians were 3,639 ms complete-line and 4,201 ms committed. This coverage-matched subset still excludes the missing outcome and is not a randomized or causal comparison. STT median was 727 ms, embeddings 891 ms and raw model TTFT 1,067 ms in phase 6; these populations differ and their medians must not be summed as an exact decomposition. **The one-second generated-line target is not met.**

Assistant inspection against the synthetic knowledge fixtures found:

- All 17 completed generated responses have one spoken field, 9–14 words, and valid real source IDs. No fallback or length suppression occurred after a reactive generation in this final run.
- Pricing inclusions and HIPAA/BAA questions were answered directly in 3/3 repeats each. Implementation was answered correctly twice, with the third session incomplete as described above.
- EU residency and concern changes remained relevant; 3/3 benign turns were silent and 3/3 interruption checks passed. Some wording still adds details beyond the exact question, including when residency is chosen; this is not proof of perfect factual entailment.
- No browser exceptions or gateway error frames were recorded. Their absence does not negate the incomplete session.

Seven additional text-only live-model/retrieval regression probes are stored separately under `regressionProbes`: monthly price, Pipedrive, HIPAA, discounts, offline capability, genuine price objection, and a new combined price/implementation question. Expected factual/silence outcomes passed assistant review. The combined question returned $1,450 and ten business days with both real source IDs. The offline model still inferred a claim without a source; the gateway correctly suppressed it. The HIPAA text probe still appended a supported SOC 2 fact, so the narrower wording instruction is not universally obeyed. These probes are not part of the audio timing aggregate or independent human quality scoring.

Two calibration runs were rejected: the first lost 2/3 HIPAA responses to the word limit, and a system-only clarification lost 3/3. A separate text diagnostic showed the model prefacing the requested negative capability answer with SOC 2 and data-residency details. The final revision also moves the information-question directive after the evidence and requests at most 12 spoken words. Both full runs are retained under `excludedCalibration`, outside the final aggregates. Their success-only timing must not be presented as a speedup without accounting for the lost answers. The final comparison tests compact references plus prompt changes, and does not isolate reference length alone.

## Verification and limits

Gateway tests: 70/70; gateway typecheck, Prettier and `git diff --check` pass. Code review found no blocking source issues. Source hashes and both preserved baseline hashes match. Root lint is a placeholder, with no executable ESLint configuration. The change affects the in-process reactive coach only; proactive generation and the separate orchestrator are outside this phase.

Short references establish citation membership, not semantic entailment. Previews remain provisional until final validation. Benchmarks use synthetic post-capture audio and local transport, not real Meet capture or production networking. Small sequential runs cannot establish a causal latency improvement or production percentiles. No deployment or real-call acceptance test is claimed.
