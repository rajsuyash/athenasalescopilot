import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SUGGEST_SYSTEM } from './coach-prompt.js';

/**
 * This guards a LATENCY budget, not a cache floor.
 *
 * Both sides of Haiku 4.5's 4096-token cache floor were measured in prod
 * (2026-07-26): at 4965 tokens the prefix cached (cache_read_input_tokens =
 * 4958, confirmed) and llm_ttft still rose from 760ms to 1903ms. Caching saves
 * prefill compute but the model attends over the whole context either way, and
 * measured TTFT scales at ~0.32ms per context token regardless of cache state.
 *
 * The product constraint is a speakable line within 1s of the prospect
 * finishing, so TTFT beats token cost and this prompt stays dense and
 * deliberately UNcached. Padding it back over 4096 to "fix" the missing cache
 * would re-introduce ~350ms of TTFT — that trade was measured and rejected.
 *
 * Measured: 8,852 chars → 2,409 tokens on claude-haiku-4-5 (~3.67 chars/token).
 */
const MAX_CHARS = 11_000; // ≈ 3,000 tokens — hard ceiling on prefill cost
const CHARS_PER_TOKEN = 3.67;

test('SUGGEST_SYSTEM stays within the TTFT budget', () => {
  const estTokens = Math.round(SUGGEST_SYSTEM.length / CHARS_PER_TOKEN);
  assert.ok(
    SUGGEST_SYSTEM.length <= MAX_CHARS,
    `prompt is ${SUGGEST_SYSTEM.length} chars (~${estTokens} tokens), over the ${MAX_CHARS}-char ` +
      `budget. Every ~3.7 chars adds ~0.32ms to TTFT on the hot path. Adding content here ` +
      `directly spends the 1s speakable-line budget — re-measure end-to-end before raising this.`,
  );
});

// The prefix must be byte-identical across calls. Even uncached, an
// interpolated value here would be a per-turn prompt, which breaks the ability
// to ever turn caching back on and makes A/B comparisons meaningless.
test('SUGGEST_SYSTEM is a static prefix — no interpolation left behind', () => {
  assert.ok(!SUGGEST_SYSTEM.includes('${'), 'prompt must not interpolate anything');
});

// Rule A is the product: the rep must be able to say the line verbatim.
test('SUGGEST_SYSTEM carries the verbatim-output and silence rules', () => {
  assert.match(SUGGEST_SYSTEM, /SPEAK THE EXACT WORDS/);
  assert.match(SUGGEST_SYSTEM, /SILENCE OVER NOISE/);
  assert.match(SUGGEST_SYSTEM, /NEVER RE-ASK ANSWERED GROUND/);
  assert.match(SUGGEST_SYSTEM, /≤18 words/);
});

/**
 * All nine archetypes must carry a canonical template. This is what a live
 * comparison showed produces a line the rep can read out loud verbatim rather
 * than a paraphrase of a technique — dropping any archetype silently falls back
 * to the model inventing phrasing for that objection type.
 */
test('SUGGEST_SYSTEM carries a reframe line for all nine archetypes', () => {
  for (const a of [
    'price',
    'stall',
    'authority',
    'comparison',
    'time',
    'skepticism',
    'self_doubt',
    'resistance',
    'avoidance',
  ]) {
    assert.ok(
      new RegExp(`^· ${a} `, 'm').test(SUGGEST_SYSTEM),
      `missing reframe line for archetype: ${a}`,
    );
  }
});

// The templates use {slot} placeholders; a leaked "{goal}" is unreadable to a
// rep mid-call, so the instruction not to emit them must survive edits.
test('SUGGEST_SYSTEM forbids emitting placeholder tokens', () => {
  assert.match(SUGGEST_SYSTEM, /Never output a brace, bracket, or placeholder token/);
});

// Two archetypes carry a do-not-run caveat that materially protects the rep on
// enterprise calls. These are easy to lose when condensing.
test('SUGGEST_SYSTEM keeps the register-risk caveats', () => {
  assert.match(SUGGEST_SYSTEM, /HIGH RISK on senior\/enterprise buyers/);
  assert.match(SUGGEST_SYSTEM, /genuine co-decider with veto power/);
});
