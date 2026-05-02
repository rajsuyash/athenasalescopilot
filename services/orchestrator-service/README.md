# orchestrator-service

Stages A (intent) + C (grounded answer). PRD F4, F5.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @athena/db prisma:migrate:dev --name init
psql "$DATABASE_URL" -f packages/db/prisma/migrations/manual/01_pgvector_chunk_embedding.sql
cp services/orchestrator-service/.env.example services/orchestrator-service/.env
pnpm --filter @athena/orchestrator-service dev
```

Listens on `http://localhost:4020`.

## Routes

| Method | Path                          | Auth | Notes |
| ------ | ----------------------------- | ---- | ----- |
| GET    | /healthz                      | —    | shows whether an LLM is configured |
| POST   | /v1/orchestrator/suggest      | required | full classify → retrieve → generate one-shot |

## Pipeline

1. `classifyIntent` (Stage A) — LLM-first, heuristic fallback. Returns
   `categories`, `stage_signal`, `urgency_score`, `confidence`.
2. If urgency < threshold → suppressed `coach` (display=false).
3. Hybrid retrieval (`pgvector` + trigram), workspace-scoped, optionally
   category-scoped from the dominant intent category.
4. `suggest` (Stage C) — LLM-first with strict JSON schema; heuristic
   fallback (top chunk, first sentence) when LLM is missing or schema fails.
5. Hard gate: source_chunk_ids must be a subset of retrieved IDs (PRD F5
   error case "hallucinated source"). Violation → suppressed coach.
6. Persist as a `suggestions` row when `meetingId` is provided.

## Latency

- Stage A deadline: 1 s
- Stage C deadline: 3 s
- Combined budget: 2 s P95 from turn-end (PRD §7)


Turn segmentation, intent detection, retrieval, grounded generation. PRD F4, F5.

## Pipeline

1. Subscribe to `transcript.final.received`.
2. Segment into turns (silence ≥500 ms + punctuation + STT finalization).
3. Stage A — intent classifier → emit `intent.detected`.
4. If `urgency_score ≥ workspace.urgency_threshold` → run hybrid retrieval (semantic + keyword) over `knowledge_chunks` filtered by `workspace_id` + active script version + persona/language.
5. Stage C — grounded generator → emit `suggestion.generated`.
6. Reject suggestions whose `source_chunk_ids` are not in the retrieval result set (hallucinated source).
7. Ranker suppresses redundant suggestions within a 10 s window.

## Latency budget

`suggestion.generated` ≤2000 ms P95 from turn-end.
