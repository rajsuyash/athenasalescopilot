# Applying Parakeet lessons to Athena's Google Meet extension

2026-11-05. Scope: Chrome extension → realtime gateway → Meet overlay. The Swift client is outside this work.

## What the evidence supports

Parakeet's useful lessons are turn completion, explicit automatic/manual triggers, duplicate suppression, bounded reconnect buffering and cancellation of scheduled work. Its private backend prompt and upstream model routing were not recovered. Our one valid authenticated synthetic trial produced first answer-containing network text about 3.01 seconds after the Web Audio source ended, complete stream at 3.28 seconds. It does not prove Parakeet is faster than Athena. See `research/parakeetai-3.10.12/RUNTIME-FINDINGS.md` and `RECOVERED-CONTRACTS.md`.

Athena already separates tab audio/customer from microphone/rep, uses a 110 ms sentence-settle path with an 800 ms fallback, streams responses and has model-free objection templates. Preserve those advantages. Copying Parakeet's 3-second idle fallback into this path would add delay. The July measurements in ADR 0003 are historical; current deployed latency has not been measured in this phase.

## Phase 1: correct the fast-path routing

Four source/test files changed in `services/realtime-gateway/src/lib/`:

- `coach-openers.ts`: recognize bounded English/French question forms even without a question mark. Questions bypass canonical openers and steps. A detected different objection archetype also declines the previous instant step.
- `coach.ts`: use the same question check for urgency, bypass the urgency gate for recognized questions at any configured threshold, and request fresh grounding instead of reusing episode chunks for those questions. Pass the current archetype into instant-step selection.
- `coach-openers.test.ts` and `coach.test.ts`: reproduce the original bad routing and verify the corrected behavior, negative declarative examples, preserved fast objection templates and the real coaching entry point at urgency threshold 1 with stubbed retrieval.

Example: “Why is this so expensive?” previously returned a canned money-aside question. It now proceeds to the contextual answer path. “How does it work” previously could be suppressed for lack of punctuation; it now reaches retrieval. No approved evidence still yields silence. This changes routing, not a guarantee that the model's eventual answer is good.

No new provider, dependency, timer or model call was added to the existing clear-objection fast path. Questions previously suppressed or answered by templates can now incur retrieval/model latency and cost. That is deliberate: a fast irrelevant line is not a usable response.

Verification: new regression tests failed before the fixes and passed afterward. Full gateway test suite, gateway typecheck and changed-file Prettier check are the phase gates. Root lint is only an echo placeholder; no executable ESLint configuration exists. No deployment performed.

## Phase 2: cancellation and session ownership

Implemented locally after phase approval, in four source/test files plus this brief:

- `modules/session/handler.ts`: removed redundant in-flight boolean state. Each reactive/proactive run owns its own abort controller; only the current, non-aborted run can stream, publish, report errors or update facts/episode/recent-suggestion state. New complete buyer turns abort obsolete work. Stop and socket disconnect abort the active run, discard pending/buffered turns, and reject late transcript callbacks.
- `modules/session/abortable.ts`: cancellation releases the session queue without waiting for a noncooperative provider to finish. Late completion/rejection remains observed; abort listeners are removed.
- `lib/coach.ts`: checks cancellation before starting work, after embedding/context/model awaits, before continuing episode/suggestion persistence, and before forwarding model partials. Removed the now-unreachable cancelled-response branch.
- `modules/session/lifecycle.test.ts`: tests the abort boundary plus the real authenticated WebSocket handler with stubbed persistence and deliberately unresolved coaching promises. Covers proactive-to-reactive preemption, overlapping buyer turns, stale successful results/partials/facts/episode state, stop, dropped connection and late callbacks. A cancelled embedding result cannot initiate a database retrieval.

Verification: **69 gateway tests passed**, package TypeScript and changed-file Prettier checks passed; no working ESLint configuration. Review found no blocking issue. The test proves a newer turn starts while its predecessor remains unresolved; it is not a production latency percentile or a Google Meet paint measurement. No deployment performed.

Cancellation detaches waiting; it cannot forcibly terminate an uncooperative provider or guarantee billing/resource reclamation. A database write already started can still complete. Phase 2 prevents further stale server output; phase 3 below adds browser retraction.

## Phase 3: extension preview lifecycle

Completed locally on 2026-11-06 after approval. Gateway generation IDs and start/end events flow through offscreen, ordered background forwarding and the Meet overlay. Cancellation clears only its matching preview; completed cards survive. Stop/reconnect cleanup rejects obsolete socket/capture continuations. Three regression tests cover offscreen ownership, meeting-scoped forwarding and real Chromium rendering, including two committed cards plus a cancelled draft. Gateway 69 tests and extension 22 tests pass; both typechecks and production extension build pass. A rollback to an older unscoped gateway after scoped traffic requires a Meet-tab reload. Not deployed.

## Phase 4: synthetic live-provider measurement

Completed locally on 2026-11-06: 24 sessions / 30 synthetic audio utterances through real STT, embeddings, local PostgreSQL, gateway and extension forwarding/rendering code. Capture and Chrome runtime APIs were test adapters; this is not production Google Meet latency. See [the full benchmark report](../research/athena-phase4/REPORT.md) and raw `results.json` for methods, limits and individual outputs.

Median speech-end to complete visible primary text: templates 868 ms (n=6), generated responses 3252 ms (n=17); median committed generated card 5241 ms. One 8-second model deadline produced an irrelevant fallback at 9818 ms. All three price questions were incorrectly reframed by the model despite correct gateway routing. Six of 17 generated primary lines exceeded 18 words. All three benign turns stayed silent and all three interruption cases superseded the obsolete generation. No production deployment or before/after speedup claim.

## Remaining quality and latency work

| Priority | Current source finding | Next change and evidence needed |
|---|---|---|
| 1 | Phase 4: model reframes genuine price questions; timeout fallback can give sourced but irrelevant text; spoken lines exceed the word cap | Fix question precedence, honest timeout behavior and concise spoken output, then repeat the benchmark with held-out contrast pairs |
| 2 | Partial text reaches the overlay before final citation/confidence/dedup checks | Define safe provisional versus committed content; never expose unvalidated factual claims as approved advice; test invalid citations and late rejection in the extension |
| 3 | Current `turn_to_first_token` begins at final-transcript arrival and ends on raw model output; phase 4 adds synthetic browser observations | Extend measurement to actual packaged-extension capture and production transport; do not label synthetic DOM acknowledgements as physical screen paint |
| 4 | Canonical episode steps depend heavily on the previous step; declining one template does not replace old episode state or cached grounding | Conditional episode transitions for new concerns, real procurement, refusal and answered questions; grounded-answer and silence evaluations, not only regex tests |
| 5 | Prompt quality and provider latency have not been compared on a current held-out sales set | Run repeatable synthetic sales conversations through the deployed path; compare usable-line p50/p95 and human-reviewed quality with the current model before changing providers |

Next is a bounded question/fallback/conciseness phase driven by the measured failures. Obtain phase approval before expanding as required by AGENTS.md.

## Limits and rollout

Question recognition is a bounded text heuristic, not semantic understanding. It intentionally avoids declarative forms such as “What we need is…”; indirect questions and unsupported phrasing can still be missed. A changed concern now bypasses an instant step, but full episode replacement and cache invalidation remain pending. The separate orchestrator's legacy classifier was not changed; this patch targets the in-process gateway used by the extension, including its caption route.

Before release: validate representative sales transcripts, then run synthetic end-to-end sessions with verified capture and transcript delivery. Separate template and generated responses; report failures and sample size. Do not claim sub-second generated coaching from helper-test timing or one Parakeet trial. No live customer recordings are needed for this initial benchmark.
