-- ============================================================
-- MIGRATION 007: Provisioning Poller Support
-- Adds columns to provisioning_logs for async polling pattern.
-- Main Site/Admin writes pending rows → Terminal poller processes them.
-- ============================================================

-- Add columns needed by the poller to reconstruct provisioning params
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS fw_user_id TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS challenge_type TEXT;
ALTER TABLE provisioning_logs ADD COLUMN IF NOT EXISTS rule_profile JSONB;

-- Add 'processing' status to prevent double-pickup
ALTER TABLE provisioning_logs DROP CONSTRAINT IF EXISTS provisioning_logs_status_check;
ALTER TABLE provisioning_logs ADD CONSTRAINT provisioning_logs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- Index for efficient polling: pending rows ordered by creation time
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_pending
  ON provisioning_logs(created_at ASC)
  WHERE status = 'pending';

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_status
  ON provisioning_logs(status);
