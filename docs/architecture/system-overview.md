# System overview

Skeleton — fill in as services land. Source: `docs/PRD.md`.

## Hot-path data flow

```
Mac mic + system audio
      │ (PCM 16kHz mono, 100ms frames)
      ▼
desktop-macos ──── WebSocket ──▶ realtime-gateway
                                       │
                                       ▼
                                  STT provider (via packages/sdk/stt)
                                       │
                                       ▼  transcript.final.received
                                 transcript-service ─▶ Postgres (transcript_segments)
                                       │
                                       ▼
                                 orchestrator-service
                                  ├─ Stage A: intent classifier ─▶ intent.detected
                                  ├─ Hybrid retrieval (pgvector + keyword)
                                  └─ Stage C: grounded answer ─▶ suggestion.generated
                                       │
                                       ▼  WebSocket push
                                  desktop-macos overlay (≤200ms render)
```

## End-of-call flow

```
desktop-macos ── meeting.ended ──▶ realtime-gateway ──▶ postcall-service
                                                              │
                                                              ▼
                                                   Stage D: summary + email + CRM
                                                              │
                                                              ▼
                                                   admin-web "My meetings" view
                                                              │
                                                              ▼
                                              integration-service ─▶ Salesforce / HubSpot
```

## Cross-cutting

- Auth: JWT (15m access + 30d refresh) issued by `services/api`. Every WebSocket and HTTP call carries `workspace_id` claim.
- Multi-tenant: every domain table has `workspace_id`; cache keys prefixed `ws:<id>:`; S3 paths prefixed by workspace; pgvector queries filter on workspace.
- Observability: OpenTelemetry traces span the full pipeline; every log line carries `workspace_id`, `meeting_id`, `request_id`.

## Open questions

See PRD §10.
