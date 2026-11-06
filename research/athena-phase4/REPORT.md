# Athena phase 4 — synthetic live-provider benchmark

Date: 2026-11-06. Local branch with phases 1–3; no deployment or product prompt/model changes.

## Measurement boundary

The runner uses macOS Samantha TTS, validates nonempty PCM, trims trailing silence at an amplitude threshold of 300, and sends stereo 16 kHz PCM in real-time batches of at most 100 ms (customer channel 0; rep channel 1 silent). The speech-end timestamp is the scheduled end of that synthetic PCM, not an acoustic measurement. The last batch is sent after its scheduled capture interval.

Real components: Deepgram Nova-3; authenticated local gateway WebSocket and session handler; tenant-scoped local PostgreSQL/pgvector retrieval and persistence; OpenAI text-embedding-3-small with 256 dimensions; Anthropic claude-haiku-4-5-20251001; actual offscreen message handling, background scoped forwarding and content/panel rendering.

Test adapters: offscreen and background run in Node VM with mocked Chrome runtime/storage/tab APIs; actual content script runs in Chromium on an intercepted synthetic Meet page. Chromium delivery crosses Playwright IPC. Two animation-frame acknowledgements observe DOM text independently of forwarding; unstable acknowledgements are excluded. This is **not** a packaged-extension Chrome service-worker, Google Meet audio-capture, physical screen-paint or production-network benchmark. No customer call data was used.

The database was created specifically for this phase. Five synthetic approved documents describe pricing, security, implementation, integrations and objection handling. The normal application database credentials failed locally, so they were not modified. Existing alternative provider credentials were read in-process from their stores after successful capability probes; none were copied into project files. The gateway `.env` has stale Anthropic/OpenAI keys and names Nova-2; this run explicitly selects Nova-3 and the stated Haiku model. Production configuration was not verified.

## Corpus and definitions

Eight scenarios, each repeated three times: clear price objection, direct price question, implementation question, EU residency question, unsupported HIPAA/BAA request, benign screen-sharing acknowledgement, price-to-security concern change, and interruption by a new security question. Thirty audio utterances in 24 sessions. This is a small diagnostic set, not a representative sales-quality estimate or held-out model-selection test.

- **First complete primary line:** first stable browser-frame observation containing the complete `answerText` (or `followupText` when no answer) eventually committed for that generation. It can be provisional and does not mean its content is relevant or approved before final validation. It excludes cancelled-generation text.
- **Committed card:** stable browser-frame observation of the final generated event containing that line.
- **STT delay:** final transcript arrival at the gateway client minus scheduled synthetic speech end.
- **Boundary/start:** generation-start arrival minus final transcript arrival; includes the settle timer, local persistence/scheduling and socket delivery, not a pure CPU measurement.
- **Retrieval:** existing gateway telemetry around parallel retrieval, script and business-context work. Includes embedding time; do not add the two as independent stages.
- **Raw TTFT:** first SDK text delta minus model-call start; often JSON syntax, not speakable text.
- **Interruption:** first generation ends without a final; second starts; first coach reports AbortError before benchmark stop; no COACH_FAILED. The first provider can settle after the second starts without blocking it.

Percentiles use nearest rank. With fewer than 20 responses per category, empirical p95 is usually the maximum and is not an SLA estimate. Failures, silence and cancellation are retained; they are not zero-millisecond successful responses.

## Results

The corrected run completed **24 sessions / 30 audio utterances**, with 30 final transcripts. It produced 6 instant templates, 17 completed model responses, 1 timeout fallback, 3 deliberately suppressed benign turns and 3 superseded generations. No gateway error frames or browser exceptions occurred. These are diagnostic outcomes, not a production release pass.

| Measured interval | n | Median | Empirical p95 / maximum |
|---|---:|---:|---:|
| Speech end → complete primary template | 6 | 0.868 s | 1.019 s |
| Speech end → complete primary model line | 17 | 3.252 s | 3.954 s |
| Speech end → committed model card | 17 | 5.241 s | 7.919 s |
| Speech end → timeout fallback | 1 | 9.818 s | 9.818 s |
| Speech end → STT final, non-superseded turns | 27 | 0.731 s | 0.950 s / 1.122 s |
| STT final → generation start | 27 | 0.113 s | 0.119 s / 0.124 s |
| Query embedding | 21 | 0.866 s | 1.087 s / 1.163 s |
| Retrieval group, including embedding | 21 | 0.869 s | 1.089 s / 1.164 s |
| Model call → first raw text delta | 19 | 1.080 s | 1.572 s |

Seventeen model calls completed with parsed output. Four returned cancelled: three supersessions and one 8-second model deadline. Cache-read tokens were zero in all 17 completed calls; cancelled calls did not return usage. No cache speedup is evidenced. The embedding call accounts for nearly all measured local retrieval time; database optimization alone would not remove that remote round trip. Stage medians are different populations and must not be summed as an exact end-to-end decomposition.

### Response quality — assistant review against the predeclared expectations

The evaluator reviewed the transcripts, complete lines, follow-ups, rationales and supplied synthetic documents. This is an assistant assessment, not independent sales-rep or human scoring. Formatting punctuation and `$1,200` normalization aside, the recognized customer turns preserve the intended questions and objections. No recognition mismatch explains the failures below.

| Scenario | Outcome across 3 repetitions |
|---|---|
| Price objection | 3/3 relevant generic isolate templates, 17 words; still lacks a buyer-specific goal |
| Direct price question | **0/3 directly answered**. All three reframe it as an objection: “Compared to what, can I ask?” The supplied seats/onboarding facts were not used to explain the price |
| Implementation | 3/3 accurate ten-business-day answers; primary line 15 words, with a separate additional follow-up |
| EU residency | 3/3 accurate; one primary line exceeds the prompt's 18-word cap; follow-ups add reading burden |
| Unsupported HIPAA/BAA | 2/3 explicitly say unavailable, but take 35 and 37 words. **1/3 timeout fallback gives only “The product is SOC 2 Type II certified.”** This is true but does not answer the compliance question |
| Benign acknowledgement | 3/3 stay silent |
| Price → security concern | 3/3 second answers address EU residency instead of advancing the price template |
| Interruption | 3/3 first generations cancelled; all three latest security answers delivered. No old-generation streaming frames after the replacement start |

**Six of 17 completed model primary lines exceed 18 words**, even before counting separate follow-ups. The factual claims inspected are supported by the supplied synthetic documents, but grounding alone is insufficient: the timeout fallback is a concrete example of a sourced yet irrelevant answer. The price-question failure persists after phase 1's routing fix because the generation prompt still pushes objection reframing. Do not score fast or cited text as automatically useful.

### Next bounded implementation phase

1. Make a genuine information question override the objection-reframing instructions, including price questions. Retain the existing fast template for actual objections. Add contrast-pair evaluations before tuning models.
2. Replace arbitrary first-sentence chunk fallback with an honest unavailable/verification response or silence when the request cannot be answered safely. Test model timeout and provider failure on the HIPAA fixture.
3. Make the spoken output concise and shorten nonspoken rationale/metadata. The complete visible line precedes final commitment by roughly two seconds in typical model responses; a smaller final payload is a testable latency hypothesis, not a measured speedup yet.

Then rerun this corpus and add held-out procurement, refusal, multilingual and multi-party cases. Investigate embedding latency and safe tenant/version-scoped reuse separately. Do not pad the prompt just to activate caching or copy Parakeet's three-second silence wait. Do not change the 110 ms settle timer first: it is a small measured share of the current generated-response delay.

## Verification and limits

Gateway tests: 69/69. Extension tests: 22/22. Both package typechecks pass; runner/summary syntax checks and summary evidence assertions pass. Deterministic evaluator: EN recall 50/50, FR recall 10/10, benign non-objection classification 21/21, episode transitions 10/10. Those classifier counts do not establish answer relevance. Root lint is an echo placeholder; no executable ESLint configuration is available. Benchmark scripts receive Prettier checks.

No production deployment, live Google Meet capture test, provider/model comparison or sales-rep validation was performed. This run does not establish production p95, noisy-call STT performance or a before/after speedup from phases 1–3. Provisional model text still appears before final confidence/citation validation. Baseline results and all raw evidence are in `results.json`; neither pilot run is included.

The reviewer independently recomputed the final counts and timing statistics from raw evidence. Source SHA-256 hashes are retained in `results.json`. The disposable `athena_phase4_eval` database was removed after collection and its absence verified; synthetic evidence remains in the repository artifacts. Existing application databases and credential files were not changed.

## Benchmark audit

Initial pilots were excluded. Review caught observer-induced backpressure (awaiting animation frames inside the serialized relay), cross-sample embedding attribution, and an interruption wait that could mistake an old cancellation event for completion of the new answer. The final run uses asynchronous frame observations, captured sample ownership, and matching-generation completion before stopping. Supersession is distinguished from benchmark shutdown and ordinary coach failure.

The older `eval/live-judge.ts` is not an end-to-end quality oracle: its no-judge mode fabricates positive verdicts even on a failed provider call, and its end-to-end numbers add fixed estimates to model timings. Its output was not used for this report. The deterministic classifier/state-machine evaluator remains useful but does not measure answer quality.

## Reproduction

From the repository root, create a disposable local database named `athena_phase4_eval`, apply `packages/db/prisma/schema.prisma` using Prisma db push, and install the Playwright Chromium binary if absent. The runner refuses a database URL outside `localhost/athena_phase4_eval`.

Run from `services/realtime-gateway`:

```sh
DATABASE_URL=postgresql://LOCAL_USER@localhost:5432/athena_phase4_eval \
EVAL_ANTHROPIC_ENV=/absolute/path/to/existing/provider.env \
EVAL_OPENAI_ENV=/absolute/path/to/existing/embedding.env \
EVAL_REPEATS=3 node --env-file=.env --import tsx eval/phase4.mjs
node eval/phase4-summary.mjs
```

`DEEPGRAM_API_KEY` comes from the gateway environment. The two scoped env paths are read only for their named API keys. Requires `say`, `ffmpeg`, local PostgreSQL with pgvector, and the repository's installed packages. Runs cost provider usage. Each run adds synthetic tenants to the disposable database and replaces the prior results artifact. Audio scratch files are removed on normal exit; the database is managed separately. Raw results contain only synthetic text, timestamps, model metadata and synthetic IDs.
