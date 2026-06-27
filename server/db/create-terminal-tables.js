/**
 * CREATE TERMINAL TABLES (t_ prefix) in Supabase
 * Uses Supabase Management API or direct pg connection
 */
import pg from 'pg';
import { config } from 'dotenv';
config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const projectRef = SUPABASE_URL?.match(/https:\/\/(.+?)\.supabase/)?.[1];

const DDL = `
-- Terminal Users (references Dashboard users by clerk_id/fw_user_id)
CREATE TABLE IF NOT EXISTS t_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges
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

-- Trading Accounts
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

-- Risk Rules
CREATE TABLE IF NOT EXISTS t_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

-- Orders
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

-- Positions
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

-- Trades
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

-- Watchlists
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

-- Account Metrics
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

-- Sessions
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
`;

const SEED = `
-- Seed test user
INSERT INTO t_users (fw_user_id, email, name, status)
VALUES ('usr_test_001', 'test@fundedwealth.com', 'Test Trader', 'active')
ON CONFLICT (fw_user_id) DO NOTHING;

-- Seed challenge
INSERT INTO t_challenges (user_id, type, plan, initial_balance, status, expires_at)
SELECT id, 'evaluation', '100K', 10000000, 'active', NOW() + INTERVAL '30 days'
FROM t_users WHERE fw_user_id = 'usr_test_001'
ON CONFLICT DO NOTHING;

-- Seed account
INSERT INTO t_accounts (user_id, account_code, challenge_id, broker_provider, balance, peak_balance, status)
SELECT u.id, 'FW-10001', c.id, 'angelone', 10000000, 10000000, 'active'
FROM t_users u JOIN t_challenges c ON c.user_id = u.id
WHERE u.fw_user_id = 'usr_test_001'
ON CONFLICT (account_code) DO NOTHING;

-- Seed risk rules
INSERT INTO t_risk_rules (account_id, rule_type, value, is_active)
SELECT a.id, unnest(ARRAY['daily_loss_limit','max_drawdown','profit_target','max_positions','allowed_segments','trading_hours']),
       unnest(ARRAY[
         '{"amount":500000,"percent":5}'::jsonb,
         '{"amount":1000000,"percent":10}'::jsonb,
         '{"amount":1000000,"percent":10}'::jsonb,
         '{"count":15}'::jsonb,
         '{"segments":["NSE","NFO","MCX","CDS"]}'::jsonb,
         '{"start":"09:15","end":"15:30"}'::jsonb
       ]), true
FROM t_accounts a JOIN t_users u ON a.user_id = u.id
WHERE u.fw_user_id = 'usr_test_001'
ON CONFLICT (account_id, rule_type) DO NOTHING;

-- Seed watchlists
INSERT INTO t_watchlists (user_id, name, color, items, sort_order)
SELECT u.id, unnest(ARRAY['INDEX','STOCKS','FUTURES']),
       unnest(ARRAY['#2962ff','#26a69a','#ff9800']),
       unnest(ARRAY[
         '[{"token":"99926000","symbol":"NIFTY 50","segment":"NSE"},{"token":"99926009","symbol":"BANKNIFTY","segment":"NSE"},{"token":"99926037","symbol":"FINNIFTY","segment":"NSE"}]'::jsonb,
         '[{"token":"2885","symbol":"RELIANCE","segment":"NSE"},{"token":"1333","symbol":"HDFCBANK","segment":"NSE"},{"token":"3045","symbol":"SBIN","segment":"NSE"},{"token":"11536","symbol":"TCS","segment":"NSE"}]'::jsonb,
         '[{"token":"NF_FUT","symbol":"NIFTY FUT","segment":"NFO"},{"token":"BNF_FUT","symbol":"BANKNIFTY FUT","segment":"NFO"}]'::jsonb
       ]),
       unnest(ARRAY[0,1,2])
FROM t_users u WHERE u.fw_user_id = 'usr_test_001'
ON CONFLICT DO NOTHING;
`;

async function tryConnection(connStr, label) {
  const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    console.log(`✓ Connected via ${label}`);
    return client;
  } catch (e) {
    console.log(`✗ ${label}: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('=== Creating Terminal Tables ===\n');

  // Try multiple connection approaches
  const connStrings = [
    [`postgresql://postgres.${projectRef}:${SUPABASE_SERVICE_KEY}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`, 'Pooler (transaction)'],
    [`postgresql://postgres.${projectRef}:${SUPABASE_SERVICE_KEY}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`, 'Pooler (session)'],
    [`postgresql://postgres:${SUPABASE_SERVICE_KEY}@db.${projectRef}.supabase.co:5432/postgres`, 'Direct'],
    [`postgresql://postgres.${projectRef}:${SUPABASE_SERVICE_KEY}@db.${projectRef}.supabase.co:5432/postgres`, 'Direct v2'],
  ];

  let client = null;
  for (const [cs, label] of connStrings) {
    client = await tryConnection(cs, label);
    if (client) break;
  }

  if (!client) {
    console.error('\n✗ All connection methods failed.');
    console.log('\nPlease run this SQL manually in Supabase SQL Editor:');
    console.log('File: server/db/migrations/006_create_terminal_tables.sql');
    process.exit(1);
  }

  // Run DDL
  try {
    console.log('\nCreating tables...');
    await client.query(DDL);
    console.log('✓ All tables created\n');

    console.log('Seeding data...');
    await client.query(SEED);
    console.log('✓ Seed data inserted\n');

    // Verify
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 't_%' ORDER BY tablename");
    console.log('Terminal tables in database:');
    for (const r of rows) console.log(`  ✓ ${r.tablename}`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

main();
