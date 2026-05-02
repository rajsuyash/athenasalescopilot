import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4020),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),

  EMBEDDING_PROVIDER: z.enum(['openai', 'deterministic', 'auto']).default('auto'),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(256),
  OPENAI_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.enum(['anthropic', 'mock', 'auto']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),

  /** Suppress display below this confidence (PRD F5 AC). */
  MIN_DISPLAY_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  /** Trigger retrieval+gen above this urgency (PRD F5). */
  URGENCY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

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
