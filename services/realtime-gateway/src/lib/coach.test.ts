import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeObjectionFirst,
  reconcileEpisode,
  classifyHeuristic,
  formatBusinessContext,
  type EpisodeState,
} from './coach.js';

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

test('classifyHeuristic: single-signal objections are flagged (F20 recall fix)', () => {
  // These scored ~0.30 (< 0.35 urgency) before F20 and were silently dropped.
  for (const t of [
    "You're being a bit pushy here.",
    "I'll have to run this by my boss first.",
    "Now isn't a good time, we're slammed.",
    "We're already using a different tool for this.",
    "Let's circle back in a few weeks.",
  ]) {
    assert.equal(classifyHeuristic(t).isObjection, true, t);
  }
});

test('classifyHeuristic: benign turns are not flagged as objections', () => {
  for (const t of [
    "Yeah that sounds great, let's do it.",
    'Can you walk me through the dashboard?',
    'We have about fifty reps on the team.',
  ]) {
    assert.equal(classifyHeuristic(t).isObjection, false, t);
  }
});

test('formatBusinessContext: builds a labelled block from BMC sections in priority order', () => {
  const block = formatBusinessContext({
    passion: 'ignored',
    niche: 'Mid-market SaaS founders',
    problem: 'Churn from bad onboarding',
    usp: 'Only tool with live call coaching',
    pricing: '$499/mo per seat',
    channel: 'ignored too',
  });
  assert.ok(block);
  const lines = (block as string).split('\n');
  assert.equal(lines[0], 'Who we sell to: Mid-market SaaS founders');
  assert.ok((block as string).includes('Why us: Only tool with live call coaching'));
  assert.ok((block as string).includes('Pricing: $499/mo per seat'));
  // passion + channel are skipped (marketing-facing, not useful live).
  assert.ok(!(block as string).includes('ignored'));
});

test('formatBusinessContext: null/empty in → null out (no block injected)', () => {
  assert.equal(formatBusinessContext(null), null);
  assert.equal(formatBusinessContext({}), null);
  assert.equal(formatBusinessContext({ niche: '   ', usp: 42 as unknown as string }), null);
});
