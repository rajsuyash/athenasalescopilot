import type { RetentionPolicy } from '@athena/shared-types';

/**
 * Retention defaults applied when a workspace has no explicit policy row.
 * Per PRD §7 Compliance — admins can override per resource type.
 */
export const DEFAULT_RETENTION = {
  transcriptDays: 30,
  audioDays: 0, // PRD F2: raw audio dropped unless workspace opts in
  summaryDays: 365,
  auditDays: 365,
} as const;

export type ResourceKind = 'transcript' | 'audio' | 'summary' | 'audit';

export function daysFor(policy: RetentionPolicy | null, kind: ResourceKind): number {
  const p = policy ?? {
    id: '' as RetentionPolicy['id'],
    workspaceId: '' as RetentionPolicy['workspaceId'],
    transcriptDays: DEFAULT_RETENTION.transcriptDays,
    audioDays: DEFAULT_RETENTION.audioDays,
    summaryDays: DEFAULT_RETENTION.summaryDays,
    auditDays: DEFAULT_RETENTION.auditDays,
  };
  switch (kind) {
    case 'transcript':
      return p.transcriptDays;
    case 'audio':
      return p.audioDays;
    case 'summary':
      return p.summaryDays;
    case 'audit':
      return p.auditDays;
  }
}

/** True if a resource created at `createdAt` is past its retention window. */
export function isExpired(
  policy: RetentionPolicy | null,
  kind: ResourceKind,
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  const days = daysFor(policy, kind);
  if (days <= 0 && kind === 'audio') return true; // audio never retained by default
  if (days <= 0) return false; // 0 means "indefinite" for non-audio kinds
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs > days * 24 * 60 * 60 * 1000;
}
