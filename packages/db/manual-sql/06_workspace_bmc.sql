-- Workspace Business Model Canvas (Block Q).
--
-- 1:1 with workspaces. Single JSONB blob keyed by BMC section so the
-- bmc-builder skill can evolve its 10-section schema without a migration.
-- See packages/db/prisma/schema.prisma `model WorkspaceBmc`.
--
-- Idempotent: every statement uses IF NOT EXISTS so this file is safe to
-- re-run on every deploy alongside the rest of manual-sql/.

CREATE TABLE IF NOT EXISTS workspace_bmc (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  data         JSONB    NOT NULL,
  source_type  TEXT     NOT NULL CHECK (source_type IN ('pdf', 'interactive', 'manual')),
  version      INTEGER  NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- Future analytical queries on niche / pricing / etc can be added as
-- generated columns; intentionally omitted in v1 (no current consumers).
