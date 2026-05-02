import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { Prisma } from '@athena/db';
import { ApiError, Errors } from '../../lib/errors.js';
import { publishCacheInvalidation } from '../../lib/pubsub.js';

const ParamsId = z.object({ id: z.string().uuid() });
const ParamsVersion = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

const CreateCollectionBody = z.object({
  name: z.string().min(1).max(120),
});

const StageBlock = z.object({
  stage: z.string().min(1).max(40),
  persona: z.string().max(40).optional(),
  language: z.string().max(20).default('en-US'),
  bodyMd: z.string().min(1).max(20_000),
  ordering: z.number().int().min(0).max(1000).default(0),
});

const CreateVersionBody = z.object({
  blocks: z.array(StageBlock).min(1).max(200),
});

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/scripts/active — published script blocks across every collection
   * in the workspace, indexed by stage. Cheap read for the orchestrator and
   * the overlay's checklist mode.
   */
  app.get('/scripts/active', async (req) => {
    const claims = await req.requirePermission('script:read');
    const collections = await prisma.scriptCollection.findMany({
      where: { workspaceId: claims.workspaceId, currentVersionId: { not: null } },
      include: {
        currentVersion: {
          include: {
            blocks: {
              orderBy: [{ stage: 'asc' }, { ordering: 'asc' }],
            },
          },
        },
      },
    });
    const byStage = new Map<
      string,
      Array<{
        collection: string;
        collectionId: string;
        versionId: string;
        version: number;
        bodyMd: string;
        persona: string | null;
        language: string;
      }>
    >();
    for (const c of collections) {
      const v = c.currentVersion;
      if (!v) continue;
      for (const b of v.blocks) {
        const arr = byStage.get(b.stage) ?? [];
        arr.push({
          collection: c.name,
          collectionId: c.id,
          versionId: v.id,
          version: v.version,
          bodyMd: b.bodyMd,
          persona: b.persona,
          language: b.language,
        });
        byStage.set(b.stage, arr);
      }
    }
    return {
      collections: collections.length,
      stages: [...byStage.entries()].map(([stage, blocks]) => ({ stage, blocks })),
    };
  });

  /** GET /v1/scripts — list workspace collections + their current version. */
  app.get('/scripts', async (req) => {
    const claims = await req.requirePermission('script:read');
    const rows = await prisma.scriptCollection.findMany({
      where: { workspaceId: claims.workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        currentVersion: { select: { id: true, version: true, status: true, publishedAt: true } },
        _count: { select: { versions: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      currentVersion: c.currentVersion
        ? {
            id: c.currentVersion.id,
            version: c.currentVersion.version,
            status: c.currentVersion.status,
            publishedAt: c.currentVersion.publishedAt?.toISOString() ?? null,
          }
        : null,
      versionCount: c._count.versions,
    }));
  });

  /** POST /v1/scripts — create a new empty collection. */
  app.post('/scripts', async (req, reply) => {
    const claims = await req.requirePermission('script:edit');
    const body = CreateCollectionBody.parse(req.body);
    const c = await prisma.scriptCollection.create({
      data: { workspaceId: claims.workspaceId, name: body.name },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'script_collection.created',
        resourceType: 'script_collection',
        resourceId: c.id,
        metadataJson: { name: c.name },
      },
    });
    reply.status(201);
    return { id: c.id, name: c.name, createdAt: c.createdAt.toISOString() };
  });

  /** GET /v1/scripts/:id — collection + version list + blocks for current version. */
  app.get('/scripts/:id', async (req) => {
    const claims = await req.requirePermission('script:read');
    const params = ParamsId.parse(req.params);
    const c = await prisma.scriptCollection.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            publishedAt: true,
            createdAt: true,
            _count: { select: { blocks: true } },
          },
        },
        currentVersion: {
          include: {
            blocks: {
              orderBy: [{ stage: 'asc' }, { ordering: 'asc' }],
              select: {
                id: true,
                stage: true,
                persona: true,
                language: true,
                bodyMd: true,
                ordering: true,
              },
            },
          },
        },
      },
    });
    if (!c) throw Errors.notFound();
    return {
      id: c.id,
      name: c.name,
      currentVersionId: c.currentVersionId,
      versions: c.versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
        blockCount: v._count.blocks,
      })),
      currentBlocks: c.currentVersion?.blocks ?? [],
    };
  });

  /**
   * POST /v1/scripts/:id/versions — create a new draft version.
   * The body is the full block list — we treat versions as immutable snapshots.
   */
  app.post('/scripts/:id/versions', async (req, reply) => {
    const claims = await req.requirePermission('script:edit');
    const params = ParamsId.parse(req.params);
    const body = CreateVersionBody.parse(req.body);
    const c = await prisma.scriptCollection.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } },
    });
    if (!c) throw Errors.notFound();
    const nextVersion = (c.versions[0]?.version ?? 0) + 1;

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const v = await tx.scriptVersion.create({
        data: {
          collectionId: c.id,
          version: nextVersion,
          status: 'draft',
        },
      });
      await tx.scriptStageBlock.createMany({
        data: body.blocks.map((b, i) => ({
          versionId: v.id,
          stage: b.stage,
          persona: b.persona ?? null,
          language: b.language,
          bodyMd: b.bodyMd,
          ordering: b.ordering ?? i,
        })),
      });
      await tx.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'script_version.drafted',
          resourceType: 'script_version',
          resourceId: v.id,
          metadataJson: { collectionId: c.id, version: nextVersion, blocks: body.blocks.length },
        },
      });
      return v;
    });
    reply.status(201);
    return {
      id: created.id,
      version: created.version,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
  });

  /**
   * POST /v1/scripts/:id/versions/:versionId/publish — atomic publish/rollback.
   * Archives the previous current version + sets this one as current. Honors
   * the `script_collections.current_version_id` unique constraint via a
   * transaction with `null`-then-set to avoid lock thrash.
   */
  app.post('/scripts/:id/versions/:versionId/publish', async (req) => {
    const claims = await req.requirePermission('script:publish');
    const params = ParamsVersion.parse(req.params);
    const c = await prisma.scriptCollection.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
    });
    if (!c) throw Errors.notFound();
    const target = await prisma.scriptVersion.findFirst({
      where: { id: params.versionId, collectionId: c.id },
    });
    if (!target) throw Errors.notFound();

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Detach current pointer first to avoid the unique constraint flapping.
      await tx.scriptCollection.update({
        where: { id: c.id },
        data: { currentVersionId: null },
      });
      // Archive whichever version was previously published.
      await tx.scriptVersion.updateMany({
        where: { collectionId: c.id, status: 'published' },
        data: { status: 'archived' },
      });
      const published = await tx.scriptVersion.update({
        where: { id: target.id },
        data: { status: 'published', publishedAt: new Date() },
      });
      await tx.scriptCollection.update({
        where: { id: c.id },
        data: { currentVersionId: published.id },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'script_version.published',
          resourceType: 'script_version',
          resourceId: published.id,
          metadataJson: { collectionId: c.id, version: published.version },
        },
      });
      return published;
    });

    // Cross-process invalidation — gateway flushes its in-memory script cache
    // immediately so new sessions ground on the freshly published version.
    void publishCacheInvalidation({
      kind: 'script.published',
      workspaceId: claims.workspaceId,
      metadata: { collectionId: c.id, versionId: result.id, version: result.version },
    });

    return {
      id: result.id,
      version: result.version,
      status: result.status,
      publishedAt: result.publishedAt?.toISOString() ?? null,
    };
  });

  /** Convenience: GET blocks for a specific version (for diffing / preview). */
  app.get('/scripts/:id/versions/:versionId', async (req) => {
    const claims = await req.requirePermission('script:read');
    const params = ParamsVersion.parse(req.params);
    const c = await prisma.scriptCollection.findFirst({
      where: { id: params.id, workspaceId: claims.workspaceId },
      select: { id: true },
    });
    if (!c) throw Errors.notFound();
    const v = await prisma.scriptVersion.findFirst({
      where: { id: params.versionId, collectionId: c.id },
      include: {
        blocks: {
          orderBy: [{ stage: 'asc' }, { ordering: 'asc' }],
        },
      },
    });
    if (!v) throw Errors.notFound();
    if (v.blocks.length > 1000) {
      throw new ApiError(500, 'INTERNAL', 'block payload too large');
    }
    return {
      id: v.id,
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
      blocks: v.blocks.map((b) => ({
        id: b.id,
        stage: b.stage,
        persona: b.persona,
        language: b.language,
        bodyMd: b.bodyMd,
        ordering: b.ordering,
      })),
    };
  });
}
