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
   *  to legacy HMAC tokens when missing. REQUIRED in production via the
   *  superRefine below. */
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  /** Webhook signing secret from Clerk dashboard → Webhooks. min(1) so an
   *  empty-string env var doesn't silently bypass Svix verification. */
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * Pinned chrome-extension origin for the published Web Store build.
   * Format: `chrome-extension://<32-char-id>`. Required in production —
   * api refuses to boot without it. Without this pin, any malicious
   * sibling extension could ride our blanket CORS allow.
   */
  EXTENSION_ORIGIN: z
    .string()
    .regex(/^chrome-extension:\/\/[a-z]{32}$/i, 'must be chrome-extension://<32-char-id>')
    .optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  // Production-only invariants. Failing here at startup is much safer than
  // letting a misconfigured prod deploy silently fall back to legacy HMAC
  // (Clerk disabled) or accept any Svix payload (webhook bypass).
  if (!env.CLERK_SECRET_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CLERK_SECRET_KEY'],
      message:
        'CLERK_SECRET_KEY is required in production. Without it Clerk verification ' +
        'silently falls back to legacy HMAC, defeating the Block T migration.',
    });
  }
  if (!env.CLERK_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CLERK_WEBHOOK_SECRET'],
      message:
        'CLERK_WEBHOOK_SECRET is required in production. Without it the /v1/auth/clerk-webhook ' +
        'endpoint cannot validate Svix signatures.',
    });
  }
  // EXTENSION_ORIGIN is OPTIONAL in production for the rollout window — if
  // unset, api falls back to allowing any chrome-extension://* origin so the
  // unpacked sideload + Web Store extension can co-exist. Once the published
  // extension ID is known, set EXTENSION_ORIGIN to lock CORS down to that
  // single origin. Track via a startup warning, not a hard fail.
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
