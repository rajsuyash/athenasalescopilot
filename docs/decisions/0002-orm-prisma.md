# 0002. ORM: Prisma + raw SQL escape hatch

- Status: accepted
- Date: 2026-04-27
- Deciders: Athena founding team
- PRD refs: F7, F10; §5 data model

## Context

Need a typed Postgres client that:

- generates types from the schema (we don't want to hand-maintain TS shapes alongside SQL),
- supports migrations,
- lets us drop to raw SQL for `pgvector` similarity queries (Prisma's vector support is limited),
- enforces the `workspace_id` invariant by convention or extension.

## Decision

Use **Prisma** as the primary ORM for `services/*`. Raw SQL via Prisma's `$queryRaw`/`$executeRaw` for `pgvector` retrieval and any query the planner doesn't generate well.

A shared Prisma extension (`packages/db/extensions/tenant-scope.ts`, future) wraps every model query, requires a `workspaceId` argument, and injects it into the `where` clause. Code that bypasses the extension is rejected by the `tenant-isolation-reviewer` agent + a CI lint rule.

## Consequences

Positive

- Schema-first migrations + generated types eliminate a class of drift bugs.
- Single source of truth for the data model lives in `packages/db/schema.prisma`.
- Tenant-scope extension makes F10 enforceable at the data layer rather than relying on every author.
- Studio + introspection accelerate ad-hoc inspection in dev.

Negative

- Prisma client adds a few MB to bundle size and a small per-call overhead vs `pg` directly. Acceptable for the API; the realtime gateway's hot path uses raw SQL where needed.
- pgvector ergonomics are weaker than `pg` + a hand-rolled query — we accept raw SQL for retrieval.
- Prisma's connection pool is per-process; we'll size it explicitly per service.

## Alternatives considered

- **Drizzle**: lighter, fully TS, no generation step. Rejected only because the team has more Prisma muscle memory and the migration story is less mature for our scale. Revisit at v2.
- **Kysely**: query builder with great types, but no migrations — would force us to bolt on `node-pg-migrate` or similar. Reject for v1.
- **TypeORM**: decorator-heavy, weaker types than Prisma. Reject.
- **Raw `pg` + zod**: fine for the realtime gateway hot path, too much hand-rolling for the API surface. Use as escape hatch only.

## References

- PRD §5 data model
- Prisma extensions docs: https://www.prisma.io/docs/orm/prisma-client/client-extensions
