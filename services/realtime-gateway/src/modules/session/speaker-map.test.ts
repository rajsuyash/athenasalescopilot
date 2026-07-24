import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerMap } from './handler.js';

test('dual-channel: mic channel (1) is rep, tab channel (0) is customer', () => {
  const sm = new SpeakerMap(null);
  // Deterministic regardless of who speaks first, order, or labels.
  assert.equal(sm.classify('Speaker 0', 1), 'rep');
  assert.equal(sm.classify('Speaker 0', 0), 'customer');
  assert.equal(sm.classify('Speaker 5', 1), 'rep');
  assert.equal(sm.classify('Speaker 2', 0), 'customer');
});

test('dual-channel: customer speaking first does NOT steal the rep role', () => {
  const sm = new SpeakerMap(null);
  // Customer (ch0) speaks first — under the old first-speaker-wins mono logic
  // this would have been tagged rep for the whole call.
  assert.equal(sm.classify('Speaker 0', 0), 'customer');
  assert.equal(sm.classify('Speaker 0', 1), 'rep');
});

test('mono fallback: first diarized speaker is the rep', () => {
  const sm = new SpeakerMap(null);
  assert.equal(sm.classify('Speaker 0'), 'rep');
  assert.equal(sm.classify('Speaker 0'), 'rep');
  assert.equal(sm.classify('Speaker 1'), 'customer');
});

test('forceCustomer wins over channel and label', () => {
  const sm = new SpeakerMap(null, true);
  assert.equal(sm.classify('Speaker 0', 1), 'customer');
  assert.equal(sm.classify('Speaker 0'), 'customer');
});
