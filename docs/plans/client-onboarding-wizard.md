# Plan: Client Onboarding Wizard (BMC → scripts → objection handling)

> Build-fresh plan. Authored 2026-06-05. Decisions locked: **Step 1 = guided Q&A,
> one question per BMC section** (uses the `bmc-builder` skill); execute in a
> fresh session.

## 1. Context

A new client/workspace today lands on `/dashboard` and sees `OnboardingBanner`
(two links: upload playbook, install extension). There is no guided setup. We
want a sequenced onboarding wizard for each new client:

- **Step 1** — answer setup questions → build their Business Model Canvas (BMC).
- **Step 2** — generate their **probing + pitching** script from the BMC.
- **Step 3** — generate their **objection-handling** matrix from the BMC.

## 2. What already exists (REUSE — do not rebuild)

Backend (`services/knowledge-service/src/modules/bmc/`):
- `POST /v1/playbooks/bmc/build` (SSE) — generates ONE BMC section from the
  user's freeform answer + prior sections, streams tokens, **persists** the
  section, returns `{ section, text, version }`. Driven by the `bmc-builder`
  skill. **This is the per-section Q&A engine** for Step 1.
- `GET /v1/playbooks/bmc` → `{ data: {<10 sections>}, version }`.
- `POST /v1/playbooks/script/generate-from-bmc` → probing+pitching script into
  the singleton auto `ScriptCollection` (idempotent). Returns `{ collectionId, blockCount }`.
- `generateObjectionMatrixFromBmc` + `indexObjectionMatrix` (`matrix-generator.ts`,
  `matrix-indexer.ts`) — already built; produce the grounded objection→solution
  matrix as `objection-handling-matrix` KnowledgeDocuments. Currently only
  invoked by `runPlaybookGen` (fire-and-forget on BMC completion).
- `runPlaybookGen` auto-fires scripts + matrix when the BMC becomes complete
  (all 10 sections filled). The wizard can rely on this OR trigger explicitly.

Admin-web (`apps/admin-web`, Next.js + Tailwind, no shadcn):
- `BmcUploader.tsx` — PDF import → extract → generate-script phase machine
  (pattern to mirror for the wizard).
- `lib/api.ts` `callBackend()` (JWT-forwarding server fetcher) + `forwardUpload()`.
- `Step` component (`app/install/page.tsx`) + `Shell`, Tailwind ink/accent theme.
- Pages: `/playbooks`, `/playbooks/bmc/upload`, `/scripts/[id]`.

## 3. The gap (what to build)

1. **No UI for the interactive BMC Q&A** (only PDF upload has UI).
2. **No wizard shell** sequencing the 3 steps with progress.
3. **No explicit objection-matrix endpoints** for a wizard to trigger + display
   (matrix is only produced by the fire-and-forget `runPlaybookGen`).
4. **No entry point** routing a fresh client into the wizard.

## 4. Architecture

```
/onboarding  (new route)
  └─ OnboardingWizard (client) — 3-step state machine + progress rail
       Step 1  BMC Q&A: for each of 10 sections in order →
                 show question → textarea answer → POST bmc/build →
                 show generated section → confirm/edit → next   (1/10 … 10/10)
       Step 2  Generate call script: POST script/generate-from-bmc →
                 show blockCount → link to /scripts/{collectionId}
       Step 3  Generate objection handling: POST objection-matrix/generate →
                 render entries (archetype · objection · suggested line)
       Done → /dashboard
```

Step state derives from `GET /v1/playbooks/bmc` (which sections are filled) so the
wizard is resumable — a client who drops off re-enters at the first empty section.

## 5. Files to add / modify

**Backend — `services/knowledge-service` (≤3 files):**
- MODIFY `src/modules/bmc/routes.ts`:
  - `POST /v1/playbooks/objection-matrix/generate` — calls
    `generateObjectionMatrixFromBmc` + `indexObjectionMatrix`, returns
    `{ entries: [...], dropped }`. (requires `script:edit` permission.)
  - `GET /v1/playbooks/objection-matrix` — reads current `objection-handling-matrix`
    docs for the workspace, returns the rendered entries for display.
  - Both are thin; reuse the existing generator/indexer + the
    `archivePriorMatrixDocs` pattern.

**Admin-web (≈6 files):**
- ADD `src/app/onboarding/page.tsx` — server component; reads `GET /v1/playbooks/bmc`
  to compute resume state, renders `<OnboardingWizard initial=… />`.
- ADD `src/components/OnboardingWizard.tsx` — client 3-step machine + progress rail
  (mirror `BmcUploader` phase pattern + the `Step` visual).
- ADD `src/components/onboarding/BmcQuestionStep.tsx` — the per-section Q&A loop.
- ADD `src/lib/onboarding-questions.ts` — the 10 section prompts (one per BMC
  section: passion, niche, problem, usp, mvp, mechanism, message, channel,
  pricing, delivery) with helper/example text.
- ADD `src/app/api/playbooks/bmc/build/route.ts` — proxy to the knowledge-service
  build endpoint (see SSE note below).
- ADD `src/app/api/playbooks/objection-matrix/generate/route.ts` (+ a GET read
  route) — proxy via `callBackend`.
- MODIFY `src/components/OnboardingBanner.tsx` (or `dashboard/page.tsx`) — add a
  prominent **"Start guided setup"** CTA → `/onboarding` for fresh workspaces.

**SSE proxy note (decide at build):** `bmc/build` is SSE. Two options:
- (A) **Simplest**: add a non-streaming JSON variant (or have the Next route
  collect the SSE and return the final `{ section, text, version }`). Wizard
  shows a per-section spinner. Lowest complexity — **recommended for v1**.
- (B) **Nicer UX**: stream the SSE through the Next API route
  (`new Response(upstream.body, { headers: text/event-stream })`) and render
  tokens live. More code; do later if desired.

## 6. Phased rollout (≤5 files/phase; verify each)

- **Phase 1 — backend objection-matrix endpoints.** Add the two routes; unit/
  integration test: generate returns ≥6 grounded entries; GET returns them;
  tenant-scoped. typecheck + knowledge-service tests green.
- **Phase 2 — wizard shell + Step 1 (BMC Q&A).** Route, wizard component,
  question list, bmc/build proxy (option A). Verify: walk all 10 sections →
  `GET /v1/playbooks/bmc` shows all filled; resume works.
- **Phase 3 — Steps 2 & 3 + entry point.** Script-generate + objection-matrix
  proxies + display; OnboardingBanner CTA; completion → dashboard.

## 7. Verification (end-to-end)

1. Fresh workspace → `/dashboard` shows "Start guided setup" → `/onboarding`.
2. Answer the 10 questions → each section persists (`GET /v1/playbooks/bmc`).
3. On completion, Step 2 generates a script (link opens `/scripts/{id}` with
   probing/pitching blocks); Step 3 shows the BMC-specific objection matrix.
4. Re-enter `/onboarding` mid-way → resumes at the first empty section.
5. Confirm `runPlaybookGen` doesn't double-generate (idempotent on `sourceBmcVersion`).
6. typecheck + lint + tests for both packages; `scripts/check-no-rogue-auth.sh` still green.

## 8. Open questions
1. **Entry enforcement** — hard-redirect fresh users to `/onboarding`, or keep it
   an optional CTA (recommended: optional CTA + banner, non-blocking)?
2. **SSE vs JSON** for Step 1 (recommend JSON/option A for v1).
3. **Objection-handling surface** — display the matrix inline in the wizard
   (recommended), and/or also expose a dedicated `/playbooks/objections` page?
4. **Question copy** — who writes the 10 section prompts/examples? (Draft from the
   `bmc-builder` skill's section guidance; product to refine.)
```
