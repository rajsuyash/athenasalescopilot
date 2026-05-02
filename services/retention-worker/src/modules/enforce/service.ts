/**
 * Hard-delete data past its workspace retention TTL.
 *
 * Default TTLs (PRD §7 + DEFAULT_RETENTION):
 *   transcript_segments: 30 days   (0 = drop after Stage D recap completes)
 *   raw audio:           never retained by default; we don't store it on the
 *                        server, so this knob is reserved for future SCK capture.
 *   meeting_summaries:   365 days  (0 = indefinite)
 *   audit_logs:          365 days  (0 = indefinite)
 *
 * Tenant invariant (PRD F10): every DELETE is keyed by `workspace_id` joined
 * to the row's owning entity. Documented + audited.
 */
import { prisma } from '@athena/db';

export interface EnforceCounts {
  workspaceId: string;
  transcripts: number;
  summaries: number;
  audits: number;
  archivedDocuments: number;
}

export interface EnforceOpts {
  /** Cap deletions per resource per workspace per sweep. */
  batchSize?: number;
  /** Override "now" — used in tests. */
  now?: Date;
}

const DEFAULT_BATCH = 1000;

interface PolicyRow {
  workspaceId: string;
  transcriptDays: number;
  summaryDays: number;
  auditDays: number;
}

export async function enforceForWorkspace(
  workspaceId: string,
  opts: EnforceOpts = {},
): Promise<EnforceCounts> {
  if (!workspaceId) throw new Error('workspaceId required');
  const policy = await prisma.retentionPolicy.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
  });
  if (!policy) {
    return {
      workspaceId,
      transcripts: 0,
      summaries: 0,
      audits: 0,
      archivedDocuments: 0,
    };
  }
  return enforceWith(
    {
      workspaceId,
      transcriptDays: policy.transcriptDays,
      summaryDays: policy.summaryDays,
      auditDays: policy.auditDays,
    },
    opts,
  );
}

export async function enforceAllWorkspaces(opts: EnforceOpts = {}): Promise<EnforceCounts[]> {
  const policies = await prisma.retentionPolicy.findMany({
    select: {
      workspaceId: true,
      transcriptDays: true,
      summaryDays: true,
      auditDays: true,
    },
  });
  const results: EnforceCounts[] = [];
  for (const p of policies) {
    try {
      results.push(await enforceWith(p, opts));
    } catch {
      // continue with the next workspace
    }
  }
  return results;
}

export function ageThreshold(now: Date, days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function enforceWith(p: PolicyRow, opts: EnforceOpts): Promise<EnforceCounts> {
  const batch = opts.batchSize ?? DEFAULT_BATCH;
  const now = opts.now ?? new Date();

  let transcripts = 0;
  const transcriptCutoff = ageThreshold(now, p.transcriptDays);
  if (transcriptCutoff) {
    // We can't directly DELETE with LIMIT in Prisma's deleteMany. Two-step:
    // select ids, then delete by id.
    const stale = await prisma.transcriptSegment.findMany({
      where: {
        workspaceId: p.workspaceId,
        meeting: { startedAt: { lt: transcriptCutoff } },
      },
      select: { id: true },
      take: batch,
    });
    if (stale.length > 0) {
      const r = await prisma.transcriptSegment.deleteMany({
        where: {
          workspaceId: p.workspaceId,
          id: { in: stale.map((s) => s.id) },
        },
      });
      transcripts = r.count;
    }
  }

  let summaries = 0;
  const summaryCutoff = ageThreshold(now, p.summaryDays);
  if (summaryCutoff) {
    const stale = await prisma.meetingSummary.findMany({
      where: {
        meeting: { workspaceId: p.workspaceId },
        createdAt: { lt: summaryCutoff },
      },
      select: { id: true },
      take: batch,
    });
    if (stale.length > 0) {
      const r = await prisma.meetingSummary.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
      summaries = r.count;
    }
  }

  let audits = 0;
  const auditCutoff = ageThreshold(now, p.auditDays);
  if (auditCutoff) {
    const stale = await prisma.auditLog.findMany({
      where: { workspaceId: p.workspaceId, createdAt: { lt: auditCutoff } },
      select: { id: true },
      take: batch,
    });
    if (stale.length > 0) {
      const r = await prisma.auditLog.deleteMany({
        where: {
          workspaceId: p.workspaceId,
          id: { in: stale.map((s) => s.id) },
        },
      });
      audits = r.count;
    }
  }

  // Hard-delete archived knowledge documents older than 30 days regardless of
  // workspace policy — they're already soft-deleted, so this just frees space.
  const archiveCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const archivedDocs = await prisma.knowledgeDocument.findMany({
    where: { workspaceId: p.workspaceId, status: 'archived', createdAt: { lt: archiveCutoff } },
    select: { id: true },
    take: batch,
  });
  let archivedDocuments = 0;
  if (archivedDocs.length > 0) {
    const r = await prisma.knowledgeDocument.deleteMany({
      where: {
        workspaceId: p.workspaceId,
        id: { in: archivedDocs.map((d) => d.id) },
      },
    });
    archivedDocuments = r.count;
  }

  // Audit-log the enforcement run itself. This row is exempt from this sweep
  // since we just wrote it; it'll be considered next time.
  if (transcripts + summaries + audits + archivedDocuments > 0) {
    await prisma.auditLog.create({
      data: {
        workspaceId: p.workspaceId,
        actorUserId: null,
        action: 'retention.enforced',
        resourceType: 'retention_policy',
        resourceId: p.workspaceId,
        metadataJson: {
          transcripts,
          summaries,
          audits,
          archivedDocuments,
          policy: {
            transcriptDays: p.transcriptDays,
            summaryDays: p.summaryDays,
            auditDays: p.auditDays,
          },
        },
      },
    });
  }

  return {
    workspaceId: p.workspaceId,
    transcripts,
    summaries,
    audits,
    archivedDocuments,
  };
}
