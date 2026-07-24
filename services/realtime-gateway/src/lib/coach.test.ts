import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObjectionFirst, reconcileEpisode, type EpisodeState } from './coach.js';

test('mergeObjectionFirst puts objection rows first', () => {
  const objection = [{ id: 'o1' }, { id: 'o2' }];
  const general = [{ id: 'g1' }, { id: 'g2' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.deepEqual(out, ['o1', 'o2', 'g1', 'g2']);
});

test('mergeObjectionFirst dedups by id, first occurrence wins', () => {
  const objection = [{ id: 'x' }, { id: 'o2' }];
  const general = [{ id: 'x' }, { id: 'g1' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.deepEqual(out, ['x', 'o2', 'g1']);
});

test('mergeObjectionFirst caps at limit', () => {
  const objection = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
  const general = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.equal(out.length, 5);
  assert.deepEqual(out, ['o1', 'o2', 'o3', 'g1', 'g2']);
});

const openPrice: EpisodeState = {
  id: 'ep1',
  archetype: 'price',
  currentStep: 'isolate',
  reframeUsed: null,
  deflections: 0,
};

test('reconcileEpisode: no report → none (episode untouched)', () => {
  assert.deepEqual(reconcileEpisode(openPrice, undefined, ['objection']), { kind: 'none' });
  assert.deepEqual(reconcileEpisode(null, undefined, ['none']), { kind: 'none' });
});

test('reconcileEpisode: new objection with no prior → open, archetype from report', () => {
  const d = reconcileEpisode(null, { is_objection: true, archetype: 'stall', step: 'disarm' }, [
    'objection',
  ]);
  assert.deepEqual(d, { kind: 'open', archetype: 'stall', step: 'disarm', reframe: null });
});

test('reconcileEpisode: new objection, null archetype → falls back to intent mapping', () => {
  const d = reconcileEpisode(null, { is_objection: true, archetype: null, step: null }, [
    'pricing',
  ]);
  assert.equal(d.kind, 'open');
  if (d.kind === 'open') {
    assert.equal(d.archetype, 'price');
    assert.equal(d.step, 'disarm');
  }
});

test('reconcileEpisode: continuing episode advances step and counts deflection', () => {
  const d = reconcileEpisode(
    openPrice,
    { is_objection: true, step: 'reframe', reframe: 'opportunity_cost', deflected: true },
    ['pricing'],
  );
  assert.deepEqual(d, {
    kind: 'advance',
    step: 'reframe',
    reframe: 'opportunity_cost',
    deflections: 1,
  });
});

test('reconcileEpisode: explicit resolved closes the episode', () => {
  const d = reconcileEpisode(openPrice, { is_objection: true, status: 'resolved' }, ['pricing']);
  assert.deepEqual(d, { kind: 'close', status: 'resolved' });
});

test('reconcileEpisode: non-objection turn with open episode → close abandoned', () => {
  const d = reconcileEpisode(openPrice, { is_objection: false }, ['none']);
  assert.deepEqual(d, { kind: 'close', status: 'abandoned' });
});

test('reconcileEpisode: non-objection turn, no episode → none', () => {
  assert.deepEqual(reconcileEpisode(null, { is_objection: false }, ['none']), { kind: 'none' });
});
