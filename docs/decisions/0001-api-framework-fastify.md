# 0001. API framework: Fastify

- Status: accepted
- Date: 2026-04-27
- Deciders: Athena founding team (recorded by scaffold)
- PRD refs: F8, F10; §7 performance budgets

## Context

PRD §7 demands hard latency budgets on hot-path services (suggestion P95 ≤ 2 s, audit write ≤ 1 s, transcript ack ≤ 200 ms). The realtime gateway will use WebSockets, but the rest of the surface (auth, workspaces, RBAC, knowledge metadata, meetings, analytics) is conventional REST. We need a Node/TS framework that:

- handles many small JSON requests with low overhead,
- has first-class WebSocket and gRPC story (gateway shares the codebase),
- gives us a lightweight middleware/plugin model so the tenant-isolation hook is easy to enforce,
- doesn't force decorators or heavy DI on us before we know the shape of the domain.

Two realistic choices: NestJS or Fastify.

## Decision

Use **Fastify** for `services/api` and the realtime gateway. NestJS is rejected for v1.

## Consequences

Positive

- ~2–3× higher req/s than Express; lowest-overhead Node framework that still has a thriving plugin ecosystem.
- Native JSON Schema (and Zod via `fastify-type-provider-zod`) — request validation + OpenAPI generation come for free.
- `@fastify/websocket` lets the realtime gateway share auth + tenant middleware with REST.
- Plugin model is small: a single `requireWorkspaceContext` plugin enforces the F10 invariant on every route.
- No decorators / no reflection / no class-based DI — keeps cold start fast and code grep-able.

Negative

- Less batteries-included than NestJS; we wire DI ourselves (we will pick a small container or pass deps explicitly).
- Smaller TypeScript-first community than Nest; some Nest-ecosystem packages have no Fastify equivalent (acceptable — we don't need them).

Neutral

- Migrating to Nest later is mechanical (route handlers translate cleanly). Reverse migration is painful, so this is the lower-regret direction.

## Alternatives considered

- **NestJS**: opinionated, decorator-heavy, large surface. Strong for teams that want enforced structure, but the structure is itself a tax we don't need yet — and the decorator model fights with our preference for explicit DI. Cold-start and per-request overhead are higher than Fastify. Reject.
- **Express**: lowest learning curve but no first-class TS, no schema layer, slower than Fastify. Reject.
- **Hono / Elysia (Bun)**: faster on paper, but Bun adoption inside the org is not yet decided and the WebSocket / DB-driver story is less mature. Defer.

## References

- PRD §7 latency budgets
- `services/api/README.md`
- Fastify benchmarks: https://fastify.dev/benchmarks/
