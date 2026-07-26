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
  /** External cancellation — e.g. the gateway superseding a stale coach call
   *  when a newer customer turn arrives. Composed with the deadline. */
  signal?: AbortSignal;
  traceId?: string;
  /**
   * Token-streaming callback. When set, the SDK enables streaming on the
   * underlying provider and invokes this callback for each text delta as it
   * arrives from the wire. The final parsed result still arrives via the
   * Promise return — onPartialText is purely additive for "perceived
   * latency" UX (rendering text as it's generated). Safe to omit.
   */
  onPartialText?: (delta: string, accumulated: string) => void;
}

export interface LlmCompleteResult<T = unknown> {
  text: string;
  parsed?: T;
  model: string;
  finishReason: 'stop' | 'length' | 'error' | 'cancelled';
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    /**
     * Prompt-cache hit size. Non-zero means the provider served a cached
     * prefill — the signal that `cache_control` is actually working.
     * Previously unread, which made cache effectiveness unmeasurable and
     * left PRD v2 F19 AC4 (`cache_read_input_tokens > 0`) unverifiable.
     */
    cacheReadTokens?: number;
    /** Tokens written INTO the cache on this call (first call of a window). */
    cacheCreationTokens?: number;
  };
  latencyMs: number;
}

export interface LlmClient {
  complete<T = unknown>(req: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>>;
}
