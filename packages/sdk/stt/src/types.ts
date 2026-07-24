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
  /**
   * Audio channel this segment came from, when multichannel is enabled
   * (0-based). With dual-channel capture (tab=0, mic=1) this gives
   * deterministic rep/customer attribution without trusting diarization.
   * Undefined for mono streams.
   */
  channelIndex?: number;
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
  /**
   * Transcribe each channel independently and tag segments with
   * `channelIndex`. Requires interleaved multi-channel PCM. Used for
   * deterministic rep/customer split (tab audio on ch0, mic on ch1).
   */
  multichannel?: boolean;
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
