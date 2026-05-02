import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import { Errors } from '../../lib/errors.js';

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
});

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workspaces/me', async (req) => {
    const claims = await req.requireAuth();
    const ws = await prisma.workspace.findUnique({
      where: { id: claims.workspaceId },
      select: { id: true, name: true, slug: true, planTier: true, region: true, status: true },
    });
    if (!ws) throw Errors.notFound();
    return ws;
  });

  app.patch('/workspaces/me', async (req) => {
    const claims = await req.requirePermission('workspace:update');
    const body = UpdateBody.parse(req.body);
    const updated = await prisma.workspace.update({
      where: { id: claims.workspaceId },
      data: body,
      select: { id: true, name: true, slug: true, planTier: true, region: true, status: true },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'workspace.updated',
        resourceType: 'workspace',
        resourceId: claims.workspaceId,
        metadataJson: body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
    return updated;
  });
}
