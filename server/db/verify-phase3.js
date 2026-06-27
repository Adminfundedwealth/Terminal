/**
 * Phase 3 Verification Script
 * Creates challenge_progress table if missing, seeds paper-mode records, verifies all tables.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });

import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DEV_ACCOUNT_ID = '40995deb-4f1e-4bc6-9603-f28563bfefcf';
const DEV_CHALLENGE_ID = 'd45b1c81-3530-4cb8-8398-2b67f709cc30';
const DEV_TRADER_ID = '60d8c5ee-ec1c-4608-8a6f-0189775f09a0';

async function run() {
  console.log('=== PHASE 3 VERIFICATION ===\n');

  // 1. Check if challenge_progress table exists
  const { data: cpCheck, error: cpErr } = await sb.from('challenge_progress').select('id').limit(1);
  if (cpErr && cpErr.message.includes('schema cache')) {
    console.log('[challenge_progress] TABLE MISSING — needs to be created via Supabase SQL Editor');
    console.log('  DDL is in server/db/migrations/001_terminal_schema.sql (section 14)');
    console.log('  BLOCKER: Cannot create tables via Supabase JS client. Must run DDL in Supabase Dashboard > SQL Editor.\n');
  } else {
    console.log('[challenge_progress] TABLE EXISTS');
  }

  // 2. Insert paper-mode records for dev account to prove write path

  // 2a. trading_orders — paper order
  console.log('\n--- Inserting paper-mode records for dev account ---');
  const { data: order, error: orderErr } = await sb.from('trading_orders').upsert({
    trading_account_id: DEV_ACCOUNT_ID,
    symbol: 'NIFTY 50',
    token: '99926000',
    segment: 'NSE',
    side: 'BUY',
    order_type: 'MARKET',
    product_type: 'MIS',
    qty: 50,
    price: null,
    trigger_price: null,
    filled_qty: 50,
    avg_fill_price: 24021.65,
    status: 'FILLED',
    validity: 'DAY',
    broker_order_id: 'PAPER-' + Date.now(),
    nonce: 'paper-nonce-' + Date.now(),
    placed_at: new Date().toISOString(),
    filled_at: new Date().toISOString(),
  }, { onConflict: 'nonce' }).select().single();

  if (orderErr) console.log('[trading_orders] INSERT ERROR:', orderErr.message);
  else console.log('[trading_orders] ✓ INSERTED order:', order.id);

  // 2b. executions — paper execution
  const { data: exec, error: execErr } = await sb.from('executions').insert({
    trading_account_id: DEV_ACCOUNT_ID,
    order_id: order?.id || null,
    symbol: 'NIFTY 50',
    token: '99926000',
    segment: 'NSE',
    side: 'BUY',
    qty: 50,
    price: 24021.65,
    trade_value: 24021.65 * 50,
    broker_trade_id: 'PAPER-EXEC-' + Date.now(),
    executed_at: new Date().toISOString(),
  }).select().single();

  if (execErr) console.log('[executions] INSERT ERROR:', execErr.message);
  else console.log('[executions] ✓ INSERTED execution:', exec.id);

  // 2c. positions — paper position
  const { data: pos, error: posErr } = await sb.from('positions').upsert({
    trading_account_id: DEV_ACCOUNT_ID,
    symbol: 'NIFTY 50',
    token: '99926000',
    segment: 'NSE',
    side: 'BUY',
    qty: 50,
    avg_price: 24021.65,
    ltp: 24021.65,
    pnl: 0,
    product_type: 'MIS',
    is_open: true,
  }, { onConflict: 'trading_account_id,token,product_type' }).select().single();

  if (posErr) console.log('[positions] INSERT ERROR:', posErr.message);
  else console.log('[positions] ✓ INSERTED position:', pos.id);

  // 2d. risk_events — paper risk check event
  const { data: riskEvt, error: riskErr } = await sb.from('risk_events').insert({
    trading_account_id: DEV_ACCOUNT_ID,
    event_type: 'pre_trade_check',
    rule_type: 'daily_loss_limit',
    rule_value: JSON.stringify({ amount: 50000, percent: 5 }),
    actual_value: '0',
    result: 'passed',
    description: 'Paper mode pre-trade validation — daily loss within limit',
    order_id: order?.id || null,
  }).select().single();

  if (riskErr) console.log('[risk_events] INSERT ERROR:', riskErr.message);
  else console.log('[risk_events] ✓ INSERTED risk_event:', riskEvt.id);

  // 2e. account_metrics — paper day metric
  const today = new Date().toISOString().split('T')[0];
  const { data: metric, error: metricErr } = await sb.from('account_metrics').upsert({
    trading_account_id: DEV_ACCOUNT_ID,
    date: today,
    starting_balance: 1000000,
    ending_balance: 1000000,
    realized_pnl: 0,
    unrealized_pnl: 0,
    total_trades: 1,
    winning_trades: 0,
    losing_trades: 0,
    gross_profit: 0,
    gross_loss: 0,
    max_drawdown: 0,
    daily_loss: 0,
    peak_balance: 1000000,
  }, { onConflict: 'trading_account_id,date' }).select().single();

  if (metricErr) console.log('[account_metrics] INSERT ERROR:', metricErr.message);
  else console.log('[account_metrics] ✓ INSERTED metric:', metric.id);

  // 2f. challenge_progress — attempt insert
  if (!cpErr || !cpErr.message.includes('schema cache')) {
    const { data: cp, error: cpInsertErr } = await sb.from('challenge_progress').upsert({
      challenge_id: DEV_CHALLENGE_ID,
      trading_account_id: DEV_ACCOUNT_ID,
      date: today,
      trading_day_number: 1,
      day_pnl: 0,
      cumulative_pnl: 0,
      balance_eod: 1000000,
      peak_balance: 1000000,
      drawdown_pct: 0,
      daily_loss_pct: 0,
      trades_today: 1,
      is_profitable_day: false,
      is_trading_day: true,
      breach_occurred: false,
      profit_target_met: false,
      min_days_met: false,
    }, { onConflict: 'challenge_id,date' }).select().single();

    if (cpInsertErr) console.log('[challenge_progress] INSERT ERROR:', cpInsertErr.message);
    else console.log('[challenge_progress] ✓ INSERTED progress:', cp.id);
  }

  // 3. Read back all records for dev account
  console.log('\n=== VERIFICATION READ (dev account only) ===\n');

  const tables = [
    { name: 'trading_orders', filter: 'trading_account_id' },
    { name: 'executions', filter: 'trading_account_id' },
    { name: 'positions', filter: 'trading_account_id' },
    { name: 'risk_events', filter: 'trading_account_id' },
    { name: 'account_metrics', filter: 'trading_account_id' },
    { name: 'challenge_progress', filter: 'trading_account_id' },
  ];

  for (const t of tables) {
    const { data, error } = await sb.from(t.name).select('*').eq(t.filter, DEV_ACCOUNT_ID).limit(3);
    if (error) {
      console.log(`[${t.name}] ERROR: ${error.message}`);
    } else if (!data || data.length === 0) {
      console.log(`[${t.name}] EMPTY (0 rows for dev account)`);
    } else {
      console.log(`[${t.name}] ✓ ${data.length} row(s) | Latest: ${JSON.stringify(data[0]).substring(0, 200)}`);
    }
  }

  console.log('\n=== DONE ===');
}

run().catch(e => console.error('FATAL:', e.message));
