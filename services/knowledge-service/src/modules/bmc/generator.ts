/**
 * Script generator (Block Q phase 4).
 *
 * Reads the workspace's saved BMC, invokes the sales-script-generator skill
 * with that BMC as input, parses the LLM's markdown output into stage
 * blocks, and publishes a new ScriptCollection version. The realtime
 * gateway picks up the new published script within ~25 s (script cache
 * TTL) and the proactive coach immediately starts using it.
 *
 * The generated markdown is structured: SLOSHED 2.0 probing (7 checkpoints)
 * + 5-Step Pillar Pitching. We map each section heading to a canonical
 * stage so the gateway's getActiveScriptForStage finds them. The
 * STAGE_ALIASES map in services/realtime-gateway/src/lib/coach.ts provides
 * insurance if the model emits a slightly different heading.
 */
import { prisma } from '@athena/db';
import type { Prisma } from '@athena/db';
import type { LlmClient } from '@athena/sdk-llm';
import { loadSkill } from '@athena/sdk-llm';
import { getBmc, type BmcData } from './service.js';

interface ParsedBlock {
  stage: string;
  bodyMd: string;
  ordering: number;
}

interface GenerateResult {
  collectionId: string;
  versionId: string;
  blockCount: number;
  generatedAt: Date;
}

/**
 * Section heading patterns → canonical gateway stage. Order matters: more
 * specific patterns first so e.g. "C2: Pain" doesn't get caught by a
 * loose "discovery" matcher. Anything that doesn't match a pattern gets
 * dropped to keep the published script clean.
 */
const HEADING_PATTERNS: Array<{ regex: RegExp; stage: string }> = [
  { regex: /^#{1,4}\s*(rapport|frame|opening|opener)\b/i, stage: 'opener' },
  { regex: /^#{1,4}\s*(c1|c\s*1|situation|c2|c\s*2|pain|c3|c\s*3|doubt)\b/i, stage: 'discovery' },
  { regex: /^#{1,4}\s*(c4|c\s*4|authority|c5|c\s*5|effort)\b/i, stage: 'qualification' },
  { regex: /^#{1,4}\s*(eagle.?s?\s*eye|pillar|delivery\s*model|temperature\s*check)\b/i, stage: 'demo' },
  { regex: /^#{1,4}\s*(c6|c\s*6|consequence)\b/i, stage: 'objection_handling' },
  { regex: /^#{1,4}\s*(c7|c\s*7|goal|commitment|price\s*reveal|closing|close|next\s*step)\b/i, stage: 'closing' },
];

/** Split the generator's markdown output into stage-tagged blocks. We
 *  walk header-to-header, attribute each block to the most-recent matched
 *  stage. Blocks that fall before the first matched header are discarded
 *  (usually preambles like "## PART 1: PROBING SCRIPT"). */
function parseScriptMarkdown(md: string): ParsedBlock[] {
  const lines = md.split('\n');
  const blocks: ParsedBlock[] = [];
  let currentStage: string | null = null;
  let buffer: string[] = [];
  let ordering = 0;

  const flush = () => {
    if (!currentStage) {
      buffer = [];
      return;
    }
    const body = buffer.join('\n').trim();
    if (body.length < 20) {
      buffer = [];
      return;
    }
    blocks.push({ stage: currentStage, bodyMd: body, ordering });
    ordering += 1;
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      const match = HEADING_PATTERNS.find((p) => p.regex.test(line));
      if (match) {
        flush();
        currentStage = match.stage;
        buffer.push(line);
        continue;
      }
      // Unmatched header → still treat as a separator within current stage.
      flush();
      if (currentStage) buffer.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** System prompt used by the script generator. The sales-script-generator
 *  skill body is the bulk; we add a thin "format your output as markdown
 *  with the headings the parser expects" hint. */
function buildSystemPrompt(): string {
  const skillBody = loadSkill('sales-script-generator');
  return `${skillBody}

OUTPUT FORMAT REQUIREMENTS:
- Output a single markdown document.
- Use H2/H3 headings exactly as documented in the skill (Rapport, Frame,
  C1: Situation, C2: Pain, C3: Doubt, C4: Authority, C5: Effort,
  C6: Consequence, C7: Goal + Commitment, Eagle's Eye View, Pillar 1,
  Pillar 2, ..., Delivery, Temperature Check, Price Reveal).
- No raw {{placeholder}} tokens — bake in concrete copy from the BMC.
- ≤6000 words total.
- No prose preamble before the first heading.`;
}

function buildUserPrompt(bmc: BmcData): string {
  return `Generate the full SLOSHED 2.0 + 5-Step Pillar Pitching script from this Business Model Canvas:

\`\`\`json
${JSON.stringify(bmc, null, 2)}
\`\`\``;
}

export async function generateScriptFromBmc(
  args: { workspaceId: string; actorUserId: string; collectionName?: string },
  deps: { llm: LlmClient },
): Promise<GenerateResult> {
  const bmc = await getBmc(args.workspaceId);
  if (!bmc) {
    throw Object.assign(new Error('no BMC found for workspace — capture or import a BMC first'), {
      statusCode: 412,
      code: 'BMC_NOT_FOUND',
    });
  }

  const r = await deps.llm.complete({
    workspaceId: args.workspaceId,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(bmc.data) },
    ],
    temperature: 0.4,
    maxTokens: 8000,
    deadlineMs: 90_000,
  });

  if (r.finishReason === 'error' || r.finishReason === 'cancelled') {
    throw Object.assign(new Error(`script generation failed: finishReason=${r.finishReason}`), {
      statusCode: 502,
      code: 'GENERATION_FAILED',
    });
  }

  const parsed = parseScriptMarkdown(r.text);
  if (parsed.length < 3) {
    throw Object.assign(
      new Error(`generator output had too few stage blocks (got ${parsed.length}); model may have failed to follow the format`),
      { statusCode: 502, code: 'PARSE_TOO_FEW_BLOCKS' },
    );
  }

  // Tx: create a fresh ScriptCollection (so users can keep a manual one
  // alongside), draft a v1 with all parsed blocks, atomically publish.
  const collectionName =
    args.collectionName ?? `auto-generated-${new Date().toISOString().slice(0, 16).replace('T', '-')}`;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const collection = await tx.scriptCollection.create({
      data: { workspaceId: args.workspaceId, name: collectionName },
    });
    const version = await tx.scriptVersion.create({
      data: {
        collectionId: collection.id,
        version: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    await tx.scriptStageBlock.createMany({
      data: parsed.map((b) => ({
        versionId: version.id,
        stage: b.stage,
        language: 'en-US',
        bodyMd: b.bodyMd,
        ordering: b.ordering,
      })),
    });
    await tx.scriptCollection.update({
      where: { id: collection.id },
      data: { currentVersionId: version.id },
    });
    await tx.auditLog.create({
      data: {
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        action: 'script_collection.auto_generated',
        resourceType: 'script_collection',
        resourceId: collection.id,
        metadataJson: {
          source: 'bmc',
          bmcVersion: bmc.version,
          blockCount: parsed.length,
        },
      },
    });
    return { collection, version };
  });

  return {
    collectionId: result.collection.id,
    versionId: result.version.id,
    blockCount: parsed.length,
    generatedAt: new Date(),
  };
}
