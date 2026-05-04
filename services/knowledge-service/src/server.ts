import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { createEmbeddingClient } from '@athena/sdk-embeddings';
import { createLlmClient, initSkills } from '@athena/sdk-llm';
import { dir as skillsDir } from '@athena/skills';
import { loadEnv } from './config/env.js';
import { authPlugin } from './lib/auth.js';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { ingestRoutes } from './modules/ingest/routes.js';
import { retrievalRoutes } from './modules/retrieval/routes.js';
import { bmcRoutes } from './modules/bmc/routes.js';

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

  // Block Q — load Anthropic Skill bundles into memory once at boot. The
  // bundles ship as a workspace package (@athena/skills) so pnpm install
  // copies them into node_modules for every dependent service — no cwd
  // tricks, no env var, deploy-portable. Failure is non-fatal: BMC routes
  // 503 when a skill is missing.
  try {
    const r = initSkills(skillsDir);
    app.log.info({ skillsDir, ...r }, 'skills loaded');
  } catch (err) {
    app.log.warn({ err }, 'skills failed to load — BMC routes will 503 until fixed');
  }

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

  const llm = createLlmClient({
    provider: env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock',
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
  });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(ingestRoutes({ embeddings }), { prefix: '/v1' });
  await app.register(retrievalRoutes({ embeddings }), { prefix: '/v1' });
  await app.register(
    bmcRoutes({
      llm,
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
      anthropicModel: env.ANTHROPIC_MODEL,
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
