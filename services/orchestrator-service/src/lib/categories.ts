/** PRD F4 — closed set of intent categories. */
export const INTENT_CATEGORIES = [
  'pricing',
  'implementation',
  'security',
  'integration',
  'procurement',
  'competitor',
  'timeline',
  'authority',
  'budget',
  'next_steps',
  'product_fit',
  'objection',
  'technical_validation',
  'feature_request',
  'none',
] as const;

export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export const STAGE_SIGNALS = [
  'opener',
  'qualification',
  'discovery',
  'demo',
  'objection_handling',
  'closing',
] as const;

export type StageSignal = (typeof STAGE_SIGNALS)[number];

/**
 * Cheap deterministic intent heuristic. Scans for high-signal keywords per category.
 * Used as Stage A in dev / when no LLM is configured. Returns up to 3 categories
 * sorted by score, plus a stage signal and an urgency score.
 */
const KEYWORDS: Record<Exclude<IntentCategory, 'none'>, RegExp[]> = {
  pricing: [/\bprice\b/i, /\bpricing\b/i, /\bcost\b/i, /\bquote\b/i, /\bdiscount\b/i, /\bplan\b/i, /\bseat\b/i, /\bper user\b/i],
  implementation: [/\bonboard/i, /\bimplement/i, /\bdeploy/i, /\brollout\b/i, /\bsetup\b/i, /\binstall/i],
  security: [/\bsecurity\b/i, /\bsoc\s*2\b/i, /\bgdpr\b/i, /\bhipaa\b/i, /\bencrypt/i, /\bretention\b/i, /\bcompliance\b/i, /\bdata\s+(?:retention|privacy)\b/i],
  integration: [/\bintegrat/i, /\bapi\b/i, /\bwebhook/i, /\bzapier\b/i, /\bsalesforce\b/i, /\bhubspot\b/i, /\bsso\b/i],
  procurement: [/\bprocurement\b/i, /\blegal\b/i, /\bcontract\b/i, /\bmsa\b/i, /\bredline/i, /\bvendor\s+review\b/i],
  competitor: [/\bvs\.?\b/i, /\bcompar/i, /\balternative\b/i, /\bcompetitor\b/i, /\binstead of\b/i],
  timeline: [/\btimeline\b/i, /\bwhen can\b/i, /\bgo[- ]live\b/i, /\bschedule\b/i, /\bquarter\b/i, /\bdeadline\b/i],
  authority: [/\bdecision[-\s]maker\b/i, /\bsign[-\s]off\b/i, /\bapprove\b/i, /\bwho\s+(?:owns|decides)\b/i],
  budget: [/\bbudget\b/i, /\bspend\b/i, /\bfunded\b/i, /\bpo\b/i],
  next_steps: [/\bnext step/i, /\bfollow up\b/i, /\bsend over\b/i],
  product_fit: [/\buse case\b/i, /\bworkflow\b/i, /\bteam size\b/i, /\bdoes (?:it|this) (?:work|support)/i],
  objection: [
    /\b(?:concern|worri|hesitat|skeptic)/i,
    /\btoo expensive\b/i,
    /\bnot sure\b/i,
    // Stall + price + authority + comparison + time + skepticism phrasings
    // recognised by the Andres reframe library.
    /\bthink (?:about|it over)\b/i,
    /\bsleep on it\b/i,
    /\bget back to (?:you|me)\b/i,
    /\b(?:talk|speak|check) (?:to|with) (?:my )?(?:wife|husband|partner|spouse|boss|manager|team|cofounder|co-founder)\b/i,
    /\bother (?:vendor|option|provider)s?\b/i,
    /\bcompare\b/i,
    /\bdon'?t have (?:the )?time\b/i,
    /\bbusy\b/i,
    /\b(?:burned|burnt) before\b/i,
    /\btried (?:something|this) (?:like )?(?:before|already)\b/i,
    /\bjust send (?:me )?(?:info|the deck|materials)\b/i,
    /\bcan'?t afford\b/i,
    /\bover (?:my|our) budget\b/i,
    /\bpushy\b/i,
  ],
  technical_validation: [/\bbenchmark/i, /\bperformance\b/i, /\blatency\b/i, /\bload test\b/i, /\bscale\b/i],
  feature_request: [/\bcan you (?:add|support)\b/i, /\bdoes it have\b/i, /\bfeature\b/i],
};

const STAGE_KEYWORDS: Record<StageSignal, RegExp[]> = {
  opener: [/\bnice to (?:meet|see)\b/i, /\bthanks for (?:joining|jumping)/i, /\bquick intro/i],
  qualification: [/\bteam size\b/i, /\bhow many (?:reps|users|seats)\b/i, /\bwhat (?:do|does) you/i],
  discovery: [/\bcurrently\b/i, /\btoday we\b/i, /\bworkflow\b/i, /\bhow do you\b/i],
  demo: [/\blet me show\b/i, /\bover here\b/i, /\bclick here\b/i, /\bif I\b/i],
  objection_handling: [/\bbut\b/i, /\bhowever\b/i, /\bconcern/i, /\bworri/i],
  closing: [/\bnext step/i, /\bfollow up\b/i, /\bcontract\b/i, /\bsend over\b/i, /\bbook (?:a|the) follow/i],
};

export interface ScoredCategory {
  category: IntentCategory;
  score: number;
}

export interface HeuristicResult {
  categories: ScoredCategory[];
  stageSignal: StageSignal;
  urgencyScore: number;
  confidence: number;
}

export function classifyHeuristic(text: string): HeuristicResult {
  const t = text.trim();
  if (!t) {
    return {
      categories: [{ category: 'none', score: 1 }],
      stageSignal: 'discovery',
      urgencyScore: 0,
      confidence: 1,
    };
  }

  const scores = new Map<IntentCategory, number>();
  for (const [cat, patterns] of Object.entries(KEYWORDS) as Array<
    [Exclude<IntentCategory, 'none'>, RegExp[]]
  >) {
    let s = 0;
    for (const p of patterns) if (p.test(t)) s += 1;
    if (s > 0) scores.set(cat, s);
  }

  // Question marks raise urgency.
  const questionMarks = (t.match(/\?/g) ?? []).length;
  const hasObjectionWords =
    /\b(?:but|however|concern|worri|skeptic|too|expensive|afford|think|sleep on|talk to|wife|husband|partner|cofounder|co-founder|burned|burnt|other (?:vendor|option)|compare|too expensive|not sure)\b/i.test(
      t,
    );

  let categories: ScoredCategory[];
  if (scores.size === 0) {
    categories = [{ category: 'none', score: 1 }];
  } else {
    categories = [...scores.entries()]
      .map(([category, score]) => ({ category, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  // Stage signal — pick highest-scoring stage; default to discovery.
  let bestStage: StageSignal = 'discovery';
  let bestStageScore = 0;
  for (const [stage, patterns] of Object.entries(STAGE_KEYWORDS) as Array<
    [StageSignal, RegExp[]]
  >) {
    let s = 0;
    for (const p of patterns) if (p.test(t)) s += 1;
    if (s > bestStageScore) {
      bestStageScore = s;
      bestStage = stage;
    }
  }
  if (hasObjectionWords) bestStage = 'objection_handling';

  // Urgency: presence of question + categorized + objection + length.
  const cap = (n: number) => Math.max(0, Math.min(1, n));
  const urgencyScore = cap(
    (questionMarks > 0 ? 0.4 : 0) +
      (scores.size > 0 ? 0.3 : 0) +
      (hasObjectionWords ? 0.2 : 0) +
      Math.min(0.1, t.length / 1000),
  );

  const confidence = scores.size === 0 ? 0.5 : cap(0.55 + 0.1 * scores.size);

  return { categories, stageSignal: bestStage, urgencyScore, confidence };
}
