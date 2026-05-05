/**
 * Loads published probing/pitching script blocks for a workspace + stage and
 * surfaces them as virtual `RetrievedChunk`s so the suggest pipeline treats
 * them as first-class grounding sources alongside semantic-retrieved chunks.
 *
 * Mirrors the realtime-gateway's stage alias map so admin authors can write
 * "Pitching" / "Probing" / "Opening" and we coerce to canonical stage IDs.
 */
import { prisma } from '@athena/db';
import type { RetrievedChunk } from './retrieval.js';

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

export function normalizeStage(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return STAGE_ALIASES[s] ?? s;
}

const SCRIPT_CHUNK_SCORE = 0.95;
const MAX_BLOCKS = 3;

export async function loadStageBlocksAsChunks(
  workspaceId: string,
  rawStage: string,
  language?: string,
): Promise<RetrievedChunk[]> {
  if (!workspaceId || !rawStage) return [];
  const wantedStage = normalizeStage(rawStage);

  // Pull every collection's published current version + blocks. ScriptCollection
  // queries are tenant-scoped (workspaceId) per CLAUDE.md hard rule #1.
  const collections = await prisma.scriptCollection.findMany({
    where: { workspaceId, currentVersionId: { not: null } },
    select: {
      name: true,
      currentVersionId: true,
      currentVersion: {
        select: {
          publishedAt: true,
          blocks: {
            select: { id: true, stage: true, bodyMd: true, ordering: true, language: true },
            orderBy: { ordering: 'asc' },
          },
        },
      },
    },
  });

  const out: RetrievedChunk[] = [];
  for (const c of collections) {
    if (!c.currentVersion?.publishedAt) continue;
    for (const b of c.currentVersion.blocks) {
      if (out.length >= MAX_BLOCKS) break;
      if (normalizeStage(b.stage) !== wantedStage) continue;
      if (language && b.language && !sameLanguage(b.language, language)) continue;
      out.push({
        id: `script:${b.id}`,
        text: b.bodyMd,
        score: SCRIPT_CHUNK_SCORE,
        documentVersionId: c.currentVersionId ?? '',
        category: `playbook-script-${wantedStage}`,
        documentName: c.name,
        language: b.language ?? 'en',
      });
    }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

function sameLanguage(a: string, b: string): boolean {
  // Match base subtag only — "en" matches "en-US" and "en-GB".
  return a.toLowerCase().split(/[-_]/)[0] === b.toLowerCase().split(/[-_]/)[0];
}
