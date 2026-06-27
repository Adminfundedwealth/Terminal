/**
 * TERMINAL BACKEND — Workflow Verification
 * Tests all core persistence workflows against the real Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const results = [];
let testTraderId = null;
let testAccountId = null;
let testChallengeId = null;
let testOrderId = null;

function log(workflow, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${workflow}${detail ? ` — ${detail}` : ''}`);
  results.push({ workflow, status, detail });
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' TERMINAL BACKEND — Workflow Verification');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // ─── 1. Create Terminal Trader ──────────────────────────────
  try {
    const { data, error } = await supabase.from('terminal_traders').insert({
      external_id: `test_${crypto.randomBytes(4).toString('hex')}`,
      email: `test-${Date.now()}@terminal.test`,
      display_name: 'Workflow Test User',
      status: 'active',
      preferences: {},
    }).select().single();
    if (error) throw new Error(error.message);
    testTraderId = data.id;
    log('Create terminal trader', 'PASS', `id=${testTraderId}`);
  } catch (e) { log('Create terminal trader', 'FAIL', e.message); }

  // ─── 2. Create Terminal Session ──────────────────────────────
  try {
    const { data, error } = await supabase.from('terminal_sessions').insert({
      trader_id: testTraderId,
      token_hash: crypto.createHash('sha256').update('test-token').digest('hex'),
      is_active: true,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    log('Create terminal session', 'PASS', `id=${data.id}`);
  } catch (e) { log('Create terminal session', 'FAIL', e.message); }

  // ─── 3. Create Challenge Account ────────────────────────────
  try {
    const { data, error } = await supabase.from('challenge_accounts').insert({
      trader_id: testTraderId,
      type: 'evaluation_phase1',
      plan: '10K',
      initial_balance: 1000000,
      current_balance: 1000000,
      peak_balance: 1000000,
      profit_target_pct: 8,
      daily_loss_limit_pct: 5,
      max_drawdown_pct: 10,
      min_trading_days: 5,
      max_calendar_days: 30,
      status: 'active',
      started_at: new Date().toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    testChallengeId = data.id;
    log('Create challenge account', 'PASS', `id=${testChallengeId}`);
  } catch (e) { log('Create challenge account', 'FAIL', e.message); }

  // ─── 4. Create Trading Account ──────────────────────────────
  try {
    const { data, error } = await supabase.from('trading_accounts').insert({
      trader_id: testTraderId,
      challenge_id: testChallengeId,
      account_code: `FW-TEST-${Date.now().toString(36).toUpperCase()}`,
      broker_provider: 'paper',
      balance: 1000000,
      status: 'active',
    }).select().single();
    if (error) throw new Error(error.message);
    testAccountId = data.id;
    log('Create trading account', 'PASS', `id=${testAccountId}`);
  } catch (e) { log('Create trading account', 'FAIL', e.message); }

  // ─── 5. Seed Risk Rules ─────────────────────────────────────
  try {
    const rules = [
      { trading_account_id: testAccountId, rule_type: 'daily_loss_limit', value: { percent: 5 }, is_active: true },
      { trading_account_id: testAccountId, rule_type: 'max_drawdown', value: { percent: 10 }, is_active: true },
      { trading_account_id: testAccountId, rule_type: 'max_positions', value: { count: 10 }, is_active: true },
    ];
    const { error } = await supabase.from('risk_rules').insert(rules);
    if (error) throw new Error(error.message);
    log('Seed risk rules', 'PASS', '3 rules inserted');
  } catch (e) { log('Seed risk rules', 'FAIL', e.message); }

  // ─── 6. Create Provisioning Log ─────────────────────────────
  try {
    const { data, error } = await supabase.from('provisioning_logs').insert({
      trader_id: testTraderId,
      trading_account_id: testAccountId,
      challenge_account_id: testChallengeId,
      order_id: `ORD-TEST-${Date.now()}`,
      plan: '10K',
      payment_method: 'test',
      source: 'admin',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    log('Create provisioning log', 'PASS', `id=${data.id}`);
  } catch (e) { log('Create provisioning log', 'FAIL', e.message); }

  // ─── 7. Place Order ─────────────────────────────────────────
  try {
    const { data, error } = await supabase.from('trading_orders').insert({
      trading_account_id: testAccountId,
      symbol: 'NIFTY',
      token: '99926000',
      segment: 'NFO',
      side: 'BUY',
      order_type: 'MARKET',
      product_type: 'MIS',
      qty: 50,
      status: 'PENDING',
    }).select().single();
    if (error) throw new Error(error.message);
    testOrderId = data.id;
    log('Place order (DB persist)', 'PASS', `id=${testOrderId}`);
  } catch (e) { log('Place order (DB persist)', 'FAIL', e.message); }

  // ─── 8. Save Position ───────────────────────────────────────
  try {
    const { data, error } = await supabase.from('positions').insert({
      trading_account_id: testAccountId,
      symbol: 'NIFTY',
      token: '99926000',
      segment: 'NFO',
      product_type: 'MIS',
      side: 'LONG',
      qty: 50,
      avg_price: 24500.00,
      is_open: true,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save position', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save position', 'FAIL', e.message); }

  // ─── 9. Save Execution ──────────────────────────────────────
  try {
    const { data, error } = await supabase.from('executions').insert({
      trading_account_id: testAccountId,
      order_id: testOrderId,
      symbol: 'NIFTY',
      token: '99926000',
      segment: 'NFO',
      side: 'BUY',
      qty: 50,
      price: 24500.00,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save execution', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save execution', 'FAIL', e.message); }

  // ─── 10. Save Watchlist ─────────────────────────────────────
  try {
    const { data, error } = await supabase.from('watchlists').insert({
      trader_id: testTraderId,
      name: 'Test Watchlist',
      color: '#00d4aa',
      items: [{ symbol: 'RELIANCE', token: '2885', exchange: 'NSE' }],
      sort_order: 0,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save watchlist', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save watchlist', 'FAIL', e.message); }

  // ─── 11. Save Journal Entry ─────────────────────────────────
  try {
    const { data, error } = await supabase.from('journal_entries').insert({
      trader_id: testTraderId,
      trading_account_id: testAccountId,
      entry_date: new Date().toISOString().split('T')[0],
      symbol: 'NIFTY',
      side: 'BUY',
      pnl: 5000,
      emotion: 'confident',
      rating: 4,
      notes: 'Test journal entry',
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save journal entry', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save journal entry', 'FAIL', e.message); }

  // ─── 12. Save Layout ────────────────────────────────────────
  try {
    const { data, error } = await supabase.from('layouts').insert({
      trader_id: testTraderId,
      name: 'Test Layout',
      layout_type: 'custom',
      panel_config: { leftDock: true, rightDock: true },
      chart_config: { chartLayout: '4-chart' },
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save layout', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save layout', 'FAIL', e.message); }

  // ─── 13. Save Theme ─────────────────────────────────────────
  try {
    const { data, error } = await supabase.from('themes').insert({
      trader_id: testTraderId,
      name: 'Custom Dark',
      colors: { background: '#0a0a0f', accent: '#00d4aa' },
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save theme', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save theme', 'FAIL', e.message); }

  // ─── 14. Save Account Metrics ───────────────────────────────
  try {
    const { data, error } = await supabase.from('account_metrics').insert({
      trading_account_id: testAccountId,
      challenge_id: testChallengeId,
      date: new Date().toISOString().split('T')[0],
      starting_balance: 1000000,
      ending_balance: 1005000,
      realized_pnl: 5000,
      total_trades: 3,
      winning_trades: 2,
      losing_trades: 1,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save account metrics', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save account metrics', 'FAIL', e.message); }

  // ─── 15. Save Broker Session ────────────────────────────────
  try {
    const { data, error } = await supabase.from('broker_sessions').insert({
      trading_account_id: testAccountId,
      broker_provider: 'angelone',
      access_token_encrypted: 'test-encrypted-token',
      is_active: true,
      session_expiry: new Date(Date.now() + 86400000).toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save broker session', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save broker session', 'FAIL', e.message); }

  // ─── 16. Save Risk Event ────────────────────────────────────
  try {
    const { data, error } = await supabase.from('risk_events').insert({
      trading_account_id: testAccountId,
      event_type: 'daily_loss_warning',
      severity: 'warning',
      rule_type: 'daily_loss_limit',
      threshold_value: 50000,
      actual_value: 42000,
      metadata: { percentUsed: 84 },
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save risk event', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save risk event', 'FAIL', e.message); }

  // ─── 17. Save Challenge Progress ───────────────────────────
  try {
    const { data, error } = await supabase.from('challenge_progress').insert({
      challenge_id: testChallengeId,
      trading_account_id: testAccountId,
      date: new Date().toISOString().split('T')[0],
      trading_day_number: 1,
      day_pnl: 5000,
      cumulative_pnl: 5000,
      balance_eod: 1005000,
      peak_balance: 1005000,
      trades_today: 3,
      is_profitable_day: true,
      is_trading_day: true,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save challenge progress', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save challenge progress', 'FAIL', e.message); }

  // ─── 18. Save Execution Audit ───────────────────────────────
  try {
    const { data, error } = await supabase.from('execution_audits').insert({
      trading_account_id: testAccountId,
      order_id: testOrderId,
      audit_type: 'pre_trade',
      checks_run: ['daily_loss', 'max_positions', 'margin'],
      all_passed: true,
      balance_before: 1000000,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save execution audit', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save execution audit', 'FAIL', e.message); }

  // ─── 19. Save Alert ─────────────────────────────────────────
  try {
    const { data, error } = await supabase.from('alerts').insert({
      trader_id: testTraderId,
      trading_account_id: testAccountId,
      alert_type: 'price',
      symbol: 'NIFTY',
      token: '99926000',
      condition: { operator: 'gte', value: 25000 },
      is_active: true,
    }).select().single();
    if (error) throw new Error(error.message);
    log('Save alert', 'PASS', `id=${data.id}`);
  } catch (e) { log('Save alert', 'FAIL', e.message); }

  // ─── SUMMARY ────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(` RESULTS: ${passed} PASS / ${failed} FAIL / ${results.length} TOTAL`);
  console.log('═══════════════════════════════════════════════════');

  // ─── CLEANUP ────────────────────────────────────────────────
  console.log('');
  console.log('[Cleanup] Removing test data...');
  
  if (testAccountId) {
    await supabase.from('alerts').delete().eq('trading_account_id', testAccountId);
    await supabase.from('execution_audits').delete().eq('trading_account_id', testAccountId);
    await supabase.from('challenge_progress').delete().eq('trading_account_id', testAccountId);
    await supabase.from('risk_events').delete().eq('trading_account_id', testAccountId);
    await supabase.from('broker_sessions').delete().eq('trading_account_id', testAccountId);
    await supabase.from('account_metrics').delete().eq('trading_account_id', testAccountId);
    await supabase.from('executions').delete().eq('trading_account_id', testAccountId);
    await supabase.from('positions').delete().eq('trading_account_id', testAccountId);
    await supabase.from('trading_orders').delete().eq('trading_account_id', testAccountId);
    await supabase.from('risk_rules').delete().eq('trading_account_id', testAccountId);
    await supabase.from('provisioning_logs').delete().eq('trading_account_id', testAccountId);
    await supabase.from('trading_accounts').delete().eq('id', testAccountId);
  }
  if (testChallengeId) {
    await supabase.from('challenge_accounts').delete().eq('id', testChallengeId);
  }
  if (testTraderId) {
    await supabase.from('layouts').delete().eq('trader_id', testTraderId);
    await supabase.from('themes').delete().eq('trader_id', testTraderId);
    await supabase.from('journal_entries').delete().eq('trader_id', testTraderId);
    await supabase.from('watchlists').delete().eq('trader_id', testTraderId);
    await supabase.from('terminal_sessions').delete().eq('trader_id', testTraderId);
    await supabase.from('terminal_traders').delete().eq('id', testTraderId);
  }
  
  console.log('[Cleanup] ✓ Done');
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
