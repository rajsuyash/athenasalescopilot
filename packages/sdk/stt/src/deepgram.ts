import crypto from 'node:crypto';
import WebSocket from 'ws';
import type {
  OpenStreamOpts,
  SttClient,
  SttSegment,
  SttStream,
  SttStreamHandlers,
} from './types.js';

// Nova-3 (2026 GA): sub-300ms streaming P95, ~8.2% WER on noisy real-world
// audio. ~100-150ms faster than Nova-2 on streaming finals. Fully-compatible
// drop-in for Nova-2 — same WS protocol, same params, same response shape.
const DEFAULT_MODEL = 'nova-3';
const DEFAULT_ENDPOINT = 'wss://api.deepgram.com/v1/listen';

/**
 * Deepgram streaming STT client.
 *
 * Per PRD F3 — partials within 800ms, finals within 300ms of finalization.
 * Diarization on. We forward both partials and finals; the consumer decides
 * whether to act on partials.
 */
export class DeepgramSttClient implements SttClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: { apiKey: string; model?: string; endpoint?: string }) {
    if (!opts.apiKey) throw new Error('DEEPGRAM_API_KEY required');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  }

  async open(opts: OpenStreamOpts, handlers: SttStreamHandlers): Promise<SttStream> {
    if (!opts.workspaceId) throw new Error('workspaceId required');

    const params = new URLSearchParams({
      model: this.model,
      encoding: opts.encoding ?? 'linear16',
      sample_rate: String(opts.sampleRate ?? 16000),
      channels: String(opts.channels ?? 1),
      language: opts.language ?? 'en-US',
      smart_format: 'true',
      diarize: 'true',
      interim_results: 'true',
      // Tuned down from 300ms to 200ms — Deepgram fires `is_final` after this
      // much trailing silence. The difference is felt directly at the head of
      // the coach pipeline: every customer utterance is scored 100ms sooner.
      // 200ms is still well above the ~100ms floor where false-final triggers
      // cut off natural sentence pauses.
      endpointing: '200',
    });
    if (opts.vocabulary && opts.vocabulary.length > 0) {
      // Deepgram accepts repeated `keywords` query params with optional boost.
      for (const k of opts.vocabulary) params.append('keywords', `${k}:1`);
    }
    const url = `${this.endpoint}?${params.toString()}`;

    const ws = new WebSocket(url, { headers: { Authorization: `Token ${this.apiKey}` } });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.off('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString('utf8')) as DeepgramTranscriptMessage;
        if (msg.type !== 'Results') return;
        const alt = msg.channel?.alternatives?.[0];
        if (!alt || !alt.transcript) return;
        const startMs = Math.round((msg.start ?? 0) * 1000);
        const endMs = startMs + Math.round((msg.duration ?? 0) * 1000);
        const speakerLabel = pickSpeaker(alt) ?? 'Speaker';
        const seg: SttSegment = {
          segmentId: crypto.randomUUID(),
          text: alt.transcript,
          startMs,
          endMs,
          confidence: alt.confidence ?? 0,
          isFinal: msg.is_final === true,
          speakerLabel,
          language: opts.language ?? 'en-US',
        };
        if (seg.isFinal) handlers.onFinal(seg);
        else handlers.onPartial?.(seg);
      } catch (err) {
        handlers.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('error', (err: Error) => handlers.onError(err));
    ws.on('close', () => handlers.onClose?.());

    let closed = false;
    return {
      push(chunk: Uint8Array): void {
        if (closed) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(chunk);
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          }
        } catch {
          /* ignore */
        }
        await new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) return resolve();
          ws.once('close', () => resolve());
          setTimeout(() => resolve(), 2000);
        });
      },
    };
  }
}

interface DeepgramTranscriptMessage {
  type: string;
  is_final?: boolean;
  start?: number;
  duration?: number;
  channel?: {
    alternatives?: Array<{
      transcript: string;
      confidence?: number;
      words?: Array<{ word: string; speaker?: number; start?: number; end?: number }>;
    }>;
  };
}

function pickSpeaker(
  alt: NonNullable<NonNullable<DeepgramTranscriptMessage['channel']>['alternatives']>[number],
): string | null {
  const words = alt.words ?? [];
  if (words.length === 0) return null;
  // Pick the speaker that owns the majority of words in this segment.
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker !== 'number') continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `Speaker ${top[0]}` : null;
}
