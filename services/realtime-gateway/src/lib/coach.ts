/**
 * In-process coach: classify → retrieve → suggest. Mirrors the orchestrator
 * service, kept in-process for hot-path latency. The two MUST stay in sync —
 * change one, change the other (audited together by tenant-isolation reviewer).
 */
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import { emitLatency } from './latency.js';

const INTENT_CATEGORIES = [
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
type IntentCategory = (typeof INTENT_CATEGORIES)[number];

const STAGE_SIGNALS = [
  'opener',
  'qualification',
  'discovery',
  'demo',
  'objection_handling',
  'closing',
] as const;
type StageSignal = (typeof STAGE_SIGNALS)[number];

const KEYWORDS: Record<Exclude<IntentCategory, 'none'>, RegExp[]> = {
  pricing: [
    /\bprice\b/i,
    /\bpricing\b/i,
    /\bcost\b/i,
    /\bquote\b/i,
    /\bdiscount\b/i,
    /\bplan\b/i,
    /\bseat\b/i,
    /\bper user\b/i,
  ],
  implementation: [
    /\bonboard/i,
    /\bimplement/i,
    /\bdeploy/i,
    /\brollout\b/i,
    /\bsetup\b/i,
    /\binstall/i,
  ],
  security: [
    /\bsecurity\b/i,
    /\bsoc\s*2\b/i,
    /\bgdpr\b/i,
    /\bhipaa\b/i,
    /\bencrypt/i,
    /\bretention\b/i,
    /\bcompliance\b/i,
    /\bdata\s+(?:retention|privacy)\b/i,
  ],
  integration: [
    /\bintegrat/i,
    /\bapi\b/i,
    /\bwebhook/i,
    /\bzapier\b/i,
    /\bsalesforce\b/i,
    /\bhubspot\b/i,
    /\bsso\b/i,
  ],
  procurement: [
    /\bprocurement\b/i,
    /\blegal\b/i,
    /\bcontract\b/i,
    /\bmsa\b/i,
    /\bredline/i,
    /\bvendor\s+review\b/i,
  ],
  competitor: [
    /\bvs\.?\b/i,
    /\bcompar/i,
    /\balternative\b/i,
    /\bcompetitor\b/i,
    /\binstead of\b/i,
    /\balready (?:have|use|using)\b/i,
    /\bhave a (?:vendor|solution|tool|system|platform)\b/i,
    /\busing (?:another|a different|an existing)\b/i,
  ],
  timeline: [
    /\btimeline\b/i,
    /\bwhen can\b/i,
    /\bgo[- ]live\b/i,
    /\bschedule\b/i,
    /\bquarter\b/i,
    /\bdeadline\b/i,
  ],
  authority: [
    /\bdecision[-\s]maker\b/i,
    /\bsign[-\s]off\b/i,
    /\bapprove\b/i,
    /\bwho\s+(?:owns|decides)\b/i,
  ],
  budget: [/\bbudget\b/i, /\bspend\b/i, /\bfunded\b/i, /\bpo\b/i],
  next_steps: [/\bnext step/i, /\bfollow up\b/i, /\bsend over\b/i],
  product_fit: [
    /\buse case\b/i,
    /\bworkflow\b/i,
    /\bteam size\b/i,
    /\bdoes (?:it|this) (?:work|support)/i,
  ],
  objection: [
    /\b(?:concern|worri|hesitat|skeptic)/i,
    /\btoo expensive\b/i,
    /\bnot sure\b/i,
    // Andres-archetype phrasings
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
    /\bsend (?:me )?(?:some )?(?:info|the deck|materials|it over)\b/i,
    /\bemail me\b/i,
    /\breview it (?:later|on my own)\b/i,
    /\bcan'?t afford\b/i,
    /\bover (?:my|our) budget\b/i,
    /\bpushy\b/i,
    /\blot of money\b/i,
    /\bbefore (?:i )?committ?ing\b/i,
    /\bcommit\b/i,
    // Authority — deferring the decision to someone else.
    /\brun (?:this|it) by\b/i,
    /\b(?:check|clear) (?:this|it|with)\b.*\b(?:boss|manager|team|partner|procurement|leadership)\b/i,
    /\bnot (?:only )?my (?:call|decision)\b/i,
    /\bsign[- ]off\b/i,
    /\bowns? (?:this|the) budget\b/i,
    // Stall / time.
    /\bcircle back\b/i,
    /\bnot ready\b/i,
    /\bbandwidth\b/i,
    /\bslammed\b/i,
    /\bnot a good time\b/i,
    /\banother (?:project|thing) (?:in|right now)\b/i,
    // Skepticism.
    /\btoo good to be true\b/i,
    /\bmove the needle\b/i,
    /\bdidn'?t work\b/i,
    // Self-doubt.
    /\bdon'?t think (?:we|i) can\b/i,
    /\bfits? us\b/i,
    /\btoo many (?:other )?(?:responsibilit|things)/i,
    /\b(?:won'?t|can'?t) (?:have the |keep the )?disciplin/i,
    /\bwe'?re (?:kind of |a bit )?different\b/i,
    // Resistance.
    /\bhard sell\b/i,
    /\bsold to\b/i,
    /\bpushing (?:too )?hard\b/i,
    /\bslow down\b/i,
    // Price.
    /\bsteep\b/i,
    /\bway over\b/i,
    /\bserious discount\b/i,
    // Comparison — incumbent already in place.
    /\balready (?:have|use|using|got|on)\b/i,
    /\bdifferent (?:tool|vendor|solution|system|platform)\b/i,
  ],
  technical_validation: [
    /\bbenchmark/i,
    /\bperformance\b/i,
    /\blatency\b/i,
    /\bload test\b/i,
    /\bscale\b/i,
  ],
  feature_request: [/\bcan you (?:add|support)\b/i, /\bdoes it have\b/i, /\bfeature\b/i],
};

const STAGE_KEYWORDS: Record<StageSignal, RegExp[]> = {
  opener: [/\bnice to (?:meet|see)\b/i, /\bthanks for (?:joining|jumping)/i, /\bquick intro/i],
  qualification: [/\bteam size\b/i, /\bhow many (?:reps|users|seats)\b/i],
  discovery: [/\bcurrently\b/i, /\btoday we\b/i, /\bworkflow\b/i, /\bhow do you\b/i],
  demo: [/\blet me show\b/i, /\bover here\b/i, /\bclick here\b/i],
  objection_handling: [/\bbut\b/i, /\bhowever\b/i, /\bconcern/i, /\bworri/i],
  closing: [/\bnext step/i, /\bfollow up\b/i, /\bcontract\b/i, /\bsend over\b/i],
};

export interface HeuristicResult {
  categories: IntentCategory[];
  stageSignal: StageSignal;
  urgencyScore: number;
  confidence: number;
  /** True when the turn carries any objection signal (category, objection
   *  words, or objection-handling stage). Objections bypass the urgency gate —
   *  we never drop a real objection just because its numeric score is low
   *  (the A4 weakness: single-signal objections scored ~0.30 < 0.35). */
  isObjection: boolean;
}

export function classifyHeuristic(text: string): HeuristicResult {
  const t = text.trim();
  if (!t) {
    return {
      categories: ['none'],
      stageSignal: 'discovery',
      urgencyScore: 0,
      confidence: 1,
      isObjection: false,
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
  const questionMarks = (t.match(/\?/g) ?? []).length;
  const hasObjectionWords =
    /\b(?:but|however|concern|worri|skeptic|too|expensive|afford|think|sleep on|talk to|wife|husband|partner|cofounder|co-founder|burned|burnt|other (?:vendor|option)|compare|too expensive|not sure|money|commit|busy|already (?:have|use)|have a vendor|have a solution)\b/i.test(
      t,
    );
  const cats: IntentCategory[] =
    scores.size === 0
      ? ['none']
      : [...scores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([c]) => c);
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
  const cap = (n: number) => Math.max(0, Math.min(1, n));
  const urgencyScore = cap(
    (questionMarks > 0 ? 0.4 : 0) +
      (scores.size > 0 ? 0.3 : 0) +
      (hasObjectionWords ? 0.2 : 0) +
      Math.min(0.1, t.length / 1000),
  );
  const confidence = scores.size === 0 ? 0.5 : cap(0.55 + 0.1 * scores.size);
  const isObjection =
    cats.includes('objection') || hasObjectionWords || bestStage === 'objection_handling';
  return { categories: cats, stageSignal: bestStage, urgencyScore, confidence, isObjection };
}

interface ChunkRow {
  id: string;
  chunk_text: string;
  document_version_id: string;
  language: string;
  score: number;
  document_name: string | null;
  document_category: string | null;
}

interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  documentVersionId: string;
  category: string | null;
  documentName: string | null;
  language: string;
}

function vectorLiteral(v: readonly number[]): string {
  return `[${v
    .map((x) => {
      if (!Number.isFinite(x)) throw new Error('non-finite vector');
      return Number(x);
    })
    .join(',')}]`;
}

/** Intent categories that should trigger the objection-first two-pass — kept in
 *  sync with the orchestrator (OBJECTION_INTENT_CATEGORIES). When the prospect
 *  turn looks like an objection, we want the seeded reframe library AND the
 *  BMC-specific objection→solution matrix (both `objection-handling-*`) surfaced
 *  even when their raw semantic score trails a generic FAQ chunk. */
const OBJECTION_INTENT_CATEGORIES = new Set<IntentCategory>([
  'objection',
  'pricing',
  'authority',
  'budget',
  'timeline',
  'competitor',
]);

const OBJECTION_CATEGORY_PREFIX = 'objection-handling-';

/** How many chunks to carry into the LLM prompt. The orchestrator uses 5;
 *  the live path was cut to 3 during the latency overhaul, which starved
 *  objection turns of the reframe-library + matrix chunks that must compete
 *  with generic FAQ hits. 5 restores headroom without materially growing the
 *  prompt (chunks are ~500 tokens). */
const RETRIEVAL_TOP_K = 5;

/** How many prior turns the reactive prompt carries. The model needs enough
 *  history to locate itself in the objection loop (did the rep already
 *  disarm? did the prospect concede value?). 3 was too shallow to pick the
 *  correct NEXT step. */
const REACTIVE_CONTEXT_TURNS = 6;

/** Merge objection-restricted rows ahead of general rows, dedup by id
 *  (first occurrence wins, preserving objection-first order), and cap to
 *  `limit`. Pure — exported for unit testing the ranking contract. */
export function mergeObjectionFirst<T extends { id: string }>(
  objectionRows: readonly T[],
  generalRows: readonly T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...objectionRows, ...generalRows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.slice(0, limit);
}

/** One hybrid (semantic + trigram) pass, optionally restricted to a document
 *  category prefix. workspace_id is the FIRST predicate (F10). */
async function retrievePass(
  workspaceId: string,
  qVec: readonly number[],
  query: string,
  language: string | null,
  categoryPrefix: string | null,
  limit: number,
): Promise<ChunkRow[]> {
  return prisma.$queryRawUnsafe<ChunkRow[]>(
    `
    WITH semantic AS (
      SELECT kc.id, kc.chunk_text, kc.document_version_id, kc.language,
             1 - (kc.embedding <=> $1::vector) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND ($3::text IS NULL OR kc.language = $3)
      ORDER BY kc.embedding <=> $1::vector
      LIMIT 12
    ),
    keyword AS (
      SELECT kc.id, similarity(kc.chunk_text, $4::text) AS score
      FROM knowledge_chunks kc
      WHERE kc.workspace_id = $2::uuid
        AND kc.active = true
        AND kc.chunk_text % $4::text
      ORDER BY similarity(kc.chunk_text, $4::text) DESC
      LIMIT 12
    ),
    combined AS (
      SELECT id, score FROM semantic
      UNION ALL SELECT id, score * 0.5 FROM keyword
    ),
    aggregated AS (
      SELECT id, MAX(score) AS score FROM combined GROUP BY id
    )
    SELECT kc.id, kc.chunk_text, kc.document_version_id, kc.language,
           a.score, kd.name AS document_name, kd.category AS document_category
    FROM aggregated a
    JOIN knowledge_chunks kc ON kc.id = a.id
    JOIN knowledge_document_versions kdv ON kdv.id = kc.document_version_id
    JOIN knowledge_documents kd ON kd.id = kdv.document_id
    WHERE kc.workspace_id = $2::uuid
      AND ($5::text IS NULL OR kd.category LIKE $5)
    ORDER BY a.score DESC
    LIMIT $6
    `,
    vectorLiteral(qVec),
    workspaceId,
    language,
    query,
    categoryPrefix ? `${categoryPrefix}%` : null,
    limit,
  );
}

async function retrieve(
  workspaceId: string,
  query: string,
  embeddings: EmbeddingClient,
  categories: readonly IntentCategory[],
  language: string | null,
): Promise<RetrievedChunk[]> {
  const { vectors } = await embeddings.embed({ workspaceId, texts: [query] });
  const qVec = vectors[0];
  if (!qVec) return [];

  const objectionFirst = categories.some((c) => OBJECTION_INTENT_CATEGORIES.has(c));

  let rows: ChunkRow[];
  if (objectionFirst) {
    // Pass 1: the reframe library + BMC objection matrix. Pass 2: unrestricted.
    // Merge objection-first (dedup by id) so a pre-baked grounded reframe wins
    // over a generic chunk even at a slightly lower score. Mirrors the
    // orchestrator's two-pass.
    const [objectionRows, generalRows] = await Promise.all([
      retrievePass(workspaceId, qVec, query, language, OBJECTION_CATEGORY_PREFIX, RETRIEVAL_TOP_K),
      retrievePass(workspaceId, qVec, query, language, null, RETRIEVAL_TOP_K),
    ]);
    // Objection-first ordering (matrix/reframe chunks lead), deduped and
    // capped so the prompt doesn't balloon to 2×TOP_K.
    rows = mergeObjectionFirst(objectionRows, generalRows, RETRIEVAL_TOP_K);
  } else {
    rows = await retrievePass(workspaceId, qVec, query, language, null, RETRIEVAL_TOP_K);
  }

  const minScore = Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.1);
  return rows
    .filter((r) => r.score >= (Number.isFinite(minScore) ? minScore : 0.1))
    .map((r) => ({
      id: r.id,
      text: r.chunk_text,
      score: Number(r.score),
      documentVersionId: r.document_version_id,
      category: r.document_category,
      documentName: r.document_name,
      language: r.language,
    }));
}

// ─── F18: objection episode state machine ──────────────────────────────────
//
// An "episode" is one objection tracked across turns so the coach gives the
// NEXT step of the Socratic reframe loop instead of a disconnected one-liner.
// The LLM already reads the turn + context; we let it ALSO report where the
// objection is in the loop (one call, zero extra latency). The handler holds
// the open episode in memory and threads it back each turn for continuity.

export const OBJECTION_ARCHETYPES = [
  'price',
  'stall',
  'authority',
  'comparison',
  'time',
  'skepticism',
  'self_doubt',
  'resistance',
  'avoidance',
] as const;
export type ObjectionArchetype = (typeof OBJECTION_ARCHETYPES)[number];

export const LOOP_STEPS = [
  'disarm',
  'isolate',
  'uncover',
  'reframe',
  'justify',
  'consequence',
  'identity_close',
] as const;
export type LoopStep = (typeof LOOP_STEPS)[number];

/** After this many prospect deflections mid-loop, stop reframing and fall back
 *  to plain answer/coach mode (per the skill's "If they deflect" guidance). */
const MAX_DEFLECTIONS = 2;

/** In-memory episode state the handler threads across turns for one meeting. */
export interface EpisodeState {
  id: string;
  archetype: ObjectionArchetype;
  currentStep: LoopStep;
  reframeUsed: string | null;
  deflections: number;
}

/** The episode block the LLM appends when the turn is objection-related. All
 *  fields optional so non-objection turns can omit it entirely. */
const EpisodeReport = z.object({
  is_objection: z.boolean(),
  archetype: z.enum(OBJECTION_ARCHETYPES).nullable().optional(),
  step: z.enum(LOOP_STEPS).nullable().optional(),
  /** open = keep working the loop; resolved = prospect satisfied; abandoned =
   *  prospect moved on / disengaged. */
  status: z.enum(['open', 'resolved', 'abandoned']).optional(),
  /** Set when the model picks a named reframe (e.g. "opportunity_cost"). */
  reframe: z.string().nullable().optional(),
  /** True when this turn is the prospect deflecting away from the reframe. */
  deflected: z.boolean().optional(),
});

const SuggestSchema = z.object({
  type: z.enum(['answer', 'ask_next', 'coach', 'risk']),
  answer_text: z.string().nullable(),
  followup_text: z.string().nullable(),
  source_chunk_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  episode: EpisodeReport.optional(),
});

const SUGGEST_SYSTEM = `You are an expert sales coach whispering to the rep on a live call. The
prospect just spoke — generate ONE grounded, contextual suggestion.

You have two context sources:
1. APPROVED CHUNKS — verified facts about the product/company. Cite these
   when stating a factual claim about the product (price, integration,
   security, timeline, etc). Chunks tagged "objection-handling-*" are the
   workspace's reframe library and pre-baked objection→answer matrix.
2. WORKSPACE PLAYBOOK (when present) — methodology and tone the rep
   follows. Treat as a FRAMEWORK and SKILL. DO NOT quote it verbatim.
3. BUSINESS CONTEXT (when present) — the rep's own offer, buyer, pricing,
   and differentiators. Tailor every suggestion to it: name their real
   value and numbers, never a generic pitch. It is background, not a
   citable chunk.

OBJECTION HANDLING — the core skill. When the prospect turn is an objection
(price / "too expensive", stall / "think about it", authority / "talk to my
partner", time, skepticism / "got burned before", comparison / "other
vendors", self-doubt, avoidance / "just send info"), do NOT answer with a
generic rebuttal. The workspace runs the Socratic reframe loop:

  DISARM → ISOLATE → UNCOVER → REFRAME → JUSTIFY → CONSEQUENCE → IDENTITY CLOSE

Read the recent turns to find where this objection already is in the loop,
then output the SINGLE NEXT step the rep should say right now — never the
whole loop:
- Objection just raised, nothing addressed yet → DISARM + ISOLATE
  ("[concern] aside for a second, do you actually feel this gets you to
  <their goal>?").
- Value already confirmed → UNCOVER the real concern ("what's the real thing
  you'd want to think through?").
- Real concern surfaced → REFRAME using the matching reframe-library chunk,
  in the prospect's own numbers/words.
- Reframe landed / prospect conceded → JUSTIFY ("why do you think that is?")
  — make them defend the new frame; do NOT re-explain it.
- New frame justified → CONSEQUENCE (cost of staying the same) then IDENTITY
  CLOSE (what the future version of them decides today).
Pick ONE move. Ground any factual claim in a chunk; the reframe move itself
is type "coach".

EPISODE TRACKING. If an "OPEN OBJECTION EPISODE" block is present in the user
message, this objection is already in progress — CONTINUE from the step shown
(do NOT restart at disarm), keep the same archetype, and advance ONE step.
Report the loop state in the "episode" field every turn:
- Non-objection turn → {"is_objection": false}.
- New objection, no open episode → is_objection true, set archetype + step
  you just executed, status "open".
- Continuing an open episode → is_objection true, same archetype, the step you
  just advanced to, status "open" (or "resolved" if the prospect is satisfied,
  "abandoned" if they disengaged / changed subject).
- If the prospect just pushed back on your reframe, set "deflected": true.

Output ONLY raw JSON (no markdown, no prose, no \`\`\` fences):
{"type":"answer"|"ask_next"|"coach"|"risk","answer_text":<str|null>,"followup_text":<str|null>,"source_chunk_ids":["<exact UUID from id= field>"],"confidence":<0..1>,"rationale":<short>,"episode":{"is_objection":<bool>,"archetype":<price|stall|authority|comparison|time|skepticism|self_doubt|resistance|avoidance|null>,"step":<disarm|isolate|uncover|reframe|justify|consequence|identity_close|null>,"status":"open"|"resolved"|"abandoned","reframe":<str|null>,"deflected":<bool>}}

Hard rules:
- answer_text comes from CHUNKS only. NEVER invent facts.
- source_chunk_ids MUST contain the exact UUID after "CHUNK_ID:" in the
  chunk header. NEVER use bracket numbers like [1] or [2].
- ≤30 words. Plain conversational English. No marketing language. No "I" voice.
- The playbook is methodology, not source — never cite it as a chunk id.
- One move per turn. Never stack two reframes or replay the whole loop.
- Output raw JSON only. No text before or after the JSON object.`;

// ─── Published script grounding ────────────────────────────────────────────
//
// Loads the published ScriptVersion blocks per workspace + caches in-memory
// for 60s. The matching `stage_signal` body is appended to the Stage C user
// prompt so suggestions track the workspace's official playbook.

// ─── Business context block (F21) ──────────────────────────────────────────
//
// A compact, per-workspace summary of the offer / ICP / differentiators /
// pricing built from the workspace BMC, injected into every coach prompt so
// suggestions are grounded in THIS business instead of generic (the A5 fix).
// Cost-free: formats existing BMC data, no LLM call. Cached in-memory.

interface BmcContextCache {
  block: string | null;
  loadedAt: number;
}
const bmcContextCache = new Map<string, BmcContextCache>();
const BMC_CONTEXT_TTL_MS = 300_000; // 5 min — the BMC rarely changes mid-call.

/** BMC sections worth whispering to the rep, in priority order, each with a
 *  short label. Skips passion/channel (marketing-facing, not useful live). */
const BMC_CONTEXT_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['niche', 'Who we sell to'],
  ['problem', 'Problem we solve'],
  ['usp', 'Why us'],
  ['mvp', 'Offer'],
  ['mechanism', 'How it works'],
  ['pricing', 'Pricing'],
  ['delivery', 'Delivery'],
  ['message', 'Positioning'],
];
const BMC_SECTION_CAP = 180; // chars per section
const BMC_BLOCK_CAP = 1100; // ~300 tokens total

/** Pure: format a workspace BMC data object into a compact context block, or
 *  null if there's nothing usable. Exported for tests. */
export function formatBusinessContext(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) return null;
  const lines: string[] = [];
  let total = 0;
  for (const [key, label] of BMC_CONTEXT_SECTIONS) {
    const raw = data[key];
    if (typeof raw !== 'string') continue;
    const v = raw.replace(/\s+/g, ' ').trim();
    if (!v) continue;
    const clipped =
      v.length > BMC_SECTION_CAP ? `${v.slice(0, BMC_SECTION_CAP - 1).trimEnd()}…` : v;
    const nextLine = `${label}: ${clipped}`;
    if (total + nextLine.length > BMC_BLOCK_CAP) break;
    lines.push(nextLine);
    total += nextLine.length;
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/** Load + cache the workspace's business context block. Best-effort — a DB
 *  hiccup returns the stale block (or null), never throws into the hot path. */
async function getBusinessContext(workspaceId: string): Promise<string | null> {
  const cached = bmcContextCache.get(workspaceId);
  if (cached && Date.now() - cached.loadedAt < BMC_CONTEXT_TTL_MS) return cached.block;
  let block: string | null = cached?.block ?? null;
  try {
    const row = await prisma.workspaceBmc.findUnique({
      where: { workspaceId },
      select: { data: true },
    });
    block = formatBusinessContext((row?.data ?? null) as Record<string, unknown> | null);
  } catch {
    // keep stale on error
  }
  bmcContextCache.set(workspaceId, { block, loadedAt: Date.now() });
  return block;
}

/** Invalidate one workspace's business-context cache (e.g. on BMC re-publish). */
export function invalidateBusinessContextCache(workspaceId: string): void {
  bmcContextCache.delete(workspaceId);
}

interface ScriptBlock {
  stage: string;
  bodyMd: string;
}

interface ScriptCache {
  byStage: Map<string, ScriptBlock[]>;
  loadedAt: number;
}

const scriptCache = new Map<string, ScriptCache>();
// PRD F7 AC2 requires "within 30s of publish" for new sessions. Cap < 30s
// so the gateway's worst-case staleness still satisfies the spec.
const SCRIPT_TTL_MS = 25_000;

/** Map free-form stage names users put in script blocks to canonical
 *  stage IDs the coach uses internally. Workspace authors will write
 *  "Pitching" / "Probing" / "Opening" — we coerce to opener/discovery/demo. */
const STAGE_ALIASES: Record<string, string> = {
  opening: 'opener',
  intro: 'opener',
  greeting: 'opener',
  rapport: 'opener',
  qualifying: 'qualification',
  qualify: 'qualification',
  probing: 'discovery',
  probe: 'discovery',
  pitching: 'demo',
  pitch: 'demo',
  presentation: 'demo',
  presenting: 'demo',
  objection: 'objection_handling',
  objections: 'objection_handling',
  reframe: 'objection_handling',
  close: 'closing',
  closingstep: 'closing',
  nextsteps: 'closing',
  followup: 'closing',
};

function normalizeStage(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return STAGE_ALIASES[s] ?? s;
}

async function getActiveScriptForStage(workspaceId: string, stage: string): Promise<string | null> {
  const cached = scriptCache.get(workspaceId);
  if (!cached || Date.now() - cached.loadedAt > SCRIPT_TTL_MS) {
    try {
      const collections = await prisma.scriptCollection.findMany({
        where: { workspaceId, currentVersionId: { not: null } },
        include: {
          currentVersion: {
            include: { blocks: { select: { stage: true, bodyMd: true } } },
          },
        },
      });
      const byStage = new Map<string, ScriptBlock[]>();
      for (const c of collections) {
        for (const b of c.currentVersion?.blocks ?? []) {
          const key = normalizeStage(b.stage);
          const arr = byStage.get(key) ?? [];
          arr.push({ stage: key, bodyMd: b.bodyMd });
          byStage.set(key, arr);
        }
      }
      scriptCache.set(workspaceId, { byStage, loadedAt: Date.now() });
    } catch {
      // best effort — leave cache stale; null below
    }
  }
  const fresh = scriptCache.get(workspaceId);
  const wanted = normalizeStage(stage);
  let blocks = fresh?.byStage.get(wanted) ?? [];
  // Graceful fallback for proactive triggers — if the workspace has no
  // block for this exact stage, try discovery (the most common authored
  // stage), then any first available block. Better to suggest something
  // grounded than to return null and stay silent.
  if (blocks.length === 0 && fresh) {
    blocks = fresh.byStage.get('discovery') ?? [];
  }
  if (blocks.length === 0 && fresh && fresh.byStage.size > 0) {
    blocks = [...fresh.byStage.values()][0] ?? [];
  }
  if (blocks.length === 0) return null;
  // Cap to ~600 chars total to keep the prompt small.
  let out = '';
  for (const b of blocks) {
    if (out.length > 600) break;
    out += `\n${b.bodyMd}`;
  }
  return out.trim();
}

/** Invalidate one workspace's cache — useful when admin publishes a new version. */
export function invalidateScriptCache(workspaceId: string): void {
  scriptCache.delete(workspaceId);
}

// ─── Proactive script-driven coaching ──────────────────────────────────────
//
// Reactive `coachAndPersist` only fires after a customer turn. For opening,
// discovery, and rep-silence moments we want to suggest the rep's NEXT line
// using their published script as the primary source. Proactive output is
// NEVER grounded in knowledge chunks — it leans entirely on the script block
// for the current stage. Returns null if no script block is published for
// this stage (nothing useful to say).

const PROACTIVE_SYSTEM = `You are an expert sales coach whispering to the rep on a live call.

You have access to the rep's WORKSPACE PLAYBOOK below. Treat the playbook as
a FRAMEWORK and SKILL — internalize its methodology, sequencing, and tone.
DO NOT quote it verbatim. DO NOT paste raw script lines. Generate a fresh,
contextual suggestion that advances the conversation in the spirit of the
playbook.

Output ONLY raw JSON (no markdown, no prose, no code fences):
{"type":"coach"|"ask_next","followup_text":<str>,"source_chunk_ids":[],"confidence":<0..1>,"rationale":<short>}

How to think:
1. Read the recent turns. Identify what stage of the call we're in and what
   the rep + prospect have already covered.
2. Read the playbook. Understand its sequencing logic (e.g. rapport →
   isolate → reframe → close, or discovery questions in order of priority).
3. Decide the SINGLE NEXT MOVE that fits where this conversation actually
   is right now — not where the script says it should be at line N.
4. Phrase it in natural conversational English the rep can actually say.

Hard rules:
- ≤25 words.
- Adapt to what was already said. If the rep covered "rapport", move to
  the next playbook step. If the prospect raised a concern, address it
  using the playbook's reframe pattern, not a generic line.
- Never repeat or paraphrase a recently-suggested prompt (you'll see them
  in the user message — pick a DIFFERENT angle).
- Never echo back what the rep just said.
- Replace any {{placeholder}} tokens with neutral conversational filler.
- source_chunk_ids stays empty — proactive prompts are playbook-grounded.
- No marketing language. No "I'd like to..." filler. Talk like a coach
  whispering in the rep's ear.

Output raw JSON only. No text before or after.`;

const ProactiveSchema = z.object({
  type: z.enum(['coach', 'ask_next']),
  followup_text: z.string().min(1).max(400),
  source_chunk_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type ProactiveTrigger = 'capture_start' | 'rep_silence' | 'stage_transition';

export interface ProactiveInput {
  workspaceId: string;
  meetingId: string;
  stage: string;
  trigger: ProactiveTrigger;
  contextTurns: Array<{ speaker: 'rep' | 'customer' | 'unknown'; text: string }>;
  /** Recently emitted proactive followup texts (most-recent first). Coach
   *  uses these to avoid suggesting the same line twice and to detect when
   *  the rep already spoke a recent suggestion. */
  recentSuggestions?: string[];
}

/** Loose normalization for similarity checks. Strips punctuation, collapses
 *  whitespace, lowercases. Two strings whose normalized forms match for the
 *  first ~30 chars are treated as duplicates. */
function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDuplicateOrSpoken(
  candidate: string,
  recentSuggestions: string[],
  contextTurns: Array<{ speaker: 'rep' | 'customer' | 'unknown'; text: string }>,
): boolean {
  const norm = normalizeForDedup(candidate);
  if (norm.length < 8) return false;
  const head = norm.slice(0, 30);
  for (const r of recentSuggestions) {
    const rn = normalizeForDedup(r);
    if (rn.startsWith(head) || norm.startsWith(rn.slice(0, 30))) return true;
  }
  // Skip if the rep already spoke (a paraphrase of) the suggestion in the
  // last few turns — no point re-suggesting what's already on the call.
  for (const t of contextTurns.slice(-6)) {
    if (t.speaker !== 'rep') continue;
    const tn = normalizeForDedup(t.text);
    if (tn.length < 8) continue;
    if (tn.includes(head) || norm.includes(tn.slice(0, 30))) return true;
  }
  return false;
}

/** Returns null when there's no published script block for the stage, when
 *  no LLM is configured, or when the LLM call fails. Caller should treat null
 *  as "skip this trigger" rather than retry. */
export async function proactiveCoach(
  input: ProactiveInput,
  deps: CoachDeps,
): Promise<CoachOutput | null> {
  if (!deps.llm) return null;
  const tStart = Date.now();
  const emitTotal = (degraded = false): void => {
    emitLatency({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      stage: 'coach_total',
      latencyMs: Date.now() - tStart,
      degraded,
    });
  };
  const tScript = Date.now();
  const [scriptBody, businessContext] = await Promise.all([
    getActiveScriptForStage(input.workspaceId, input.stage),
    getBusinessContext(input.workspaceId),
  ]);
  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'script_fetch',
    latencyMs: Date.now() - tScript,
  });
  if (!scriptBody) {
    // No published script for this stage — not a latency regression, but
    // record coach_total so we have a complete picture of where the path
    // exits.
    emitTotal(true);
    return null;
  }

  const recent = input.recentSuggestions ?? [];
  const userPrompt = [
    `Trigger: ${input.trigger}`,
    `Current stage: ${input.stage}`,
    businessContext
      ? `Business context (the rep's own company — tailor the line to THIS offer, buyer, and pricing):\n${businessContext}`
      : null,
    input.contextTurns.length
      ? `Recent turns:\n${input.contextTurns
          .slice(-6)
          .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
          .join('\n')}`
      : 'No turns yet — call just started.',
    recent.length
      ? `Already suggested in this call (DO NOT repeat or paraphrase these — pick a DIFFERENT line from the script):\n${recent
          .slice(0, 5)
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n')}`
      : null,
    `Workspace playbook (stage=${input.stage}) — internalize the methodology, sequencing and tone. DO NOT quote verbatim. Generate a fresh contextual line in the playbook's spirit:\n${scriptBody}`,
    `IMPORTANT: replace any {{placeholder}} tokens with natural conversational filler. Never output curly-brace placeholders. Adapt the next move to what was actually said in the recent turns above — not to the playbook's literal sequence.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const tSuggest = Date.now();
  const r = await deps.llm.complete({
    workspaceId: input.workspaceId,
    messages: [
      { role: 'system', content: PROACTIVE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    schema: ProactiveSchema,
    temperature: 0.3,
    maxTokens: 200,
    deadlineMs: Number(process.env.LLM_DEADLINE_MS ?? 12000),
  });
  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'suggestion',
    latencyMs: Date.now() - tSuggest,
  });

  if (!r.parsed || r.finishReason === 'cancelled' || r.finishReason === 'error') {
    emitTotal(true);
    return null;
  }

  // Reject duplicates AFTER the LLM call — even with the avoid-list in the
  // prompt the model occasionally regurgitates the same opener verbatim.
  // Also reject if the rep already spoke (a paraphrase of) the candidate.
  if (
    isDuplicateOrSpoken(r.parsed.followup_text, input.recentSuggestions ?? [], input.contextTurns)
  ) {
    emitTotal(true);
    return null;
  }

  // Strip any leftover {{placeholder}} tokens so we never surface raw
  // template syntax to the rep on a live call.
  const cleanedText = r.parsed.followup_text.replace(/\{\{[^}]*\}\}/g, 'there').trim();
  if (cleanedText.length < 4) {
    emitTotal(true);
    return null;
  }

  const conf = clamp01(r.parsed.confidence);
  const stageSignal: StageSignal = (STAGE_SIGNALS as readonly string[]).includes(input.stage)
    ? (input.stage as StageSignal)
    : 'discovery';

  // A proactive suggestion still needs a Turn row (Suggestion.turnId is
  // required). We synthesize a zero-length Turn tagged 'system' so analytics
  // can distinguish proactive prompts from real customer-turn-triggered ones.
  const turn = await prisma.turn.create({
    data: {
      meetingId: input.meetingId,
      speakerType: 'system',
      startMs: 0,
      endMs: 0,
    },
  });

  const row = await prisma.suggestion.create({
    data: {
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      turnId: turn.id,
      suggestionType: r.parsed.type,
      answerText: null,
      followupText: cleanedText,
      confidenceScore: conf,
      priorityScore: 0.5,
      sourceChunkIds: [],
      policyVersion: POLICY_VERSION,
      rationale: `[proactive:${input.trigger}] ${r.parsed.rationale}`,
    },
  });
  emitTotal();

  return {
    type: r.parsed.type,
    answerText: null,
    followupText: cleanedText,
    confidenceScore: conf,
    priorityScore: 0.5,
    sourceChunkIds: [],
    policyVersion: POLICY_VERSION,
    rationale: r.parsed.rationale,
    display: conf >= deps.minDisplayConfidence,
    intent: {
      categories: ['none'],
      stageSignal,
      urgencyScore: 0.4,
      confidence: conf,
      isObjection: false,
      source: 'llm',
    },
    sources: [],
    suggestionId: row.id,
    openEpisode: null,
  };
}

/** Stable list of stages we will fire proactive prompts for. `objection_handling`
 *  is excluded because the reactive customer-turn path already covers it. */
export const PROACTIVE_STAGES: readonly string[] = [
  'opener',
  'qualification',
  'discovery',
  'demo',
  'closing',
];

/** Lightweight stage detector for the gateway's stage state machine. Wraps
 *  the same heuristic the coach uses so both paths agree on the current stage. */
export function detectStage(text: string): string {
  return classifyHeuristic(text).stageSignal;
}

export type SuggestionType = 'answer' | 'ask_next' | 'coach' | 'risk';

export interface CoachInput {
  workspaceId: string;
  meetingId: string;
  turnId: string;
  customerText: string;
  contextTurns: Array<{ speaker: 'rep' | 'customer' | 'unknown'; text: string }>;
  language?: string;
  /**
   * Optional streaming callback. When set, the SDK enables Anthropic's
   * server-streaming, and this callback fires with each text delta as the
   * model writes its JSON output. Used by the gateway to emit
   * `suggestion.streaming` WS frames so the rep's overlay can render the
   * answer as it generates instead of waiting for the full JSON.
   *
   * The accumulated arg is the full output so far, including the JSON
   * preamble. Callers extract the user-visible string (answer_text /
   * followup_text) using extractStreamingAnswer below.
   */
  onPartialText?: (delta: string, accumulated: string) => void;
  /** The objection episode currently open for this meeting (threaded by the
   *  handler across turns), or null/undefined if none is open. */
  openEpisode?: EpisodeState | null;
}

export interface CoachOutput {
  type: SuggestionType;
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
  priorityScore: number;
  sourceChunkIds: string[];
  policyVersion: string;
  rationale: string;
  display: boolean;
  intent: HeuristicResult & { source: 'heuristic' | 'llm' };
  sources: Array<{ id: string; documentName: string | null; score: number }>;
  suggestionId: string | null;
  /** The objection episode after this turn — open EpisodeState to continue, or
   *  null when no episode is open (never opened, or just closed). The handler
   *  stores this and passes it back as `openEpisode` next turn. */
  openEpisode: EpisodeState | null;
}

export interface CoachDeps {
  llm: LlmClient | null;
  embeddings: EmbeddingClient;
  minDisplayConfidence: number;
  urgencyThreshold: number;
}

const POLICY_VERSION = 'policy-v1-gateway';

/** Best-effort archetype when the model flags an objection but omits the
 *  archetype. Maps the heuristic intent category to the closest loop archetype. */
function mapIntentToArchetype(categories: readonly IntentCategory[]): ObjectionArchetype {
  for (const c of categories) {
    switch (c) {
      case 'pricing':
      case 'budget':
        return 'price';
      case 'authority':
        return 'authority';
      case 'timeline':
        return 'time';
      case 'competitor':
        return 'comparison';
    }
  }
  return 'stall';
}

export type EpisodeReportT = z.infer<typeof EpisodeReport>;

export type EpisodeDecision =
  | { kind: 'none' }
  | { kind: 'open'; archetype: ObjectionArchetype; step: LoopStep; reframe: string | null }
  | { kind: 'advance'; step: LoopStep; reframe: string | null; deflections: number }
  | { kind: 'close'; status: 'resolved' | 'abandoned' };

/** Pure decision: given the prior open episode (if any), the model's episode
 *  report, and the heuristic intent, decide what to do with the episode. The
 *  caller (coachAndPersist) performs the DB write. Exported for unit tests. */
export function reconcileEpisode(
  prior: EpisodeState | null | undefined,
  report: EpisodeReportT | undefined,
  intentCategories: readonly IntentCategory[],
): EpisodeDecision {
  // No signal from the model → don't disturb an open episode, do nothing new.
  if (!report) return { kind: 'none' };

  if (report.is_objection) {
    if (!prior) {
      return {
        kind: 'open',
        archetype: report.archetype ?? mapIntentToArchetype(intentCategories),
        step: report.step ?? 'disarm',
        reframe: report.reframe ?? null,
      };
    }
    if (report.status === 'resolved' || report.status === 'abandoned') {
      return { kind: 'close', status: report.status };
    }
    return {
      kind: 'advance',
      step: report.step ?? prior.currentStep,
      reframe: report.reframe ?? prior.reframeUsed,
      deflections: prior.deflections + (report.deflected ? 1 : 0),
    };
  }

  // Turn is not an objection. If an episode was open, the prospect either
  // accepted (resolved) or moved on (abandoned). Trust an explicit resolved;
  // otherwise treat a topic change as abandoned.
  if (prior) {
    return { kind: 'close', status: report.status === 'resolved' ? 'resolved' : 'abandoned' };
  }
  return { kind: 'none' };
}

/** Persist an episode decision and return the episode state to carry into the
 *  next turn (null when none is open). Best-effort: a DB hiccup here must never
 *  fail the suggestion, so the caller wraps this in try/catch. */
async function applyEpisodeDecision(
  decision: EpisodeDecision,
  input: CoachInput,
  prior: EpisodeState | null | undefined,
): Promise<EpisodeState | null> {
  switch (decision.kind) {
    case 'none':
      return prior ?? null;
    case 'open': {
      const row = await prisma.objectionEpisode.create({
        data: {
          workspaceId: input.workspaceId,
          meetingId: input.meetingId,
          openedTurnId: input.turnId,
          archetype: decision.archetype,
          currentStep: decision.step,
          reframeUsed: decision.reframe,
        },
      });
      return {
        id: row.id,
        archetype: decision.archetype,
        currentStep: decision.step,
        reframeUsed: decision.reframe,
        deflections: 0,
      };
    }
    case 'advance': {
      if (!prior) return null;
      await prisma.objectionEpisode.update({
        where: { id: prior.id },
        data: {
          currentStep: decision.step,
          reframeUsed: decision.reframe,
          deflections: decision.deflections,
        },
      });
      return {
        ...prior,
        currentStep: decision.step,
        reframeUsed: decision.reframe,
        deflections: decision.deflections,
      };
    }
    case 'close': {
      if (prior) {
        await prisma.objectionEpisode.update({
          where: { id: prior.id },
          data: { status: decision.status, closedAt: new Date() },
        });
      }
      return null;
    }
  }
}

export async function coachAndPersist(input: CoachInput, deps: CoachDeps): Promise<CoachOutput> {
  if (!input.workspaceId) throw new Error('workspaceId required');
  const tStart = Date.now();
  const intent = classifyHeuristic(input.customerText);
  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'intent',
    latencyMs: Date.now() - tStart,
  });

  // Objections ALWAYS proceed. The urgency gate exists for cost control on
  // generic chatter, not to filter objections — dropping a real objection over
  // a low numeric score was the A4 weakness (single-signal objections scored
  // ~0.30 < 0.35, suppressing them before the LLM). Objection turns are a
  // fraction of the call and cheap on Haiku, so bypassing the gate for them is
  // cost-acceptable while capturing the recall the eval flagged.
  if (!intent.isObjection && intent.urgencyScore < deps.urgencyThreshold) {
    // Tagged degraded:true so the analytics aggregator can exclude these
    // non-events from p50/p95 — the rep never sees an LLM call here.
    emitLatency({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      stage: 'coach_total',
      latencyMs: Date.now() - tStart,
      degraded: true,
    });
    // Preserve any open episode — a low-urgency turn doesn't end the objection.
    return {
      ...suppressed(intent, 'urgency below threshold'),
      openEpisode: input.openEpisode ?? null,
    };
  }

  const cat = intent.categories.find((c) => c !== 'none') ?? null;
  const tRetrieval = Date.now();
  // Phase 2.1: retrieve() and getActiveScriptForStage() are independent DB
  // operations — both are needed for the LLM call but neither depends on
  // the other. Running in parallel saves the script-fetch round-trip
  // (~30-100ms depending on cache state) on every coached turn.
  const [chunks, scriptBody, businessContext] = await Promise.all([
    retrieve(
      input.workspaceId,
      input.customerText,
      deps.embeddings,
      intent.categories,
      input.language ?? null,
    ),
    deps.llm
      ? getActiveScriptForStage(input.workspaceId, intent.stageSignal)
      : Promise.resolve(null),
    deps.llm ? getBusinessContext(input.workspaceId) : Promise.resolve(null),
  ]);
  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'retrieval',
    latencyMs: Date.now() - tRetrieval,
  });

  if (chunks.length === 0) {
    emitLatency({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      stage: 'coach_total',
      latencyMs: Date.now() - tStart,
    });
    return { ...askNext(intent, cat), openEpisode: input.openEpisode ?? null };
  }

  const tSuggest = Date.now();
  let out: CoachOutput;
  let episodeReport: EpisodeReportT | undefined;
  if (!deps.llm) {
    out = heuristicAnswer(intent, chunks, deps.minDisplayConfidence);
  } else {
    const userPrompt = [
      `Customer turn:\n${input.customerText}`,
      businessContext
        ? `Business context (the rep's own company — ground every suggestion in THIS offer, buyer, and pricing; never generic):\n${businessContext}`
        : null,
      input.contextTurns.length
        ? `Context:\n${input.contextTurns
            .slice(-REACTIVE_CONTEXT_TURNS)
            .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
            .join('\n')}`
        : null,
      `Intent: categories=${intent.categories.join(',')} stage=${intent.stageSignal} urgency=${intent.urgencyScore.toFixed(2)}`,
      input.openEpisode
        ? `OPEN OBJECTION EPISODE — continue this, do NOT restart at disarm:\narchetype=${input.openEpisode.archetype} current_step=${input.openEpisode.currentStep}${input.openEpisode.reframeUsed ? ` reframe=${input.openEpisode.reframeUsed}` : ''}${
            input.openEpisode.deflections >= MAX_DEFLECTIONS
              ? '\nProspect has deflected twice — STOP reframing; give a direct answer or concede and offer a concrete next step.'
              : ''
          }`
        : null,
      scriptBody
        ? `Workspace playbook for stage=${intent.stageSignal} (METHODOLOGY — internalize the pattern and adapt to the prospect's actual words; DO NOT quote verbatim; never cite as a chunk):\n${scriptBody}`
        : null,
      `Approved chunks (use the UUID after "CHUNK_ID:" in source_chunk_ids — never the bracket number):\n\n${chunks
        .map(
          (c, i) =>
            `[${i + 1}] CHUNK_ID:${c.id} score=${c.score.toFixed(3)} doc=${c.documentName ?? '?'}\n${c.text}`,
        )
        .join('\n\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const r = await deps.llm.complete({
      workspaceId: input.workspaceId,
      messages: [
        { role: 'system', content: SUGGEST_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      schema: SuggestSchema,
      temperature: 0.2,
      maxTokens: 400,
      deadlineMs: Number(process.env.LLM_DEADLINE_MS ?? 12000),
      // Phase 2.2: forward streaming text deltas to the gateway handler so
      // it can emit `suggestion.streaming` WS frames. The model writes JSON;
      // extractStreamingAnswer() parses partial JSON to surface user-visible
      // text (answer_text / followup_text) only.
      ...(input.onPartialText ? { onPartialText: input.onPartialText } : {}),
    });

    if (!r.parsed || r.finishReason === 'cancelled' || r.finishReason === 'error') {
      out = heuristicAnswer(intent, chunks, deps.minDisplayConfidence, 'llm fallback');
    } else {
      // Capture the objection-loop report regardless of source-citation
      // validity — the objection progression is independent of grounding.
      episodeReport = r.parsed.episode;
      const claimed = r.parsed.source_chunk_ids ?? [];
      const allowed = new Set(chunks.map((c) => c.id));
      const cleaned = claimed.filter((id) => allowed.has(id));
      if (cleaned.length !== claimed.length) {
        out = suppressed(intent, 'policy_violation: invalid_source');
      } else {
        const top = chunks[0]?.score ?? 0;
        const conf = clamp01(r.parsed.confidence * 0.7 + top * 0.3);
        const priority = clamp01(intent.urgencyScore * 0.5 + conf * 0.5);
        out = {
          type: r.parsed.type,
          answerText: r.parsed.answer_text,
          followupText: r.parsed.followup_text,
          confidenceScore: conf,
          priorityScore: priority,
          sourceChunkIds: cleaned.length > 0 ? cleaned : chunks.slice(0, 1).map((c) => c.id),
          policyVersion: POLICY_VERSION,
          rationale: r.parsed.rationale,
          display: conf >= deps.minDisplayConfidence,
          intent: { ...intent, source: 'llm' },
          sources: chunks
            .filter((c) => (cleaned.length > 0 ? cleaned.includes(c.id) : c === chunks[0]))
            .map((c) => ({ id: c.id, documentName: c.documentName, score: c.score })),
          suggestionId: null,
          openEpisode: null, // set by reconcileEpisode below
        };
      }
    }
  }

  // Reconcile the objection episode from the model's report. Best-effort —
  // never let episode bookkeeping fail the suggestion.
  try {
    const decision = reconcileEpisode(input.openEpisode, episodeReport, intent.categories);
    out.openEpisode = await applyEpisodeDecision(decision, input, input.openEpisode);
  } catch {
    out.openEpisode = input.openEpisode ?? null;
  }

  // Persist if there's something worth keeping.
  if (out.answerText || out.followupText) {
    const row = await prisma.suggestion.create({
      data: {
        workspaceId: input.workspaceId,
        meetingId: input.meetingId,
        turnId: input.turnId,
        suggestionType: out.type,
        answerText: out.answerText,
        followupText: out.followupText,
        confidenceScore: out.confidenceScore,
        priorityScore: out.priorityScore,
        sourceChunkIds: out.sourceChunkIds,
        policyVersion: out.policyVersion,
        rationale: out.rationale,
      },
    });
    out.suggestionId = row.id;
  }

  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'suggestion',
    latencyMs: Date.now() - tSuggest,
  });
  emitLatency({
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    stage: 'coach_total',
    latencyMs: Date.now() - tStart,
  });

  return out;
}

function heuristicAnswer(
  intent: HeuristicResult,
  chunks: RetrievedChunk[],
  minConf: number,
  rationaleSuffix?: string,
): CoachOutput {
  const top = chunks[0];
  if (!top) return askNext(intent, null);
  const sentence = (top.text.match(/[^.!?]+[.!?]/)?.[0] ?? top.text).trim();
  const conf = clamp01(0.4 + top.score * 0.5);
  const priority = clamp01(intent.urgencyScore * 0.6 + conf * 0.4);
  return {
    type: 'answer',
    answerText: sentence,
    followupText: null,
    confidenceScore: conf,
    priorityScore: priority,
    sourceChunkIds: [top.id],
    policyVersion: POLICY_VERSION,
    rationale: `top chunk ${top.documentName ?? '?'} score=${top.score.toFixed(2)}${rationaleSuffix ? ` (${rationaleSuffix})` : ''}`,
    display: conf >= minConf,
    intent: { ...intent, source: 'heuristic' },
    sources: [{ id: top.id, documentName: top.documentName, score: top.score }],
    suggestionId: null,
    openEpisode: null,
  };
}

function askNext(intent: HeuristicResult, category: string | null): CoachOutput {
  const map: Record<string, string> = {
    pricing: 'How many seats are you sizing this for?',
    security: 'Which compliance frameworks does your team need?',
    integration: 'Which CRM and meeting tools should this plug into?',
    timeline: 'What does an ideal go-live look like?',
    objection: 'Can you tell me more about the concern?',
  };
  const followup = (category && map[category]) ?? "What's the most important outcome here?";
  return {
    type: 'ask_next',
    answerText: null,
    followupText: followup,
    confidenceScore: 0.6,
    priorityScore: clamp01(intent.urgencyScore * 0.5 + 0.2),
    sourceChunkIds: [],
    policyVersion: POLICY_VERSION,
    rationale: 'no matching chunk; ask to clarify',
    display: true,
    intent: { ...intent, source: 'heuristic' },
    sources: [],
    suggestionId: null,
    openEpisode: null,
  };
}

function suppressed(intent: HeuristicResult, reason: string): CoachOutput {
  return {
    type: 'coach',
    answerText: null,
    followupText: null,
    confidenceScore: 0,
    priorityScore: clamp01(intent.urgencyScore * 0.5),
    sourceChunkIds: [],
    policyVersion: POLICY_VERSION,
    rationale: reason,
    display: false,
    intent: { ...intent, source: 'heuristic' },
    sources: [],
    suggestionId: null,
    openEpisode: null,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
