# realtime-gateway

WebSocket ingress: audio → STT → in-process orchestrator → persisted suggestions. PRD F2, F3.

Moves Deepgram + Anthropic API keys server-side so clients don't need them.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp services/realtime-gateway/.env.example services/realtime-gateway/.env
# (set DEEPGRAM_API_KEY + ANTHROPIC_API_KEY in the .env)
pnpm --filter @athena/realtime-gateway dev    # :4040
```

## Endpoints

| Path                 | Type | Auth     | Notes                                         |
| -------------------- | ---- | -------- | --------------------------------------------- |
| GET /healthz         | HTTP | —        | reports stt + llm + deepgram availability     |
| GET /v1/sessions     | WS   | required | ws upgrade; auth via `?token=` or `Authorization: Bearer` |

## Wire format

```jsonc
// client → server (control)
{ "type": "hello", "meetingId": "<uuid>", "sampleRate": 16000, "language": "en-US",
  "vocabulary": ["MEDDIC", "Athena"], "repLabel": "Speaker 0" }
{ "type": "set_rep", "label": "Speaker 1" }
{ "type": "bye" }

// client → server (binary): raw PCM s16le frames at the announced sample rate

// server → client
{ "type": "hello.required", "sessionId": "..." }
{ "type": "ready", "sessionId": "...", "meetingId": "..." }
{ "type": "transcript.partial", "segment": { ... } }
{ "type": "transcript.final", "segment": { ... }, "speaker": "rep" | "customer" | "unknown" }
{ "type": "suggestion.generated", "suggestion": { ... } }
{ "type": "error", "code": "...", "message": "..." }
{ "type": "closed", "reason": "..." }
```

## What persists

For every final transcript: a `transcript_segments` row (workspace-scoped).
For every customer turn that produces a non-empty suggestion: a `turns` row
plus a `suggestions` row. Audit log is written via the same path the orchestrator uses.

## Latency budget (PRD §7)

| Hop | Target |
| --- | ------ |
| audio frame → STT push | ≤ 50 ms |
| STT final → transcript persisted + emitted | ≤ 300 ms |
| customer final → suggestion emitted | ≤ 2 s P95 |

WebSocket / gRPC ingress for live audio + session lifecycle events. PRD F2 (server), F3 (orchestration entry).

## Responsibilities

- Authenticate session WebSocket via JWT.
- Authorize session creation against `workspace_id`.
- Receive 100 ms PCM frames, ack per-frame within 200 ms P95.
- Forward frames to STT provider via `packages/sdk/stt`.
- Publish lifecycle + transcript events to the orchestrator.

## Latency budget

Per-frame ack ≤200 ms P95 on 50 Mbps. Backpressure required.
