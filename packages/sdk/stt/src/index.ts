export * from './types.js';
export { DeepgramSttClient } from './deepgram.js';
export { MockSttClient } from './mock.js';

import type { SttClient } from './types.js';
import { DeepgramSttClient } from './deepgram.js';
import { MockSttClient } from './mock.js';

export interface SttFactoryOptions {
  provider?: 'deepgram' | 'mock' | 'auto';
  deepgramApiKey?: string | undefined;
  deepgramModel?: string | undefined;
  mockScript?: Array<{ delayMs: number; text: string; speakerLabel?: string }>;
}

export function createSttClient(opts: SttFactoryOptions = {}): SttClient {
  const provider = opts.provider ?? 'auto';
  if (provider === 'deepgram' || (provider === 'auto' && opts.deepgramApiKey)) {
    return new DeepgramSttClient({
      apiKey: opts.deepgramApiKey ?? '',
      ...(opts.deepgramModel ? { model: opts.deepgramModel } : {}),
    });
  }
  return new MockSttClient(opts.mockScript ?? []);
}
