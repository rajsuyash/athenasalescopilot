import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from './config/env.js';
import { authPlugin } from '@athena/auth';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { enforceRoutes } from './modules/enforce/routes.js';
import { enforceAllWorkspaces } from './modules/enforce/service.js';

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

  app.get('/healthz', async () => ({
    ok: true,
    sweepEnabled: env.SWEEP_INTERVAL_MS > 0,
    sweepIntervalMs: env.SWEEP_INTERVAL_MS,
  }));

  await app.register(enforceRoutes({ batchSize: env.BATCH_SIZE }), { prefix: '/v1' });

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

  // Background sweep across all workspaces. Disabled when SWEEP_INTERVAL_MS=0.
  let timer: NodeJS.Timeout | null = null;
  if (env.SWEEP_INTERVAL_MS > 0) {
    const tick = async (): Promise<void> => {
      try {
        const results = await enforceAllWorkspaces({ batchSize: env.BATCH_SIZE });
        const total = results.reduce(
          (acc, r) => acc + r.transcripts + r.summaries + r.audits + r.archivedDocuments,
          0,
        );
        if (total > 0) {
          app.log.info({ workspaces: results.length, total }, 'retention sweep');
        }
      } catch (err) {
        app.log.error({ err }, 'retention sweep failed');
      }
    };
    // Stagger first run by 30s so we don't slam the DB on boot.
    setTimeout(() => {
      void tick();
      timer = setInterval(() => void tick(), env.SWEEP_INTERVAL_MS);
    }, 30_000);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      if (timer) clearInterval(timer);
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
