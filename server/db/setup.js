/**
 * DATABASE SETUP SCRIPT
 * 
 * Verifies terminal tables exist in Supabase, inserts seed data if empty.
 * 
 * PREREQUISITE: Run 004_terminal_tables.sql in Supabase SQL Editor first.
 * 
 * Usage:
 *   node server/db/setup.js
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const REQUIRED_TABLES = [
  'users',
  'challenge_accounts',
  'trading_accounts',
  'challenge_rules',
  'trading_orders',
  'positions',
  'executions',
  'risk_events',
  'sessions',
  'audit_logs',
  'execution_audits',
  'challenge_progress',
];

async function main() {
  console.log('=== FundedWealth Terminal — Database Setup ===\n');
  console.log(`Supabase URL: ${SUPABASE_URL}\n`);

  // Step 1: Verify tables exist
  console.log('1. Verifying terminal tables...');
  let allTablesExist = true;
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('id').limit(0);
    if (error) {
      console.error(`   ❌ ${table} — ${error.message}`);
      allTablesExist = false;
    } else {
      console.log(`   ✅ ${table}`);
    }
  }

  if (!allTablesExist) {
    console.error('\n❌ Some terminal tables are missing.');
    console.error('   Run server/db/schema.sql in Supabase SQL Editor.');
    console.error('   Run server/db/migrations/001-004 in order.');
    process.exit(1);
  }
  console.log(`   All ${REQUIRED_TABLES.length} tables verified.\n`);

  // Step 2: Check if seed data exists
  console.log('2. Checking for existing data...');
  const { data: existingUsers } = await supabase.from('t_users').select('id').limit(1);
  if (existingUsers && existingUsers.length > 0) {
    console.log('   ⚠️  Data already exists. Skipping seed.\n');
  } else {
    console.log('   No data found. Inserting seed...\n');
    await insertSeedData();
  }

  // Step 3: Verify seed
  console.log('3. Verifying seed data...');
  const { data: user } = await supabase.from('t_users').select('*').eq('fw_user_id', 'usr_test_001').single();
  if (user) {
    console.log(`   ✅ User: ${user.name} (${user.email})`);
  }

  const { data: account } = await supabase.from('t_accounts').select('*').eq('account_code', 'FW-10001').single();
  if (account) {
    console.log(`   ✅ Account: ${account.account_code} (balance: ₹${Number(account.balance).toLocaleString()})`);
  }

  const { data: rules } = await supabase.from('t_risk_rules').select('rule_type').eq('account_id', account?.id);
  if (rules) {
    console.log(`   ✅ Risk rules: ${rules.length} rules configured`);
  }

  console.log('\n=== Setup Complete ===');
  console.log('Terminal is ready. Start the server with: node server/index.js');
}

async function insertSeedData() {
  // User
  const { data: user, error: userErr } = await supabase.from('t_users').insert({
    fw_user_id: 'usr_test_001',
    email: 'test@fundedwealth.com',
    name: 'Test Trader',
  }).select().single();

  if (userErr) {
    console.error(`   ❌ User insert failed: ${userErr.message}`);
    return;
  }
  console.log(`   ✅ User created: ${user.id}`);

  // Challenge
  const { data: challenge, error: chalErr } = await supabase.from('t_challenges').insert({
    user_id: user.id,
    type: 'evaluation',
    plan: '100K',
    initial_balance: 10000000,
    status: 'active',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }).select().single();

  if (chalErr) {
    console.error(`   ❌ Challenge insert failed: ${chalErr.message}`);
    return;
  }
  console.log(`   ✅ Challenge created: ${challenge.id}`);

  // Account
  const { data: account, error: accErr } = await supabase.from('t_accounts').insert({
    user_id: user.id,
    account_code: 'FW-10001',
    challenge_id: challenge.id,
    broker_provider: 'angelone',
    balance: 10000000,
    peak_balance: 10000000,
    status: 'active',
  }).select().single();

  if (accErr) {
    console.error(`   ❌ Account insert failed: ${accErr.message}`);
    return;
  }
  console.log(`   ✅ Account created: ${account.id}`);

  // Risk Rules
  const rules = [
    { account_id: account.id, rule_type: 'daily_loss_limit', value: { amount: 500000, percent: 5 } },
    { account_id: account.id, rule_type: 'max_drawdown', value: { amount: 1000000, percent: 10 } },
    { account_id: account.id, rule_type: 'profit_target', value: { amount: 1000000, percent: 10 } },
    { account_id: account.id, rule_type: 'max_positions', value: { count: 15 } },
    { account_id: account.id, rule_type: 'max_lot_size', value: { nifty: 6, banknifty: 3, stocks: 4, default: 2 } },
    { account_id: account.id, rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'MCX', 'CDS'] } },
    { account_id: account.id, rule_type: 'trading_hours', value: { start: '09:15', end: '15:30' } },
    { account_id: account.id, rule_type: 'no_overnight', value: { enabled: true, auto_square_off: '15:15' } },
    { account_id: account.id, rule_type: 'max_daily_trades', value: { count: 50 } },
  ];

  const { error: rulesErr } = await supabase.from('t_risk_rules').insert(rules);
  if (rulesErr) {
    console.error(`   ❌ Rules insert failed: ${rulesErr.message}`);
    return;
  }
  console.log(`   ✅ Risk rules created: ${rules.length} rules`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});

