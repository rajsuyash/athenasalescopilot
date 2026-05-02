import type { FastifyInstance } from 'fastify';
import { prisma } from '@athena/db';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: 'up' };
    } catch (err) {
      app.log.warn({ err }, 'db readiness check failed');
      reply.status(503);
      return { ok: false, db: 'down' };
    }
  });
}
