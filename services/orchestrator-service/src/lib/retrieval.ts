/**
 * Local copy of the retrieval query so the orchestrator doesn't HTTP-hop to the
 * knowledge service on the hot path. Same SQL, same tenant invariant.
 *
 * If you change one, change both — they're audited together by the
 * `tenant-isolation-reviewer` agent.
 */
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';

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

function vectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => {
    if (!Number.isFinite(x)) throw new Error('non-finite vector value');
    return Number(x);
  }).join(',')}]`;
}

export interface RetrieveOpts {
  workspaceId: string;
  query: string;
  topK?: number;
  minScore?: number;
  category?: string;
  /**
   * Restrict to documents whose category starts with this string. Useful for
   * matching the four seeded objection-handling-* categories with one filter.
   * Mutually exclusive with `category`; when both set, `category` wins.
   */
  categoryPrefix?: string;
  language?: string;
}

export async function retrieve(
  opts: RetrieveOpts,
  deps: { embeddings: EmbeddingClient },
): Promise<RetrievedChunk[]> {
  if (!opts.workspaceId) throw new Error('workspaceId required');
  if (!opts.query.trim()) return [];
  const topK = opts.topK ?? 5;
  const minScore = opts.minScore ?? 0.2;

  const { vectors } = await deps.embeddings.embed({
    workspaceId: opts.workspaceId,
    texts: [opts.query],
  });
  const qVec = vectors[0];
  if (!qVec) return [];

  const rows = await prisma.$queryRawUnsafe<ChunkRow[]>(
    `
    WITH semantic AS (
      SELECT kc.id, kc.chunk_text, kc.document_version_id, kc.language,
             1 - (kc.embedding <=> $1::vector) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND ($3::text IS NULL OR kc.language = $3)
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $4
    ),
    keyword AS (
      SELECT kc.id, similarity(kc.chunk_text, $5::text) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND kc.chunk_text % $5::text
      ORDER BY similarity(kc.chunk_text, $5::text) DESC
      LIMIT $4
    ),
    combined AS (
      SELECT id, score FROM semantic
      UNION ALL SELECT id, score * 0.5 FROM keyword
    ),
    aggregated AS (
      SELECT id, MAX(score) AS score FROM combined GROUP BY id
    )
    SELECT kc.id, kc.chunk_text, kc.document_version_id, kc.language,
           a.score, kd.name AS document_name, kd.category AS document_category
    FROM aggregated a
    JOIN knowledge_chunks kc ON kc.id = a.id
    JOIN knowledge_document_versions kdv ON kdv.id = kc.document_version_id
    JOIN knowledge_documents kd ON kd.id = kdv.document_id
    WHERE kc.workspace_id = $2::uuid
      AND ($6::text IS NULL OR kd.category = $6)
      AND ($7::text IS NULL OR kd.category LIKE $7 || '%')
    ORDER BY a.score DESC
    LIMIT $4
    `,
    vectorLiteral(qVec),
    opts.workspaceId,
    opts.language ?? null,
    topK,
    opts.query,
    opts.category ?? null,
    opts.category ? null : (opts.categoryPrefix ?? null),
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
