import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { vectorLiteral } from '../../lib/vector-sql.js';

export interface RetrieveInput {
  workspaceId: string;
  query: string;
  topK?: number;
  /** 0..1 cosine similarity threshold; below this, the chunk is dropped. */
  minScore?: number;
  category?: string;
  language?: string;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  documentVersionId: string;
  category: string | null;
  documentName: string | null;
  language: string;
}

interface ChunkRow {
  id: string;
  chunk_text: string;
  document_version_id: string;
  language: string;
  score: number;
  document_name: string | null;
  document_category: string | null;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.2;

export async function retrieveChunks(
  input: RetrieveInput,
  deps: { embeddings: EmbeddingClient },
): Promise<RetrievedChunk[]> {
  if (!input.workspaceId) throw new Error('workspaceId required');
  if (!input.query.trim()) return [];

  const topK = input.topK ?? DEFAULT_TOP_K;
  const minScore = input.minScore ?? DEFAULT_MIN_SCORE;

  const { vectors } = await deps.embeddings.embed({
    workspaceId: input.workspaceId,
    texts: [input.query],
  });
  const qVec = vectors[0];
  if (!qVec) return [];

  // Hybrid retrieval: cosine similarity (pgvector) + trigram on chunk_text.
  // We compute both signals in a single SQL call and take the combined score.
  // workspace_id filter is the FIRST predicate, applied at the index, per F10.
  const rows = await prisma.$queryRawUnsafe<ChunkRow[]>(
    `
    WITH semantic AS (
      SELECT
        kc.id,
        kc.chunk_text,
        kc.document_version_id,
        kc.language,
        1 - (kc.embedding <=> $1::vector) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND ($3::text IS NULL OR kc.language = $3)
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $4
    ),
    keyword AS (
      SELECT
        kc.id,
        similarity(kc.chunk_text, $5::text) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND kc.chunk_text % $5::text
      ORDER BY similarity(kc.chunk_text, $5::text) DESC
      LIMIT $4
    ),
    combined AS (
      SELECT id, score FROM semantic
      UNION ALL
      SELECT id, score * 0.5 AS score FROM keyword
    ),
    aggregated AS (
      SELECT id, MAX(score) AS score
      FROM combined
      GROUP BY id
    )
    SELECT
      kc.id,
      kc.chunk_text,
      kc.document_version_id,
      kc.language,
      a.score,
      kd.name AS document_name,
      kd.category AS document_category
    FROM aggregated a
    JOIN knowledge_chunks kc ON kc.id = a.id
    JOIN knowledge_document_versions kdv ON kdv.id = kc.document_version_id
    JOIN knowledge_documents kd ON kd.id = kdv.document_id
    WHERE kc.workspace_id = $2::uuid
      AND ($6::text IS NULL OR kd.category = $6)
    ORDER BY a.score DESC
    LIMIT $4
    `,
    vectorLiteral(qVec),
    input.workspaceId,
    input.language ?? null,
    topK,
    input.query,
    input.category ?? null,
  );

  return rows
    .filter((r) => r.score >= minScore)
    .map((r) => ({
      id: r.id,
      text: r.chunk_text,
      score: Number(r.score),
      documentVersionId: r.document_version_id,
      category: r.document_category,
      documentName: r.document_name,
      language: r.language,
    }));
}
