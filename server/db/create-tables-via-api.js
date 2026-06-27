/**
 * Create terminal tables via Supabase Management API (SQL execution)
 * Uses the project's service role key with the /rest/v1/rpc endpoint
 * or falls back to direct SQL via the Supabase dashboard SQL endpoint
 */
import { config } from 'dotenv';
config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const projectRef = SUPABASE_URL?.match(/https:\/\/(.+?)\.supabase/)?.[1];

// Supabase exposes a SQL execution endpoint at management level
// We'll try creating an RPC function first, then use it

async function execSql(sql) {
  // Method 1: Try management API SQL endpoint
  const mgmtUrl = `https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`;
  let res = await fetch(mgmtUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ sql_query: sql }),
  });
  if (res.ok) return { ok: true, method: 'rpc/exec_sql' };

  // Method 2: Try the pg_execute function
  res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pg_execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) return { ok: true, method: 'rpc/pg_execute' };

  // Method 3: Try Supabase's SQL API (newer projects)
  res = await fetch(`https://${projectRef}.supabase.co/pg/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) return { ok: true, method: 'pg/sql' };
  const errText = await res.text();
  return { ok: false, status: res.status, error: errText.slice(0, 200) };
}

async function main() {
  console.log('=== Attempting SQL execution via Supabase API ===\n');
  
  // Test with simple query first
  const testResult = await execSql('SELECT 1 as test');
  console.log('Test query result:', testResult);

  if (!testResult.ok) {
    console.log('\nDirect SQL execution not available via API.');
    console.log('Creating tables one-by-one via Supabase client insert workaround...\n');
    
    // Alternative: use supabase-js to check if we can use the "schema" endpoint
    // Or we can create a serverless function that executes SQL
    // For now, let's write the SQL file and provide instructions
    console.log('ACTION REQUIRED: Run the following SQL in Supabase Dashboard → SQL Editor');
    console.log(`Project URL: ${SUPABASE_URL}`);
    console.log('File: server/db/migrations/006_create_terminal_tables.sql\n');
    
    // Save combined migration
    const { writeFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    
    const fullSql = `-- FUNDEDWEALTH TERMINAL — CREATE ALL TERMINAL TABLES
-- Run this in Supabase SQL Editor
-- Project: ${SUPABASE_URL}
-- Date: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS t_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'evaluation',
    plan TEXT NOT NULL DEFAULT '100K',
    initial_balance NUMERIC(15,2) NOT NULL DEFAULT 10000000,
    status TEXT DEFAULT 'active',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT
);

CREATE TABLE IF NOT EXISTS t_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID REFERENCES t_challenges(id),
    broker_provider TEXT NOT NULL DEFAULT 'angelone',
    balance NUMERIC(15,2) NOT NULL DEFAULT 10000000,
    peak_balance NUMERIC(15,2) DEFAULT 10000000,
    status TEXT DEFAULT 'active',
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

CREATE TABLE IF NOT EXISTS t_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT 'NSE',
    exchange TEXT DEFAULT 'NSE',
    side TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'MARKET',
    product_type TEXT NOT NULL DEFAULT 'MIS',
    qty INTEGER NOT NULL DEFAULT 1,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    filled_qty INTEGER DEFAULT 0,
    avg_price NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'PENDING',
    reject_reason TEXT,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT 'NSE',
    exchange TEXT DEFAULT 'NSE',
    product_type TEXT NOT NULL DEFAULT 'MIS',
    qty INTEGER NOT NULL DEFAULT 0,
    avg_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS t_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    order_id UUID REFERENCES t_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT 'NSE',
    exchange TEXT DEFAULT 'NSE',
    side TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    ending_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    max_drawdown NUMERIC(12,2) DEFAULT 0,
    daily_loss NUMERIC(12,2) DEFAULT 0,
    peak_balance NUMERIC(15,2),
    UNIQUE(account_id, date)
);

CREATE TABLE IF NOT EXISTS t_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES t_accounts(id),
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    revoked_at TIMESTAMPTZ
);

-- Seed data
INSERT INTO t_users (fw_user_id, email, name, status) VALUES ('usr_test_001', 'test@fundedwealth.com', 'Test Trader', 'active') ON CONFLICT (fw_user_id) DO NOTHING;
INSERT INTO t_challenges (user_id, type, plan, initial_balance, status, expires_at) SELECT id, 'evaluation', '100K', 10000000, 'active', NOW() + INTERVAL '30 days' FROM t_users WHERE fw_user_id = 'usr_test_001';
INSERT INTO t_accounts (user_id, account_code, challenge_id, broker_provider, balance, peak_balance, status) SELECT u.id, 'FW-10001', c.id, 'angelone', 10000000, 10000000, 'active' FROM t_users u JOIN t_challenges c ON c.user_id = u.id WHERE u.fw_user_id = 'usr_test_001' ON CONFLICT (account_code) DO NOTHING;
`;
    writeFileSync(join(__dirname, 'migrations', '006_create_terminal_tables.sql'), fullSql);
    console.log('✓ Migration file saved: server/db/migrations/006_create_terminal_tables.sql');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
