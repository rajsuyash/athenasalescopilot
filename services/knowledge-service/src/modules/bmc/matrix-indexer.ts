/**
 * Index the grounded objection→solution matrix as knowledge documents so the
 * EXISTING live retrieval path serves them with no new serving code:
 *   - Category `objection-handling-matrix` matches the orchestrator's objection
 *     two-pass (`categoryPrefix='objection-handling-'`) → served objection-first.
 *   - In the gateway, Phase 3 adds the same prefix pass; until then they surface
 *     via plain semantic/trigram (the triggerPhrases are baked into the body for
 *     trigram fuel).
 *
 * Idempotent + soft-delete: prior matrix docs are archived (chunks deactivated)
 * before re-ingest. Never hard-deletes (CLAUDE.md "Soft-delete by default").
 *
 * Each entry's original grounding IDs are stored in tags.groundedOnChunkIds as
 * provenance (F5 audit trail) — NOT read at serve time. At serve time the matrix
 * chunk has its own UUID, which the live LLM cites and the live F5 gate
 * validates against the live retrieval set.
 */
import { prisma } from '@athena/db';
import type { EmbeddingClient } from '@athena/sdk-embeddings';
import { ingestDocument } from '../ingest/service.js';
import type { MatrixEntry } from './matrix-generator.js';

export const MATRIX_CATEGORY = 'objection-handling-matrix';
const INGEST_CONCURRENCY = 5;

export interface IndexMatrixArgs {
  workspaceId: string;
  actorUserId: string;
  entries: MatrixEntry[];
  bmcVersion: number;
}

export interface IndexMatrixResult {
  indexed: number;
  failed: number;
}

/** Display-ready projection of a matrix entry, served by the wizard read path.
 *  Sourced from chunk tags so the GET endpoint never has to parse markdown.
 *  The full 7-step reframe stays in the doc body for the live call surface. */
export interface MatrixDisplayEntry {
  archetype: string;
  bmcTheme: string;
  objectionText: string;
  suggestedLine: string;
  triggerPhrases: string[];
}

export function renderEntryMd(entry: MatrixEntry): string {
  const steps = entry.reframeSteps;
  // triggerPhrases go near the top, verbatim, so the trigram retriever matches
  // a customer's actual wording to this entry.
  return `# Objection (${entry.archetype} · ${entry.bmcTheme}): ${entry.objectionText}

When the customer says things like: ${entry.triggerPhrases.map((p) => `"${p}"`).join(', ')}.

## Ready-to-deliver line
${entry.suggestedLine}

## Socratic reframe (7-step loop)
1. Disarm: ${steps.disarm}
2. Isolate: ${steps.isolate}
3. Uncover: ${steps.uncover}
4. Reframe: ${steps.reframe}
5. Justify: ${steps.justify}
6. Consequence: ${steps.consequence}
7. Identity close: ${steps.identityClose}`;
}

export async function indexObjectionMatrix(
  args: IndexMatrixArgs,
  deps: { embeddings: EmbeddingClient },
): Promise<IndexMatrixResult> {
  await archivePriorMatrixDocs(args.workspaceId);

  let indexed = 0;
  let failed = 0;
  const queue = [...args.entries];

  // Bounded concurrency: ingestDocument embeds + writes per call; cap the
  // fan-out so we don't open an unbounded number of embed round-trips at once.
  const worker = async (): Promise<void> => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      try {
        await ingestDocument(
          {
            workspaceId: args.workspaceId,
            actorUserId: args.actorUserId,
            name: `Objection · ${entry.archetype} · ${entry.bmcTheme}`,
            category: MATRIX_CATEGORY,
            format: 'markdown',
            text: renderEntryMd(entry),
            tags: {
              source: 'objection-matrix',
              archetype: entry.archetype,
              bmcTheme: entry.bmcTheme,
              bmcVersion: args.bmcVersion,
              triggerPhrases: entry.triggerPhrases,
              // Display fields for the wizard read path (GET endpoint reads tags
              // so it never parses the rendered markdown body).
              objectionText: entry.objectionText,
              suggestedLine: entry.suggestedLine,
              // Provenance only (F5 audit trail) — not read at serve time.
              groundedOnChunkIds: entry.sourceChunkIds,
            },
            language: 'en-US',
          },
          deps,
        );
        indexed += 1;
      } catch {
        failed += 1;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(INGEST_CONCURRENCY, args.entries.length) }, () => worker()),
  );

  // Matrix-level audit event (append-only). Per-document audit rows are also
  // written by ingestDocument ('knowledge.uploaded').
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      action: 'precall.matrix_generated',
      resourceType: 'objection_matrix',
      resourceId: args.workspaceId,
      metadataJson: {
        bmcVersion: args.bmcVersion,
        entryCount: args.entries.length,
        indexed,
        failed,
      },
    },
  });

  return { indexed, failed };
}

/**
 * Read the current (non-archived) objection matrix for a workspace as
 * display-ready entries. workspace_id is the first predicate (F10). One entry
 * per source document: a matrix entry renders to a small markdown doc that the
 * chunker rarely splits, but if it does, every chunk shares identical tags, so
 * we dedupe by document version and read the first chunk's tags.
 */
export async function readObjectionMatrix(workspaceId: string): Promise<MatrixDisplayEntry[]> {
  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      workspaceId,
      active: true,
      documentVersion: {
        document: { workspaceId, category: MATRIX_CATEGORY, status: { not: 'archived' } },
      },
    },
    select: { documentVersionId: true, chunkOrder: true, tagsJson: true },
    orderBy: [{ documentVersionId: 'asc' }, { chunkOrder: 'asc' }],
  });

  const entries: MatrixDisplayEntry[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (seen.has(c.documentVersionId)) continue;
    seen.add(c.documentVersionId);
    const t = (c.tagsJson ?? {}) as Record<string, unknown>;
    if (t.source !== 'objection-matrix') continue;
    entries.push({
      archetype: typeof t.archetype === 'string' ? t.archetype : '',
      bmcTheme: typeof t.bmcTheme === 'string' ? t.bmcTheme : '',
      objectionText: typeof t.objectionText === 'string' ? t.objectionText : '',
      suggestedLine: typeof t.suggestedLine === 'string' ? t.suggestedLine : '',
      triggerPhrases: Array.isArray(t.triggerPhrases)
        ? t.triggerPhrases.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }
  return entries;
}

/** Map a freshly-generated (in-memory) matrix entry to the display shape, so the
 *  POST response and the GET read path return byte-identical entry objects. */
export function toDisplayEntry(entry: MatrixEntry): MatrixDisplayEntry {
  return {
    archetype: entry.archetype,
    bmcTheme: entry.bmcTheme,
    objectionText: entry.objectionText,
    suggestedLine: entry.suggestedLine,
    triggerPhrases: entry.triggerPhrases,
  };
}

async function archivePriorMatrixDocs(workspaceId: string): Promise<void> {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { workspaceId, category: MATRIX_CATEGORY, status: { not: 'archived' } },
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
