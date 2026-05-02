/**
 * Helpers for the raw SQL paths that touch pgvector. Kept in one file so the
 * tenant-isolation reviewer can audit them in one read.
 *
 * INVARIANT (PRD F10): every query MUST filter on workspace_id, applied at the
 * index. Never accept workspace_id from the request body — always from the
 * authenticated JWT claim, propagated by the caller.
 */

export function vectorLiteral(v: readonly number[]): string {
  // pgvector accepts a string in `[a,b,c]` form. Coerce to plain numbers to
  // strip any NaN/Infinity that would let bad data poison the index.
  const safe = v.map((x) => {
    if (!Number.isFinite(x)) throw new Error('vector contains non-finite value');
    return Number(x);
  });
  return `[${safe.join(',')}]`;
}

export const SCHEMA_PREFIX = 'public';

/** SQL fragment used by knowledge_chunks creation/migration. Imported by migration. */
export const ADD_CHUNK_EMBEDDING_SQL = `
  ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS embedding vector(256);

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
    ON knowledge_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
`;
