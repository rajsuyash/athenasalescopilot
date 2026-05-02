import crypto from 'node:crypto';
import { prisma } from '@athena/db';
import type { Prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { chunkText } from '../../lib/chunker.js';
import { extractText, type SupportedFormat } from '../../lib/extract.js';
import { vectorLiteral } from '../../lib/vector-sql.js';

export interface IngestInput {
  workspaceId: string;
  actorUserId: string;
  name: string;
  category: string;
  format: SupportedFormat;
  buffer?: Buffer;
  text?: string;
  url?: string;
  tags?: Record<string, unknown>;
  language?: string;
  visibilityScope?: 'workspace' | 'team' | 'role';
}

export interface IngestResult {
  documentId: string;
  versionId: string;
  chunkCount: number;
  duplicate: boolean;
}

export interface IngestDeps {
  embeddings: EmbeddingClient;
}

export async function ingestDocument(
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  if (!input.workspaceId) throw new Error('workspaceId required');

  const extracted = await extractText({
    format: input.format,
    ...(input.buffer ? { buffer: input.buffer } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.url ? { url: input.url } : {}),
  });
  const cleaned = extracted.text.trim();
  if (cleaned.length === 0) {
    throw Object.assign(new Error('extracted text is empty'), {
      statusCode: 422,
      code: 'EMPTY_DOCUMENT',
    });
  }

  const contentHash = crypto.createHash('sha256').update(cleaned).digest('hex');

  // Dedup: same content hash within the same workspace = warn + reuse existing.
  const existing = await prisma.knowledgeDocumentVersion.findFirst({
    where: {
      contentHash,
      document: { workspaceId: input.workspaceId },
    },
    include: { document: true },
  });
  if (existing) {
    return {
      documentId: existing.documentId,
      versionId: existing.id,
      chunkCount: 0,
      duplicate: true,
    };
  }

  const chunks = chunkText(cleaned, { targetTokens: 500, overlapTokens: 50 });
  if (chunks.length === 0) {
    throw Object.assign(new Error('chunker produced 0 chunks'), {
      statusCode: 422,
      code: 'EMPTY_DOCUMENT',
    });
  }

  const { vectors, dimension } = await deps.embeddings.embed({
    workspaceId: input.workspaceId,
    texts: chunks.map((c) => c.text),
  });
  if (vectors.length !== chunks.length) {
    throw new Error('embedding count mismatch');
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const doc = await tx.knowledgeDocument.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        category: input.category,
        status: 'processing',
      },
    });
    const version = await tx.knowledgeDocumentVersion.create({
      data: {
        documentId: doc.id,
        version: 1,
        contentHash,
      },
    });

    // Insert chunks via raw SQL so we can write the pgvector column. We still
    // insert one row per chunk to keep the loop tenant-scoped + bounded; the
    // dimension column was added by the migration in vector-sql.ts.
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const v = vectors[i]!;
      const tagsJson = JSON.stringify(input.tags ?? {});
      await tx.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks
           (id, workspace_id, document_version_id, chunk_text, chunk_order,
            tags_json, visibility_scope, language, active, embedding)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, true, $8::vector)`,
        input.workspaceId,
        version.id,
        c.text,
        c.order,
        tagsJson,
        input.visibilityScope ?? 'workspace',
        input.language ?? 'en-US',
        vectorLiteral(v),
      );
    }

    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'indexed' },
    });

    await tx.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'knowledge.uploaded',
        resourceType: 'knowledge_document',
        resourceId: doc.id,
        metadataJson: {
          name: input.name,
          category: input.category,
          chunks: chunks.length,
          dimension,
          format: input.format,
        },
      },
    });

    return { documentId: doc.id, versionId: version.id, chunkCount: chunks.length };
  });

  return { ...result, duplicate: false };
}
