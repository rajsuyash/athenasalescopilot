import type { LlmClient, LlmCompleteRequest, LlmCompleteResult, LlmMessage } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string;
  usage?: AnthropicUsage;
}

/** Copy provider usage into our shape, omitting absent fields so callers can
 *  distinguish "not reported" from zero. */
function mapUsage(u: AnthropicUsage | undefined): NonNullable<LlmCompleteResult['usage']> {
  const out: NonNullable<LlmCompleteResult['usage']> = {};
  if (u?.input_tokens !== undefined) out.inputTokens = u.input_tokens;
  if (u?.output_tokens !== undefined) out.outputTokens = u.output_tokens;
  if (u?.cache_read_input_tokens !== undefined) out.cacheReadTokens = u.cache_read_input_tokens;
  if (u?.cache_creation_input_tokens !== undefined) {
    out.cacheCreationTokens = u.cache_creation_input_tokens;
  }
  return out;
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
    if (req.signal) {
      if (req.signal.aborted) ac.abort();
      else req.signal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    const startedAt = Date.now();

    try {
      // Prompt caching: when the system prompt is ≥1024 tokens (Sonnet/Haiku
      // threshold), Anthropic returns cached prefill — saves 70-90% of input
      // cost AND ~100-200ms TTFT on cache hit. Below the threshold the
      // cache_control marker is harmless (Anthropic just doesn't cache).
      // Reactive coach reuses an identical SUGGEST_SYSTEM every customer
      // turn, so cache hit rate is near 100% within a 5-minute call window.
      const systemBlocks = system
        ? [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }]
        : null;

      const useStream = !!req.onPartialText;
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
          ...(systemBlocks ? { system: systemBlocks } : {}),
          messages: others.map((m) => ({ role: m.role, content: m.content })),
          ...(useStream ? { stream: true } : {}),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return errorResult<T>(
          `anthropic ${res.status}: ${errText.slice(0, 256)}`,
          this.model,
          Date.now() - startedAt,
        );
      }

      let text: string;
      let stopReason: AnthropicResponse['stop_reason'] = 'end_turn';
      let model = this.model;
      let usage: NonNullable<LlmCompleteResult['usage']> = {};

      if (useStream) {
        const streamed = await consumeStream(res, req.onPartialText!);
        text = streamed.text;
        stopReason = streamed.stopReason;
        model = streamed.model || this.model;
        usage = streamed.usage;
      } else {
        const body = (await res.json()) as AnthropicResponse;
        text = body.content
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('');
        stopReason = body.stop_reason;
        model = body.model;
        usage = mapUsage(body.usage);
      }

      const latencyMs = Date.now() - startedAt;
      const finishReason: LlmCompleteResult['finishReason'] =
        stopReason === 'end_turn' || stopReason === 'stop_sequence'
          ? 'stop'
          : stopReason === 'max_tokens'
            ? 'length'
            : 'stop';

      const out: LlmCompleteResult<T> = {
        text,
        model,
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

/**
 * Read an Anthropic SSE response stream and forward `text_delta` events to
 * the caller's onPartialText callback. Returns the final accumulated text +
 * stop reason + usage so the synchronous return shape matches the non-stream
 * path. Anthropic's SSE protocol uses `event: <name>\ndata: <json>\n\n`
 * frames; we care about content_block_delta and message_delta events.
 */
async function consumeStream(
  res: Response,
  onPartialText: (delta: string, accumulated: string) => void,
): Promise<{
  text: string;
  stopReason: AnthropicResponse['stop_reason'];
  model: string;
  usage: NonNullable<LlmCompleteResult['usage']>;
}> {
  if (!res.body) {
    return { text: '', stopReason: 'end_turn', model: '', usage: {} };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';
  let stopReason: AnthropicResponse['stop_reason'] = 'end_turn';
  let model = '';
  // Input + cache counts arrive once in `message_start`; output_tokens is
  // updated in `message_delta` as generation proceeds.
  const usage: NonNullable<LlmCompleteResult['usage']> = {};

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const dataLine = event
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!dataLine || dataLine === '[DONE]') continue;
      let payload: unknown;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }
      const p = payload as {
        type?: string;
        delta?: { type?: string; text?: string; stop_reason?: AnthropicResponse['stop_reason'] };
        message?: { model?: string; usage?: AnthropicUsage };
        usage?: AnthropicUsage;
      };
      if (
        p.type === 'content_block_delta' &&
        p.delta?.type === 'text_delta' &&
        typeof p.delta.text === 'string'
      ) {
        acc += p.delta.text;
        try {
          onPartialText(p.delta.text, acc);
        } catch {
          // Caller-supplied callback failure must not poison the stream.
        }
      } else if (p.type === 'message_start' && p.message) {
        if (p.message.model) model = p.message.model;
        Object.assign(usage, mapUsage(p.message.usage));
      } else if (p.type === 'message_delta') {
        if (p.delta?.stop_reason) stopReason = p.delta.stop_reason;
        // Only output_tokens is refreshed here — don't let a delta-scoped
        // usage object clobber the cache counts from message_start.
        if (p.usage?.output_tokens !== undefined) usage.outputTokens = p.usage.output_tokens;
      }
    }
  }
  return { text: acc, stopReason, model, usage };
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
  try {
    return JSON.parse(text.trim());
  } catch {
    /* continue */
  }

  // 2. Accept a fenced ```json ... ``` block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* continue */
    }
  }

  // 3. Extract the first top-level JSON object from free-form text.
  // This handles cases where the model emits prose before/after the JSON.
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      /* continue */
    }
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
