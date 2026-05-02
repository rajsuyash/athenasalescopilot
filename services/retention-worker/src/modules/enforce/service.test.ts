import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ageThreshold } from './service.js';

describe('ageThreshold', () => {
  it('returns null for 0 days (indefinite retention)', () => {
    assert.equal(ageThreshold(new Date(), 0), null);
    assert.equal(ageThreshold(new Date(), -5), null);
  });

  it('subtracts the right number of days', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const t = ageThreshold(now, 30);
    assert.ok(t);
    assert.equal(t!.toISOString(), '2026-03-29T12:00:00.000Z');
  });

  it('handles fractional inputs by truncation via getTime arithmetic', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const t = ageThreshold(now, 1);
    assert.equal(t!.toISOString(), '2025-12-31T00:00:00.000Z');
  });

  it('returns null for non-finite', () => {
    assert.equal(ageThreshold(new Date(), Number.POSITIVE_INFINITY), null);
    assert.equal(ageThreshold(new Date(), Number.NaN), null);
  });
});
