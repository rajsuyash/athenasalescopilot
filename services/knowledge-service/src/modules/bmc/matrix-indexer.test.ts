import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { MatrixEntry } from './matrix-generator.js';
import { renderEntryMd, toDisplayEntry } from './matrix-indexer.js';

function entry(over: Partial<MatrixEntry> = {}): MatrixEntry {
  return {
    archetype: 'price',
    bmcTheme: 'pricing',
    triggerPhrases: ['too expensive', 'cant afford it'],
    objectionText: 'It costs too much',
    reframeSteps: {
      disarm: 'Not a problem.',
      isolate: 'Is it just the price?',
      uncover: 'Whats the real concern?',
      reframe: 'Two kinds of people.',
      justify: 'Why does that matter?',
      consequence: 'What happens if nothing changes?',
      identityClose: 'What would the new you do?',
    },
    suggestedLine: 'Totally fair. Is price the only thing holding you back?',
    sourceChunkIds: ['chunk-a'],
    ...over,
  };
}

describe('toDisplayEntry', () => {
  it('projects only the display fields, dropping reframe + provenance', () => {
    const d = toDisplayEntry(entry());
    assert.deepEqual(d, {
      archetype: 'price',
      bmcTheme: 'pricing',
      objectionText: 'It costs too much',
      suggestedLine: 'Totally fair. Is price the only thing holding you back?',
      triggerPhrases: ['too expensive', 'cant afford it'],
    });
    assert.equal('reframeSteps' in d, false);
    assert.equal('sourceChunkIds' in d, false);
  });

  it('mirrors the tag fields the GET read path reconstructs', () => {
    // The display shape must match exactly what readObjectionMatrix() rebuilds
    // from chunk tags — same keys, same types — so POST and GET are symmetric.
    const d = toDisplayEntry(entry({ archetype: 'stall', bmcTheme: 'time' }));
    assert.equal(d.archetype, 'stall');
    assert.equal(d.bmcTheme, 'time');
    assert.ok(Array.isArray(d.triggerPhrases));
  });
});

describe('renderEntryMd', () => {
  it('puts trigger phrases and the ready line in the body for trigram + serve', () => {
    const md = renderEntryMd(entry());
    assert.match(md, /too expensive/);
    assert.match(md, /Ready-to-deliver line/);
    assert.match(md, /Totally fair\. Is price the only thing holding you back\?/);
    // All 7 reframe steps present.
    for (const label of [
      'Disarm',
      'Isolate',
      'Uncover',
      'Reframe',
      'Justify',
      'Consequence',
      'Identity close',
    ]) {
      assert.match(md, new RegExp(label));
    }
  });
});
