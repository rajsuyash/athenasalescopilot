import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isLikelyUtteranceEnd, joinCustomerFragments } from './handler.js';

// Deepgram at endpointing=200 slices continuous speech into ~7-word
// fragments (prod: avg 7.3 words, 34% of segments ≤4 words). These are
// reassembled into one utterance before the coach sees them, so the joining
// has to survive the real shapes STT emits.
test('joinCustomerFragments: reassembles a fragmented objection into one line', () => {
  const parts = ["Honestly it's too expensive", 'for us right now,', "that's way over our budget."];
  assert.equal(
    joinCustomerFragments(parts),
    "Honestly it's too expensive for us right now, that's way over our budget.",
  );
});

test('joinCustomerFragments: collapses stray whitespace instead of doubling spaces', () => {
  // Fragments arrive with inconsistent edge whitespace; a naive join(' ')
  // produces "talk to  my   partner" and leading/trailing gaps.
  assert.equal(
    joinCustomerFragments(['  I need to ', ' talk to  my ', '  partner   ']),
    'I need to talk to my partner',
  );
});

test('joinCustomerFragments: drops empty and whitespace-only fragments', () => {
  assert.equal(
    joinCustomerFragments(['We already', '', '   ', 'have a vendor']),
    'We already have a vendor',
  );
});

test('joinCustomerFragments: single fragment passes through trimmed', () => {
  assert.equal(joinCustomerFragments(['  just one  ']), 'just one');
});

// Early-flush detection: the difference between a ~800ms and a ~150ms turn
// boundary, i.e. the largest controllable slice of the speakable-line budget
// (ADR 0003). A false negative costs 650ms; a false positive costs one 150ms
// beat and a possible split.
test('isLikelyUtteranceEnd: finished sentence flushes early', () => {
  assert.equal(isLikelyUtteranceEnd("That's way over our budget.", 4), true);
  assert.equal(isLikelyUtteranceEnd('Can you send that over?', 4), true);
  assert.equal(isLikelyUtteranceEnd('That is completely unacceptable!', 4), true);
});

test('isLikelyUtteranceEnd: mid-utterance fragment keeps the full window', () => {
  // Deepgram fragments mid-thought carry no terminal punctuation.
  assert.equal(isLikelyUtteranceEnd("Honestly it's just too expensive for us", 4), false);
  assert.equal(isLikelyUtteranceEnd("right now and that's way over the", 4), false);
});

test('isLikelyUtteranceEnd: short filler does not end a turn', () => {
  // "Yeah." is punctuated but the prospect is still forming the thought.
  assert.equal(isLikelyUtteranceEnd('Yeah.', 4), false);
  assert.equal(isLikelyUtteranceEnd('Right, okay.', 4), false);
  assert.equal(isLikelyUtteranceEnd('Sure that makes sense.', 4), true);
});

test('isLikelyUtteranceEnd: tolerates a closing quote or bracket after punctuation', () => {
  assert.equal(isLikelyUtteranceEnd('He literally said "no way."', 4), true);
  assert.equal(isLikelyUtteranceEnd('We looked at it (briefly.)', 4), true);
});

test('isLikelyUtteranceEnd: trailing comma or dash is not an ending', () => {
  assert.equal(isLikelyUtteranceEnd('I mean it could work, but', 4), false);
  assert.equal(isLikelyUtteranceEnd('The thing is —', 4), false);
});

test('joinCustomerFragments: all-empty input yields empty string (caller skips the coach)', () => {
  assert.equal(joinCustomerFragments([]), '');
  assert.equal(joinCustomerFragments(['', '  ']), '');
});
