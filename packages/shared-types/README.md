# shared-types

Cross-service TypeScript types. Mirror PRD §5 data model exactly.

## Conventions

- One file per entity (`workspace.ts`, `meeting.ts`, `suggestion.ts`, ...).
- Branded ID types: `WorkspaceId`, `MeetingId`, `SuggestionId` etc., to prevent ID-mixup bugs.
- Event payloads (`TranscriptFinalReceived`, `IntentDetected`, `SuggestionGenerated`) match PRD JSON shapes verbatim.
- No runtime code; types only. Schema validators live in `packages/policies` or per-service.

## Versioning

Bump major on breaking shape changes. Consumers pin via workspace protocol.
