/**
 * Billing aggregations: ensure a billing account exists per workspace, count
 * seats / MAR / meeting hours for the current period.
 */
import { prisma } from '@athena/db';

export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface BillingSnapshot {
  planTier: PlanTier;
  status: string;
  seats: number;
  meetingHourLimit: number;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface UsageSnapshot {
  periodStart: string;
  periodEnd: string;
  activeMembers: number;
  monthlyActiveReps: number;
  meetingHours: number;
  knowledgeChunks: number;
}

const SEAT_DEFAULTS: Record<PlanTier, number> = { free: 3, pro: 25, enterprise: 200 };
const HOUR_DEFAULTS: Record<PlanTier, number> = { free: 5, pro: 250, enterprise: -1 };

function periodWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function ensureBillingAccount(workspaceId: string): Promise<BillingSnapshot> {
  if (!workspaceId) throw new Error('workspaceId required');
  let account = await prisma.billingAccount.findUnique({ where: { workspaceId } });
  if (!account) {
    account = await prisma.billingAccount.create({
      data: {
        workspaceId,
        planTier: 'free',
        seats: SEAT_DEFAULTS.free,
        meetingHourLimit: HOUR_DEFAULTS.free,
      },
    });
  }
  const { start } = periodWindow();
  return {
    planTier: account.planTier as PlanTier,
    status: account.status,
    seats: account.seats,
    meetingHourLimit: account.meetingHourLimit,
    currentPeriodStart: start.toISOString(),
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    stripeCustomerId: account.stripeCustomerId,
    stripeSubscriptionId: account.stripeSubscriptionId,
  };
}

export async function snapshotUsage(workspaceId: string): Promise<UsageSnapshot> {
  if (!workspaceId) throw new Error('workspaceId required');
  const { start, end } = periodWindow();

  const [activeMembers, marReps, meetings, chunkCount] = await Promise.all([
    prisma.userWorkspaceMembership.count({
      where: { workspaceId, status: 'active' },
    }),
    prisma.meeting
      .findMany({
        where: { workspaceId, startedAt: { gte: start, lt: end } },
        select: { hostUserId: true },
        distinct: ['hostUserId'],
      })
      .then((rows) => rows.length),
    prisma.meeting.findMany({
      where: {
        workspaceId,
        startedAt: { gte: start, lt: end },
        endedAt: { not: null },
      },
      select: { startedAt: true, endedAt: true },
    }),
    prisma.knowledgeChunk.count({ where: { workspaceId, active: true } }),
  ]);

  let totalMs = 0;
  for (const m of meetings) {
    if (m.startedAt && m.endedAt) {
      totalMs += Math.max(0, m.endedAt.getTime() - m.startedAt.getTime());
    }
  }
  const meetingHours = Math.round(totalMs / 36_000) / 100; // 2-decimal hours

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    activeMembers,
    monthlyActiveReps: marReps,
    meetingHours,
    knowledgeChunks: chunkCount,
  };
}

/** Persist usage into UsageCounter rows so analytics + Stripe metering can read. */
export async function persistUsage(workspaceId: string): Promise<void> {
  const account = await prisma.billingAccount.findUnique({ where: { workspaceId } });
  if (!account) return;
  const { start, end } = periodWindow();
  const usage = await snapshotUsage(workspaceId);
  const rows = [
    { kind: 'mar', value: usage.monthlyActiveReps },
    { kind: 'meeting_hours', value: Math.round(usage.meetingHours) },
    { kind: 'knowledge_chunks', value: usage.knowledgeChunks },
  ];
  for (const r of rows) {
    await prisma.usageCounter.upsert({
      where: {
        workspaceId_kind_periodStart: {
          workspaceId,
          kind: r.kind,
          periodStart: start,
        },
      },
      create: {
        workspaceId,
        billingAccountId: account.id,
        kind: r.kind,
        periodStart: start,
        periodEnd: end,
        value: r.value,
      },
      update: { value: r.value, periodEnd: end },
    });
  }
}

export interface SeatCheck {
  seatLimit: number;
  activeMembers: number;
  overLimit: boolean;
}

export async function seatCheck(workspaceId: string): Promise<SeatCheck> {
  const account = await ensureBillingAccount(workspaceId);
  const usage = await snapshotUsage(workspaceId);
  return {
    seatLimit: account.seats,
    activeMembers: usage.activeMembers,
    overLimit: usage.activeMembers > account.seats,
  };
}

export const PLAN_DEFAULTS = { seats: SEAT_DEFAULTS, hours: HOUR_DEFAULTS };
