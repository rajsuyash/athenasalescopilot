import type {
  AnswerTemplateId,
  AuditLogId,
  ChunkId,
  DocumentId,
  DocumentVersionId,
  IntentEventId,
  MeetingId,
  MembershipId,
  RetentionPolicyId,
  ScriptCollectionId,
  ScriptVersionId,
  SegmentId,
  SessionId,
  SubscriptionId,
  SuggestionId,
  TeamId,
  TurnId,
  UserId,
  WorkspaceId,
} from './ids.js';

/** PRD F8 roles. Order = least → most privilege within a workspace. */
export type Role =
  | 'compliance_viewer'
  | 'analyst'
  | 'rep'
  | 'manager'
  | 'admin'
  | 'owner';

export type WorkspaceStatus = 'active' | 'suspended' | 'payment_overdue' | 'deleted';
export type MembershipStatus = 'invited' | 'active' | 'removed';
export type MeetingStatus = 'ready' | 'live' | 'completed' | 'failed' | 'degraded';
export type SessionStatus = 'starting' | 'live' | 'paused' | 'ended';
export type ConsentMode = 'rep_only' | 'all_party';
export type ExternalPlatform = 'google_meet';
export type SpeakerType = 'rep' | 'customer' | 'unknown';
export type SuggestionType = 'answer' | 'ask_next' | 'coach' | 'risk';
export type DocumentCategory =
  | 'script'
  | 'faq'
  | 'battlecard'
  | 'pricing'
  | 'implementation'
  | 'security'
  | 'case_study'
  | 'product_notes';
export type DocumentStatus = 'processing' | 'indexed' | 'published' | 'failed' | 'archived';
export type ScriptVersionStatus = 'draft' | 'published' | 'archived';
export type VisibilityScope = 'workspace' | 'team' | 'role';

export interface Workspace {
  id: WorkspaceId;
  name: string;
  slug: string;
  planTier: 'free' | 'pro' | 'enterprise';
  region: 'us' | 'eu';
  status: WorkspaceStatus;
  createdAt: string;
}

export interface User {
  id: UserId;
  email: string;
  name: string;
  globalStatus: 'active' | 'disabled';
  createdAt: string;
}

export interface UserWorkspaceMembership {
  id: MembershipId;
  workspaceId: WorkspaceId;
  userId: UserId;
  role: Role;
  teamId: TeamId | null;
  status: MembershipStatus;
  createdAt: string;
}

export interface Team {
  id: TeamId;
  workspaceId: WorkspaceId;
  name: string;
  parentTeamId: TeamId | null;
}

export interface Meeting {
  id: MeetingId;
  workspaceId: WorkspaceId;
  hostUserId: UserId;
  externalPlatform: ExternalPlatform;
  externalMeetingId: string;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: MeetingStatus;
  consentMode: ConsentMode;
  retentionPolicyId: RetentionPolicyId;
}

export interface MeetingSession {
  id: SessionId;
  meetingId: MeetingId;
  deviceId: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
}

export interface TranscriptSegment {
  id: SegmentId;
  workspaceId: WorkspaceId;
  meetingId: MeetingId;
  speakerType: SpeakerType;
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  sourceType: 'stt_audio' | 'meet_caption';
  language: string;
}

export interface Turn {
  id: TurnId;
  meetingId: MeetingId;
  speakerType: SpeakerType;
  startMs: number;
  endMs: number;
  finalizedAt: string;
}

export interface IntentEvent {
  id: IntentEventId;
  meetingId: MeetingId;
  turnId: TurnId;
  categories: string[];
  stageSignal: string;
  urgencyScore: number;
  interruptionPriority: number;
  confidence: number;
  modelVersion: string;
  detectedAt: string;
}

export interface Suggestion {
  id: SuggestionId;
  workspaceId: WorkspaceId;
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
  displayedAt: string | null;
  dismissedAt: string | null;
  acceptedSignal: 'useful' | 'not_useful' | null;
}

export interface KnowledgeDocument {
  id: DocumentId;
  workspaceId: WorkspaceId;
  name: string;
  category: DocumentCategory;
  status: DocumentStatus;
}

export interface KnowledgeDocumentVersion {
  id: DocumentVersionId;
  documentId: DocumentId;
  version: number;
  contentHash: string;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: ChunkId;
  workspaceId: WorkspaceId;
  documentVersionId: DocumentVersionId;
  chunkText: string;
  chunkOrder: number;
  tagsJson: Record<string, unknown>;
  visibilityScope: VisibilityScope;
  language: string;
  active: boolean;
}

export interface ScriptCollection {
  id: ScriptCollectionId;
  workspaceId: WorkspaceId;
  name: string;
  currentVersionId: ScriptVersionId | null;
}

export interface ScriptVersion {
  id: ScriptVersionId;
  collectionId: ScriptCollectionId;
  version: number;
  status: ScriptVersionStatus;
  publishedAt: string | null;
}

export interface AnswerTemplate {
  id: AnswerTemplateId;
  workspaceId: WorkspaceId;
  category: string;
  body: string;
  sourceChunkIds: ChunkId[];
}

export interface AuditLog {
  id: AuditLogId;
  workspaceId: WorkspaceId;
  actorUserId: UserId | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadataJson: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RetentionPolicy {
  id: RetentionPolicyId;
  workspaceId: WorkspaceId;
  transcriptDays: number;
  audioDays: number;
  summaryDays: number;
  auditDays: number;
}

export interface Subscription {
  id: SubscriptionId;
  workspaceId: WorkspaceId;
  planTier: 'free' | 'pro' | 'enterprise';
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  seats: number;
}
