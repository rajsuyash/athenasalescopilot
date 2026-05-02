import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyHeuristic } from './categories.js';

describe('classifyHeuristic', () => {
  it('returns none + low urgency for filler', () => {
    const r = classifyHeuristic('yeah, totally');
    assert.equal(r.categories[0]!.category, 'none');
    assert.ok(r.urgencyScore < 0.3);
  });

  it('flags security retention question', () => {
    const r = classifyHeuristic("What's your data retention policy?");
    assert.ok(r.categories.some((c) => c.category === 'security'));
    assert.ok(r.urgencyScore > 0.4);
  });

  it('flags pricing + budget when relevant', () => {
    const r = classifyHeuristic('Honestly, the price per seat feels too expensive for our budget.');
    const cats = r.categories.map((c) => c.category);
    assert.ok(cats.includes('pricing') || cats.includes('budget'));
    assert.equal(r.stageSignal, 'objection_handling');
  });

  it('detects competitor framing', () => {
    const r = classifyHeuristic('How does this compare vs Gong?');
    assert.ok(r.categories.some((c) => c.category === 'competitor'));
  });

  it('caps to 3 categories', () => {
    const long = 'pricing security integration timeline budget contract API GDPR procurement?';
    const r = classifyHeuristic(long);
    assert.ok(r.categories.length <= 3);
  });

  it('urgency is 0..1', () => {
    const r = classifyHeuristic("Pricing? Security? GDPR? When can we go-live? What's the cost?");
    assert.ok(r.urgencyScore >= 0 && r.urgencyScore <= 1);
  });
});
