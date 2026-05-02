-- Billing tables (PRD F16). Apply after `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS billing_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL UNIQUE,
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  plan_tier               TEXT NOT NULL DEFAULT 'free',
  status                  TEXT NOT NULL DEFAULT 'active',
  seats                   INTEGER NOT NULL DEFAULT 1,
  meeting_hour_limit      INTEGER NOT NULL DEFAULT 50,
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL,
  billing_account_id  UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  value               INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, period_start)
);
