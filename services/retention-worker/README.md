# retention-worker

Enforces workspace retention policies. PRD §7 + F11.

Soft-delete already happens in the api / knowledge service when an admin
deletes something. This worker is the **hard-delete** sweep: it scans every
workspace's `retention_policies` row and DELETEs rows past the configured TTL.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp services/retention-worker/.env.example services/retention-worker/.env
pnpm --filter @athena/retention-worker dev    # :4050
```

The background sweep starts 30 s after boot and repeats every
`SWEEP_INTERVAL_MS` (default 1 hour). Set to `0` to disable and rely only on
the manual trigger.

## Routes

| Method | Path                       | Auth                 | Notes                                              |
| ------ | -------------------------- | -------------------- | -------------------------------------------------- |
| GET    | /healthz                   | —                    | reports sweep enabled / interval                   |
| POST   | /v1/retention/enforce      | `retention:update`   | manual sweep for the caller's workspace            |

## What gets deleted

| Resource             | TTL source                       | Default | Notes                                                                |
| -------------------- | -------------------------------- | ------- | -------------------------------------------------------------------- |
| `transcript_segments`| `retention_policies.transcript_days` | 30 days | Joined to `meetings.started_at`. `0` disables (kept indefinitely).   |
| `meeting_summaries`  | `retention_policies.summary_days`    | 365 d   | Keyed on `created_at`. `0` disables.                                 |
| `audit_logs`         | `retention_policies.audit_days`      | 365 d   | Keyed on `created_at`. `0` disables. Required ≥ 365 for SOC 2.      |
| `knowledge_documents`| status=`archived` + `created_at` > 30d ago | n/a | Hard-deletes rows already soft-deleted via the knowledge service.    |

Each batch is bounded by `BATCH_SIZE` (default 1000) so the sweep never holds
long row locks. Across many workspaces the worker walks them sequentially —
add Redis-backed leader election before running multiple replicas.

## Audit

Every sweep writes a `retention.enforced` audit log row per workspace where
something was actually deleted, with counts and the policy snapshot.

## Tenant isolation

Every DELETE is keyed by `workspace_id` directly or via the row's parent
entity (`meeting.workspaceId` for transcript segments + summaries). The
service shares the same `JWT_ACCESS_SECRET` as the rest of the cluster so
the manual enforce endpoint reuses the standard RBAC layer.
