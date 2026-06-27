-- ============================================================
-- MIGRATION 003: Schema Additions
-- Identified in PRODUCTION-GAP-REPORT.md
-- ============================================================

-- 1. Add peak_balance to accounts (for drawdown calculation from high-water mark)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS peak_balance NUMERIC(15,2);

-- 2. Add payout_eligible to accounts (funded accounts payout tracking)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS payout_eligible BOOLEAN DEFAULT FALSE;

-- 3. Add min_trading_days to challenges (some challenges require minimum activity)
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS min_trading_days INTEGER;

-- 4. Fix positions UNIQUE constraint
-- Drop existing constraint and recreate as partial unique index
ALTER TABLE positions DROP CONSTRAINT IF EXISTS unique_open_position;
CREATE UNIQUE INDEX idx_unique_open_position 
  ON positions (account_id, token, product_type) 
  WHERE closed_at IS NULL;

-- 5. Add exchange column to orders (NSE/BSE/MCX)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchange TEXT;

-- 6. Add exchange column to positions
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exchange TEXT;

-- 7. Add exchange column to trades
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange TEXT;
