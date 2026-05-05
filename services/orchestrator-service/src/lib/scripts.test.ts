import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeStage } from './scripts.js';

describe('normalizeStage', () => {
  const cases: Array<[string, string]> = [
    ['Pitching', 'demo'],
    ['Probing', 'discovery'],
    ['Opening', 'opener'],
    ['  rapport ', 'opener'],
    ['Next-steps', 'closing'],
    ['next_steps', 'closing'],
    ['objection', 'objection_handling'],
    ['Reframe', 'objection_handling'],
    ['discovery', 'discovery'],
    // Unknown stages pass through normalized (lowercased, alpha-num only).
    ['custom-stage', 'customstage'],
  ];

  for (const [raw, want] of cases) {
    it(`${JSON.stringify(raw)} → ${want}`, () => {
      assert.equal(normalizeStage(raw), want);
    });
  }
});
