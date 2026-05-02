import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MockSttClient } from './mock.js';
import type { SttSegment } from './types.js';

describe('MockSttClient', () => {
  it('emits scripted finals on the timer', async () => {
    const c = new MockSttClient([
      { delayMs: 5, text: 'first', speakerLabel: 'Speaker 1' },
      { delayMs: 10, text: 'second', speakerLabel: 'Speaker 2' },
    ]);
    const finals: SttSegment[] = [];
    const stream = await c.open(
      { workspaceId: 'ws_a' },
      { onFinal: (s) => finals.push(s), onError: () => {} },
    );
    await new Promise((r) => setTimeout(r, 50));
    await stream.close();
    assert.equal(finals.length, 2);
    assert.equal(finals[0]!.text, 'first');
    assert.equal(finals[0]!.speakerLabel, 'Speaker 1');
    assert.equal(finals[1]!.text, 'second');
    assert.equal(finals[0]!.isFinal, true);
  });

  it('rejects open without workspaceId', async () => {
    const c = new MockSttClient();
    await assert.rejects(() => c.open({ workspaceId: '' }, { onFinal: () => {}, onError: () => {} }));
  });

  it('close stops further finals', async () => {
    const c = new MockSttClient([{ delayMs: 50, text: 'late' }]);
    const finals: SttSegment[] = [];
    const stream = await c.open(
      { workspaceId: 'ws_a' },
      { onFinal: (s) => finals.push(s), onError: () => {} },
    );
    await stream.close();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(finals.length, 0);
  });
});
