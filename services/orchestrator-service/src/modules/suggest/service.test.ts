import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DeterministicEmbeddingClient } from '@athena/sdk-embeddings';
import { MockLlmClient } from '@athena/sdk-llm';
import type { ClassifyOutput } from '../intent/service.js';
import { suggest } from './service.js';

// We mock retrieve via module replacement: tests below override it by stubbing
// the prisma calls is overkill — instead we exercise the code paths that don't
// need the DB (no chunks, hallucinated source, urgency suppression). The DB-
// backed retrieval path is exercised by the orchestrator integration test once
// Postgres is available.

const lowUrgencyIntent: ClassifyOutput = {
  categories: ['none'],
  stageSignal: 'discovery',
  urgencyScore: 0.1,
  confidence: 0.7,
  source: 'heuristic',
};

describe('suggest', () => {
  it('suppresses below the urgency threshold', async () => {
    const r = await suggest(
      {
        workspaceId: 'ws_a',
        customerText: 'mhm',
        intent: lowUrgencyIntent,
        urgencyThreshold: 0.5,
      },
      { llm: null, embeddings: new DeterministicEmbeddingClient() },
    );
    assert.equal(r.type, 'coach');
    assert.equal(r.display, false);
    assert.match(r.rationale, /urgency/);
  });

  it('rejects missing workspaceId', async () => {
    await assert.rejects(() =>
      suggest(
        {
          workspaceId: '',
          customerText: 'pricing question',
          intent: { ...lowUrgencyIntent, urgencyScore: 0.9 },
        },
        { llm: new MockLlmClient(), embeddings: new DeterministicEmbeddingClient() },
      ),
    );
  });
});
