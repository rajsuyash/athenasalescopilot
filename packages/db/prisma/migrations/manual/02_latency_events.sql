-- Run AFTER `prisma migrate deploy` to create the latency_events table.
-- Prisma's migrate command would also produce this from the schema; this file
-- documents the change for environments that hand-apply SQL.

CREATE TABLE IF NOT EXISTS latency_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  meeting_id   UUID,
  stage        TEXT NOT NULL,
  latency_ms   INTEGER NOT NULL,
  degraded     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_latency_events_workspace_stage_time
  ON latency_events (workspace_id, stage, created_at DESC);
