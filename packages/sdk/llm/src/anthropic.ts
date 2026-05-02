import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmMessage,
} from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: { apiKey: string; model?: string; endpoint?: string }) {
    if (!opts.apiKey) throw new Error('ANTHROPIC_API_KEY required');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? 'https://api.anthropic.com/v1/messages';
  }

  async complete<T = unknown>(req: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
    if (!req.workspaceId) throw new Error('workspaceId required');
    const { system, others } = splitMessages(req.messages);

    const ac = new AbortController();
    const deadline = req.deadlineMs ?? 30_000;
    const timer = setTimeout(() => ac.abort(), deadline);
    const startedAt = Date.now();

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: req.temperature ?? 0.2,
          ...(system ? { system } : {}),
          messages: others.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const latencyMs = Date.now() - startedAt;

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return errorResult<T>(`anthropic ${res.status}: ${errText.slice(0, 256)}`, this.model, latencyMs);
      }

      const body = (await res.json()) as AnthropicResponse;
      const text = body.content
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('');

      const finishReason: LlmCompleteResult['finishReason'] =
        body.stop_reason === 'end_turn' || body.stop_reason === 'stop_sequence'
          ? 'stop'
          : body.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop';

      const usage: { inputTokens?: number; outputTokens?: number } = {};
      if (body.usage?.input_tokens !== undefined) usage.inputTokens = body.usage.input_tokens;
      if (body.usage?.output_tokens !== undefined) usage.outputTokens = body.usage.output_tokens;

      const out: LlmCompleteResult<T> = {
        text,
        model: body.model,
        finishReason,
        usage,
        latencyMs,
      };

      if (req.schema) {
        const candidate = tryJson(text);
        const parsed = req.schema.safeParse(candidate);
        if (parsed.success) out.parsed = parsed.data;
        else {
          // TEMP UAT instrumentation — remove once LLM JSON path is green.
          // eslint-disable-next-line no-console
          console.error('[llm-anthropic] schema parse failed', {
            finishReason,
            textPreview: text.slice(0, 600),
            zodIssues: parsed.error?.issues?.slice(0, 5),
          });
        }
      }
      return out;
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      if ((err as { name?: string }).name === 'AbortError') {
        return errorResult<T>('cancelled', this.model, latencyMs, 'cancelled');
      }
      return errorResult<T>(getMessage(err), this.model, latencyMs);
    } finally {
      clearTimeout(timer);
    }
  }
}

function splitMessages(messages: LlmMessage[]): { system: string | null; others: LlmMessage[] } {
  const systems = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const others = messages.filter((m) => m.role !== 'system');
  return {
    system: systems.length > 0 ? systems.join('\n\n') : null,
    others,
  };
}

function tryJson(text: string): unknown {
  // 1. Try plain parse first (model returned raw JSON).
  try { return JSON.parse(text.trim()); } catch { /* continue */ }

  // 2. Accept a fenced ```json ... ``` block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }

  // 3. Extract the first top-level JSON object from free-form text.
  // This handles cases where the model emits prose before/after the JSON.
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
  }

  return null;
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorResult<T>(
  text: string,
  model: string,
  latencyMs: number,
  finishReason: LlmCompleteResult['finishReason'] = 'error',
): LlmCompleteResult<T> {
  return { text, model, finishReason, latencyMs };
}
