/**
 * Workspace Business Model Canvas service (Block Q).
 *
 * Two ingestion paths:
 *   1. PDF import — extract text via the existing knowledge extractor,
 *      then ask the LLM to map it into the 10-section BMC schema.
 *   2. Interactive build — bmc-builder.skill drives a 10-step conversation
 *      with the user; this service generates one section at a time and
 *      streams the model's output back to the caller.
 *
 * Both paths converge on the WorkspaceBmc Prisma row. The script generator
 * (Phase 4) reads that row and emits ScriptStageBlock records.
 */
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { LlmClient } from '@athena/sdk-llm';
import { loadSkill } from '@athena/sdk-llm';
import { extractText } from '../../lib/extract.js';

export const BMC_SECTIONS = [
  'passion',
  'niche',
  'problem',
  'usp',
  'mvp',
  'mechanism',
  'message',
  'channel',
  'pricing',
  'delivery',
] as const;
export type BmcSection = (typeof BMC_SECTIONS)[number];

export type BmcData = Partial<Record<BmcSection, string>>;

const BmcExtractionSchema = z.object({
  passion: z.string(),
  niche: z.string(),
  problem: z.string(),
  usp: z.string(),
  mvp: z.string(),
  mechanism: z.string(),
  message: z.string(),
  channel: z.string(),
  pricing: z.string(),
  delivery: z.string(),
  confidence: z.number().min(0).max(1),
});

/** Extract a structured BMC from a freeform PDF/text upload. Returns null
 *  when the document doesn't look like a BMC (low confidence) — caller
 *  should surface a friendly "this doesn't look like a BMC" message. */
export async function extractBmcFromUpload(
  args: {
    workspaceId: string;
    buffer: Buffer;
    format: 'pdf' | 'text' | 'markdown';
  },
  deps: { llm: LlmClient },
): Promise<{ data: BmcData; confidence: number } | null> {
  const extracted = await extractText({
    format: args.format,
    buffer: args.buffer,
  });
  const text = extracted.text.trim();
  if (text.length < 50) return null;

  const system = `You extract a Business Model Canvas (BMC) from a document.

The 10 BMC sections in order:
1. passion — the founder's market interest / passion area
2. niche — the specific target customer segment
3. problem — the domino problem + associated problems
4. usp — unique value proposition (Kano model: must-have, performance, delight)
5. mvp — MVP offer phases / milestones
6. mechanism — the unique mechanism that makes the offer work
7. message — the marketing message that captures attention
8. channel — primary acquisition channels
9. pricing — pricing strategy + offer structure
10. delivery — how the offer is delivered

Output ONLY raw JSON (no prose, no fences):
{"passion":"<...>","niche":"<...>","problem":"<...>","usp":"<...>","mvp":"<...>","mechanism":"<...>","message":"<...>","channel":"<...>","pricing":"<...>","delivery":"<...>","confidence":<0..1>}

Rules:
- Each section value is 2-6 sentences in plain prose.
- If a section is genuinely missing from the document, return an empty string for that section but lower confidence.
- confidence ≥ 0.6 means "this is recognizably a BMC". < 0.6 means "this doesn't look like a BMC".
- No marketing language. No invented facts.`;

  const result = await deps.llm.complete({
    workspaceId: args.workspaceId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text.slice(0, 60_000) },
    ],
    schema: BmcExtractionSchema,
    temperature: 0.1,
    maxTokens: 4000,
    deadlineMs: 60_000,
  });

  if (!result.parsed || result.parsed.confidence < 0.5) return null;
  const { confidence, ...sections } = result.parsed;
  return { data: sections, confidence };
}

/** Persist (upsert) the workspace BMC and bump the version counter. */
export async function saveBmc(args: {
  workspaceId: string;
  data: BmcData;
  sourceType: 'pdf' | 'interactive' | 'manual';
}): Promise<{ version: number }> {
  const existing = await prisma.workspaceBmc.findUnique({
    where: { workspaceId: args.workspaceId },
  });
  const nextVersion = existing ? existing.version + 1 : 1;
  await prisma.workspaceBmc.upsert({
    where: { workspaceId: args.workspaceId },
    create: {
      workspaceId: args.workspaceId,
      data: args.data,
      sourceType: args.sourceType,
      version: nextVersion,
    },
    update: {
      data: args.data,
      sourceType: args.sourceType,
      version: nextVersion,
    },
  });
  return { version: nextVersion };
}

export async function getBmc(workspaceId: string): Promise<{
  data: BmcData;
  sourceType: string;
  version: number;
  updatedAt: Date;
} | null> {
  const row = await prisma.workspaceBmc.findUnique({ where: { workspaceId } });
  if (!row) return null;
  return {
    data: (row.data ?? {}) as BmcData,
    sourceType: row.sourceType,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** Build the system + user prompt for ONE bmc-builder section. The skill
 *  body (10-step methodology + reference) is loaded once at boot via
 *  initSkills(); we slice it per section so the model focuses on the
 *  current step rather than processing the entire skill on every turn. */
export function buildSectionPrompt(args: {
  section: BmcSection;
  priorSections: BmcData;
  userInput: string;
}): { system: string; user: string } {
  const skillBody = loadSkill('bmc-builder');
  const priorJson = JSON.stringify(args.priorSections, null, 2);
  const system = `You are running the bmc-builder skill. Reference methodology below.

${skillBody.slice(0, 18_000)}

You are currently on section: ${args.section}.

Output ONLY the section's content in plain prose (2-6 sentences). No markdown headers, no JSON, no preamble. The frontend will render it as a confirmable card.`;
  const user = `Sections completed so far (use as context, don't repeat):\n${priorJson}\n\nUser input for the ${args.section} section:\n${args.userInput}`;
  return { system, user };
}
