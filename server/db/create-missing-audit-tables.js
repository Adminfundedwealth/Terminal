/**
 * CREATE MISSING AUDIT TABLES
 * Creates challenge_metrics and order_audit tables
 */

import { supabase } from './client.js';

const SQL = `
-- Challenge Metrics (audit trail)
CREATE TABLE IF NOT EXISTS challenge_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenge_accounts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'challenge_started', 'challenge_updated', 'challenge_passed',
    'challenge_failed', 'challenge_expired', 'daily_target_hit',
    'profit_target_reached', 'drawdown_warning', 'drawdown_breach',
    'balance_snapshot', 'trading_day_complete', 'milestone_reached'
  )),
  balance_before NUMERIC(15,2),
  balance_after NUMERIC(15,2),
  pnl NUMERIC(12,2),
  pnl_percent NUMERIC(8,4),
  drawdown NUMERIC(12,2),
  drawdown_percent NUMERIC(8,4),
  peak_balance NUMERIC(15,2),
  trading_days_elapsed INTEGER,
  total_trades INTEGER,
  win_rate NUMERIC(5,2),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_metrics_challenge ON challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_metrics_account ON challenge_metrics(account_id, created_at DESC);

-- Order Audit (immutable state transitions)
CREATE TABLE IF NOT EXISTS order_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES trading_orders(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'order_created', 'order_submitted', 'order_accepted', 'order_open',
    'order_partially_filled', 'order_filled', 'order_modified',
    'order_cancelled', 'order_rejected', 'order_expired',
    'position_opened', 'position_updated', 'position_closed', 'position_reversed'
  )),
  previous_status TEXT,
  new_status TEXT,
  symbol TEXT NOT NULL,
  token TEXT NOT NULL,
  segment TEXT NOT NULL,
  side TEXT CHECK (side IN ('BUY', 'SELL')),
  qty INTEGER,
  price NUMERIC(12,2),
  filled_qty INTEGER,
  avg_price NUMERIC(12,2),
  broker_order_id TEXT,
  broker_provider TEXT,
  reject_reason TEXT,
  latency_ms INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_audit_order ON order_audit(order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_order_audit_account ON order_audit(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_audit_today ON order_audit(account_id, created_at DESC) WHERE created_at >= CURRENT_DATE;
`;

async function createTables() {
  console.log('Creating missing audit tables...\n');
  
  if (!supabase) {
    console.error('❌ Supabase not configured');
    process.exit(1);
  }

  try {
    const { error } = await supabase.rpc('exec_sql', { sql: SQL });
    
    if (error) {
      console.error('❌ Failed:', error.message);
      console.log('\nManual creation required via Supabase SQL Editor');
      process.exit(1);
    }

    console.log('✅ Audit tables created successfully\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.log('\n⚠️  RPC function not available. Use manual SQL execution:');
    console.log('\nCopy and execute in Supabase SQL Editor:');
    console.log('─'.repeat(50));
    console.log(SQL);
    console.log('─'.repeat(50));
    process.exit(1);
  }
}

createTables();
