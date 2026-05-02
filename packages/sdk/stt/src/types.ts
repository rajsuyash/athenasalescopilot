export interface SttSegment {
  /** Stable id from the provider, or generated. */
  segmentId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
  /** Speaker label from diarization. Stable across the session. */
  speakerLabel: string;
  /** Heuristic mapping of speaker → rep/customer/unknown (set by stream consumer). */
  language: string;
}

export interface SttStreamHandlers {
  onPartial?(seg: SttSegment): void;
  onFinal(seg: SttSegment): void;
  onError(err: Error): void;
  onClose?(): void;
}

export interface OpenStreamOpts {
  workspaceId: string;
  meetingId?: string;
  /** ISO language tag (e.g. en-US). */
  language?: string;
  /** Boost terms — improves recognition of brand names, jargon. */
  vocabulary?: string[];
  /** Sample rate of the PCM frames you'll push. */
  sampleRate?: number;
  channels?: number;
  encoding?: 'linear16' | 'opus';
}

export interface SttStream {
  /** Push a binary audio chunk. PCM s16le by default. */
  push(chunk: Uint8Array): void;
  /** Politely flush + close. Resolves once the stream is fully drained. */
  close(): Promise<void>;
}

export interface SttClient {
  open(opts: OpenStreamOpts, handlers: SttStreamHandlers): Promise<SttStream>;
}
