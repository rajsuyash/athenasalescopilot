import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { MockLlmClient } from './mock.js';

describe('MockLlmClient', () => {
  it('echoes the last user message by default', async () => {
    const c = new MockLlmClient();
    const r = await c.complete({
      workspaceId: 'ws_a',
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'second' },
      ],
    });
    assert.equal(r.text, 'second');
    assert.equal(r.finishReason, 'stop');
  });

  it('parses schema when respond returns valid JSON', async () => {
    const Schema = z.object({ answer: z.string(), confidence: z.number() });
    const c = new MockLlmClient({
      respond: () => '```json\n{"answer":"30 days","confidence":0.9}\n```',
    });
    const r = await c.complete({
      workspaceId: 'ws_a',
      messages: [{ role: 'user', content: 'q' }],
      schema: Schema,
    });
    assert.deepEqual(r.parsed, { answer: '30 days', confidence: 0.9 });
  });

  it('leaves parsed unset on bad JSON', async () => {
    const Schema = z.object({ answer: z.string() });
    const c = new MockLlmClient({ respond: () => 'not json' });
    const r = await c.complete({
      workspaceId: 'ws_a',
      messages: [{ role: 'user', content: 'q' }],
      schema: Schema,
    });
    assert.equal(r.parsed, undefined);
  });
});
