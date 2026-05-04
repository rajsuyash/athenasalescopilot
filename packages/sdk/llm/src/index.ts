export * from './types.js';
export { AnthropicLlmClient } from './anthropic.js';
export { MockLlmClient } from './mock.js';
export { initSkills, loadSkill, loadedSkills } from './skills.js';

import type { LlmClient } from './types.js';
import { AnthropicLlmClient } from './anthropic.js';
import { MockLlmClient } from './mock.js';

export interface LlmFactoryOptions {
  provider?: 'anthropic' | 'mock' | 'auto';
  anthropicApiKey?: string | undefined;
  anthropicModel?: string | undefined;
}

export function createLlmClient(opts: LlmFactoryOptions = {}): LlmClient {
  const provider = opts.provider ?? 'auto';
  if (provider === 'anthropic' || (provider === 'auto' && opts.anthropicApiKey)) {
    return new AnthropicLlmClient({
      apiKey: opts.anthropicApiKey ?? '',
      ...(opts.anthropicModel ? { model: opts.anthropicModel } : {}),
    });
  }
  return new MockLlmClient();
}
