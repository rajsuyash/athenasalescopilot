import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import { Errors } from '../../lib/errors.js';

const ListQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ParamsId = z.object({ id: z.string().uuid() });

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/notifications — recent notifications for the caller. Always
   * scoped to (userId, workspaceId) from the JWT.
   */
  app.get('/notifications', async (req) => {
    const claims = await req.requireAuth();
    const q = ListQuery.parse(req.query);
    const where = {
      userId: claims.sub,
      workspaceId: claims.workspaceId,
      ...(q.unreadOnly ? { readAt: null } : {}),
    };
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      prisma.notification.count({
        where: { userId: claims.sub, workspaceId: claims.workspaceId, readAt: null },
      }),
    ]);
    return {
      unread,
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
        payload: n.payload,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  /**
   * POST /v1/notifications/:id/read — mark one as read.
   */
  app.post('/notifications/:id/read', async (req) => {
    const claims = await req.requireAuth();
    const params = ParamsId.parse(req.params);
    const n = await prisma.notification.findFirst({
      where: { id: params.id, userId: claims.sub, workspaceId: claims.workspaceId },
    });
    if (!n) throw Errors.notFound();
    if (!n.readAt) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { readAt: new Date() },
      });
    }
    return { id: n.id, readAt: (n.readAt ?? new Date()).toISOString() };
  });

  /**
   * POST /v1/notifications/read-all — mark every unread notification read.
   */
  app.post('/notifications/read-all', async (req) => {
    const claims = await req.requireAuth();
    const r = await prisma.notification.updateMany({
      where: { userId: claims.sub, workspaceId: claims.workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: r.count };
  });
}
