-- Coaching workflows tables (PRD F13). Apply after `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS suggestion_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  flagged_by    UUID NOT NULL,
  reason        TEXT NOT NULL,
  notes         TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_flags_workspace_resolved
  ON suggestion_flags (workspace_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_suggestion_flags_suggestion
  ON suggestion_flags (suggestion_id);

CREATE TABLE IF NOT EXISTS suggestion_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_comments_suggestion_time
  ON suggestion_comments (suggestion_id, created_at);
