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
    // Hard cap on HTTP body — caption-injection batches are the largest
    // legitimate payload (50 captions × 2KB ≈ 100KB). 256KB leaves headroom.
    bodyLimit: 256 * 1024,
  });

  // CORS allow-list. Production accepts ONLY origins enumerated in
  // CORS_ORIGINS plus the single pinned chrome-extension://<id> for our
  // published Web Store build (set via EXTENSION_ORIGIN). When that env
  // var is absent we fall back to the pre-fix behaviour (any
  // chrome-extension://*) AND log a loud warning. After the Web Store id
  // is known, set EXTENSION_ORIGIN on Railway to enforce the pin.
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  if (env.EXTENSION_ORIGIN) allowedOrigins.add(env.EXTENSION_ORIGIN);
  const isProd = env.NODE_ENV === 'production';
  const allowAnyExtension = !isProd || !env.EXTENSION_ORIGIN;
  if (isProd && !env.EXTENSION_ORIGIN) {
    app.log.warn(
      'CORS pin: EXTENSION_ORIGIN not set; allowing any chrome-extension://* origin. ' +
        'Set EXTENSION_ORIGIN=chrome-extension://<published-id> on Railway after the Web Store listing is live.',
    );
  }
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      if (allowAnyExtension && origin.startsWith('chrome-extension://')) return cb(null, true);
      return cb(new Error('cors: origin not allowed'), false);
    },
  });
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

  // Phase 3: hot-path model selection. Reactive coach + proactive coach
  // both run on the same WS so we use a single shared LLM client; the
  // hot-path env var (default Haiku 4.5) wins over ANTHROPIC_MODEL when
  // set. ANTHROPIC_MODEL stays as the explicit override knob for an
  // emergency rollback to Sonnet without redeploy.
  const hotPathModel = env.ANTHROPIC_MODEL ?? env.ANTHROPIC_MODEL_HOT_PATH;
  const llm =
    env.LLM_PROVIDER === 'mock'
      ? createLlmClient({ provider: 'mock' })
      : env.ANTHROPIC_API_KEY
        ? createLlmClient({
            provider: 'anthropic',
            anthropicApiKey: env.ANTHROPIC_API_KEY,
            anthropicModel: hotPathModel,
          })
        : null;

  const stt = createSttClient({
    provider: env.STT_PROVIDER,
    deepgramApiKey: env.DEEPGRAM_API_KEY,
    deepgramModel: env.DEEPGRAM_MODEL,
  });

  // Public health probe — minimal surface so unauthenticated callers can't
  // fingerprint our provider configuration. Detailed diagnostic shape moved
  // to authenticated `/healthz/details`.
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/healthz/details', async (req) => {
    await req.requireAuth();
    return {
      ok: true,
      stt: env.STT_PROVIDER,
      llm: !!llm,
      deepgram: !!env.DEEPGRAM_API_KEY,
    };
  });

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
