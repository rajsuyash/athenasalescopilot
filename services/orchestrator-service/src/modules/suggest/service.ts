import { z } from 'zod';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import type { LlmClient } from '@athena/sdk-llm';
import { retrieve, type RetrievedChunk } from '../../lib/retrieval.js';
import { OBJECTION_CATEGORY_PREFIX, isObjectionIntent } from '../../lib/categories.js';
import { loadStageBlocksAsChunks } from '../../lib/scripts.js';
import type { ClassifyOutput } from '../intent/service.js';

export interface SuggestInput {
  workspaceId: string;
  customerText: string;
  intent: ClassifyOutput;
  contextTurns?: Array<{ speaker: 'rep' | 'customer' | 'unknown'; text: string }>;
  language?: string;
  /**
   * Active call stage (e.g. 'opener', 'discovery', 'demo'). When provided,
   * the suggest pipeline injects the workspace's published script blocks for
   * this stage as virtual chunks so the rep's probing/pitching script grounds
   * the LLM output. Falls back to `intent.stageSignal` when omitted.
   */
  currentStage?: string;
  /** Per PRD F5: defaults applied here if caller doesn't override. */
  minDisplayConfidence?: number;
  urgencyThreshold?: number;
}

export type SuggestionType = 'answer' | 'ask_next' | 'coach' | 'risk';

export interface Suggestion {
  type: SuggestionType;
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
  priorityScore: number;
  sourceChunkIds: string[];
  rationale: string;
  policyVersion: string;
  /** Whether this suggestion crosses the display threshold. */
  display: boolean;
  /** Convenience: the chunks used (for the rep app to surface "source"). */
  sources: Array<{ id: string; documentName: string | null; score: number }>;
}

const POLICY_VERSION = 'policy-v1-heuristic';

const LlmSchema = z.object({
  type: z.enum(['answer', 'ask_next', 'coach', 'risk']),
  answer_text: z.string().nullable(),
  followup_text: z.string().nullable(),
  source_chunk_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

const SYSTEM_PROMPT = `You are a sales-call copilot. Generate ONE grounded suggestion for the rep.

Output STRICT JSON:
{
  "type": "answer" | "ask_next" | "coach" | "risk",
  "answer_text": <string or null>,
  "followup_text": <string or null>,
  "source_chunk_ids": [<id strings from the provided chunks ONLY>],
  "confidence": <0..1>,
  "rationale": <one short sentence>
}

Hard rules:
- "answer_text" must come from the provided chunks. NEVER invent facts.
- "source_chunk_ids" MUST be a subset of the provided chunk ids. If you have no
  matching chunk, use type "ask_next" or "coach" with answer_text=null.
- Keep answer_text under 30 words. Plain English. No marketing.
- If the customer is asking a clarifying question, prefer "ask_next" with a
  follow-up question that would let the rep give a better answer.
- Never use the word "I" or pretend to be the rep — speak in the imperative.
- Do not include any text outside the JSON object.

Objection-handling framework (when chunks tagged "objection-handling-*" appear):
The workspace is pre-trained on the Andres Contreras Socratic-reframe loop:
DISARM → ISOLATE → UNCOVER → REFRAME → JUSTIFY → CONSEQUENCE → IDENTITY CLOSE.
When the customer turn looks like an objection (price, stall, authority, time,
skepticism, comparison, self-doubt, avoidance), pick the SINGLE NEXT step the
rep should execute right now — not the whole loop. Use type "coach" with the
specific line to deliver, sourced from the matching reframe-library chunk.
Keep it tight: one move, in the rep's voice, ready to say out loud.`;

export interface SuggestDeps {
  llm: LlmClient | null;
  embeddings: EmbeddingClient;
  deadlineMs?: number;
}

export async function suggest(input: SuggestInput, deps: SuggestDeps): Promise<Suggestion> {
  if (!input.workspaceId) throw new Error('workspaceId required');
  const minConfidence = input.minDisplayConfidence ?? 0.5;
  const urgencyThreshold = input.urgencyThreshold ?? 0.5;

  // PRD F5: only fire retrieval+gen when urgency is above threshold.
  if (input.intent.urgencyScore < urgencyThreshold) {
    return suppressed(
      'urgency below threshold',
      input.intent.urgencyScore,
      [],
      false,
    );
  }

  // Allow operators to dial the retrieval floor — deterministic-fallback
  // embeddings (no OPENAI_API_KEY) score lower than OpenAI's, so we'd starve
  // suggestions at the default 0.2 in dev.
  const minScoreEnv = process.env.RETRIEVAL_MIN_SCORE;
  const minScore = minScoreEnv !== undefined ? Number(minScoreEnv) : 0.1;
  // Two-pass retrieval when the intent classifier flags an objection: one pass
  // restricted to the seeded `objection-handling-*` framework, one unfiltered.
  // Merge objection-first so the Andres Socratic-reframe library is guaranteed
  // to surface even when its semantic score loses to a closer FAQ match.
  // Falls through to single-pass when the workspace isn't seeded.
  const safeMinScore = Number.isFinite(minScore) ? minScore : 0.1;
  const baseQuery = {
    workspaceId: input.workspaceId,
    query: input.customerText,
    minScore: safeMinScore,
    ...(input.language ? { language: input.language } : {}),
  } as const;

  // Resolve the call stage. Caller may pass an explicit `currentStage` (the
  // realtime gateway tracks one); otherwise use the intent classifier's
  // signal. Either way, we ask the script loader for the workspace's
  // published blocks for that stage.
  const activeStage = input.currentStage ?? input.intent.stageSignal;
  const scriptChunks = await loadStageBlocksAsChunks(
    input.workspaceId,
    activeStage,
    input.language,
  );

  let retrieved: RetrievedChunk[];
  if (isObjectionIntent(input.intent.categories)) {
    const [objectionChunks, openChunks] = await Promise.all([
      retrieve(
        { ...baseQuery, topK: 3, categoryPrefix: OBJECTION_CATEGORY_PREFIX },
        { embeddings: deps.embeddings },
      ),
      retrieve({ ...baseQuery, topK: 3 }, { embeddings: deps.embeddings }),
    ]);
    const seen = new Set<string>();
    retrieved = [];
    for (const c of [...objectionChunks, ...openChunks]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      retrieved.push(c);
    }
  } else {
    retrieved = await retrieve({ ...baseQuery, topK: 5 }, { embeddings: deps.embeddings });
  }

  // Script blocks come first so the LLM weighs them above semantic chunks.
  // They carry score 0.95 and id prefix `script:` so the source-id allowlist
  // still validates and the rep can see the script as a cited source.
  const seenIds = new Set<string>();
  const chunks: RetrievedChunk[] = [];
  for (const c of [...scriptChunks, ...retrieved]) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    chunks.push(c);
  }

  // PRD F5 AC2: no matching content → ask_next, never fabricate.
  if (chunks.length === 0) {
    return askNext(input, []);
  }

  if (!deps.llm) {
    return heuristicAnswer(input, chunks, minConfidence);
  }

  const prompt = buildUserPrompt(input, chunks);
  const r = await deps.llm.complete({
    workspaceId: input.workspaceId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    schema: LlmSchema,
    temperature: 0.2,
    maxTokens: 400,
    deadlineMs: deps.deadlineMs ?? Number(process.env.LLM_DEADLINE_MS ?? 12000),
  });

  if (!r.parsed || r.finishReason === 'cancelled' || r.finishReason === 'error') {
    // Generator latency or schema fail → fall back to heuristic answer (PRD F5 error case).
    return heuristicAnswer(input, chunks, minConfidence, 'llm fallback');
  }

  const parsed = r.parsed;
  const claimedSourceIds = parsed.source_chunk_ids ?? [];
  const allowedIds = new Set(chunks.map((c) => c.id));
  const cleanedSourceIds = claimedSourceIds.filter((id) => allowedIds.has(id));

  // PRD F5 error: model returned a chunk id not in retrieval set → reject.
  if (cleanedSourceIds.length !== claimedSourceIds.length) {
    return suppressed(
      'policy_violation: invalid_source',
      input.intent.urgencyScore * 0.5,
      chunks,
      false,
    );
  }

  // Confidence factors in retrieval top score.
  const topScore = chunks[0]?.score ?? 0;
  const confidence = Math.max(parsed.confidence * 0.7 + topScore * 0.3, 0);
  const priority = clamp01(input.intent.urgencyScore * 0.5 + confidence * 0.5);

  return {
    type: parsed.type,
    answerText: parsed.answer_text,
    followupText: parsed.followup_text,
    confidenceScore: clamp01(confidence),
    priorityScore: priority,
    sourceChunkIds: cleanedSourceIds.length > 0 ? cleanedSourceIds : chunks.slice(0, 1).map((c) => c.id),
    rationale: parsed.rationale,
    policyVersion: POLICY_VERSION,
    display: clamp01(confidence) >= minConfidence,
    sources: chunks
      .filter((c) =>
        cleanedSourceIds.length > 0 ? cleanedSourceIds.includes(c.id) : c === chunks[0],
      )
      .map((c) => ({ id: c.id, documentName: c.documentName, score: c.score })),
  };
}

function buildUserPrompt(input: SuggestInput, chunks: RetrievedChunk[]): string {
  const ctx = (input.contextTurns ?? [])
    .slice(-6)
    .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
    .join('\n');
  const sourceBlock = chunks
    .map(
      (c, i) =>
        `[${i + 1}] id=${c.id} score=${c.score.toFixed(3)} category=${c.category ?? '?'} doc=${c.documentName ?? '?'}\n${c.text}`,
    )
    .join('\n\n');

  return [
    `Customer question / objection:\n${input.customerText}`,
    ctx ? `Prior turns:\n${ctx}` : null,
    `Intent classification: categories=${input.intent.categories.join(',')} stage=${input.intent.stageSignal} urgency=${input.intent.urgencyScore.toFixed(2)}`,
    `Approved chunks (use ONLY these for answer_text + source_chunk_ids):\n\n${sourceBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function heuristicAnswer(
  input: SuggestInput,
  chunks: RetrievedChunk[],
  minConfidence: number,
  rationaleSuffix?: string,
): Suggestion {
  // No LLM (or fallback): return the highest-scoring chunk as the answer, trimmed.
  const top = chunks[0];
  if (!top) return askNext(input, chunks);
  const sentence = firstSentence(top.text);
  const confidence = clamp01(0.4 + top.score * 0.5);
  const priority = clamp01(input.intent.urgencyScore * 0.6 + confidence * 0.4);
  const rationale = `matched chunk ${top.documentName ?? 'workspace knowledge'} score=${top.score.toFixed(2)}${rationaleSuffix ? ` (${rationaleSuffix})` : ''}`;
  return {
    type: 'answer',
    answerText: sentence,
    followupText: null,
    confidenceScore: confidence,
    priorityScore: priority,
    sourceChunkIds: [top.id],
    rationale,
    policyVersion: POLICY_VERSION,
    display: confidence >= minConfidence,
    sources: [{ id: top.id, documentName: top.documentName, score: top.score }],
  };
}

function askNext(input: SuggestInput, chunks: RetrievedChunk[]): Suggestion {
  const cat = input.intent.categories.find((c) => c !== 'none') ?? null;
  const followup = cat
    ? clarifyingQuestionForCategory(cat)
    : "What's the most important outcome for you here?";
  return {
    type: 'ask_next',
    answerText: null,
    followupText: followup,
    confidenceScore: 0.6,
    priorityScore: clamp01(input.intent.urgencyScore * 0.5 + 0.2),
    sourceChunkIds: [],
    rationale:
      chunks.length === 0 ? 'no matching chunk; ask to clarify' : 'low score chunks; defer',
    policyVersion: POLICY_VERSION,
    display: true,
    sources: [],
  };
}

function suppressed(
  reason: string,
  priority: number,
  chunks: RetrievedChunk[],
  display: boolean,
): Suggestion {
  return {
    type: 'coach',
    answerText: null,
    followupText: null,
    confidenceScore: 0,
    priorityScore: clamp01(priority),
    sourceChunkIds: chunks.slice(0, 1).map((c) => c.id),
    rationale: reason,
    policyVersion: POLICY_VERSION,
    display,
    sources: [],
  };
}

function clarifyingQuestionForCategory(cat: string): string {
  const map: Record<string, string> = {
    pricing: 'How many seats are you sizing this for, and what budget cycle are we in?',
    security: 'Which compliance frameworks does your team need to satisfy?',
    integration: 'Which CRM and meeting tools do you need this to plug into?',
    timeline: 'What does an ideal go-live look like — and what would block it?',
    procurement: 'What does your typical vendor review look like, and who owns it?',
    competitor: 'What did you like and dislike about the alternative you tried?',
    objection: 'Can you tell me more about the concern — is it about cost, fit, or timing?',
    technical_validation: 'What load do you need this to handle on day one?',
    feature_request: 'What does the workflow look like today without that feature?',
    next_steps: 'What would a great next step look like from your side?',
    product_fit: "Walk me through one of your team's calls today end-to-end?",
    authority: 'Who else needs to weigh in before we move forward?',
    budget: 'Is this funded out of an existing line item or do we need a new one?',
    implementation: 'Who would own the rollout internally and how big is the team?',
  };
  return map[cat] ?? "What's the most important outcome for you here?";
}

function firstSentence(text: string): string {
  const m = text.match(/[^.!?]+[.!?]/);
  return (m?.[0] ?? text).trim();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
