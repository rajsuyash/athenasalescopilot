import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from './config/env.js';
import { authPlugin } from '@athena/auth';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { aggregateRoutes } from './modules/aggregate/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { secret: env.JWT_ACCESS_SECRET });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(aggregateRoutes, { prefix: '/v1' });

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) void main();
