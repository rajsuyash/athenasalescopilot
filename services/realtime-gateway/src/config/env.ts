import { z } from 'zod';

/** Hot-path coach model when neither ANTHROPIC_MODEL_HOT_PATH nor
 *  ANTHROPIC_MODEL is set. Haiku 4.5 — lowest TTFT of the Claude tier. */
export const DEFAULT_HOT_PATH_MODEL = 'claude-haiku-4-5';

/**
 * Resolve the model the live coach runs on. Extracted + tested because this
 * precedence shipped INVERTED once (`ANTHROPIC_MODEL ?? hotPath`), which put
 * every docker-compose deploy's hot path on Sonnet — a silent 500-800ms TTFT
 * regression that no test or type could catch.
 *
 * Order: explicit hot-path var → ANTHROPIC_MODEL (emergency rollback knob) →
 * Haiku default.
 */
export function resolveHotPathModel(
  hotPath: string | undefined,
  fallback: string | undefined,
): string {
  return hotPath ?? fallback ?? DEFAULT_HOT_PATH_MODEL;
}

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4040),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),

  STT_PROVIDER: z.enum(['deepgram', 'mock', 'auto']).default('auto'),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().optional(),

  EMBEDDING_PROVIDER: z.enum(['openai', 'deterministic', 'auto']).default('auto'),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(256),
  OPENAI_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.enum(['anthropic', 'mock', 'auto']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /**
   * Fallback model used by any non-hot-path caller in this service (e.g.
   * proactive coach when ANTHROPIC_MODEL_HOT_PATH isn't set). Quality-first
   * by default.
   */
  ANTHROPIC_MODEL: z.string().optional(),
  /**
   * Phase 3: hot-path model used on every customer-turn coachAndPersist
   * call. Haiku 4.5 hits ~360ms TTFT vs Sonnet's 800-1200ms with negligible
   * quality drop on the grounded-answer + objection-reframe output we
   * actually surface. Saves 500-800ms TTFT per coached turn.
   *
   * Resolution order (see server.ts): this var → ANTHROPIC_MODEL →
   * DEFAULT_HOT_PATH_MODEL. Deliberately OPTIONAL rather than defaulted: a
   * zod default here is indistinguishable from an operator-set value, which
   * would make ANTHROPIC_MODEL a dead branch and remove the documented
   * emergency-rollback knob.
   */
  ANTHROPIC_MODEL_HOT_PATH: z.string().optional(),

  MIN_DISPLAY_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  // Lowered 0.5 → 0.35 (2026-05-11): 24h prod data showed 98/98 customer
  // turns were skipped by the urgency gate. Single-signal turns (e.g., a
  // bare "?" without an intent keyword match) need to surface to the LLM.
  // Quality is still gated downstream by MIN_DISPLAY_CONFIDENCE; this gate
  // is for cost control, not card quality.
  URGENCY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),

  /** URL of the postcall-service for auto-recap dispatch. */
  POSTCALL_URL: z.string().url().default('http://localhost:4030'),
  /** Auto-fire postcall recap when the session ends. */
  AUTO_RECAP: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : v)),
  /** Auto-end the meeting via api on session close. */
  AUTO_END_MEETING: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : v)),
  /** API service URL (for meeting end). */
  API_URL: z.string().url().default('http://localhost:4000'),

  /** Optional Redis for cross-process cache invalidation. */
  REDIS_URL: z.string().optional(),

  /** Idle disconnect (no audio frames received) in ms. */
  IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** Bounded ring buffer per session (number of segments cached for redrive). */
  MAX_PENDING_SEGMENTS: z.coerce.number().int().positive().default(200),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  /**
   * Pinned chrome-extension origin for the published Web Store build.
   * Format: `chrome-extension://<32-char-id>`. Required in production —
   * gateway refuses to boot without it. Without this pin, any malicious
   * sibling extension could ride our blanket CORS allow.
   */
  EXTENSION_ORIGIN: z
    .string()
    .regex(/^chrome-extension:\/\/[a-z]{32}$/i, 'must be chrome-extension://<32-char-id>')
    .optional(),

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
