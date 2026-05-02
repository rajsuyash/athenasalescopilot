# transcript-service

Persists STT output. PRD F3.

## Responsibilities

- Subscribe to `transcript.partial.*` and `transcript.final.received` events.
- Persist final segments to `transcript_segments` (workspace_id, meeting_id scoped).
- Apply per-workspace custom vocabulary (boost terms in STT request).
- Drop low-confidence segments below `workspace.min_stt_confidence`.

## Latency budget

Final segment persisted ≤300 ms after STT finalization.
