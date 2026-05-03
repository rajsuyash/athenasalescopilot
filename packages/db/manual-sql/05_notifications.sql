-- In-app notifications. Apply after `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id      UUID NOT NULL,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  link_path    TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_time
  ON notifications (workspace_id, created_at DESC);
