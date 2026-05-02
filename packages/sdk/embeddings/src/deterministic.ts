import crypto from 'node:crypto';
import type { EmbedRequest, EmbedResult, EmbeddingClient } from './types.js';

/**
 * Deterministic local embedding for dev + tests. NOT for production retrieval quality.
 *
 * Algorithm: hashed-bag-of-tokens. Tokenize on whitespace, project each token
 * into a fixed-dim vector via SHA-256, accumulate, then L2-normalize.
 * Two texts that share words will have non-trivial cosine similarity, which
 * is enough to validate the retrieval plumbing without an API key.
 */
export class DeterministicEmbeddingClient implements EmbeddingClient {
  private readonly dim: number;

  constructor(opts: { dimension?: number } = {}) {
    this.dim = opts.dimension ?? 256;
  }

  dimension(): number {
    return this.dim;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!req.workspaceId) throw new Error('workspaceId required');
    const vectors = req.texts.map((t) => this.embedOne(t));
    return {
      vectors,
      dimension: this.dim,
      model: 'deterministic-bag-of-tokens-v1',
      usage: { totalTokens: req.texts.reduce((a, t) => a + tokens(t).length, 0) },
    };
  }

  private embedOne(text: string): number[] {
    const v = new Float64Array(this.dim);
    for (const tok of tokens(text)) {
      const hash = crypto.createHash('sha256').update(tok.toLowerCase()).digest();
      // Spread the 32-byte digest across the dimension, signed.
      for (let i = 0; i < hash.length; i++) {
        const idx = (i * 8) % this.dim;
        const byte = hash[i] ?? 0;
        const sign = byte & 1 ? 1 : -1;
        const cur = v[idx] ?? 0;
        v[idx] = cur + sign * ((byte >> 1) / 127);
      }
    }
    // L2 normalize so cosine == dot product.
    let sumSq = 0;
    for (let i = 0; i < this.dim; i++) sumSq += (v[i] ?? 0) ** 2;
    const norm = Math.sqrt(sumSq) || 1;
    const out = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) out[i] = (v[i] ?? 0) / norm;
    return out;
  }
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
