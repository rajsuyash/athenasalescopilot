/**
 * Branded ID types — prevent ID-mixup bugs at the type level.
 * Always cast through the `as` helper, never via `as unknown as`.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type MeetingId = Brand<string, 'MeetingId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type SegmentId = Brand<string, 'SegmentId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type SuggestionId = Brand<string, 'SuggestionId'>;
export type IntentEventId = Brand<string, 'IntentEventId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type DocumentVersionId = Brand<string, 'DocumentVersionId'>;
export type ChunkId = Brand<string, 'ChunkId'>;
export type ScriptCollectionId = Brand<string, 'ScriptCollectionId'>;
export type ScriptVersionId = Brand<string, 'ScriptVersionId'>;
export type AnswerTemplateId = Brand<string, 'AnswerTemplateId'>;
export type AuditLogId = Brand<string, 'AuditLogId'>;
export type RetentionPolicyId = Brand<string, 'RetentionPolicyId'>;
export type FeatureFlagId = Brand<string, 'FeatureFlagId'>;
export type SubscriptionId = Brand<string, 'SubscriptionId'>;

/** Tag a raw string as a branded ID. Use sparingly at trust boundaries. */
export const asId = <B extends Brand<string, string>>(s: string): B => s as B;
