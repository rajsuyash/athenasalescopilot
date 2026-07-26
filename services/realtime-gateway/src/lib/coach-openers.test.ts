import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  detectOpenerArchetype,
  extractGoalPhrase,
  instantOpener,
  type OpenerArchetype,
} from './coach-openers.js';

const BC = [
  'Who we sell to: B2B sales teams of 10-50 reps.',
  'Problem we solve: missed objections, lost deals',
  'Offer: Growth plan, $1,200/month.',
].join('\n');

// These fire without a model, so a misclassification puts the WRONG canonical
// move in the rep's mouth mid-call. Precision matters more than recall here —
// an unmatched turn falls through to the LLM, which is merely slower.
test('detectOpenerArchetype: maps real objections to the right archetype', () => {
  const cases: Array<[string, OpenerArchetype]> = [
    ["Honestly it's too expensive for us right now.", 'price'],
    ["That's a lot of money to commit to.", 'price'],
    ["I'd need to talk to my business partner first.", 'authority'],
    ["This isn't only my call, I have to check with the team.", 'authority'],
    ['I want to speak to a couple of other vendors.', 'comparison'],
    ['We already have a vendor for this.', 'comparison'],
    ["I'm too busy right now, maybe in 6 months.", 'time'],
    ['We got burned by another tool last year.', 'skepticism'],
    ["Just send me the deck and I'll review it.", 'avoidance'],
    ["I feel like you're being a bit pushy.", 'resistance'],
    ["We're kind of different, I don't think this fits us.", 'self_doubt'],
    ['Let me think about it and get back to you.', 'stall'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(detectOpenerArchetype(text), expected, `misclassified: ${text}`);
  }
});

// "too expensive, let me think about it" is the most common real pairing. The
// specific objection is the one worth working, so stall must lose.
test('detectOpenerArchetype: a specific archetype beats a co-occurring stall', () => {
  assert.equal(
    detectOpenerArchetype("It's too expensive — let me think about it and get back to you."),
    'price',
  );
  assert.equal(
    detectOpenerArchetype('I need to talk to my partner, let me get back to you.'),
    'authority',
  );
});

// An unmatched turn must fall through to the LLM rather than guess.
test('detectOpenerArchetype: returns null on benign or ambiguous turns', () => {
  for (const t of [
    '',
    '   ',
    'Yeah that sounds really useful.',
    'How does the integration with Salesforce work?',
    'We have plenty of bandwidth for this right now.',
    'Can you walk me through the onboarding?',
  ]) {
    assert.equal(detectOpenerArchetype(t), null, `should not have matched: "${t}"`);
  }
});

test('instantOpener: every archetype yields a complete, brace-free line within budget', () => {
  const texts = [
    "It's too expensive.",
    'Let me think about it.',
    'I need to talk to my partner.',
    'I want to speak to other vendors.',
    "I don't have time.",
    'We got burned before.',
    "We're kind of different.",
    "You're being pushy.",
    'Just send me the info.',
  ];
  for (const t of texts) {
    for (const bc of [BC, null]) {
      const o = instantOpener(t, bc);
      assert.ok(o, `no opener for: ${t}`);
      // A rep must never see a placeholder token.
      assert.ok(!/[{}<>[\]]/.test(o.line), `placeholder leaked: ${o.line}`);
      // Must be a complete sentence, not a fragment or a coaching note.
      assert.match(o.line, /[.?!]$/, `not a complete sentence: ${o.line}`);
      // Length budget — the rep reads this while listening to a prospect.
      const words = o.line.split(/\s+/).filter(Boolean).length;
      assert.ok(words <= 18, `${words} words (>18): ${o.line}`);
    }
  }
});

test('instantOpener: returns null when no archetype matches', () => {
  assert.equal(instantOpener('That sounds great, what are next steps?', BC), null);
});

test('extractGoalPhrase: takes a short clause, or nothing', () => {
  assert.equal(extractGoalPhrase(BC), 'missed objections');
  assert.equal(extractGoalPhrase(null), null);
  // Too long to fit the opener's word budget → decline rather than truncate.
  assert.equal(
    extractGoalPhrase(
      'Problem we solve: a very long winded description that runs on well past any reasonable clause length',
    ),
    null,
  );
  // No usable label.
  assert.equal(extractGoalPhrase('Pricing: annual billing'), null);
});

test('instantOpener: substitutes the goal phrase when available, drops it cleanly when not', () => {
  const withGoal = instantOpener("It's too expensive.", BC);
  const without = instantOpener("It's too expensive.", null);
  assert.ok(withGoal && without);
  assert.match(withGoal.line, /missed objections/);
  assert.doesNotMatch(without.line, /missed objections/);
  // Both remain complete, readable sentences.
  for (const o of [withGoal, without]) assert.match(o.line, /[.?!]$/);
});

// The budget is enforced on the assembled line, not the ingredient. Sweep goal
// lengths and assert the invariant rather than a specific branch: whichever way
// the assembly resolves, the rep must get a complete line inside the budget.
test('instantOpener: holds the word budget across every goal-phrase length', () => {
  const goals = [
    'Problem we solve: two words',
    'Problem we solve: three short words',
    'Problem we solve: four fairly short words',
    'Problem we solve: five reasonably short words here',
    'Problem we solve: a much longer phrase that should be declined outright',
  ];
  for (const bc of goals) {
    for (const t of ["It's too expensive.", "I don't have time.", "We're kind of different."]) {
      const o = instantOpener(t, bc);
      assert.ok(o, `no opener for ${t}`);
      const words = o.line.split(/\s+/).filter(Boolean).length;
      assert.ok(words <= 18, `${words} words: ${o.line}`);
      assert.match(o.line, /[.?!]$/);
      assert.ok(!/[{}<>[\]]/.test(o.line), `placeholder leaked: ${o.line}`);
    }
  }
});
