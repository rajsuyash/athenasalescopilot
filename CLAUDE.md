# CLAUDE.md — Athena

Project-level guidance for Claude Code agents working in this repo. Overrides defaults; read before any non-trivial change.

## Project shape

Multi-tenant SaaS sales copilot. macOS desktop app + cloud backend that listens to live Google Meet calls, detects customer questions and objections, and surfaces grounded suggestions to the rep in real time.

**Source of truth:** `docs/PRD.md` — every feature ID (F1–F16), data shape, and acceptance criterion lives there.

## Repository layout

```
apps/{desktop-macos,admin-web,chrome-extension}
services/{api,realtime-gateway,transcript-service,orchestrator-service,
          knowledge-service,analytics-service,integration-service,
          billing-service,postcall-service}
packages/{shared-types,ui,prompts,policies,sdk/{stt,llm,embeddings}}
infra/terraform
docs/{architecture,decisions,runbooks}
```

Each subdirectory has its own README. **Do not** create top-level utility folders (`utils/`, `helpers/`, `common/`) outside `packages/`.

## Hard rules (non-negotiable)

1. **Tenant isolation first.** Every domain table has `workspace_id`. Every query and cache key MUST be tenant-scoped. PR is rejected if a new query path lacks a `workspace_id` filter. See PRD F10.
2. **Provider abstraction.** STT, LLM, embedding providers are accessed only via `packages/sdk/{stt,llm,embeddings}`. No direct vendor SDK imports in services.
3. **Grounded outputs only.** Suggestion text must reference real chunk IDs from the retrieval result set. Reject hallucinated source IDs server-side (PRD F5 error case).
4. **No raw audio retention by default.** Workspace must opt in via `audio_retention=true`. Drop frames after STT processes them.
5. **Append-only audit log.** `audit_logs` rows are immutable. DELETE returns 405.
6. **Soft-delete by default.** Hard-delete only via retention enforcement jobs.
7. **Secrets via env or vault.** Never hardcode. Validate presence at service startup.

## Stack invariants

| Layer            | Choice                              |
| ---------------- | ----------------------------------- |
| Desktop          | Swift + SwiftUI (macOS 13+)         |
| Chrome extension | TypeScript + React + Manifest V3    |
| Admin web        | Next.js + TypeScript + React        |
| Backend          | TypeScript + NestJS or Fastify      |
| Realtime         | WebSockets (gRPC alt)               |
| Primary DB       | PostgreSQL                          |
| Vector           | pgvector (partitioned by workspace) |
| Cache / pub-sub  | Redis (tenant-prefixed keys)        |
| Object store     | S3 (per-tenant prefix)              |
| Auth             | JWT 15m access + 30d refresh        |
| Billing          | Stripe                              |
| Observability    | OpenTelemetry                       |

## Working agreements

- **Phased changes.** Touch ≤5 files per phase. Verify (typecheck, lint, tests) before next phase.
- **Re-read before edit.** Don't trust mental snapshots. Re-read the file you're about to change.
- **Multi-search renames.** Search direct refs, type defs, string literals, imports, exports, re-exports. Pattern matching only — no semantic awareness.
- **Senior-dev override.** Allowed to fix obvious architectural smells in the touched area. Do not silently preserve bad patterns just to minimize diff.
- **Tests are mandatory** before declaring "done": typecheck + lint + unit + integration where they exist. State explicitly when a tool is missing.
- **PRD is canon.** If implementation conflicts with PRD acceptance criteria, the PRD wins — flag the conflict, do not silently diverge.

## Latency budgets (PRD §7)

- Partial transcript: ≤800 ms P95 from speech receipt
- Suggestion published: ≤2000 ms P95 from turn-end
- Audit log write: ≤1 s
- Knowledge chunk indexing (50-page PDF): ≤60 s P95
- Admin dashboard FMR: <2 s

If you change a hot-path service, run a latency check before merge.

## Commit & PR style

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`
- One logical change per commit
- PR description includes: feature ID(s) from PRD, acceptance criteria touched, test plan
- Never `--no-verify`, never force-push to `main`

## Build order (PRD Appendix B)

Follow unless explicitly overridden:

1. Monorepo + shared types + auth + workspaces + RBAC (F8, F10)
2. Knowledge ingestion + retrieval (F7)
3. Realtime gateway + transcript persistence (F2 backend, F3)
4. Orchestrator with mocked STT (F4, F5)
5. Desktop overlay UI (F1, F2 client, F6)
6. Post-call jobs + analytics (F9, F12)
7. Audit surfaces + RBAC hardening (F11)
8. Billing + feature flags (F16)
9. Chrome extension (F15)
10. CRM integrations (F14)
11. Coaching workflows (F13)
12. Observability + load test + tenant-isolation pen-test

## When in doubt

- Architectural question → spawn `architect` agent
- Tenant-scoping question → re-read PRD F10
- Provider choice → see `docs/decisions/` ADRs; if no ADR, write one before implementing
- Naming or vocabulary → PRD §9 Glossary is authoritative
