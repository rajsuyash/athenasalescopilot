import { z } from 'zod';
import type { LlmClient } from '@athena/sdk-llm';
import {
  classifyHeuristic,
  INTENT_CATEGORIES,
  STAGE_SIGNALS,
  type IntentCategory,
  type StageSignal,
} from '../../lib/categories.js';

export interface ClassifyInput {
  workspaceId: string;
  text: string;
  /** Last few rep+customer turns for stage-signal disambiguation. */
  contextTurns?: Array<{ speaker: 'rep' | 'customer' | 'unknown'; text: string }>;
}

export interface ClassifyOutput {
  categories: IntentCategory[];
  stageSignal: StageSignal;
  urgencyScore: number;
  confidence: number;
  source: 'heuristic' | 'llm';
}

const LlmSchema = z.object({
  categories: z.array(z.enum(INTENT_CATEGORIES)).min(1).max(3),
  stage_signal: z.enum(STAGE_SIGNALS),
  urgency_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You are a sales-call intent classifier.
Given a single customer turn (and a few prior turns for context), classify it.

Output STRICT JSON with these fields ONLY:
{
  "categories": [<one to three of: ${INTENT_CATEGORIES.join(', ')}>],
  "stage_signal": <one of: ${STAGE_SIGNALS.join(', ')}>,
  "urgency_score": <0..1, how strongly the rep should respond now>,
  "confidence": <0..1, your confidence in the classification>
}

Rules:
- Use "none" only when the turn carries no useful intent (filler, agreement, etc.).
- urgency_score is high (0.7+) for direct customer questions about pricing, security, integration, or objections.
- Do not include any text outside the JSON object.`;

export async function classifyIntent(
  input: ClassifyInput,
  deps: { llm: LlmClient | null; deadlineMs?: number },
): Promise<ClassifyOutput> {
  if (!input.workspaceId) throw new Error('workspaceId required');
  const trimmed = input.text.trim();
  if (!trimmed) {
    return {
      categories: ['none'],
      stageSignal: 'discovery',
      urgencyScore: 0,
      confidence: 1,
      source: 'heuristic',
    };
  }

  const heuristic = classifyHeuristic(trimmed);

  // If no LLM is wired, return heuristic result.
  if (!deps.llm) {
    return {
      categories: heuristic.categories.map((c) => c.category),
      stageSignal: heuristic.stageSignal,
      urgencyScore: heuristic.urgencyScore,
      confidence: heuristic.confidence,
      source: 'heuristic',
    };
  }

  const contextLines = (input.contextTurns ?? [])
    .slice(-6)
    .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
    .join('\n');
  const userPrompt = [
    contextLines && `Prior turns (oldest first):\n${contextLines}`,
    `Customer turn to classify:\n${trimmed}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await deps.llm.complete({
    workspaceId: input.workspaceId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    schema: LlmSchema,
    temperature: 0.1,
    maxTokens: 200,
    deadlineMs: deps.deadlineMs ?? 1000,
  });

  if (!r.parsed || r.finishReason === 'cancelled' || r.finishReason === 'error') {
    // Per PRD F4 error case: malformed → fall back to heuristic, mark degraded.
    return {
      categories: heuristic.categories.map((c) => c.category),
      stageSignal: heuristic.stageSignal,
      urgencyScore: heuristic.urgencyScore,
      confidence: heuristic.confidence * 0.8,
      source: 'heuristic',
    };
  }

  return {
    categories: r.parsed.categories,
    stageSignal: r.parsed.stage_signal,
    urgencyScore: r.parsed.urgency_score,
    confidence: r.parsed.confidence,
    source: 'llm',
  };
}
