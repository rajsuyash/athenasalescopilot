import type { ZodSchema } from 'zod';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteRequest<T = unknown> {
  workspaceId: string;
  messages: LlmMessage[];
  /** Optional Zod schema; client retries once with stricter prompt if validation fails. */
  schema?: ZodSchema<T>;
  maxTokens?: number;
  temperature?: number;
  /** Hard server-side deadline. Cancels in-flight on breach. */
  deadlineMs?: number;
  traceId?: string;
}

export interface LlmCompleteResult<T = unknown> {
  text: string;
  parsed?: T;
  model: string;
  finishReason: 'stop' | 'length' | 'error' | 'cancelled';
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
}

export interface LlmClient {
  complete<T = unknown>(req: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>>;
}
