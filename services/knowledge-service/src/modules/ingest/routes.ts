import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { ingestDocument } from './service.js';

const FormatEnum = z.enum(['text', 'markdown', 'pdf', 'csv', 'docx', 'url']);

const TextBody = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  format: z.enum(['text', 'markdown']),
  text: z.string().min(1),
  tags: z.record(z.unknown()).optional(),
  language: z.string().optional(),
  visibilityScope: z.enum(['workspace', 'team', 'role']).optional(),
});

const UrlBody = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  format: z.literal('url'),
  url: z.string().url(),
  tags: z.record(z.unknown()).optional(),
  language: z.string().optional(),
  visibilityScope: z.enum(['workspace', 'team', 'role']).optional(),
});

interface IngestDeps {
  embeddings: EmbeddingClient;
}

export function ingestRoutes(deps: IngestDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /**
     * POST /v1/knowledge/text — inline text or markdown ingestion.
     * Use cases: pasting a script, dropping FAQ markdown.
     */
    app.post('/knowledge/text', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:upload');
      const body = TextBody.parse(req.body);
      const result = await ingestDocument(
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          name: body.name,
          category: body.category,
          format: body.format,
          text: body.text,
          ...(body.tags ? { tags: body.tags } : {}),
          ...(body.language ? { language: body.language } : {}),
          ...(body.visibilityScope ? { visibilityScope: body.visibilityScope } : {}),
        },
        deps,
      );
      reply.status(result.duplicate ? 200 : 201);
      return result;
    });

    /**
     * POST /v1/knowledge/url — fetch+ingest a public URL.
     */
    app.post('/knowledge/url', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:upload');
      const body = UrlBody.parse(req.body);
      const result = await ingestDocument(
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          name: body.name,
          category: body.category,
          format: 'url',
          url: body.url,
          ...(body.tags ? { tags: body.tags } : {}),
          ...(body.language ? { language: body.language } : {}),
          ...(body.visibilityScope ? { visibilityScope: body.visibilityScope } : {}),
        },
        deps,
      );
      reply.status(result.duplicate ? 200 : 201);
      return result;
    });

    /**
     * POST /v1/knowledge/upload — multipart binary (PDF/CSV/DOCX).
     */
    app.post('/knowledge/upload', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:upload');
      const data = await req.file();
      if (!data) {
        reply.status(400);
        return { error: 'NO_FILE', message: 'multipart file required' };
      }
      const fields = data.fields as Record<string, { value: string } | undefined>;
      const meta = z
        .object({
          name: z.string().min(1).max(200),
          category: z.string().min(1).max(50),
          format: FormatEnum,
        })
        .parse({
          name: fields.name?.value ?? data.filename,
          category: fields.category?.value ?? 'product_notes',
          format: fields.format?.value ?? 'pdf',
        });

      const buffer = await data.toBuffer();
      const result = await ingestDocument(
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          name: meta.name,
          category: meta.category,
          format: meta.format,
          buffer,
        },
        deps,
      );
      reply.status(result.duplicate ? 200 : 201);
      return result;
    });

    /**
     * GET /v1/knowledge/documents — list workspace docs.
     */
    app.get('/knowledge/documents', async (req) => {
      const claims = await req.requirePermission('knowledge:read');
      const { prisma } = await import('@athena/db');
      const docs = await prisma.knowledgeDocument.findMany({
        where: { workspaceId: claims.workspaceId, status: { not: 'archived' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          createdAt: true,
        },
      });
      return docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));
    });

    /**
     * DELETE /v1/knowledge/documents/:id — soft delete (PRD F7 / common rule).
     * Marks doc archived + deactivates all chunks so retrieval skips them.
     * Hard delete happens via the retention enforcement job.
     */
    app.delete('/knowledge/documents/:id', async (req, reply) => {
      const claims = await req.requirePermission('knowledge:delete');
      const id = String((req.params as { id?: string }).id ?? '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        reply.status(400);
        return { error: 'BAD_ID', message: 'invalid uuid' };
      }
      const { prisma } = await import('@athena/db');
      const doc = await prisma.knowledgeDocument.findFirst({
        where: { id, workspaceId: claims.workspaceId },
        include: { versions: { select: { id: true } } },
      });
      if (!doc) {
        reply.status(404);
        return { error: 'NOT_FOUND', message: 'document not found' };
      }
      const versionIds = doc.versions.map((v) => v.id);
      await prisma.$transaction([
        prisma.knowledgeChunk.updateMany({
          where: { workspaceId: claims.workspaceId, documentVersionId: { in: versionIds } },
          data: { active: false },
        }),
        prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { status: 'archived' },
        }),
        prisma.auditLog.create({
          data: {
            workspaceId: claims.workspaceId,
            actorUserId: claims.sub,
            action: 'knowledge.deleted',
            resourceType: 'knowledge_document',
            resourceId: doc.id,
            metadataJson: { name: doc.name, category: doc.category },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        }),
      ]);
      reply.status(204).send();
      return reply;
    });
  };
}
