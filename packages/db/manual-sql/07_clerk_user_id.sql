-- Block T phase 2 — migrate auth to Clerk.
--
-- Add clerk_user_id column to users so every Athena user can be paired
-- with their Clerk identity. Nullable during the migration window; once
-- the one-shot import script has run for every existing user, a follow-up
-- migration will set NOT NULL and drop password_hash.
--
-- Idempotent: safe to re-run on every deploy.

ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users (clerk_user_id);
