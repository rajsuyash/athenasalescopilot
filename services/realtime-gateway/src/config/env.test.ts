import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_HOT_PATH_MODEL, resolveHotPathModel } from './env.js';

// Regression guard: this precedence shipped inverted once, silently routing
// docker-compose deploys' hot path to Sonnet (~500-800ms extra TTFT per
// coached turn). The compose case below is the exact shape that broke.
test('resolveHotPathModel: explicit hot-path var wins over ANTHROPIC_MODEL', () => {
  // docker-compose.prod.yml: shared ANTHROPIC_MODEL=sonnet (for postcall /
  // knowledge) + gateway-scoped ANTHROPIC_MODEL_HOT_PATH=haiku.
  assert.equal(
    resolveHotPathModel('claude-haiku-4-5', 'claude-sonnet-4-6'),
    'claude-haiku-4-5',
    'hot-path var must win — otherwise the live coach runs on Sonnet',
  );
});

test('resolveHotPathModel: ANTHROPIC_MODEL is the rollback knob when hot-path is unset', () => {
  // Railway sets only ANTHROPIC_MODEL. Also the emergency "force Sonnet
  // without a redeploy" path.
  assert.equal(
    resolveHotPathModel(undefined, 'claude-sonnet-4-6'),
    'claude-sonnet-4-6',
    'ANTHROPIC_MODEL must still be able to override the default',
  );
  assert.equal(
    resolveHotPathModel(undefined, 'claude-haiku-4-5-20251001'),
    'claude-haiku-4-5-20251001',
  );
});

test('resolveHotPathModel: neither set → Haiku default', () => {
  assert.equal(resolveHotPathModel(undefined, undefined), DEFAULT_HOT_PATH_MODEL);
  assert.equal(DEFAULT_HOT_PATH_MODEL, 'claude-haiku-4-5');
});
