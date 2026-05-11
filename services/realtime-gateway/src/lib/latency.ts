/**
 * Bounded, batched latency event writer. Emits per-stage timing rows from
 * the hot path without blocking the WebSocket loop or holding a transaction.
 *
 * Tenant invariant: every row carries `workspace_id`. Reads (analytics-service)
 * filter on the same.
 */
import { prisma } from '@athena/db';

export type LatencyStage =
  | 'transcript_final'
  | 'intent'
  | 'retrieval'
  | 'script_fetch'
  | 'suggestion'
  | 'coach_total';

interface PendingEvent {
  workspaceId: string;
  meetingId?: string | null;
  stage: LatencyStage;
  latencyMs: number;
  degraded?: boolean;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 200;
let buffer: PendingEvent[] = [];
let timer: NodeJS.Timeout | null = null;

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushNow(), FLUSH_INTERVAL_MS);
  // Don't keep the process alive purely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
}

export function emitLatency(ev: PendingEvent): void {
  if (!ev.workspaceId || !Number.isFinite(ev.latencyMs) || ev.latencyMs < 0) return;
  buffer.push(ev);
  ensureTimer();
  if (buffer.length >= MAX_BATCH) {
    void flushNow();
  }
}

export async function flushNow(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await prisma.latencyEvent.createMany({
      data: batch.map((e) => ({
        workspaceId: e.workspaceId,
        meetingId: e.meetingId ?? null,
        stage: e.stage,
        latencyMs: Math.round(e.latencyMs),
        degraded: e.degraded ?? false,
      })),
    });
  } catch {
    // Drop on failure — telemetry must never block the hot path.
  }
}

export async function shutdownLatency(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await flushNow();
}
