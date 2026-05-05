/**
 * Index Workspace BMC sections as knowledge documents so retrieval can ground
 * suggestions on the rep's own canvas (USP, mechanism, pricing, message…).
 *
 * Idempotent. Each save/edit replaces the prior auto-indexed document for
 * that section by archiving the document and deactivating its chunks before
 * re-ingesting. We never delete — keeps audit history per CLAUDE.md hard
 * rule "Soft-delete by default".
 */
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { ingestDocument } from '../ingest/service.js';
import { BMC_SECTIONS, type BmcData, type BmcSection } from './service.js';

const SECTION_LABEL: Record<BmcSection, string> = {
  passion: 'Passion',
  niche: 'Niche',
  problem: 'Problem',
  usp: 'Unique Value Proposition',
  mvp: 'MVP Offer',
  mechanism: 'Mechanism',
  message: 'Marketing Message',
  channel: 'Channels',
  pricing: 'Pricing',
  delivery: 'Delivery',
};

const MIN_SECTION_LEN = 10;

export interface IndexBmcArgs {
  workspaceId: string;
  actorUserId: string;
  data: BmcData;
  version: number;
}

export interface IndexBmcResult {
  indexed: BmcSection[];
  skipped: BmcSection[];
  failed: Array<{ section: BmcSection; error: string }>;
}

export async function indexBmcAsKnowledge(
  args: IndexBmcArgs,
  deps: { embeddings: EmbeddingClient },
): Promise<IndexBmcResult> {
  const indexed: BmcSection[] = [];
  const skipped: BmcSection[] = [];
  const failed: Array<{ section: BmcSection; error: string }> = [];

  for (const section of BMC_SECTIONS) {
    const raw = (args.data[section] ?? '').trim();
    if (raw.length < MIN_SECTION_LEN) {
      skipped.push(section);
      // Still archive any prior auto-doc so editing a section to empty stops
      // surfacing stale content.
      await archivePriorBmcDocs(args.workspaceId, section);
      continue;
    }
    try {
      await archivePriorBmcDocs(args.workspaceId, section);
      const text = renderSection(section, raw);
      await ingestDocument(
        {
          workspaceId: args.workspaceId,
          actorUserId: args.actorUserId,
          name: `BMC · ${SECTION_LABEL[section]}`,
          category: `bmc-${section}`,
          format: 'markdown',
          text,
          tags: {
            source: 'bmc-auto',
            section,
            bmcVersion: args.version,
          },
          language: 'en-US',
        },
        deps,
      );
      indexed.push(section);
    } catch (err) {
      failed.push({
        section,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { indexed, skipped, failed };
}

function renderSection(section: BmcSection, body: string): string {
  // Wrap with a header so the LLM has clear context about what kind of fact
  // it's grounding on. The section name + label is also retrievable text.
  return `# ${SECTION_LABEL[section]}\n\nSource: workspace Business Model Canvas (section: ${section}).\n\n${body}`;
}

async function archivePriorBmcDocs(workspaceId: string, section: BmcSection): Promise<void> {
  const category = `bmc-${section}`;
  const docs = await prisma.knowledgeDocument.findMany({
    where: { workspaceId, category, status: { not: 'archived' } },
    select: { id: true, versions: { select: { id: true } } },
  });
  if (docs.length === 0) return;
  const versionIds = docs.flatMap((d) => d.versions.map((v) => v.id));
  await prisma.$transaction([
    ...(versionIds.length
      ? [
          prisma.knowledgeChunk.updateMany({
            where: { workspaceId, documentVersionId: { in: versionIds } },
            data: { active: false },
          }),
        ]
      : []),
    prisma.knowledgeDocument.updateMany({
      where: { workspaceId, id: { in: docs.map((d) => d.id) } },
      data: { status: 'archived' },
    }),
  ]);
}
