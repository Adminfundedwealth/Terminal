import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function exec(sql) {
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) return { ok: false, error: error.message };
  if (data && data.success === false) return { ok: false, error: data.error };
  return { ok: true };
}

async function run(sql, label) {
  const r = await exec(sql);
  console.log(`  ${r.ok ? '✓' : '✗'} ${label}${r.ok ? '' : ' → ' + (r.error || '').substring(0, 60)}`);
  return r.ok;
}

async function main() {
  console.log('═══ FIXING SCHEMA ═══\n');
  
  // Step 1: Drop OLD tables that conflict (from original schema)
  console.log('Step 1: Drop old schema tables...');
  await run('DROP TABLE IF EXISTS trades CASCADE', 'drop old trades');
  await run('DROP TABLE IF EXISTS orders CASCADE', 'drop old orders');
  await run('DROP TABLE IF EXISTS sessions CASCADE', 'drop old sessions');
  await run('DROP TABLE IF EXISTS accounts CASCADE', 'drop old accounts');
  await run('DROP TABLE IF EXISTS challenges CASCADE', 'drop old challenges');
  await run('DROP TABLE IF EXISTS users CASCADE', 'drop old users');
  
  // Step 2: Drop and recreate the tables that failed (positions, executions, execution_audits, journal_entries)
  console.log('\nStep 2: Drop failed new tables for clean recreation...');
  await run('DROP TABLE IF EXISTS execution_audits CASCADE', 'drop execution_audits');
  await run('DROP TABLE IF EXISTS executions CASCADE', 'drop executions');
  await run('DROP TABLE IF EXISTS positions CASCADE', 'drop positions');
  await run('DROP TABLE IF EXISTS journal_entries CASCADE', 'drop journal_entries');
  
  // Step 3: Recreate positions (without invalid WHERE in CONSTRAINT)
  console.log('\nStep 3: Recreate positions...');
  await run(`
    CREATE TABLE positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
      symbol TEXT NOT NULL,
      token TEXT NOT NULL,
      segment TEXT NOT NULL,
      instrument_type TEXT,
      product_type TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
      qty INTEGER NOT NULL,
      avg_price NUMERIC(12,2) NOT NULL,
      current_price NUMERIC(12,2),
      realized_pnl NUMERIC(12,2) DEFAULT 0,
      unrealized_pnl NUMERIC(12,2) DEFAULT 0,
      buy_qty INTEGER DEFAULT 0,
      sell_qty INTEGER DEFAULT 0,
      buy_avg NUMERIC(12,2) DEFAULT 0,
      sell_avg NUMERIC(12,2) DEFAULT 0,
      margin_used NUMERIC(12,2) DEFAULT 0,
      is_open BOOLEAN DEFAULT TRUE,
      opened_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'create positions');
  
  // Partial unique index (valid PostgreSQL syntax)
  await run(`CREATE UNIQUE INDEX unique_open_position ON positions(trading_account_id, token, product_type) WHERE is_open = TRUE`, 'positions unique index');
  
  // Step 4: Recreate executions
  console.log('\nStep 4: Recreate executions...');
  await run(`
    CREATE TABLE executions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
      order_id UUID REFERENCES trading_orders(id),
      position_id UUID REFERENCES positions(id),
      broker_trade_id TEXT,
      symbol TEXT NOT NULL,
      token TEXT NOT NULL,
      segment TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      qty INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      exchange_timestamp TIMESTAMPTZ,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'create executions');
  
  // Step 5: Recreate execution_audits
  console.log('\nStep 5: Recreate execution_audits...');
  await run(`
    CREATE TABLE execution_audits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
      order_id UUID REFERENCES trading_orders(id),
      execution_id UUID REFERENCES executions(id),
      audit_type TEXT NOT NULL CHECK (audit_type IN ('pre_trade', 'post_trade', 'position_exit', 'risk_breach')),
      checks_run JSONB NOT NULL,
      all_passed BOOLEAN NOT NULL,
      rejection_reason TEXT,
      balance_before NUMERIC(15,2),
      balance_after NUMERIC(15,2),
      margin_before NUMERIC(15,2),
      margin_after NUMERIC(15,2),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'create execution_audits');
  
  // Step 6: Recreate journal_entries
  console.log('\nStep 6: Recreate journal_entries...');
  await run(`
    CREATE TABLE journal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
      trading_account_id UUID REFERENCES trading_accounts(id),
      execution_id UUID REFERENCES executions(id),
      position_id UUID REFERENCES positions(id),
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      symbol TEXT,
      side TEXT CHECK (side IN ('BUY', 'SELL')),
      entry_price NUMERIC(12,2),
      exit_price NUMERIC(12,2),
      qty INTEGER,
      pnl NUMERIC(12,2),
      setup_type TEXT,
      emotion TEXT CHECK (emotion IN ('confident', 'neutral', 'fearful', 'greedy', 'disciplined', 'impulsive', 'frustrated')),
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      trade_phase TEXT CHECK (trade_phase IN ('before', 'during', 'after')),
      notes TEXT,
      lessons TEXT,
      mistakes TEXT,
      tags TEXT[] DEFAULT '{}',
      screenshot_urls TEXT[] DEFAULT '{}',
      is_auto_generated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'create journal_entries');
  
  // Step 7: Indexes for recreated tables
  console.log('\nStep 7: Indexes for recreated tables...');
  await run('CREATE INDEX idx_positions_open ON positions(trading_account_id) WHERE is_open = TRUE', 'idx_positions_open');
  await run('CREATE INDEX idx_positions_symbol ON positions(symbol, trading_account_id) WHERE is_open = TRUE', 'idx_positions_symbol');
  await run('CREATE INDEX idx_positions_closed ON positions(trading_account_id, closed_at DESC) WHERE is_open = FALSE', 'idx_positions_closed');
  await run('CREATE INDEX idx_executions_account_time ON executions(trading_account_id, executed_at DESC)', 'idx_executions_account_time');
  await run('CREATE INDEX idx_executions_order ON executions(order_id)', 'idx_executions_order');
  await run('CREATE INDEX idx_executions_position ON executions(position_id)', 'idx_executions_position');
  await run('CREATE INDEX idx_executions_symbol ON executions(symbol, trading_account_id)', 'idx_executions_symbol');
  await run('CREATE INDEX idx_audits_account ON execution_audits(trading_account_id, created_at DESC)', 'idx_audits_account');
  await run('CREATE INDEX idx_audits_order ON execution_audits(order_id)', 'idx_audits_order');
  await run('CREATE INDEX idx_audits_type ON execution_audits(audit_type, trading_account_id)', 'idx_audits_type');
  await run('CREATE INDEX idx_audits_failed ON execution_audits(trading_account_id) WHERE all_passed = FALSE', 'idx_audits_failed');
  await run('CREATE INDEX idx_journal_trader ON journal_entries(trader_id, entry_date DESC)', 'idx_journal_trader');
  await run('CREATE INDEX idx_journal_account ON journal_entries(trading_account_id, entry_date DESC)', 'idx_journal_account');
  await run('CREATE INDEX idx_journal_symbol ON journal_entries(symbol, trader_id)', 'idx_journal_symbol');
  await run('CREATE INDEX idx_journal_emotion ON journal_entries(emotion, trader_id)', 'idx_journal_emotion');
  await run('CREATE INDEX idx_journal_rating ON journal_entries(rating, trader_id)', 'idx_journal_rating');
  await run('CREATE INDEX idx_journal_tags ON journal_entries USING GIN(tags)', 'idx_journal_tags');
  
  // Step 8: RLS
  console.log('\nStep 8: RLS for recreated tables...');
  await run('ALTER TABLE positions ENABLE ROW LEVEL SECURITY', 'RLS positions');
  await run('ALTER TABLE executions ENABLE ROW LEVEL SECURITY', 'RLS executions');
  await run('ALTER TABLE execution_audits ENABLE ROW LEVEL SECURITY', 'RLS execution_audits');
  await run('ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY', 'RLS journal_entries');
  
  await run(`CREATE POLICY positions_own_read ON positions FOR SELECT USING (trading_account_id IN (SELECT id FROM trading_accounts WHERE trader_id = auth.uid()))`, 'policy positions');
  await run(`CREATE POLICY executions_own_read ON executions FOR SELECT USING (trading_account_id IN (SELECT id FROM trading_accounts WHERE trader_id = auth.uid()))`, 'policy executions');
  await run(`CREATE POLICY audits_own_read ON execution_audits FOR SELECT USING (trading_account_id IN (SELECT id FROM trading_accounts WHERE trader_id = auth.uid()))`, 'policy audits');
  await run(`CREATE POLICY journal_own_all ON journal_entries FOR ALL USING (trader_id = auth.uid())`, 'policy journal');
  
  // Step 9: Final verification
  console.log('\n═══ FINAL VERIFICATION ═══\n');
  
  const tables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'broker_sessions', 'risk_rules',
    'trading_orders', 'positions', 'executions', 'execution_audits',
    'watchlists', 'account_metrics', 'risk_events', 'challenge_progress',
    'alerts', 'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
  ];
  
  let count = 0;
  for (const t of tables) {
    // Verify by trying to count via exec_sql
    const r = await exec(`SELECT count(*) FROM ${t}`);
    const exists = r.ok;
    if (exists) count++;
    console.log(`  ${exists ? '✓ YES' : '✗ NO '} | ${t}`);
  }
  
  // Verify old tables are gone
  console.log('\nOLD tables removed:');
  for (const t of ['users', 'sessions', 'challenges', 'accounts', 'orders', 'trades']) {
    const r = await exec(`SELECT count(*) FROM ${t}`);
    console.log(`  ${r.ok ? '⚠ STILL EXISTS' : '✓ REMOVED'} | ${t}`);
  }
  
  console.log(`\n═══ RESULT: ${count}/19 tables verified via SQL ═══`);
}

main().catch(e => { console.error(e); process.exit(1); });
