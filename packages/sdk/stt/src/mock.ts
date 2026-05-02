import crypto from 'node:crypto';
import type {
  OpenStreamOpts,
  SttClient,
  SttSegment,
  SttStream,
  SttStreamHandlers,
} from './types.js';

/**
 * Deterministic mock STT for tests + local dev. Emits scripted finals on a
 * timer; ignores audio chunks. Useful for exercising the full pipeline with
 * a known transcript.
 */
export class MockSttClient implements SttClient {
  private readonly script: Array<{ delayMs: number; text: string; speakerLabel?: string }>;

  constructor(script: Array<{ delayMs: number; text: string; speakerLabel?: string }> = []) {
    this.script = script;
  }

  async open(opts: OpenStreamOpts, handlers: SttStreamHandlers): Promise<SttStream> {
    if (!opts.workspaceId) throw new Error('workspaceId required');

    const timers: NodeJS.Timeout[] = [];
    let totalMs = 0;
    for (const step of this.script) {
      totalMs += step.delayMs;
      const at = totalMs;
      timers.push(
        setTimeout(() => {
          const seg: SttSegment = {
            segmentId: crypto.randomUUID(),
            text: step.text,
            startMs: at - step.delayMs,
            endMs: at,
            confidence: 0.95,
            isFinal: true,
            speakerLabel: step.speakerLabel ?? 'Speaker 0',
            language: opts.language ?? 'en-US',
          };
          handlers.onFinal(seg);
        }, at),
      );
    }

    let closed = false;
    return {
      push(_chunk: Uint8Array): void {
        // mock ignores audio
        void _chunk;
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        for (const t of timers) clearTimeout(t);
        handlers.onClose?.();
      },
    };
  }
}
