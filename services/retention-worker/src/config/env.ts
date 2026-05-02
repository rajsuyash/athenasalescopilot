import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4050),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),

  /** How often the background sweep runs across all workspaces. Set to 0 to disable. */
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(60 * 60 * 1000), // 1h

  /** Cap deletions per resource per workspace per sweep so we don't lock the DB. */
  BATCH_SIZE: z.coerce.number().int().positive().default(1000),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
