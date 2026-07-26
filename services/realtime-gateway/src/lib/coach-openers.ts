/**
 * Instant canonical openers — the sub-second path.
 *
 * ─── Why this exists ──────────────────────────────────────────────────────
 *
 * The product constraint is a line the rep can say out loud within 1s of the
 * prospect finishing. Measured against Haiku 4.5 over 16 judged samples, the
 * LLM path cannot do it and the gap is not tuning:
 *
 *   TTFT           mean 933ms   p50  866ms   p90 1317ms
 *   line complete  mean 1833ms  p50 1651ms   p90 2713ms
 *
 * TTFT p90 alone exceeds the entire budget before a single word streams.
 *
 * The observation that makes it solvable: for a FRESHLY RAISED objection, the
 * LLM reliably reproduces the library template almost verbatim. Across every
 * measured run a price objection produced some variant of "money aside for a
 * second, do you feel like this actually gets you to <goal>". That is the
 * canonical disarm+isolate, and it is determined by the ARCHETYPE, not by the
 * conversation — which is exactly why a trained rep delivers it reflexively
 * and saves deliberation for the reframe.
 *
 * So the opening move does not need a model. `classifyHeuristic` already
 * identifies the objection in ~0ms; we emit the canonical opener straight
 * away, and the LLM handles the later loop steps (uncover / reframe / justify /
 * consequence / close) where ~1.5s is fine because the rep is mid-exchange
 * rather than waiting at a turn boundary.
 *
 * Resulting budget for the first move: ~110ms settle + ~1ms template + network.
 *
 * ─── Why this is not the canned-fallback mistake ───────────────────────────
 *
 * A 2026-07-24 field report killed the canned `askNext` questions for being
 * context-blind — they re-asked things the prospect had already answered. Two
 * differences here. First, these fire ONLY on a detected objection with no
 * episode already open, so they cannot re-ask answered ground: an objection
 * that was just raised has no prior answer. Second, they are archetype-matched
 * rather than generic, and they ask about the prospect's own stated goal rather
 * than for new information. The check that matters is still applied — the
 * caller runs the same dedup and display gate it applies to LLM output.
 */

/** Objection archetypes that have a canonical opening move. */
export type OpenerArchetype =
  | 'price'
  | 'stall'
  | 'authority'
  | 'comparison'
  | 'time'
  | 'skepticism'
  | 'self_doubt'
  | 'resistance'
  | 'avoidance';

/**
 * High-precision surface patterns per archetype.
 *
 * Deliberately narrower than the coach's objection patterns: those gate
 * "should the LLM look at this turn", where a false positive costs a wasted
 * call. These gate "say this exact line to the prospect now", where a false
 * positive puts the WRONG canonical move in the rep's mouth. When nothing
 * matches confidently we return null and the LLM path runs as before.
 */
const ARCHETYPE_PATTERNS: ReadonlyArray<readonly [OpenerArchetype, readonly RegExp[]]> = [
  [
    'price',
    [
      /\btoo expensive\b/i,
      /\bcan'?t afford\b/i,
      /\bover (?:my|our) budget\b/i,
      /\b(?:a )?lot of money\b/i,
      /\bway (?:too|over)\b[^.]*\b(?:expensive|much|budget|pricey|price)\b/i,
      /\bexpensive\b/i,
      /\bpricey\b/i,
      /\bbudget\b[^.]*\b(?:tight|set aside|don'?t have)\b/i,
    ],
  ],
  [
    'authority',
    [
      /\b(?:talk|speak|check|run|loop) (?:this |it |them )?(?:to|with|by|in) (?:my |the |our |her |his |their )?(?:\w+ ){0,2}(?:wife|husband|partner|spouse|boss|manager|team|cofounder|co-founder|leadership|procurement|board|committee)\b/i,
      /\b(?:not|n'?t)(?: only)? my (?:call|decision)\b/i,
      /\bowns? (?:this|the) budget\b/i,
      /\b(?:need|get|require)[^.]*\bsign[- ]?off\b/i,
    ],
  ],
  [
    'comparison',
    [
      /\bother (?:vendor|option|provider)s?\b/i,
      /\b(?:speak|talk) (?:to|with) (?:other|another|some|a couple)\b/i,
      /\bevaluate (?:some )?alternativ/i,
      /\balready (?:have|use|using|got|on) [^.]{0,25}\b(?:vendor|tool|solution|system|platform|provider)\b/i,
      /\bdue diligence\b/i,
      /\bhow do you compare\b/i,
      /\bcouple of quotes\b/i,
    ],
  ],
  [
    'time',
    [
      /\bdon'?t have (?:the )?time\b/i,
      /\bno (?:time|bandwidth)\b/i,
      /\btoo busy\b/i,
      /\bslammed\b/i,
      /\b(?:isn'?t|not|no)(?: really)? a good time\b/i,
      /\bmaybe in (?:\d+|a few|six|three) months?\b/i,
    ],
  ],
  [
    'skepticism',
    [
      /\b(?:burned|burnt)\b/i,
      /\btried (?:something|this|that|it)\b[^.]*(?:before|already)\b/i,
      /\btoo good to be true\b/i,
      /\bskeptical\b/i,
      /\bdidn'?t work\b/i,
    ],
  ],
  [
    'avoidance',
    [
      // The determiner is optional and independent of the noun — "send me the
      // info" and "send info over" are both common, and an alternation that
      // fuses them ("the deck" as one branch) misses half the real phrasings.
      /\bsend (?:me |over |it )?(?:the |some |a )?(?:info|information|deck|materials|pricing|details|proposal)\b/i,
      /\bjust send\b/i,
      /\breview it (?:later|on my own)\b/i,
      /\bemail me\b/i,
    ],
  ],
  [
    'resistance',
    [
      /\bpushy\b/i,
      /\bhard sell\b/i,
      /\bpushing (?:too )?hard\b/i,
      /\bsold to\b/i,
      /\baggressive\b/i,
    ],
  ],
  [
    'self_doubt',
    [
      /\bdon'?t think (?:we|i) can\b/i,
      /\btoo many (?:other )?responsibilit/i,
      /\bkind of different\b/i,
      /\b(?:we|i)'?re (?:kind of )?different\b/i,
      /\bdoesn'?t fit us\b/i,
      /\bdon'?t think this fits\b/i,
    ],
  ],
  // Stall is LAST: "let me think about it" frequently rides along with a more
  // specific archetype ("too expensive, let me think"), and the specific one is
  // the objection actually worth working.
  [
    'stall',
    [
      /\bthink (?:about it|it over)\b/i,
      /\bsleep on it\b/i,
      /\bget back to (?:you|me)\b/i,
      /\bcircle back\b/i,
      /\bnot ready to (?:commit|decide|move|buy|sign|go)\b/i,
      /\bneed (?:some )?time\b/i,
      /\bnot sure\b/i,
    ],
  ],
];

/**
 * Which archetype is this turn anchored on? Null when nothing matches
 * confidently — the caller then falls through to the LLM path.
 */
export function detectOpenerArchetype(text: string): OpenerArchetype | null {
  const t = text.trim();
  if (!t) return null;
  for (const [archetype, patterns] of ARCHETYPE_PATTERNS) {
    for (const p of patterns) {
      if (p.test(t)) return archetype;
    }
  }
  return null;
}

/**
 * Canonical disarm+isolate opener per archetype, condensed from
 * reframe-library.md to the ≤18 words the rep can actually read mid-call.
 *
 * `{goal}` is substituted with the workspace's own outcome phrase when one is
 * available, and the sentence is rewritten without it otherwise — a rep must
 * never see a brace. Every variant is a complete spoken sentence.
 */
const OPENERS: Record<OpenerArchetype, { withGoal: (goal: string) => string; noGoal: string }> = {
  price: {
    withGoal: (g) => `Money aside for a second — do you feel this actually gets you to ${g}?`,
    noGoal: `Not a problem at all — money aside for a second, do you feel this actually solves it?`,
  },
  stall: {
    withGoal: () => `Not a problem at all. What are you actually wanting to go over in your head?`,
    noGoal: `Not a problem at all. What are you actually wanting to go over in your head?`,
  },
  authority: {
    withGoal: () =>
      `Of course. Quick one — when this is running, will they be on the calls with you?`,
    noGoal: `Of course. Quick one — when this is running, will they be on the calls with you?`,
  },
  comparison: {
    withGoal: () =>
      `Completely understand. How will you know if someone gets you a better result before you try?`,
    noGoal: `Completely understand. How will you know if someone gets you a better result before you try?`,
  },
  time: {
    withGoal: (g) =>
      `Everyone's got the same 24 hours — so is getting to ${g} actually a priority right now?`,
    noGoal: `Everyone's got the same 24 hours — so the real question is, is this a priority right now?`,
  },
  skepticism: {
    withGoal: () =>
      `Completely fair, I'd be skeptical too. What would you need to see to feel it's different?`,
    noGoal: `Completely fair, I'd be skeptical too. What would you need to see to feel it's different?`,
  },
  self_doubt: {
    withGoal: (g) =>
      `Fair enough. If budget and risk weren't issues, would ${g} actually be the right outcome here?`,
    noGoal: `Fair enough. If budget and risk weren't issues, would you say the fit is actually there?`,
  },
  resistance: {
    withGoal: () =>
      `Can I check something — have I actually asked you to buy anything on this call?`,
    noGoal: `Can I check something — have I actually asked you to buy anything on this call?`,
  },
  avoidance: {
    withGoal: () => `Happy to send it over. How will you know it's a fit just from a deck, though?`,
    noGoal: `Happy to send it over. How will you know it's a fit just from a deck, though?`,
  },
};

/**
 * Pull a short outcome phrase out of the workspace business-context block, for
 * the `{goal}` slot. Looks at the problem/offer lines, takes a clause, and caps
 * it so the opener stays inside the word budget. Returns null when nothing
 * short and clean is available — better a slightly generic complete sentence
 * than an unreadable one.
 */
export function extractGoalPhrase(businessContext: string | null): string | null {
  if (!businessContext) return null;
  for (const label of ['Problem we solve:', 'Offer:', 'Why us:']) {
    const line = businessContext.split('\n').find((l) => l.startsWith(label));
    if (!line) continue;
    const raw = line.slice(label.length).trim();
    if (!raw) continue;
    // First clause only, and strip a trailing period.
    const clause =
      raw
        .split(/[,.;–—]/)[0]
        ?.trim()
        .replace(/\.$/, '') ?? '';
    const words = clause.split(/\s+/).filter(Boolean);
    // ≤5 words: the longest opener template is already 19 words, so anything
    // wordier blows the 18-word line budget once substituted. `instantOpener`
    // enforces the real constraint on the assembled line regardless — this is
    // just a cheap pre-filter.
    if (words.length >= 2 && words.length <= 5) return clause.toLowerCase();
  }
  return null;
}

/** The rep reads this off a screen mid-call; past ~18 words they lose their place. */
const OPENER_WORD_BUDGET = 18;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export interface InstantOpener {
  archetype: OpenerArchetype;
  line: string;
}

/**
 * The canonical opening move for a freshly-raised objection, or null when no
 * archetype matches confidently.
 *
 * Caller contract: only invoke when the turn is a detected objection AND no
 * episode is already open. Mid-loop turns must go to the LLM — that is where
 * adaptation to the prospect's actual words carries the value.
 */
export function instantOpener(
  customerText: string,
  businessContext: string | null,
): InstantOpener | null {
  const archetype = detectOpenerArchetype(customerText);
  if (!archetype) return null;
  const t = OPENERS[archetype];
  const goal = extractGoalPhrase(businessContext);

  // Enforce the budget on the ASSEMBLED line, not on the goal phrase. Checking
  // the ingredient is a proxy and it failed: a 7-word goal is fine in
  // isolation but pushes the 19-word price template to 26. When substitution
  // overflows, fall back to the goal-free variant — still a complete, on-method
  // sentence, just not personalised.
  if (goal) {
    const withGoal = t.withGoal(goal);
    if (wordCount(withGoal) <= OPENER_WORD_BUDGET) return { archetype, line: withGoal };
  }
  return { archetype, line: t.noGoal };
}

// ─── Mid-loop canonical steps ──────────────────────────────────────────────
//
// The same argument that makes the opener model-free extends to most of the
// rest of the loop: the wording of uncover / justify / consequence /
// identity_close is determined by WHICH STEP you are on, not by what the
// prospect just said. "And why do you think that is?" is the justify step
// whatever they justified. A trained rep does not deliberate over these either.
//
// REFRAME is the exception and deliberately stays on the LLM: it has to land in
// the prospect's own words and numbers, which is precisely the adaptation a
// template cannot do. So the model is spent on the one step that needs it.

/** Steps that have a canonical line. `reframe` is absent on purpose. */
const STEP_LINES: Partial<Record<LoopStep, string>> = {
  uncover: `So what's the real thing you'd want to think through before this is a yes?`,
  justify: `And why do you think that is?`,
  consequence: `So if nothing changes for the next two quarters, what does that cost you?`,
  identity_close: `So what decision do you feel you need to make to not be in that spot?`,
};

/** Loop steps, in the order a turn advances through them. */
export type LoopStep =
  | 'disarm'
  | 'isolate'
  | 'uncover'
  | 'reframe'
  | 'justify'
  | 'consequence'
  | 'identity_close';

const LADDER: readonly LoopStep[] = [
  'disarm',
  'isolate',
  'uncover',
  'reframe',
  'justify',
  'consequence',
  'identity_close',
];

/** The step after `current`, or null at the end of the loop. */
export function nextLoopStep(current: LoopStep): LoopStep | null {
  const i = LADDER.indexOf(current);
  if (i < 0 || i === LADDER.length - 1) return null;
  return LADDER[i + 1] ?? null;
}

export interface InstantStep {
  step: LoopStep;
  line: string;
}

/**
 * The canonical line for the next step of an open objection episode, or null
 * when that step needs the model (reframe), the loop is finished, or the
 * prospect's turn suggests the ladder no longer applies.
 *
 * `customerText` is checked for a question: if the prospect asked something
 * outright, they want an answer, and marching on with the next Socratic step
 * would talk past them. Those turns go to the LLM, which can actually answer
 * from the chunks.
 */
export function instantStep(currentStep: LoopStep, customerText: string): InstantStep | null {
  if (customerText.includes('?')) return null;
  const step = nextLoopStep(currentStep);
  if (!step) return null;
  const line = STEP_LINES[step];
  if (!line) return null; // reframe — needs the model
  return { step, line };
}
