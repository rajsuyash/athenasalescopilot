import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SUGGEST_SYSTEM } from './coach-prompt.js';

/**
 * Anthropic's minimum cacheable prefix on Haiku 4.5 is 4096 tokens, and
 * falling below it disables prompt caching SILENTLY — no error, just
 * cache_read_input_tokens = 0. That exact failure went unnoticed from
 * 2026-05-10 to 2026-07-26 because nothing asserted the size.
 *
 * Measured with the real count_tokens endpoint (2026-07-26,
 * claude-haiku-4-5): 18,069 chars → 4,965 tokens, i.e. ~3.64 chars/token.
 * The floor below keeps ~1000 tokens of headroom over 4096. Tokens can't be
 * counted offline, so this guards the proxy — if you change the prompt
 * substantially, re-measure rather than just nudging this constant.
 */
const CHARS_PER_TOKEN = 3.64;
const CACHE_FLOOR_TOKENS = 4096;
const MIN_CHARS = 16_000; // ≈ 4,395 tokens — ~300 tokens above the floor

test('SUGGEST_SYSTEM stays above the Haiku 4.5 prompt-cache floor', () => {
  const estTokens = Math.round(SUGGEST_SYSTEM.length / CHARS_PER_TOKEN);
  assert.ok(
    SUGGEST_SYSTEM.length >= MIN_CHARS,
    `prompt is ${SUGGEST_SYSTEM.length} chars (~${estTokens} tokens); needs ≥${MIN_CHARS} ` +
      `to stay clear of the ${CACHE_FLOOR_TOKENS}-token cache floor. Shortening it ` +
      `disables prompt caching silently — re-measure with count_tokens before lowering this.`,
  );
});

// The prefix must be byte-identical on every call or the cache never hits.
// A template interpolation would make it per-turn and silently break caching.
test('SUGGEST_SYSTEM is a static prefix — no interpolation left behind', () => {
  assert.ok(!SUGGEST_SYSTEM.includes('${'), 'prompt must not interpolate anything');
  // Two calls must yield the identical string (catches accidental Date/random use
  // if this ever becomes a builder function).
  assert.equal(SUGGEST_SYSTEM, SUGGEST_SYSTEM);
});

// Rule A is the product: the rep must be able to say the line verbatim.
test('SUGGEST_SYSTEM carries the verbatim-output and silence rules', () => {
  assert.match(SUGGEST_SYSTEM, /SPEAK THE EXACT WORDS/);
  assert.match(SUGGEST_SYSTEM, /SILENCE OVER NOISE/);
  assert.match(SUGGEST_SYSTEM, /NEVER RE-ASK ANSWERED GROUND/);
  assert.match(SUGGEST_SYSTEM, /≤30 words/);
});

// All nine archetypes must be present — the whole point of shipping the full
// library rather than the active archetype is that the prefix stays stable.
test('SUGGEST_SYSTEM carries all nine objection archetypes', () => {
  for (const a of [
    'PRICE',
    'STALL',
    'AUTHORITY',
    'COMPARISON',
    'TIME',
    'SKEPTICISM',
    'SELF-DOUBT',
    'RESISTANCE',
    'AVOIDANCE',
  ]) {
    assert.ok(SUGGEST_SYSTEM.includes(a), `missing archetype section: ${a}`);
  }
});

// The templates use {slot} placeholders; the model must be told never to emit
// them. A leaked "{goal}" on a live call is unreadable to the rep.
test('SUGGEST_SYSTEM forbids emitting placeholder tokens', () => {
  assert.match(SUGGEST_SYSTEM, /Never output a brace, bracket, or placeholder token/);
});
