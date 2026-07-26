import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { joinCustomerFragments } from './handler.js';

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

test('joinCustomerFragments: all-empty input yields empty string (caller skips the coach)', () => {
  assert.equal(joinCustomerFragments([]), '');
  assert.equal(joinCustomerFragments(['', '  ']), '');
});
