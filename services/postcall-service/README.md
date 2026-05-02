# postcall-service

Stage D — post-call summary, follow-up email, CRM-field suggestions, adherence score. PRD F9.

## Quickstart

```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp services/postcall-service/.env.example services/postcall-service/.env
pnpm --filter @athena/postcall-service dev    # :4030
```

## Routes

| Method | Path                                           | Auth     | Notes                                |
| ------ | ---------------------------------------------- | -------- | ------------------------------------ |
| GET    | /healthz                                       | —        | shows whether an LLM is configured   |
| POST   | /v1/postcall/meetings/:meetingId/recap         | required | run Stage D, persist `MeetingSummary` |
| GET    | /v1/postcall/meetings/:meetingId/recap         | required | fetch the most recent recap         |

## Behavior

- LLM-driven by default (Claude). Without `ANTHROPIC_API_KEY`, falls back to a
  mechanical recap that lists customer questions + a templated follow-up email.
- Caches the result in `meeting_summaries`. Re-running with `--force` overwrites.
- `low_signal: true` for transcripts under ~300 chars / 5 turns.
- Adherence framework defaults to `MEDDIC`; override via `DEFAULT_FRAMEWORK`
  env or per-call body.

Stage-D summary, follow-up draft, CRM suggestions, adherence score. PRD F9.

## Inputs

All `transcript_segments`, `suggestions`, `intent_events` for a meeting.

## Outputs

- 3–5 paragraph summary
- Key questions asked
- Objections (with category + resolution)
- Unanswered questions
- Next-step commitments (owner + due date)
- Follow-up email draft (subject + body)
- CRM field suggestions (`stage`, `next_step`, `objections[]`, `use_case`, `close_date_confidence`)
- Adherence score against MEDDIC / BANT / SPICED

## Latency budget

Outputs available in rep's "My meetings" view ≤90 s P95.

## Edge cases

- Transcript <60 s → run thin-summary template, mark `low_signal: true`.
- Abrupt end (no end-event) → backend auto-finalizes after 5 min inactivity.
- Workspace with `transcript_retention=0` → outputs persist, transcript deleted.
