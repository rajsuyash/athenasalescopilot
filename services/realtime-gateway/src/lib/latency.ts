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
  | 'llm_ttft'
  /**
   * Wall-clock from the customer's final transcript segment arriving to the
   * rep seeing the first token. The ONLY stage that measures what the rep
   * actually experiences: it spans queue wait (a coach call blocked behind an
   * in-flight one), intent, retrieval, AND model TTFT.
   *
   * Every other stage starts inside coachAndPersist, so none of them could
   * see the pre-call queue stall that motivated this metric.
   */
  | 'turn_to_first_token'
  | 'suggestion'
  | 'coach_total';

interface PendingEvent {
  workspaceId: string;
  meetingId?: string | null;
  stage: LatencyStage;
  latencyMs: number;
  degraded?: boolean;
  /** Model that served the call, so the number is attributable later. */
  model?: string | null;
  /** Anthropic cache_read_input_tokens — >0 proves the prompt cache engaged. */
  cacheReadTokens?: number | null;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 200;
let buffer: PendingEvent[] = [];
let timer: NodeJS.Timeout | null = null;
/** Latch so a persistent write failure warns once, not once per flush. */
let warnedFlushFailure = false;

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
        model: e.model ?? null,
        cacheReadTokens: e.cacheReadTokens ?? null,
      })),
    });
  } catch (err) {
    // Drop on failure — telemetry must never block the hot path.
    //
    // But do NOT drop silently. This catch hid a total telemetry outage:
    // `latency_events` writes were failing and nobody knew, so months of
    // "check the dashboard" follow-ups were chasing a table with no data.
    // One warn per flush is cheap and makes the next outage visible.
    if (!warnedFlushFailure) {
      warnedFlushFailure = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[latency] flush failed — telemetry is being dropped (logged once per process):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export async function shutdownLatency(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await flushNow();
}
