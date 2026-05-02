import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MockLlmClient } from '@athena/sdk-llm';
import { classifyIntent } from './service.js';

describe('classifyIntent', () => {
  it('falls back to heuristic without an LLM', async () => {
    const r = await classifyIntent(
      { workspaceId: 'ws_a', text: 'What is your data retention policy?' },
      { llm: null },
    );
    assert.equal(r.source, 'heuristic');
    assert.ok(r.categories.includes('security'));
  });

  it('uses LLM result when JSON parses', async () => {
    const llm = new MockLlmClient({
      respond: () =>
        '```json\n{"categories":["pricing","budget"],"stage_signal":"objection_handling","urgency_score":0.85,"confidence":0.9}\n```',
    });
    const r = await classifyIntent(
      { workspaceId: 'ws_a', text: 'price is too high' },
      { llm },
    );
    assert.equal(r.source, 'llm');
    assert.deepEqual(r.categories, ['pricing', 'budget']);
    assert.equal(r.stageSignal, 'objection_handling');
    assert.equal(r.urgencyScore, 0.85);
  });

  it('falls back to heuristic when LLM JSON is malformed', async () => {
    const llm = new MockLlmClient({ respond: () => 'not json at all' });
    const r = await classifyIntent(
      { workspaceId: 'ws_a', text: 'How does pricing work for enterprise?' },
      { llm },
    );
    assert.equal(r.source, 'heuristic');
    assert.ok(r.categories.includes('pricing'));
  });

  it('returns none for empty text', async () => {
    const r = await classifyIntent({ workspaceId: 'ws_a', text: '' }, { llm: null });
    assert.deepEqual(r.categories, ['none']);
  });

  it('rejects missing workspaceId', async () => {
    await assert.rejects(() => classifyIntent({ workspaceId: '', text: 'x' }, { llm: null }));
  });
});
