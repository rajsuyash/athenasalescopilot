import type { EmbedRequest, EmbedResult, EmbeddingClient } from './types.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

interface OpenAiBody {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export class OpenAiEmbeddingClient implements EmbeddingClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  /**
   * Optional output truncation. text-embedding-3 models support a `dimensions`
   * request param that returns shorter, normalized vectors. We use this so the
   * vectors fit the pgvector column declared in the DB migration (default 256).
   */
  private readonly outputDimensions: number | undefined;

  constructor(opts: {
    apiKey: string;
    model?: string;
    endpoint?: string;
    outputDimensions?: number;
  }) {
    if (!opts.apiKey) throw new Error('OPENAI_API_KEY required');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? 'https://api.openai.com/v1/embeddings';
    this.outputDimensions = opts.outputDimensions;
  }

  dimension(): number {
    return this.outputDimensions ?? MODEL_DIMENSIONS[this.model] ?? 1536;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!req.workspaceId) throw new Error('workspaceId required');
    if (req.texts.length === 0) {
      return { vectors: [], dimension: this.dimension(), model: this.model };
    }
    const payload: Record<string, unknown> = {
      input: req.texts,
      model: req.model ?? this.model,
    };
    if (this.outputDimensions !== undefined) {
      payload.dimensions = this.outputDimensions;
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`embeddings ${res.status}: ${text.slice(0, 256)}`);
    }
    const body = (await res.json()) as OpenAiBody;
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    const usage: { promptTokens?: number; totalTokens?: number } = {};
    if (body.usage?.prompt_tokens !== undefined) usage.promptTokens = body.usage.prompt_tokens;
    if (body.usage?.total_tokens !== undefined) usage.totalTokens = body.usage.total_tokens;
    return {
      vectors: sorted.map((d) => d.embedding),
      dimension: sorted[0]?.embedding.length ?? this.dimension(),
      model: body.model,
      usage,
    };
  }
}
