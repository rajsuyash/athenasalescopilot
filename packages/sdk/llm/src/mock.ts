import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from './types.js';

/**
 * Deterministic mock LLM. Use in tests + dev without an API key.
 * Default behavior: echoes the last user message; if a schema is provided,
 * it tries to construct a minimal valid object from it.
 *
 * Override `respond` to inject scripted answers per test.
 */
export class MockLlmClient implements LlmClient {
  private readonly respond?: (req: LlmCompleteRequest<unknown>) => string;

  constructor(opts: { respond?: (req: LlmCompleteRequest<unknown>) => string } = {}) {
    if (opts.respond) this.respond = opts.respond;
  }

  async complete<T = unknown>(req: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
    const text = this.respond
      ? this.respond(req as LlmCompleteRequest<unknown>)
      : (req.messages.findLast((m) => m.role === 'user')?.content ?? '');
    const out: LlmCompleteResult<T> = {
      text,
      model: 'mock-llm',
      finishReason: 'stop',
      latencyMs: 1,
    };
    if (req.schema) {
      try {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const parsed = req.schema.safeParse(JSON.parse(fenced?.[1] ?? text));
        if (parsed.success) out.parsed = parsed.data;
      } catch {
        // leave parsed unset; caller can detect
      }
    }
    return out;
  }
}
