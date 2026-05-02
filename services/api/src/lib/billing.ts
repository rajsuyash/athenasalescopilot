/**
 * Plan-tier guards. Read the workspace's `BillingAccount` and reject mutations
 * that would push usage past the configured caps. PRD F16.
 *
 * Defaults match billing-service `PLAN_DEFAULTS` so a workspace without an
 * explicit BillingAccount row still gets sensible free-tier limits.
 */
import { prisma } from '@athena/db';
import { ApiError } from './errors.js';

const FREE_DEFAULTS = { seats: 3, meetingHourLimit: 5 };

interface AccountSnapshot {
  planTier: string;
  status: string;
  seats: number;
  meetingHourLimit: number;
}

async function snapshot(workspaceId: string): Promise<AccountSnapshot> {
  const account = await prisma.billingAccount.findUnique({ where: { workspaceId } });
  if (account) {
    return {
      planTier: account.planTier,
      status: account.status,
      seats: account.seats,
      meetingHourLimit: account.meetingHourLimit,
    };
  }
  return {
    planTier: 'free',
    status: 'active',
    seats: FREE_DEFAULTS.seats,
    meetingHourLimit: FREE_DEFAULTS.meetingHourLimit,
  };
}

/** Throws SEAT_LIMIT when adding one more active member would exceed the cap. */
export async function assertSeatAvailable(workspaceId: string): Promise<void> {
  const account = await snapshot(workspaceId);
  const active = await prisma.userWorkspaceMembership.count({
    where: { workspaceId, status: { in: ['invited', 'active'] } },
  });
  if (active >= account.seats) {
    throw new ApiError(402, 'SEAT_LIMIT', 'Seat limit reached for this plan.', {
      planTier: account.planTier,
      seats: account.seats,
      active,
    });
  }
}

/**
 * Soft cap: returns a status object instead of throwing, so the caller can
 * decide whether to allow the new meeting + surface a warning banner.
 *
 * - status=`payment_overdue` after a 7-day grace → block.
 * - meeting_hours past hard cap → block.
 * - within 80% of cap → allow but flag `nearLimit`.
 */
export interface MeetingGate {
  allowed: boolean;
  reason: string | null;
  planTier: string;
  meetingHoursUsed: number;
  meetingHourLimit: number;
  nearLimit: boolean;
}

export async function gateMeetingStart(workspaceId: string): Promise<MeetingGate> {
  const account = await snapshot(workspaceId);
  if (account.status === 'past_due' || account.status === 'canceled') {
    return {
      allowed: false,
      reason: 'PAYMENT_OVERDUE',
      planTier: account.planTier,
      meetingHoursUsed: 0,
      meetingHourLimit: account.meetingHourLimit,
      nearLimit: false,
    };
  }
  if (account.meetingHourLimit < 0) {
    return {
      allowed: true,
      reason: null,
      planTier: account.planTier,
      meetingHoursUsed: 0,
      meetingHourLimit: -1,
      nearLimit: false,
    };
  }
  // Sum meeting durations in the current calendar month.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const meetings = await prisma.meeting.findMany({
    where: {
      workspaceId,
      startedAt: { gte: start },
      endedAt: { not: null },
    },
    select: { startedAt: true, endedAt: true },
  });
  let totalMs = 0;
  for (const m of meetings) {
    if (m.startedAt && m.endedAt) {
      totalMs += Math.max(0, m.endedAt.getTime() - m.startedAt.getTime());
    }
  }
  const hours = totalMs / (1000 * 60 * 60);
  const cap = account.meetingHourLimit;
  const nearLimit = hours >= cap * 0.8;
  if (hours >= cap) {
    return {
      allowed: false,
      reason: 'METERING_LIMIT',
      planTier: account.planTier,
      meetingHoursUsed: Math.round(hours * 100) / 100,
      meetingHourLimit: cap,
      nearLimit: true,
    };
  }
  return {
    allowed: true,
    reason: null,
    planTier: account.planTier,
    meetingHoursUsed: Math.round(hours * 100) / 100,
    meetingHourLimit: cap,
    nearLimit,
  };
}
