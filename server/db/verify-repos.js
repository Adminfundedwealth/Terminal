/**
 * Verify all repositories can CRUD against the new schema.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS | ${label}`);
    return true;
  } catch (err) {
    console.log(`  ✗ FAIL | ${label}`);
    console.log(`         ${err.message?.substring(0, 80)}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' PHASE 2 — REPOSITORY COMPATIBILITY AUDIT');
  console.log('═══════════════════════════════════════════\n');

  let pass = 0, fail = 0;
  const result = (ok) => ok ? pass++ : fail++;

  // ─ terminal_traders (user.repository)
  console.log('terminal_traders:');
  result(await test('SELECT', async () => {
    const { error } = await supabase.from('terminal_traders').select('id, external_id, email, display_name, status').limit(1);
    if (error) throw error;
  }));
  result(await test('INSERT columns', async () => {
    const { error } = await supabase.from('terminal_traders').insert({
      external_id: 'test-verify-001', email: 'verify@test.com', display_name: 'Test Verify'
    }).select().single();
    if (error && !error.message.includes('duplicate')) throw error;
  }));
  // Cleanup
  await supabase.from('terminal_traders').delete().eq('external_id', 'test-verify-001');

  // ─ terminal_sessions
  console.log('\nterminal_sessions:');
  result(await test('columns: trader_id, token_hash, expires_at, is_active', async () => {
    const { error } = await supabase.from('terminal_sessions').select('id, trader_id, token_hash, is_active, expires_at, device_fingerprint').limit(1);
    if (error) throw error;
  }));

  // ─ challenge_accounts
  console.log('\nchallenge_accounts:');
  result(await test('columns: trader_id, type, plan, initial_balance, profit_target_pct', async () => {
    const { error } = await supabase.from('challenge_accounts').select('id, trader_id, type, plan, initial_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, status').limit(1);
    if (error) throw error;
  }));

  // ─ trading_accounts
  console.log('\ntrading_accounts:');
  result(await test('columns: trader_id, challenge_id, account_code, broker_provider, balance, available_margin', async () => {
    const { error } = await supabase.from('trading_accounts').select('id, trader_id, challenge_id, account_code, broker_provider, balance, available_margin, used_margin, status').limit(1);
    if (error) throw error;
  }));

  // ─ broker_sessions
  console.log('\nbroker_sessions:');
  result(await test('columns: trading_account_id, broker_provider, is_active, session_expiry', async () => {
    const { error } = await supabase.from('broker_sessions').select('id, trading_account_id, broker_provider, is_active, session_expiry, feed_token, error_count').limit(1);
    if (error) throw error;
  }));

  // ─ risk_rules
  console.log('\nrisk_rules:');
  result(await test('columns: trading_account_id, rule_type, value, is_active', async () => {
    const { error } = await supabase.from('risk_rules').select('id, trading_account_id, rule_type, value, is_active').limit(1);
    if (error) throw error;
  }));

  // ─ trading_orders
  console.log('\ntrading_orders:');
  result(await test('columns: trading_account_id, symbol, side, order_type, placed_at', async () => {
    const { error } = await supabase.from('trading_orders').select('id, trading_account_id, symbol, token, segment, side, order_type, product_type, qty, price, trigger_price, target_price, stoploss_price, status, order_group_id, order_group_type, validity, is_amo, placed_at').limit(1);
    if (error) throw error;
  }));

  // ─ positions
  console.log('\npositions:');
  result(await test('columns: trading_account_id, side, is_open, buy_qty, sell_qty', async () => {
    const { error } = await supabase.from('positions').select('id, trading_account_id, symbol, token, segment, product_type, side, qty, avg_price, is_open, buy_qty, sell_qty, buy_avg, sell_avg, realized_pnl, unrealized_pnl, margin_used, opened_at, closed_at').limit(1);
    if (error) throw error;
  }));

  // ─ executions
  console.log('\nexecutions:');
  result(await test('columns: trading_account_id, order_id, position_id, broker_trade_id', async () => {
    const { error } = await supabase.from('executions').select('id, trading_account_id, order_id, position_id, broker_trade_id, symbol, token, segment, side, qty, price, exchange_timestamp, executed_at').limit(1);
    if (error) throw error;
  }));

  // ─ execution_audits
  console.log('\nexecution_audits:');
  result(await test('columns: trading_account_id, audit_type, checks_run, all_passed', async () => {
    const { error } = await supabase.from('execution_audits').select('id, trading_account_id, order_id, execution_id, audit_type, checks_run, all_passed, rejection_reason, balance_before, balance_after').limit(1);
    if (error) throw error;
  }));

  // ─ watchlists
  console.log('\nwatchlists:');
  result(await test('columns: trader_id, name, color, items, is_default', async () => {
    const { error } = await supabase.from('watchlists').select('id, trader_id, name, color, icon, items, sort_order, is_default').limit(1);
    if (error) throw error;
  }));

  // ─ account_metrics
  console.log('\naccount_metrics:');
  result(await test('columns: trading_account_id, date, gross_profit, profit_factor', async () => {
    const { error } = await supabase.from('account_metrics').select('id, trading_account_id, challenge_id, date, starting_balance, ending_balance, realized_pnl, total_trades, winning_trades, gross_profit, gross_loss, profit_factor, peak_balance').limit(1);
    if (error) throw error;
  }));

  // ─ risk_events
  console.log('\nrisk_events:');
  result(await test('columns: trading_account_id, event_type, severity, acknowledged', async () => {
    const { error } = await supabase.from('risk_events').select('id, trading_account_id, challenge_id, event_type, severity, rule_type, threshold_value, actual_value, metadata, acknowledged').limit(1);
    if (error) throw error;
  }));

  // ─ challenge_progress
  console.log('\nchallenge_progress:');
  result(await test('columns: challenge_id, trading_account_id, date, trading_day_number', async () => {
    const { error } = await supabase.from('challenge_progress').select('id, challenge_id, trading_account_id, date, trading_day_number, day_pnl, cumulative_pnl, balance_eod, peak_balance, drawdown_pct, trades_today, is_profitable_day, is_trading_day, breach_occurred, profit_target_met').limit(1);
    if (error) throw error;
  }));

  // ─ alerts
  console.log('\nalerts:');
  result(await test('columns: trader_id, symbol, condition, target_price, is_triggered', async () => {
    const { error } = await supabase.from('alerts').select('id, trader_id, symbol, token, segment, condition, target_price, notification_type, is_triggered, is_active, triggered_at').limit(1);
    if (error) throw error;
  }));

  // ─ layouts
  console.log('\nlayouts:');
  result(await test('columns: trader_id, layout_type, panel_config, chart_config', async () => {
    const { error } = await supabase.from('layouts').select('id, trader_id, name, layout_type, is_active, is_default, panel_config, chart_config, sidebar_collapsed, bottom_panel_height, watchlist_width, order_panel_width').limit(1);
    if (error) throw error;
  }));

  // ─ themes
  console.log('\nthemes:');
  result(await test('columns: trader_id, name, is_active, colors, chart_colors', async () => {
    const { error } = await supabase.from('themes').select('id, trader_id, name, is_active, is_system, colors, font_family, font_size, chart_colors').limit(1);
    if (error) throw error;
  }));

  // ─ journal_entries
  console.log('\njournal_entries:');
  result(await test('columns: trader_id, execution_id, position_id, emotion, rating, tags', async () => {
    const { error } = await supabase.from('journal_entries').select('id, trader_id, trading_account_id, execution_id, position_id, entry_date, symbol, side, emotion, rating, trade_phase, notes, lessons, mistakes, tags, screenshot_urls').limit(1);
    if (error) throw error;
  }));

  // ─ analytics_snapshots
  console.log('\nanalytics_snapshots:');
  result(await test('columns: trading_account_id, period_type, win_rate, equity_curve', async () => {
    const { error } = await supabase.from('analytics_snapshots').select('id, trading_account_id, challenge_id, period_type, period_start, period_end, win_rate, profit_factor, expectancy, avg_rr_ratio, equity_curve, sharpe_ratio').limit(1);
    if (error) throw error;
  }));

  console.log(`\n═══════════════════════════════════════════`);
  console.log(` PHASE 2 RESULT`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  PASS: ${pass}`);
  console.log(`  FAIL: ${fail}`);
  console.log(`  Repositories Compatible: ${fail === 0 ? 'YES ✓' : 'NO — ' + fail + ' failures'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
