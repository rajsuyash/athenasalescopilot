# knowledge-service

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @athena/db prisma:migrate:dev --name init
psql "$DATABASE_URL" -f packages/db/prisma/migrations/manual/01_pgvector_chunk_embedding.sql
cp services/api/.env.example services/knowledge-service/.env  # share secrets with api
pnpm --filter @athena/knowledge-service dev
```

Listens on `http://localhost:4010`.

## Routes (v1)

| Method | Path                         | Auth                | Notes                                   |
| ------ | ---------------------------- | ------------------- | --------------------------------------- |
| GET    | /healthz                     | —                   | liveness                                |
| POST   | /v1/knowledge/text           | `knowledge:upload`  | inline text/markdown ingestion          |
| POST   | /v1/knowledge/url            | `knowledge:upload`  | fetch + ingest a URL                    |
| POST   | /v1/knowledge/upload         | `knowledge:upload`  | multipart PDF/CSV/DOCX                  |
| GET    | /v1/knowledge/documents      | `knowledge:read`    | list workspace documents                |
| GET    | /v1/knowledge/search         | `knowledge:read`    | hybrid pgvector + trigram retrieval     |

## Pipeline

1. Extract text per format (`text`, `markdown`, `pdf`, `csv`, `url`).
2. SHA-256 of cleaned text → dedup check (workspace-scoped).
3. Sentence-aware chunker → ~500 token chunks with ~50 token overlap.
4. Embedding via `@athena/sdk-embeddings` (deterministic dev / OpenAI prod).
5. Insert chunks via raw SQL (vector column).
6. Update doc status `processing → indexed`; write `audit_logs` row.

## Tenant isolation

Every SQL path filters on `workspace_id` first. The retrieval query joins through the chunk's workspace and applies the predicate at the index. The `tenant-isolation-reviewer` agent re-verifies on every change.

Document ingestion, chunking, embedding, versioning, script publish. PRD F7.

## Responsibilities

- Accept uploads (PDF / DOCX / MD / TXT / CSV / URL) up to 50 MB.
- Extract → clean → chunk (~500 tokens, 50-token overlap) → embed → write `knowledge_documents`, `knowledge_document_versions`, `knowledge_chunks`.
- Detect duplicate content by hash.
- Manage `script_collections` and `script_versions` with optimistic locking on publish.
- Enforce visibility scopes (workspace / team / role) at chunk write time.

## Latency budget

50-page PDF queryable ≤60 s P95.
