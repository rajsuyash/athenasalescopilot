-- Chrome extension pairing codes (Block R).
--
-- Lets a user authenticated on admin-web mint a short-lived, single-use code
-- that the Chrome extension exchanges for an access+refresh token pair. Closes
-- the Google-OAuth gap: Clerk-created users have no email+password to type
-- into the extension popup.
--
-- See packages/db/prisma/schema.prisma `model ExtensionPairing` and
-- services/api/src/modules/auth/service.ts startExtensionPairing /
-- claimExtensionPairing.
--
-- Idempotent: every statement uses IF NOT EXISTS so this file is safe to
-- re-run on every deploy alongside the rest of manual-sql/.

CREATE TABLE IF NOT EXISTS extension_pairings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES user_workspace_memberships(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMP NOT NULL,
  claimed_at    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- TTL sweeper-friendly index; rows past expires_at can be GC'd by a cron.
CREATE INDEX IF NOT EXISTS extension_pairings_expires_at_idx
  ON extension_pairings (expires_at);

CREATE INDEX IF NOT EXISTS extension_pairings_user_id_idx
  ON extension_pairings (user_id);
