import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4030),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),

  LLM_PROVIDER: z.enum(['anthropic', 'mock', 'auto']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),

  /** Default sales framework for adherence scoring. */
  DEFAULT_FRAMEWORK: z.enum(['MEDDIC', 'BANT', 'SPICED']).default('MEDDIC'),

  /** Hard deadline on the recap LLM call. */
  RECAP_DEADLINE_MS: z.coerce.number().int().positive().default(60_000),

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
