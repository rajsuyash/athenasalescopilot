-- F18 — objection episodes: the lifecycle of a single objection across turns,
-- so the live coach runs the Socratic reframe loop statefully (next step, not a
-- disconnected one-liner).
--
-- See packages/db/prisma/schema.prisma `model ObjectionEpisode`,
-- services/realtime-gateway/src/lib/coach.ts (reconcileEpisode /
-- applyEpisodeDecision), and the recap GET in
-- services/postcall-service/src/modules/recap/routes.ts (AC5).
--
-- Column types mirror Prisma's mapping for plain `DateTime` (timestamp(3)).
-- Idempotent: every statement uses IF NOT EXISTS so this file is safe to
-- re-run on every deploy alongside the rest of manual-sql/.

CREATE TABLE IF NOT EXISTS objection_episodes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meeting_id     UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  opened_turn_id UUID NOT NULL,
  archetype      TEXT NOT NULL,
  current_step   TEXT NOT NULL DEFAULT 'disarm',
  reframe_used   TEXT,
  deflections    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open',
  opened_at      TIMESTAMP(3) NOT NULL DEFAULT now(),
  closed_at      TIMESTAMP(3),
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS objection_episodes_workspace_meeting_status_idx
  ON objection_episodes (workspace_id, meeting_id, status);
