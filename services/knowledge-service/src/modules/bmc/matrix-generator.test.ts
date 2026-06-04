import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  claimNumbers,
  enforceGrounding,
  shouldAbort,
  wordCount,
  type MatrixEntry,
} from './matrix-generator.js';

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
    suggestedLine: 'Totally fair. Is price the only thing holding you back, or is there more?',
    sourceChunkIds: ['chunk-a'],
    ...over,
  };
}

describe('wordCount', () => {
  it('counts words ignoring extra whitespace', () => {
    assert.equal(wordCount('  one   two three '), 3);
    assert.equal(wordCount(''), 0);
  });
});

describe('claimNumbers', () => {
  it('extracts money, percent, and multipliers; normalizes k/m', () => {
    assert.deepEqual(claimNumbers('we charge $30k per year'), [30_000]);
    assert.deepEqual(claimNumbers('$1,200/mo'), [1_200]);
    assert.deepEqual(claimNumbers('save 50%'), [50]);
    assert.deepEqual(claimNumbers('up to $1.5M ARR'), [1_500_000]);
  });

  it('ignores bare integers with no unit (rhetorical counts)', () => {
    assert.deepEqual(claimNumbers('the 7-step loop with 2 kinds of people'), []);
  });

  it('reconciles formatting differences (30k vs 30,000)', () => {
    const a = new Set(claimNumbers('$30,000'));
    assert.equal(a.has(30_000), true);
    assert.equal(
      claimNumbers('$30k').every((n) => a.has(n)),
      true,
    );
  });
});

describe('enforceGrounding', () => {
  const allowedIds = new Set(['chunk-a', 'chunk-b']);
  const chunkTextById = new Map([
    ['chunk-a', 'Our plan is $30,000 per year and saves 50% of rep time.'],
    ['chunk-b', 'The mechanism is a live coach.'],
  ]);

  it('keeps a grounded entry and strips non-allowed source ids', () => {
    const e = entry({ sourceChunkIds: ['chunk-a', 'hallucinated-id'] });
    const { kept, dropped } = enforceGrounding({ entries: [e], allowedIds, chunkTextById });
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 0);
    assert.deepEqual(kept[0]!.sourceChunkIds, ['chunk-a']);
  });

  it('drops an entry whose source ids are all hallucinated', () => {
    const e = entry({ sourceChunkIds: ['nope-1', 'nope-2'] });
    const { kept, dropped } = enforceGrounding({ entries: [e], allowedIds, chunkTextById });
    assert.equal(kept.length, 0);
    assert.equal(dropped[0]!.reason, 'no_valid_source_ids');
  });

  it('drops an entry whose suggested line exceeds 30 words', () => {
    const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(' ');
    const e = entry({ suggestedLine: long });
    const { kept, dropped } = enforceGrounding({ entries: [e], allowedIds, chunkTextById });
    assert.equal(kept.length, 0);
    assert.equal(dropped[0]!.reason, 'suggested_line_too_long');
  });

  it('drops an entry asserting a number not in any cited chunk (prose cross-check)', () => {
    const e = entry({ suggestedLine: 'It pays for itself — you save $99,999 in the first month.' });
    const { kept, dropped } = enforceGrounding({ entries: [e], allowedIds, chunkTextById });
    assert.equal(kept.length, 0);
    assert.match(dropped[0]!.reason, /^unsupported_numbers:/);
  });

  it('keeps an entry whose cited number matches a chunk despite formatting', () => {
    const e = entry({
      suggestedLine: 'For $30k a year you reclaim half your selling time.',
      sourceChunkIds: ['chunk-a'],
    });
    const { kept } = enforceGrounding({ entries: [e], allowedIds, chunkTextById });
    assert.equal(kept.length, 1);
  });
});

describe('shouldAbort', () => {
  it('aborts when more than half dropped', () => {
    assert.equal(shouldAbort(4, 10), true); // 6 dropped > 50%
    assert.equal(shouldAbort(5, 10), false); // exactly 50% dropped, ok
    assert.equal(shouldAbort(10, 10), false);
  });

  it('aborts on an empty result set', () => {
    assert.equal(shouldAbort(0, 0), true);
  });
});
