import { z } from 'zod';
import { prisma } from '@athena/db';
import type { LlmClient } from '@athena/sdk-llm';

export type Framework = 'MEDDIC' | 'BANT' | 'SPICED';

export interface RecapInput {
  workspaceId: string;
  meetingId: string;
  framework?: Framework;
  /** Hard deadline forwarded to the LLM. */
  deadlineMs?: number;
}

export interface RecapResult {
  summary: string;
  questions: string[];
  objections: Array<{
    category: string;
    text: string;
    resolution: 'answered' | 'deferred' | 'open';
    notes: string | null;
  }>;
  unanswered: string[];
  nextSteps: Array<{ owner: 'rep' | 'customer' | 'shared'; action: string; due: string | null }>;
  followupEmail: { subject: string; body: string };
  crmSuggestions: {
    stage: 'discovery' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | 'unknown';
    nextStep: string | null;
    objections: string[];
    useCase: string | null;
    closeDateConfidence: number;
  };
  adherence: { framework: Framework; score: number; missing: string[] };
  lowSignal: boolean;
  source: 'llm' | 'fallback';
}

const FRAMEWORK_CRITERIA: Record<Framework, string[]> = {
  MEDDIC: ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion'],
  BANT: ['budget', 'authority', 'need', 'timing'],
  SPICED: ['situation', 'pain', 'impact', 'critical_event', 'decision'],
};

const Schema = z.object({
  summary: z.string().min(1).max(4000),
  questions: z.array(z.string()).max(40).default([]),
  objections: z
    .array(
      z.object({
        category: z.string(),
        text: z.string(),
        resolution: z.enum(['answered', 'deferred', 'open']),
        notes: z.string().nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
  unanswered: z.array(z.string()).max(20).default([]),
  next_steps: z
    .array(
      z.object({
        owner: z.enum(['rep', 'customer', 'shared']),
        action: z.string(),
        due: z.string().nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
  followup_email: z.object({
    subject: z.string().min(1).max(160),
    body: z.string().min(1),
  }),
  crm_suggestions: z.object({
    stage: z.enum([
      'discovery',
      'demo',
      'proposal',
      'negotiation',
      'closed_won',
      'closed_lost',
      'unknown',
    ]),
    next_step: z.string().nullable().default(null),
    objections: z.array(z.string()).max(10).default([]),
    use_case: z.string().nullable().default(null),
    close_date_confidence: z.number().min(0).max(1),
  }),
  adherence: z.object({
    framework: z.enum(['MEDDIC', 'BANT', 'SPICED']),
    score: z.number().min(0).max(1),
    missing: z.array(z.string()).max(10).default([]),
  }),
});

export interface RecapDeps {
  llm: LlmClient | null;
}

export async function runRecap(input: RecapInput, deps: RecapDeps): Promise<RecapResult> {
  if (!input.workspaceId) throw new Error('workspaceId required');
  if (!input.meetingId) throw new Error('meetingId required');

  // Authoritative tenant check at the data layer (PRD F10).
  const meeting = await prisma.meeting.findFirst({
    where: { id: input.meetingId, workspaceId: input.workspaceId },
    include: {
      host: { select: { id: true, name: true, email: true } },
    },
  });
  if (!meeting) {
    throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const segments = await prisma.transcriptSegment.findMany({
    where: { workspaceId: input.workspaceId, meetingId: meeting.id },
    orderBy: { startMs: 'asc' },
    select: { speakerType: true, text: true, startMs: true, confidence: true },
  });
  const suggestions = await prisma.suggestion.findMany({
    where: { workspaceId: input.workspaceId, meetingId: meeting.id },
    orderBy: { generatedAt: 'asc' },
    select: {
      suggestionType: true,
      answerText: true,
      followupText: true,
      confidenceScore: true,
      rationale: true,
    },
  });

  const framework: Framework = input.framework ?? 'MEDDIC';
  const totalChars = segments.reduce((acc, s) => acc + s.text.length, 0);
  const lowSignal = totalChars < 300 || segments.length < 5;

  // No LLM → produce a thin, mechanical summary so the user still gets value.
  if (!deps.llm) {
    return mechanicalRecap(meeting, segments, suggestions, framework, lowSignal);
  }

  const transcriptBlock = segments
    .slice(0, 400) // cap for prompt size; covers ~30+ minute call
    .map((s) => `${s.speakerType.toUpperCase()} [${formatMs(s.startMs)}]: ${s.text}`)
    .join('\n');
  const suggestionBlock = suggestions
    .slice(0, 50)
    .map(
      (s) =>
        `- [${s.suggestionType} conf=${s.confidenceScore.toFixed(2)}] ${s.answerText ?? ''}${s.followupText ? ` (ask next: ${s.followupText})` : ''}`,
    )
    .join('\n');

  const prompt = [
    `Meeting: ${meeting.title ?? '(untitled)'} (id ${meeting.id})`,
    `Host: ${meeting.host.name} <${meeting.host.email}>`,
    `Framework for adherence: ${framework} — criteria ${FRAMEWORK_CRITERIA[framework].join(', ')}`,
    '',
    'TRANSCRIPT (REP/CUSTOMER turns; rep should drive the call):',
    transcriptBlock || '(no transcript captured)',
    '',
    suggestionBlock ? `SUGGESTIONS FIRED DURING CALL:\n${suggestionBlock}` : '(no suggestions fired)',
  ].join('\n');

  const r = await deps.llm.complete({
    workspaceId: input.workspaceId,
    deadlineMs: input.deadlineMs ?? 60_000,
    temperature: 0.3,
    maxTokens: 2000,
    schema: Schema,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  if (!r.parsed || r.finishReason === 'cancelled' || r.finishReason === 'error') {
    return mechanicalRecap(meeting, segments, suggestions, framework, lowSignal);
  }

  const p = r.parsed;
  return {
    summary: p.summary,
    questions: p.questions ?? [],
    objections: (p.objections ?? []).map((o) => ({
      category: o.category,
      text: o.text,
      resolution: o.resolution,
      notes: o.notes ?? null,
    })),
    unanswered: p.unanswered ?? [],
    nextSteps: (p.next_steps ?? []).map((n) => ({
      owner: n.owner,
      action: n.action,
      due: n.due ?? null,
    })),
    followupEmail: p.followup_email,
    crmSuggestions: {
      stage: p.crm_suggestions.stage,
      nextStep: p.crm_suggestions.next_step ?? null,
      objections: p.crm_suggestions.objections ?? [],
      useCase: p.crm_suggestions.use_case ?? null,
      closeDateConfidence: p.crm_suggestions.close_date_confidence,
    },
    adherence: {
      framework: p.adherence.framework,
      score: p.adherence.score,
      missing: p.adherence.missing ?? [],
    },
    lowSignal,
    source: 'llm',
  };
}

const SYSTEM_PROMPT = `You are a sales-call post-call analyst. Produce a structured recap.

Return STRICT JSON with this exact shape:
{
  "summary": <3-5 paragraphs of plain English>,
  "questions": [<customer questions asked, deduped>],
  "objections": [{
    "category": <e.g. pricing, security, integration, timeline>,
    "text": <quote or paraphrase>,
    "resolution": "answered" | "deferred" | "open",
    "notes": <one sentence or null>
  }],
  "unanswered": [<questions left without a clear answer>],
  "next_steps": [{
    "owner": "rep" | "customer" | "shared",
    "action": <imperative>,
    "due": <ISO date or null>
  }],
  "followup_email": {
    "subject": <under 80 chars>,
    "body": <plain text email body in the rep's voice>
  },
  "crm_suggestions": {
    "stage": "discovery" | "demo" | "proposal" | "negotiation" | "closed_won" | "closed_lost" | "unknown",
    "next_step": <imperative or null>,
    "objections": [<short tags>],
    "use_case": <one sentence or null>,
    "close_date_confidence": <0..1>
  },
  "adherence": {
    "framework": "MEDDIC" | "BANT" | "SPICED",
    "score": <0..1>,
    "missing": [<criteria not yet covered>]
  }
}

Rules:
- Quote or paraphrase from the transcript only. Do not invent objections, dates, or commitments.
- Follow-up email must be plain text (no HTML), 80-180 words, second-person, ends with a clear ask.
- If the call is too short to score adherence, set score=0 and list all framework criteria in "missing".
- No prose outside the JSON object.`;

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface MeetingForRecap {
  id: string;
  title: string | null;
  host: { id: string; name: string; email: string };
}
interface SegmentForRecap {
  speakerType: string;
  text: string;
  startMs: number;
}
interface SuggestionForRecap {
  suggestionType: string;
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
}

function mechanicalRecap(
  meeting: MeetingForRecap,
  segments: SegmentForRecap[],
  suggestions: SuggestionForRecap[],
  framework: Framework,
  lowSignal: boolean,
): RecapResult {
  // Extract customer questions by simple heuristic: ends with '?'
  const customerQuestions = segments
    .filter((s) => s.speakerType === 'customer' && /\?\s*$/.test(s.text))
    .map((s) => s.text.trim());
  const repTurns = segments.filter((s) => s.speakerType === 'rep').slice(0, 8);

  const summary =
    segments.length === 0
      ? `No transcript was captured for "${meeting.title ?? 'this call'}".`
      : `Call "${meeting.title ?? 'untitled'}" with ${segments.length} turns. ` +
        `Customer asked ${customerQuestions.length} explicit question(s). ` +
        `${suggestions.length} grounded suggestion(s) fired during the call. ` +
        `Run with an LLM provider configured (ANTHROPIC_API_KEY) for full structured analysis.`;

  return {
    summary,
    questions: customerQuestions.slice(0, 20),
    objections: [],
    unanswered: customerQuestions.slice(0, 5),
    nextSteps: [],
    followupEmail: {
      subject: `Recap: ${meeting.title ?? 'our call today'}`,
      body:
        `Hi,\n\nThanks for the time today. ` +
        (customerQuestions[0]
          ? `I want to make sure I follow up on "${customerQuestions[0].slice(0, 120)}" with a clearer answer. `
          : ``) +
        `I'll circle back with the items we discussed. Let me know if anything changed on your side.\n\n` +
        `Best,\n${meeting.host.name}`,
    },
    crmSuggestions: {
      stage: 'unknown',
      nextStep: null,
      objections: [],
      useCase: null,
      closeDateConfidence: 0,
    },
    adherence: {
      framework,
      score: lowSignal ? 0 : 0.3,
      missing: FRAMEWORK_CRITERIA[framework],
    },
    lowSignal,
    source: 'fallback',
  };
  void repTurns; // reserved for richer fallback
}

export async function persistRecap(
  meetingId: string,
  workspaceId: string,
  result: RecapResult,
): Promise<{ id: string }> {
  // Upsert: a meeting has at most one summary row.
  const existing = await prisma.meetingSummary.findUnique({ where: { meetingId } });
  const data = {
    summary: result.summary,
    objectionsJson: result.objections,
    nextStepsJson: result.nextSteps,
    followupEmail: result.followupEmail,
    crmSuggestionsJson: result.crmSuggestions,
    adherenceJson: result.adherence,
    lowSignal: result.lowSignal,
  };

  const row = existing
    ? await prisma.meetingSummary.update({ where: { meetingId }, data })
    : await prisma.meetingSummary.create({ data: { meetingId, ...data } });

  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId: null,
      action: 'meeting.recap_generated',
      resourceType: 'meeting_summary',
      resourceId: row.id,
      metadataJson: { source: result.source, lowSignal: result.lowSignal },
    },
  });

  return { id: row.id };
}
