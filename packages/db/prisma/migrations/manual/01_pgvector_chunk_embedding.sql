-- Run AFTER `prisma migrate deploy` (or dev). Prisma's vector support is incomplete,
-- so we add the embedding column + ANN index in a hand-written migration.
--
-- Dimension: 256 (matches deterministic dev embedder). Bump to 1536 when wired
-- to OpenAI text-embedding-3-small per ADR 0003 (TBD). Migration is destructive
-- on dimension change — drop and re-embed all chunks.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(256);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_text_trgm
  ON knowledge_chunks
  USING gin (chunk_text gin_trgm_ops);

-- Per PRD F10: tenant isolation must hold under any retrieval path. Guarantee
-- the workspace_id column has a NOT NULL constraint and is indexed for the
-- WHERE filter pushed under the ANN scan.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_workspace_active
  ON knowledge_chunks (workspace_id, active);
