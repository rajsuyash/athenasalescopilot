import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { createEmbeddingClient } from '@athena/sdk-embeddings';
import { createLlmClient } from '@athena/sdk-llm';
import { loadEnv } from './config/env.js';
import { authPlugin } from './lib/auth.js';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { suggestRoutes } from './modules/suggest/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1 * 1024 * 1024,
  });

  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { secret: env.JWT_ACCESS_SECRET });

  const embeddings = createEmbeddingClient({
    provider: env.EMBEDDING_PROVIDER,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.EMBEDDING_MODEL,
    openaiOutputDimensions: env.EMBEDDING_DIMENSION,
    deterministicDimension: env.EMBEDDING_DIMENSION,
  });

  const llm = env.LLM_PROVIDER === 'mock'
    ? createLlmClient({ provider: 'mock' })
    : env.ANTHROPIC_API_KEY
      ? createLlmClient({
          provider: 'anthropic',
          anthropicApiKey: env.ANTHROPIC_API_KEY,
          anthropicModel: env.ANTHROPIC_MODEL,
        })
      : null;

  app.get('/healthz', async () => ({ ok: true, llm: !!llm }));

  await app.register(
    suggestRoutes({
      llm,
      embeddings,
      minDisplayConfidence: env.MIN_DISPLAY_CONFIDENCE,
      urgencyThreshold: env.URGENCY_THRESHOLD,
    }),
    { prefix: '/v1' },
  );

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
