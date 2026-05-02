export * from './types.js';
export { DeterministicEmbeddingClient } from './deterministic.js';
export { OpenAiEmbeddingClient } from './openai.js';

import type { EmbeddingClient } from './types.js';
import { DeterministicEmbeddingClient } from './deterministic.js';
import { OpenAiEmbeddingClient } from './openai.js';

export interface EmbeddingFactoryOptions {
  provider?: 'openai' | 'deterministic' | 'auto';
  openaiApiKey?: string | undefined;
  openaiModel?: string | undefined;
  /** OpenAI: ask the API to return shorter vectors so they fit our DB column. */
  openaiOutputDimensions?: number;
  deterministicDimension?: number;
}

/**
 * Create an embedding client. Defaults to `auto`:
 *   - if openaiApiKey is set → OpenAI;
 *   - else → deterministic (dev/test).
 */
export function createEmbeddingClient(opts: EmbeddingFactoryOptions = {}): EmbeddingClient {
  const provider = opts.provider ?? 'auto';
  if (provider === 'openai' || (provider === 'auto' && opts.openaiApiKey)) {
    return new OpenAiEmbeddingClient({
      apiKey: opts.openaiApiKey ?? '',
      ...(opts.openaiModel ? { model: opts.openaiModel } : {}),
      ...(opts.openaiOutputDimensions !== undefined
        ? { outputDimensions: opts.openaiOutputDimensions }
        : {}),
    });
  }
  return new DeterministicEmbeddingClient(
    opts.deterministicDimension !== undefined ? { dimension: opts.deterministicDimension } : {},
  );
}
