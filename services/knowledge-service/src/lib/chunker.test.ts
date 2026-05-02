import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(chunkText(''), []);
  });

  it('produces a single chunk for short text', () => {
    const out = chunkText('Hello world. This is a test.', { targetTokens: 500 });
    assert.equal(out.length, 1);
    assert.match(out[0]!.text, /Hello world/);
  });

  it('produces multiple chunks when text exceeds target', () => {
    const sentence = 'Athena retains transcripts for thirty days by default. ';
    const text = sentence.repeat(200); // ~1600 tokens approx
    const out = chunkText(text, { targetTokens: 200, overlapTokens: 20 });
    assert.ok(out.length >= 4, `expected ≥4 chunks, got ${out.length}`);
    for (const c of out) {
      assert.ok(c.text.length > 0);
      assert.ok(c.approxTokens <= 250, `chunk too big: ${c.approxTokens}`);
    }
    // Order is monotonic + zero-based.
    out.forEach((c, i) => assert.equal(c.order, i));
  });

  it('preserves sentence boundaries on chunk breaks', () => {
    const text =
      'Pricing starts at fifty dollars per seat. Enterprise plans are negotiable. We support SOC 2 Type II. Data is encrypted at rest with AES-256.';
    const out = chunkText(text, { targetTokens: 20, overlapTokens: 5 });
    assert.ok(out.length >= 2);
    for (const c of out) {
      // Each chunk should end on a sentence terminator.
      assert.match(c.text.trimEnd(), /[.!?]$/);
    }
  });

  it('overlaps consecutive chunks', () => {
    const text =
      'Sentence one ends here. Sentence two ends here. Sentence three ends here. Sentence four ends here. Sentence five ends here.';
    const out = chunkText(text, { targetTokens: 12, overlapTokens: 6 });
    assert.ok(out.length >= 2);
    const a = out[0]!.text;
    const b = out[1]!.text;
    // Last sentence of a should appear at the start of b (overlap behavior).
    const aSentences = a.split(/(?<=[.!?])\s+/);
    const lastA = aSentences[aSentences.length - 1]!.trim();
    assert.ok(b.startsWith(lastA), `expected overlap; a="${a}" b="${b}"`);
  });
});
