import type {
  ChunkId,
  MeetingId,
  SegmentId,
  SuggestionId,
  TurnId,
  UserId,
  WorkspaceId,
} from './ids.js';
import type { SpeakerType, SuggestionType } from './entities.js';

/** Per-frame audio chunk uploaded by the desktop app. PRD F2. */
export interface AudioChunkIn {
  meetingId: MeetingId;
  channel: 'system' | 'mic';
  sequence: number;
  timestampMs: number;
  payloadBytes: string; // base64 PCM
  format: 'pcm_s16le_16khz_mono';
}

export interface AudioChunkAck {
  meetingId: MeetingId;
  ackSequence: number;
  receivedAtServerMs: number;
}

/** PRD F3 — partial or final transcript. */
export interface TranscriptEvent {
  type: 'transcript.partial.received' | 'transcript.final.received';
  meetingId: MeetingId;
  segmentId: SegmentId;
  speakerType: SpeakerType;
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
  language: string;
  sourceType: 'stt_audio' | 'meet_caption';
}

/** PRD F4 — intent classifier output for one finalized turn. */
export interface IntentDetectedEvent {
  type: 'intent.detected';
  meetingId: MeetingId;
  turnId: TurnId;
  speakerType: SpeakerType;
  categories: string[];
  stageSignal: string;
  urgencyScore: number;
  interruptionPriority: number;
  confidence: number;
  modelVersion: string;
  detectedAt: string;
}

/** PRD F5 — grounded suggestion. */
export interface SuggestionGeneratedEvent {
  type: 'suggestion.generated';
  id: SuggestionId;
  meetingId: MeetingId;
  turnId: TurnId;
  suggestionType: SuggestionType;
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
  priorityScore: number;
  sourceChunkIds: ChunkId[];
  policyVersion: string;
  rationale: string | null;
  generatedAt: string;
}

/** PRD F6 — rep feedback on a suggestion. */
export interface SuggestionFeedbackEvent {
  type: 'suggestion.feedback.recorded';
  suggestionId: SuggestionId;
  meetingId: MeetingId;
  repUserId: UserId;
  feedback: 'useful' | 'not_useful' | 'dismissed';
  displayedAt: string;
  acknowledgedAt: string;
  action: 'copy' | 'pin' | 'dismiss' | 'expand' | null;
}

/** Tagged union for the realtime pipeline event bus. */
export type RealtimeEvent =
  | TranscriptEvent
  | IntentDetectedEvent
  | SuggestionGeneratedEvent
  | SuggestionFeedbackEvent;

/** Envelope wrapping every event with required tenant context. */
export interface EventEnvelope<E extends RealtimeEvent = RealtimeEvent> {
  workspaceId: WorkspaceId;
  meetingId: MeetingId;
  requestId: string;
  emittedAt: string;
  event: E;
}
