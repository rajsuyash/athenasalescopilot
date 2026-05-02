import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import { Errors } from '../../lib/errors.js';

const UpdateBody = z.object({
  transcriptDays: z.number().int().min(0).max(3650).optional(),
  audioDays: z.number().int().min(0).max(3650).optional(),
  summaryDays: z.number().int().min(0).max(3650).optional(),
  auditDays: z.number().int().min(0).max(3650).optional(),
});

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/workspaces/me/retention — current retention policy.
   * Auto-creates a default policy row on first access.
   */
  app.get('/workspaces/me/retention', async (req) => {
    const claims = await req.requireAuth();
    let policy = await prisma.retentionPolicy.findFirst({
      where: { workspaceId: claims.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    if (!policy) {
      policy = await prisma.retentionPolicy.create({
        data: { workspaceId: claims.workspaceId },
      });
    }
    return {
      id: policy.id,
      transcriptDays: policy.transcriptDays,
      audioDays: policy.audioDays,
      summaryDays: policy.summaryDays,
      auditDays: policy.auditDays,
      updatedAt: policy.createdAt.toISOString(),
    };
  });

  /**
   * PATCH /v1/workspaces/me/retention — update retention. Requires
   * `retention:update` (admin/owner per packages/policies).
   */
  app.patch('/workspaces/me/retention', async (req) => {
    const claims = await req.requirePermission('retention:update');
    const body = UpdateBody.parse(req.body);
    const existing = await prisma.retentionPolicy.findFirst({
      where: { workspaceId: claims.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    if (!existing) throw Errors.notFound();
    const updated = await prisma.retentionPolicy.update({
      where: { id: existing.id },
      data: body,
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'retention.updated',
        resourceType: 'retention_policy',
        resourceId: updated.id,
        metadataJson: body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
    return {
      id: updated.id,
      transcriptDays: updated.transcriptDays,
      audioDays: updated.audioDays,
      summaryDays: updated.summaryDays,
      auditDays: updated.auditDays,
    };
  });
}
