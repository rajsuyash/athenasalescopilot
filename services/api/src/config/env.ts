import { z } from 'zod';

/**
 * Boundary validation per CLAUDE.md: untrusted env validated once at startup.
 * Throws synchronously if required vars are missing — fail fast.
 */
const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be ≥32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be ≥32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /** Optional Redis for cross-process cache invalidation. */
  REDIS_URL: z.string().optional(),

  /** Optional Sentry DSN. Errors logged to stdout when unset. */
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  /** Knowledge-service base URL — used to seed sample docs on workspace creation. */
  KNOWLEDGE_URL: z.string().url().default('http://localhost:4010'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  /** Block T — Clerk identity provider. Optional in dev so the api still
   *  boots without a key; routes that need Clerk verification fall back
   *  to legacy HMAC tokens when missing. */
  CLERK_SECRET_KEY: z.string().optional(),
  /** Webhook signing secret from Clerk dashboard → Webhooks. */
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
