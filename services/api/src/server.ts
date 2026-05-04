import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from './config/env.js';
import { configureClerk } from './lib/clerk.js';
import { initPubSub, shutdownPubSub } from './lib/pubsub.js';
import { attachSentryHandler, initSentry } from './lib/sentry.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { auditRoutes } from './modules/audit/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { clerkWebhookRoutes } from './modules/auth/clerk-webhook.js';
import { healthRoutes } from './modules/health/routes.js';
import { meetingRoutes } from './modules/meetings/routes.js';
import { membershipRoutes } from './modules/memberships/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { retentionRoutes } from './modules/retention/routes.js';
import { scriptRoutes } from './modules/scripts/routes.js';
import { suggestionRoutes } from './modules/suggestions/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  initPubSub(env.REDIS_URL);
  initSentry(env.SENTRY_DSN, env.SENTRY_ENVIRONMENT ?? env.NODE_ENV);
  // Block T — configure Clerk verifier. When the secret is absent (dev
  // before env var lands), Clerk verification is skipped and only legacy
  // HMAC tokens work.
  if (env.CLERK_SECRET_KEY) {
    configureClerk({ secretKey: env.CLERK_SECRET_KEY });
  }

  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  // Allow the configured admin-web origins AND any chrome-extension origin so
  // the Athena Companion popup can sign in regardless of the per-install ext id.
  const allowed = new Set(env.CORS_ORIGINS);
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      // Same-origin requests (e.g. server-side fetches) have no Origin header.
      if (!origin) return cb(null, true);
      if (allowed.has(origin)) return cb(null, true);
      if (origin.startsWith('chrome-extension://')) return cb(null, true);
      return cb(new Error('cors: origin not allowed'), false);
    },
  });
  await app.register(sensible);
  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });
  await app.register(errorHandlerPlugin);
  attachSentryHandler(app);
  await app.register(authPlugin, {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
  });

  await app.register(healthRoutes);
  await app.register(
    authRoutes({ refreshSecret: env.JWT_REFRESH_SECRET, knowledgeUrl: env.KNOWLEDGE_URL }),
    { prefix: '/v1' },
  );
  await app.register(
    clerkWebhookRoutes({ webhookSecret: env.CLERK_WEBHOOK_SECRET ?? '' }),
    { prefix: '/v1' },
  );
  await app.register(workspaceRoutes, { prefix: '/v1' });
  await app.register(membershipRoutes, { prefix: '/v1' });
  await app.register(meetingRoutes, { prefix: '/v1' });
  await app.register(retentionRoutes, { prefix: '/v1' });
  await app.register(suggestionRoutes, { prefix: '/v1' });
  await app.register(auditRoutes, { prefix: '/v1' });
  await app.register(notificationRoutes, { prefix: '/v1' });
  await app.register(scriptRoutes, { prefix: '/v1' });

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
      app.log.info({ sig }, 'shutdown signal');
      await app.close();
      await shutdownPubSub();
      process.exit(0);
    });
  }
}

import { realpathSync } from "node:fs"; import { fileURLToPath } from "node:url"; const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? ""); } catch { return false; } })();
if (isMain) {
  void main();
}
