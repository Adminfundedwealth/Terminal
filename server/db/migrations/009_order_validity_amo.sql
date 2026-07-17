-- Migration 009: Ensure validity and is_amo exist on both known order table names.
-- The live table is trading_orders (used by the repository).
-- terminal_orders is the migration-file schema name; both get the same columns.

ALTER TABLE trading_orders
  ADD COLUMN IF NOT EXISTS validity TEXT DEFAULT 'DAY',
  ADD COLUMN IF NOT EXISTS is_amo BOOLEAN DEFAULT FALSE;

ALTER TABLE terminal_orders
  ADD COLUMN IF NOT EXISTS validity TEXT DEFAULT 'DAY',
  ADD COLUMN IF NOT EXISTS is_amo BOOLEAN DEFAULT FALSE;
