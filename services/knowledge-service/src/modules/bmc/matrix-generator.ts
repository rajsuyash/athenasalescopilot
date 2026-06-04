/**
 * BMC-specific objection→solution matrix generator (Block Q phase 5).
 *
 * Pre-generates the objections THIS business will actually face — derived from
 * its own BMC (pricing, problem, USP, …) crossed with the objection-reframer
 * archetypes — each paired with a grounded Socratic reframe and a
 * ready-to-deliver line. The survivors are indexed (matrix-indexer.ts) as
 * `objection-handling-matrix` knowledge docs so the EXISTING live retrieval
 * path serves a pre-baked answer the instant the customer objects, instead of
 * reasoning from scratch mid-call.
 *
 * F5 (grounded outputs) is the load-bearing invariant here: a pre-baked entry
 * is a *permanent* source, so an ungrounded one is strictly worse than a live
 * one-off. enforceGrounding() drops any entry whose cited chunk IDs aren't in
 * the retrieved allowlist, whose ready line exceeds the answer budget, or whose
 * ready line asserts a money/percent/multiplier figure that doesn't appear in a
 * cited chunk. If >50% of entries drop, the whole run aborts and the prior
 * matrix is left untouched (matrix-indexer never gets called).
 */
import { z } from 'zod';
import type { LlmClient } from '@athena/sdk-llm';
import { loadSkill } from '@athena/sdk-llm';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { retrieveChunks, type RetrievedChunk } from '../retrieval/service.js';
import { getBmc, type BmcData } from './service.js';

const ARCHETYPES = [
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

const BMC_THEMES = [
  'pricing',
  'problem_doubt',
  'authority',
  'comparison',
  'time',
  'skepticism',
  'delivery',
  'generic',
] as const;

const ReframeStepsSchema = z.object({
  disarm: z.string().min(1),
  isolate: z.string().min(1),
  uncover: z.string().min(1),
  reframe: z.string().min(1),
  justify: z.string().min(1),
  consequence: z.string().min(1),
  identityClose: z.string().min(1),
});

const MatrixEntrySchema = z.object({
  archetype: z.enum(ARCHETYPES),
  bmcTheme: z.enum(BMC_THEMES),
  /** Verbatim ways a customer phrases this objection — these become the body
   *  text the live trigram retriever matches against. */
  triggerPhrases: z.array(z.string().min(3)).min(2).max(6),
  objectionText: z.string().min(8),
  reframeSteps: ReframeStepsSchema,
  /** The ≤30-word line the rep can say. Enforced post-parse (matches the live
   *  answerText budget). */
  suggestedLine: z.string().min(8),
  sourceChunkIds: z.array(z.string()).min(1),
});

export type MatrixEntry = z.infer<typeof MatrixEntrySchema>;

const MatrixSchema = z.object({ entries: z.array(MatrixEntrySchema).min(6).max(15) });

/** Matches the live answerText budget so a pre-baked line can be served as-is. */
export const MAX_SUGGESTED_WORDS = 30;
/** Abort the run (preserve prior matrix) if more than this fraction is dropped. */
export const DROP_ABORT_RATIO = 0.5;

const ALLOWLIST_TOP_K = 40;
const MAX_ALLOWLIST = 40;

// ─── Pure, unit-tested helpers ───────────────────────────────────────────────

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extract "claim numbers" — money ($1,200 / $30k / $1.5M), percentages (50%),
 * and bare multipliers (30k, 2M) — normalized to a numeric value. Bare integers
 * with no unit ("7 steps", "2 kinds of people") are intentionally ignored so
 * the cross-check only polices factual figures, not rhetorical counts.
 */
export function claimNumbers(s: string): number[] {
  const out: number[] = [];
  const re = /\$\s?\d[\d.,]*\s*[kmKM]?|\d[\d.,]*\s*[kmKM](?![a-z])|\d[\d.,]*\s*%/g;
  for (const raw of s.match(re) ?? []) {
    const t = raw.toLowerCase().replace(/[\s$,%]/g, '');
    const mult = /k$/.test(t) ? 1_000 : /m$/.test(t) ? 1_000_000 : 1;
    const base = parseFloat(t.replace(/[km]$/, ''));
    if (!Number.isNaN(base)) out.push(base * mult);
  }
  return out;
}

export interface GroundingInput {
  entries: MatrixEntry[];
  allowedIds: Set<string>;
  chunkTextById: Map<string, string>;
}

export interface GroundingResult {
  kept: MatrixEntry[];
  dropped: Array<{ entry: MatrixEntry; reason: string }>;
}

/**
 * The F5 gate (+ the user-requested prose/number cross-check). Pure so it can
 * be exhaustively unit-tested. An entry survives only if:
 *   1. ≥1 of its cited source IDs is in the retrieved allowlist (others stripped);
 *   2. its ready line is ≤ MAX_SUGGESTED_WORDS;
 *   3. every money/percent/multiplier figure in its ready line also appears in
 *      at least one cited chunk's text (no fabricated numbers).
 * Survivors keep ONLY the validated subset of source IDs.
 */
export function enforceGrounding(input: GroundingInput): GroundingResult {
  const kept: MatrixEntry[] = [];
  const dropped: Array<{ entry: MatrixEntry; reason: string }> = [];

  for (const e of input.entries) {
    const validIds = e.sourceChunkIds.filter((id) => input.allowedIds.has(id));
    if (validIds.length === 0) {
      dropped.push({ entry: e, reason: 'no_valid_source_ids' });
      continue;
    }
    if (wordCount(e.suggestedLine) > MAX_SUGGESTED_WORDS) {
      dropped.push({ entry: e, reason: 'suggested_line_too_long' });
      continue;
    }
    const citedText = validIds.map((id) => input.chunkTextById.get(id) ?? '').join('\n');
    const citedNums = new Set(claimNumbers(citedText));
    const fabricated = claimNumbers(e.suggestedLine).filter((n) => !citedNums.has(n));
    if (fabricated.length > 0) {
      dropped.push({ entry: e, reason: `unsupported_numbers:${fabricated.join(',')}` });
      continue;
    }
    kept.push({ ...e, sourceChunkIds: validIds });
  }

  return { kept, dropped };
}

export function shouldAbort(keptCount: number, totalCount: number): boolean {
  if (totalCount === 0) return true;
  return (totalCount - keptCount) / totalCount > DROP_ABORT_RATIO;
}

// ─── Prompt construction ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const skillBody = loadSkill('objection-reframer');
  return `${skillBody}

BATCH MODE — OBJECTION MATRIX:
You are generating a batch objection→solution matrix for ONE business, from its
Business Model Canvas. Enumerate the objections THIS business will actually face
(derive them from the BMC's pricing, problem, usp, mechanism, delivery sections
crossed with the archetypes above), and produce one Socratic reframe for each.

OUTPUT CONTRACT:
- Output STRICT JSON matching the provided schema. No prose, no markdown fences.
- 6–15 entries. Cover the archetypes most relevant to this business; do not pad.
- reframeSteps must follow the 7-step loop (disarm, isolate, uncover, reframe,
  justify, consequence, identityClose).
- suggestedLine: ≤30 words, plain spoken English, the single best line to say.
- GROUNDING (hard rule): you may cite ONLY ids present in ALLOWED_SOURCE_IDS.
  Every entry needs ≥1 such id in sourceChunkIds. NEVER invent ids. Any
  money/percentage figure you put in suggestedLine MUST appear in a cited chunk.
- triggerPhrases: 2–6 verbatim phrasings a customer would actually say.`;
}

function buildUserPrompt(bmc: BmcData, allowlist: RetrievedChunk[]): string {
  const sources = allowlist
    .map((c) => `[${c.id}] (${c.category ?? 'uncategorized'}) ${c.text.slice(0, 400)}`)
    .join('\n\n');
  return `BUSINESS MODEL CANVAS:
\`\`\`json
${JSON.stringify(bmc, null, 2)}
\`\`\`

ALLOWED_SOURCE_IDS (cite only these; each entry needs ≥1):
${sources}`;
}

/**
 * Build the grounding allowlist with a SINGLE embedding call: embed a
 * BMC-derived probe once, retrieve top chunks, then filter in-memory to the
 * objection-handling library + BMC-fact categories. workspace_id is the first
 * predicate inside retrieveChunks (F10).
 */
export async function buildAllowlist(
  workspaceId: string,
  bmc: BmcData,
  deps: { embeddings: EmbeddingClient },
): Promise<RetrievedChunk[]> {
  const probe = [bmc.problem, bmc.usp, bmc.pricing, bmc.mechanism]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n')
    .trim();
  if (!probe) return [];

  const chunks = await retrieveChunks(
    { workspaceId, query: probe, topK: ALLOWLIST_TOP_K, minScore: 0 },
    { embeddings: deps.embeddings },
  );

  return chunks
    .filter((c) => {
      const cat = c.category ?? '';
      return cat.startsWith('objection-handling-') || cat.startsWith('bmc-');
    })
    .slice(0, MAX_ALLOWLIST);
}

export interface GenerateMatrixResult {
  kept: MatrixEntry[];
  dropped: Array<{ entry: MatrixEntry; reason: string }>;
  bmcVersion: number;
}

/**
 * Generate + ground (but do NOT persist) the objection matrix. Persisting is
 * the indexer's job; keeping generation separate makes the F5 gate the single
 * choke point and keeps this function unit-friendly.
 */
export async function generateObjectionMatrixFromBmc(
  args: { workspaceId: string; actorUserId: string },
  deps: { llm: LlmClient; embeddings: EmbeddingClient },
): Promise<GenerateMatrixResult> {
  const bmc = await getBmc(args.workspaceId);
  if (!bmc) {
    throw Object.assign(new Error('no BMC found for workspace — capture or import a BMC first'), {
      statusCode: 412,
      code: 'BMC_NOT_FOUND',
    });
  }

  const allowlist = await buildAllowlist(args.workspaceId, bmc.data, deps);
  if (allowlist.length === 0) {
    throw Object.assign(
      new Error(
        'no groundable chunks for objection matrix — index the BMC + objection library first',
      ),
      { statusCode: 502, code: 'NO_GROUNDING' },
    );
  }

  const r = await deps.llm.complete({
    workspaceId: args.workspaceId,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(bmc.data, allowlist) },
    ],
    schema: MatrixSchema,
    temperature: 0.3,
    maxTokens: 6000,
    deadlineMs: 90_000,
  });

  if (!r.parsed || r.finishReason === 'error' || r.finishReason === 'cancelled') {
    throw Object.assign(
      new Error(`objection matrix generation failed: finishReason=${r.finishReason}`),
      { statusCode: 502, code: 'GENERATION_FAILED' },
    );
  }

  const allowedIds = new Set(allowlist.map((c) => c.id));
  const chunkTextById = new Map(allowlist.map((c) => [c.id, c.text]));
  const { kept, dropped } = enforceGrounding({
    entries: r.parsed.entries,
    allowedIds,
    chunkTextById,
  });

  if (shouldAbort(kept.length, r.parsed.entries.length)) {
    throw Object.assign(
      new Error(
        `objection matrix grounding yield too low (${kept.length}/${r.parsed.entries.length} survived) — leaving prior matrix in place`,
      ),
      { statusCode: 502, code: 'LOW_GROUNDING_YIELD' },
    );
  }

  return { kept, dropped, bmcVersion: bmc.version };
}
