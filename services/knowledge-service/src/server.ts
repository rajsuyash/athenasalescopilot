import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { createEmbeddingClient } from '@athena/sdk-embeddings';
import { loadEnv } from './config/env.js';
import { authPlugin } from './lib/auth.js';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { ingestRoutes } from './modules/ingest/routes.js';
import { retrievalRoutes } from './modules/retrieval/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 50 * 1024 * 1024,
  });

  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { secret: env.JWT_ACCESS_SECRET });

  const embeddings = createEmbeddingClient({
    provider: env.EMBEDDING_PROVIDER,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.EMBEDDING_MODEL,
    openaiOutputDimensions: env.EMBEDDING_DIMENSION,
    deterministicDimension: env.EMBEDDING_DIMENSION,
  });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(ingestRoutes({ embeddings }), { prefix: '/v1' });
  await app.register(retrievalRoutes({ embeddings }), { prefix: '/v1' });

  return app;
}

async function main() {
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

import { realpathSync } from "node:fs"; import { fileURLToPath } from "node:url"; const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? ""); } catch { return false; } })();
if (isMain) void main();
