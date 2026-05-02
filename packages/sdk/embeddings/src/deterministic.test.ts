import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DeterministicEmbeddingClient } from './deterministic.js';

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
};

describe('DeterministicEmbeddingClient', () => {
  const client = new DeterministicEmbeddingClient({ dimension: 256 });

  it('returns unit-norm vectors of the configured dimension', async () => {
    const r = await client.embed({ workspaceId: 'ws_a', texts: ['hello world', 'foo bar'] });
    assert.equal(r.dimension, 256);
    assert.equal(r.vectors.length, 2);
    for (const v of r.vectors) {
      assert.equal(v.length, 256);
      const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
      assert.ok(Math.abs(norm - 1) < 1e-9, `norm should be 1, got ${norm}`);
    }
  });

  it('is deterministic across calls', async () => {
    const a = await client.embed({ workspaceId: 'ws_a', texts: ['data retention policy'] });
    const b = await client.embed({ workspaceId: 'ws_a', texts: ['data retention policy'] });
    assert.deepEqual(a.vectors[0], b.vectors[0]);
  });

  it('similar texts have higher cosine than unrelated texts', async () => {
    const r = await client.embed({
      workspaceId: 'ws_a',
      texts: [
        'what is your data retention policy',
        'how long do you keep transcripts',
        'pricing for enterprise plan with custom contract',
      ],
    });
    const [q, related, unrelated] = r.vectors as [number[], number[], number[]];
    const simRelated = cosine(q, related);
    const simUnrelated = cosine(q, unrelated);
    assert.ok(
      simRelated > simUnrelated,
      `expected related (${simRelated}) > unrelated (${simUnrelated})`,
    );
  });

  it('rejects calls without workspaceId', async () => {
    await assert.rejects(() => client.embed({ workspaceId: '', texts: ['x'] }), /workspaceId/);
  });
});
