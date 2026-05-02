import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { createEmbeddingClient } from '@athena/sdk-embeddings';
import { createLlmClient } from '@athena/sdk-llm';
import { createSttClient } from '@athena/sdk-stt';
import { loadEnv } from './config/env.js';
import { authPlugin } from './lib/auth.js';
import { errorHandlerPlugin } from './lib/error-handler.js';
import { initSubscriber, shutdownSubscriber } from './lib/pubsub.js';
import { captionsRoutes } from './modules/session/captions.js';
import { registerSessionHandler } from './modules/session/handler.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  initSubscriber(env.REDIS_URL);
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
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });

  const embeddings = createEmbeddingClient({
    provider: env.EMBEDDING_PROVIDER,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.EMBEDDING_MODEL,
    openaiOutputDimensions: env.EMBEDDING_DIMENSION,
    deterministicDimension: env.EMBEDDING_DIMENSION,
  });

  const llm =
    env.LLM_PROVIDER === 'mock'
      ? createLlmClient({ provider: 'mock' })
      : env.ANTHROPIC_API_KEY
        ? createLlmClient({
            provider: 'anthropic',
            anthropicApiKey: env.ANTHROPIC_API_KEY,
            anthropicModel: env.ANTHROPIC_MODEL,
          })
        : null;

  const stt = createSttClient({
    provider: env.STT_PROVIDER,
    deepgramApiKey: env.DEEPGRAM_API_KEY,
    deepgramModel: env.DEEPGRAM_MODEL,
  });

  app.get('/healthz', async () => ({
    ok: true,
    stt: env.STT_PROVIDER,
    llm: !!llm,
    deepgram: !!env.DEEPGRAM_API_KEY,
  }));

  registerSessionHandler(app, {
    stt,
    embeddings,
    llm,
    minDisplayConfidence: env.MIN_DISPLAY_CONFIDENCE,
    urgencyThreshold: env.URGENCY_THRESHOLD,
    idleTimeoutMs: env.IDLE_TIMEOUT_MS,
    maxPendingSegments: env.MAX_PENDING_SEGMENTS,
    postcallUrl: env.POSTCALL_URL,
    apiUrl: env.API_URL,
    autoRecap: env.AUTO_RECAP,
    autoEndMeeting: env.AUTO_END_MEETING,
  });

  await app.register(
    captionsRoutes({
      llm,
      embeddings,
      minDisplayConfidence: env.MIN_DISPLAY_CONFIDENCE,
      urgencyThreshold: env.URGENCY_THRESHOLD,
    }),
    { prefix: '/v1' },
  );

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
      const { shutdownLatency } = await import('./lib/latency.js');
      await shutdownLatency();
      await shutdownSubscriber();
      process.exit(0);
    });
  }
}

import { realpathSync } from "node:fs"; import { fileURLToPath } from "node:url"; const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? ""); } catch { return false; } })();
if (isMain) void main();
