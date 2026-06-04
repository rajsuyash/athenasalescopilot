# Proactive BMC Pre-Generation: Probing/Pitching Scripts + Objection→Solution Matrix

> Design plan produced 2026-06-04 via multi-agent workflow (3 design perspectives → 2 adversarial reviews → synthesis), grounded against PRD F5/F10/F7 + the cost directive.

## 1. Context

The workspace BMC (`WorkspaceBmc`, 10 sections) already drives two things, but both are incomplete for the "instant coaching" goal. **Scripts exist but are manual**: `generateScriptFromBmc()` (`services/knowledge-service/src/modules/bmc/generator.ts`) produces SLOSHED probing + 5-step pitching as published `ScriptStageBlock`s served live at score 0.95, but only fires from the manual `POST /v1/playbooks/script/generate-from-bmc` endpoint. **A BMC-specific objection→solution matrix does not exist at all**: today the only objection content is the generic Andres framework seeded identically into every workspace (`seed-workspace.ts`), so a live objection is answered by general reframe docs + a live LLM call, not a pre-baked answer tailored to *this* business's pricing/problem/USP. Gap: make script generation **proactive** (auto-fire on BMC completion) and **add a grounded, BMC-derived objection matrix**, both stored so the **existing** live retrieval/script-block path serves them with near-zero added latency.

## 2. Decision summary

| Fork | Decision | Reason |
|---|---|---|
| New microservice vs extend | **Extend `knowledge-service`** | Already owns `getBmc`, `ingestDocument`, script gen, BMC indexer, audit, LLM/embeddings DI. New service = duplication + a hop for zero isolation gain. |
| Matrix storage | **`KnowledgeDocument`, category `objection-handling-matrix`** (no new table) | Orchestrator objection two-pass filters pass-1 on `categoryPrefix='objection-handling-'` → served objection-first with zero orchestrator change. |
| Script storage | **Reuse `ScriptCollection`/`ScriptVersion`/`ScriptStageBlock`** | Already served at 0.95 by orchestrator + gateway; no new serve path. |
| Generation skill | **Reuse `objection-reframer.skill` + code-built JSON addendum** (no new bundle) | Batch contract belongs in the user prompt + output-format addendum, like `generator.ts buildSystemPrompt()` pins headings. |
| Trigger | **Fire-and-forget from the 3 BMC-completion route points; completeness-transition guard** | `saveBmc` runs 10×/interactive build; route layer fires once when BMC actually becomes complete. |
| Idempotency / invalidation | **Singleton auto-generated `ScriptCollection` per workspace + `sourceBmcVersion` column** | Republish into one stable collection; short-circuit if already generated for this `bmcVersion`. Avoids multi-collection serving corruption. |
| Redis warming / cross-service invalidation | **No** | In-process 25s-TTL cache + pgvector already meet F7. Pub/sub fan-out is the cost trap all reviews flagged. |
| Status model + admin polling UI | **Cut for v1** | Gold-plating for a background job; the manual endpoint is the retry button. |

## 3. Architecture

```
routes.ts (import / PUT / build-done)
  └─ await safeIndex(...)                         # existing; rotates bmc-* chunk IDs FIRST
  └─ void runPlaybookGen({workspaceId, actorUserId, bmcVersion})   # fire-and-forget
        ├─ short-circuit if auto-collection.sourceBmcVersion === bmcVersion   (idempotency)
        ├─ generateScriptFromBmc(...)  → upsert SINGLETON auto-collection, bump version  (Phase 1)
        └─ generateObjectionMatrixFromBmc(...)                                            (Phase 2)
              ├─ buildAllowlist(workspaceId, bmc)   # ONE embed of probe, reused
              ├─ llm.complete({schema})  loadSkill('objection-reframer') + JSON addendum
              ├─ enforceGrounding(parsed, allowlist)  # drop entry if 0 valid IDs; abort if >50% dropped
              └─ indexObjectionMatrix(...)  # archive-prior + ingest survivors as objection-handling-matrix docs
```

**Live serve (UNCHANGED code — verified):**
- **Scripts:** orchestrator `lib/scripts.ts` + gateway `lib/coach.ts:333` both query `scriptCollection.findMany({ where: { workspaceId, currentVersionId: { not: null } } })`, emit blocks at 0.95. Singleton collection ⇒ exactly one auto-collection served.
- **Matrix in orchestrator:** `suggest/service.ts:140` pass-1 `categoryPrefix='objection-handling-'` topK3 + pass-2 unrestricted topK3, objection-first. `objection-handling-matrix` matches → served objection-first, zero change.
- **Matrix in gateway (CAVEAT):** `coach.ts retrieve()` (line 172) takes `category` but **discards it (`void category;`)**, single hybrid pass `LIMIT 3`. **No objection-prefix two-pass in the gateway.** Matrix docs still surface via standard semantic + trigram (same path as every chunk, zero added latency) but get **no objection-first priority** there. Gateway objection-first priority = separate follow-up (add prefix pass to `coach.ts retrieve`), out of v1 scope.

**Files:**
- **NEW** `services/knowledge-service/src/modules/bmc/matrix-generator.ts` — `generateObjectionMatrixFromBmc()`, `buildAllowlist()`, `enforceGrounding()`, `clampWords()`.
- **NEW** `services/knowledge-service/src/modules/bmc/matrix-indexer.ts` — `indexObjectionMatrix()`, `renderEntryMd()`, `archivePriorMatrixDocs()`.
- **MODIFY** `generator.ts` — singleton auto-collection upsert; set `isAutoGenerated`/`sourceBmcVersion`; mid-flight `WorkspaceBmc.version` re-check before publish tx.
- **MODIFY** `routes.ts` — `runPlaybookGen()` orchestrator + fire-and-forget from 3 completion points; keep manual endpoint as retry.
- **MODIFY** `packages/db/prisma/schema.prisma` — 2 columns on `ScriptCollection`.
- **REUSE (no edit)** `objection-reframer` skill; `ingestDocument`/`archivePriorBmcDocs` in `indexer.ts`; orchestrator F5 allowlist (`suggest/service.ts:196-197`).

## 4. Objection-matrix design

```ts
const MatrixEntrySchema = z.object({
  archetype: z.enum(['price','stall','authority','comparison','time',
                     'skepticism','self_doubt','resistance','avoidance']),
  bmcTheme: z.enum(['pricing','problem_doubt','authority','comparison',
                    'time','skepticism','delivery','generic']),
  triggerPhrases: z.array(z.string().min(3)).min(2).max(6),  // verbatim → trigram fuel
  objectionText: z.string().min(8),
  reframeSteps: z.object({                                    // 7-step loop
    disarm: z.string(), isolate: z.string(), uncover: z.string(),
    reframe: z.string(), justify: z.string(), consequence: z.string(),
    identityClose: z.string(),
  }),
  suggestedLine: z.string().min(8),     // ≤30 words enforced post-parse
  sourceChunkIds: z.array(z.string()).min(1),
});
const MatrixSchema = z.object({ entries: z.array(MatrixEntrySchema).min(6).max(15) });
```

**BMC-section → archetype derivation:** pricing→price+stall; problem/usp→skepticism+self_doubt; mvp/delivery→time+avoidance; niche/message→authority+comparison. Reframes use BMC's actual numbers.

**Prompt:** system = `loadSkill('objection-reframer')` + code-built batch addendum ("from this BMC, enumerate the objections THIS business faces, one Socratic reframe each, strict JSON, cite ONLY ids in ALLOWED_SOURCE_IDS, ≥1 per entry, never invent ids"). User = BMC JSON + allowlist block. `llm.complete({ schema, temperature: 0.3, deadlineMs: 90_000 })`, provider-abstracted, Anthropic ephemeral cache on system prompt.

**F5 grounding-validation contract:**
1. **Allowlist (one embed, reused):** embed `probe = [problem, usp, pricing, mechanism].join('\n')` once; reuse across one unrestricted `retrieveChunks` (topK ~20) filtered in-memory to `objection-handling-*` + `bmc-*`. Cap ~40 chunks. `workspaceId` first on all calls.
2. **Enforcement (clone of `suggest/service.ts:196-197`):** `allowed = Set(allowlist ids)`; per entry `validIds = sourceChunkIds.filter(id => allowed.has(id))`.
3. **On failure:**
   - Zero valid IDs → **DROP** (a pre-baked ungrounded entry is a *permanent* poisoned source — worse than a live one-off; no latency pressure ⇒ "if not grounded, it doesn't exist").
   - `suggestedLine` >30 words → **reject entry** (don't truncate mid-reframe).
   - **>50% dropped** → **abort run**, audit `precall.matrix_generation_failed reason=low_grounding_yield`, **leave prior matrix in place**.
   - Empty after filter → 502, never persist.
4. **Provenance:** survivors persist as `objection-handling-matrix` docs; original grounding IDs in `tagsJson.groundedOnChunkIds` (provenance only). At serve time the matrix chunk has its **own** UUID which the live LLM cites; that UUID is in the live retrieval set → passes live F5 naturally.
5. **Residual (accepted v1):** F5 validates cited **IDs**, not reframe **prose**. Full prose-grounding deferred (Open Q1).

**Indexing:** `archivePriorMatrixDocs(workspaceId)` (soft-delete, `where: { workspaceId, category }` first) → `ingestDocument` survivors, bounded concurrency ≤5 (well within ≤60s F7). `renderEntryMd` puts `triggerPhrases` verbatim in body for trigram. Audit `precall.matrix_generated { bmcVersion, entryCount, droppedEntries, archetypes, groundingYield }` in-tx.

## 5. Grounding & tenant guarantees

**F5:** matrix LLM cites only allowlisted real IDs; hallucinated IDs stripped; entry with no surviving ID dropped, never persisted; >50% drop aborts + preserves prior; provenance retained; at serve time orchestrator allowlist still validates the live LLM's citations.

**F10:** every new read/write `workspace_id`-first — `getBmc`, `buildAllowlist` retrieval, `ingestDocument`, `archivePriorMatrixDocs` (`where: { workspaceId, category }`), singleton upsert (`where: { workspaceId, isAutoGenerated: true }`), audit row. No global cache keys (no Redis). Shared `objection-reframer` skill = static prompt text, no tenant data, safe to share.

**Append-only / soft-delete:** invalidation archives (never hard-deletes); audit rows created in-tx.

## 6. Phased rollout (≤5 files/phase)

**Phase 0 — Schema (1 file + migration).** `ScriptCollection`: `sourceBmcVersion Int? @map("source_bmc_version")`, `isAutoGenerated Boolean @default(false) @map("is_auto_generated")`. Migrate. *Verify:* `prisma validate` + typecheck.

**Phase 1 — Proactive scripts + singleton collection (≤3 files).** Modify `generator.ts` (singleton upsert `where: { workspaceId, isAutoGenerated: true }`, set new columns, mid-flight version re-check before publish tx). Modify `routes.ts` (`runPlaybookGen` skeleton, script-gen only; fire-and-forget from import/PUT/build-completion; gen failure must NOT fail BMC save). + trigger test. *Verify:* generator tests + "two runs ⇒ one served collection" + "stale bmcVersion aborts publish"; typecheck + lint.

**Phase 2 — Matrix generator + indexer, F5-critical (2 files + test).** `matrix-generator.ts` + `matrix-indexer.ts`. *Verify (mandatory):* fake source ID dropped; >50% drop aborts + leaves prior; >30-word line rejected; allowlist embeds probe exactly once. typecheck + lint.

**Phase 3 — Wire matrix into trigger + invalidation + serve proof (≤2 files).** Extend `runPlaybookGen` to call matrix gen **after** `safeIndex`; idempotency short-circuit on `sourceBmcVersion`; archive-prior on regen. *Verify:* integration — import BMC ⇒ published singleton auto-collection with `sourceBmcVersion` + matrix entry retrievable through **unchanged orchestrator** path; ingesting a matrix doc does **not** re-trigger gen (trigger keys strictly on `WorkspaceBmc` version, never KnowledgeDocument writes).

## 7. Verification plan

**Automated:** `pnpm -w typecheck`, `pnpm -w lint`, unit/integration tests above. F5 drop/abort + "single served auto-collection" are blocking gates.

**End-to-end manual:**
1. New workspace, complete a BMC (import or 10-step build).
2. Confirm one `isAutoGenerated` ScriptCollection (`currentVersionId` set, `sourceBmcVersion = bmc.version`) + N active `objection-handling-matrix` docs + audit rows.
3. Re-save same BMC → no new collection (idempotency), matrix not duplicated.
4. Edit a section (version bumps) → republished into same collection, prior matrix archived (not deleted), `precall.matrix_invalidated` audited.
5. Live call: transcript turn matching a matrix `triggerPhrase` (price objection) → orchestrator `suggest()` retrieves the pre-baked chunk objection-first; served `sourceChunkIds` reference it; P95 latency unchanged.
6. Latency check on orchestrator + gateway: ≤2000ms P95 intact.

## 8. Cost note

**One-time per BMC change:** 1 matrix LLM call (skill body ephemeral-cached ⇒ near-free after first; small output) + existing script-gen call + a few embeddings (one probe embed reused + per-entry ingest). ~a few cents per actual BMC change, triggered only on save/import — no cron, no all-workspace sweep. **Per-call live cost trends DOWN:** live LLM paraphrases an already-correct grounded answer vs reasoning from scratch, fewer low-confidence regenerations. **No new spend:** no service, no table, no bundle, no Redis/queue.

## 9. Open questions

1. **Prose-grounding depth (F5 strictness).** v1 validates cited IDs but not that the reframe *prose* is supported. Acceptable, or add a post-gen numeric/claim cross-check (price/outcome figures in `suggestedLine` must appear in a cited chunk) before persisting?
2. **Gateway objection-first priority.** `coach.ts retrieve()` discards `category`, no objection two-pass — matrix surfaces via plain semantic/trigram. Sufficient, or follow-up phase to mirror orchestrator in gateway?
3. **Interactive-build completion signal.** Trigger fires on the save that transitions BMC to "all 10 sections non-empty" (users fill out of order). Confirm `MIN_SECTION_LEN` threshold + that build endpoint exposes post-save full state.
4. **Status visibility.** v1 cuts the status model + admin polling UI. OK that admin-web shows no live "generating…/ready" indicator (manual regenerate endpoint remains as retry)?

---

**Net surface:** 2 new files + 3 modified + 2 Prisma columns + 1 reused skill. No new service, table, bundle, Redis, status model, or admin UI.
