/**
 * DIAGNOSTIC SCRIPT — ejudha@gmail.com Account Audit
 * 
 * Checks:
 *   1. User record in terminal_traders
 *   2. Trading account status & balance
 *   3. Challenge/phase metadata
 *   4. Recent orders (especially rejections)
 *   5. Risk rules / drawdown status
 *   6. Session validity
 * 
 * Run from server/: node diagnose-ejudha.js
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config(); // loads server/.env when run from server/

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TARGET_EMAIL = 'ejudha@gmail.com';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ACCOUNT AUDIT: ${TARGET_EMAIL}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 1. Lookup terminal_traders ──────────────────────────────────────────
  console.log('─── 1. TRADER IDENTITY ───────────────────────────────────');
  const { data: trader, error: traderErr } = await supabase
    .from('terminal_traders')
    .select('*')
    .eq('email', TARGET_EMAIL)
    .single();

  if (traderErr || !trader) {
    console.log(`  ✗ NOT FOUND in terminal_traders (error: ${traderErr?.message || 'no match'})`);
    console.log('  → User may not have completed SSO login to terminal yet.');
    console.log('  → Or email might be different in the system.\n');

    // Try broader search
    const { data: allTraders } = await supabase
      .from('terminal_traders')
      .select('id, email, external_id, status, display_name')
      .ilike('email', '%ejudha%');
    if (allTraders && allTraders.length > 0) {
      console.log('  Partial matches found:');
      allTraders.forEach(t => console.log(`    - ${t.email} | ID: ${t.id} | Status: ${t.status}`));
    } else {
      console.log('  No partial matches either.');
    }
    process.exit(0);
  }

  console.log(`  ✓ Trader Found:`);
  console.log(`    ID:          ${trader.id}`);
  console.log(`    External ID: ${trader.external_id}`);
  console.log(`    Email:       ${trader.email}`);
  console.log(`    Display:     ${trader.display_name}`);
  console.log(`    Status:      ${trader.status}`);
  console.log(`    Last Login:  ${trader.last_login_at}`);
  console.log(`    Created:     ${trader.created_at}`);
  console.log('');

  if (trader.status !== 'active') {
    console.log(`  ⚠ PROBLEM: Trader status is "${trader.status}" — must be "active" for terminal access.`);
  }

  // ── 2. Trading Accounts ────────────────────────────────────────────────
  console.log('─── 2. TRADING ACCOUNTS ──────────────────────────────────');
  const { data: accounts, error: acctErr } = await supabase
    .from('trading_accounts')
    .select('*, challenge_accounts(id, type, plan, initial_balance, current_balance, peak_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, status, started_at, expires_at)')
    .eq('trader_id', trader.id)
    .order('created_at', { ascending: false });

  if (acctErr) {
    console.log(`  ✗ Query error: ${acctErr.message}`);
  } else if (!accounts || accounts.length === 0) {
    console.log('  ✗ No trading accounts found for this trader.');
    console.log('  → User has not been provisioned with a trading account yet.');
  } else {
    for (const acct of accounts) {
      const ch = acct.challenge_accounts;
      console.log(`  Account: ${acct.account_code || acct.id}`);
      console.log(`    ID:             ${acct.id}`);
      console.log(`    Status:         ${acct.status} ${acct.status !== 'active' ? '⚠ NOT ACTIVE' : '✓'}`);
      console.log(`    Locked Reason:  ${acct.locked_reason || 'none'}`);
      console.log(`    Balance:        ₹${parseFloat(acct.balance || 0).toLocaleString('en-IN')}`);
      console.log(`    Peak Balance:   ₹${parseFloat(acct.peak_balance || acct.balance || 0).toLocaleString('en-IN')}`);
      console.log(`    Broker:         ${acct.broker_provider}`);
      console.log(`    Broker Client:  ${acct.broker_client_id || 'none'}`);
      console.log(`    Created:        ${acct.created_at}`);
      if (ch) {
        console.log(`    Challenge:`);
        console.log(`      Plan:           ${ch.plan}`);
        console.log(`      Type:           ${ch.type}`);
        console.log(`      Status:         ${ch.status}`);
        console.log(`      Initial Bal:    ₹${parseFloat(ch.initial_balance || 0).toLocaleString('en-IN')}`);
        console.log(`      Current Bal:    ₹${parseFloat(ch.current_balance || 0).toLocaleString('en-IN')}`);
        console.log(`      Peak Bal:       ₹${parseFloat(ch.peak_balance || 0).toLocaleString('en-IN')}`);
        console.log(`      Profit Target:  ${ch.profit_target_pct}%`);
        console.log(`      Daily Loss:     ${ch.daily_loss_limit_pct}%`);
        console.log(`      Max Drawdown:   ${ch.max_drawdown_pct}%`);
        console.log(`      Started:        ${ch.started_at}`);
        console.log(`      Expires:        ${ch.expires_at}`);
      }
      console.log('');
    }
  }

  // ── 3. Recent Orders (especially REJECTED) ─────────────────────────────
  console.log('─── 3. RECENT ORDERS (last 20) ───────────────────────────');
  const activeAccounts = accounts || [];
  for (const acct of activeAccounts) {
    const { data: orders, error: ordErr } = await supabase
      .from('trading_orders')
      .select('*')
      .eq('trading_account_id', acct.id)
      .order('placed_at', { ascending: false })
      .limit(20);

    if (ordErr) {
      console.log(`  ✗ Orders query error for ${acct.account_code}: ${ordErr.message}`);
      continue;
    }
    if (!orders || orders.length === 0) {
      console.log(`  No orders found for account ${acct.account_code || acct.id}`);
      continue;
    }

    console.log(`  Account: ${acct.account_code || acct.id} (${orders.length} recent orders)`);
    const rejected = orders.filter(o => o.status === 'REJECTED');
    const filled = orders.filter(o => o.status === 'FILLED');
    const pending = orders.filter(o => o.status === 'PENDING' || o.status === 'OPEN');

    console.log(`    REJECTED: ${rejected.length} | FILLED: ${filled.length} | PENDING/OPEN: ${pending.length}`);

    if (rejected.length > 0) {
      console.log(`    ⚠ REJECTED ORDERS:`);
      for (const r of rejected.slice(0, 10)) {
        console.log(`      [${r.placed_at}] ${r.side} ${r.qty}x ${r.symbol} (${r.order_type})`);
        console.log(`        Reason: ${r.reject_reason || 'unknown'}`);
        console.log(`        Token:  ${r.token} | Segment: ${r.segment}`);
      }
    }
    console.log('');
  }

  // ── 4. Risk Alerts ─────────────────────────────────────────────────────
  console.log('─── 4. RISK ALERTS (recent) ──────────────────────────────');
  for (const acct of activeAccounts) {
    const { data: alerts } = await supabase
      .from('risk_alerts')
      .select('*')
      .eq('trading_account_id', acct.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (alerts && alerts.length > 0) {
      console.log(`  Account: ${acct.account_code || acct.id}`);
      for (const a of alerts) {
        console.log(`    [${a.created_at}] ${a.severity} — ${a.rule_type}: ${a.message}`);
      }
    } else {
      console.log(`  No risk alerts for ${acct.account_code || acct.id}`);
    }
    console.log('');
  }

  // ── 5. Sessions ────────────────────────────────────────────────────────
  console.log('─── 5. ACTIVE SESSIONS ───────────────────────────────────');
  const { data: sessions } = await supabase
    .from('terminal_sessions')
    .select('*')
    .eq('trader_id', trader.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (sessions && sessions.length > 0) {
    console.log(`  Active sessions: ${sessions.length}`);
    for (const s of sessions) {
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      console.log(`    [${s.created_at}] Account: ${s.trading_account_id} | Expires: ${s.expires_at} ${expired ? '⚠ EXPIRED' : '✓'}`);
    }
  } else {
    console.log('  No active (non-revoked) sessions found.');
    console.log('  → User may need to re-login via SSO from Dashboard.');
  }
  console.log('');

  // ── 6. Positions ───────────────────────────────────────────────────────
  console.log('─── 6. OPEN POSITIONS ────────────────────────────────────');
  for (const acct of activeAccounts) {
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('trading_account_id', acct.id)
      .eq('is_open', true);

    if (positions && positions.length > 0) {
      console.log(`  Account: ${acct.account_code || acct.id} — ${positions.length} open positions`);
      for (const p of positions) {
        console.log(`    ${p.side} ${p.qty}x ${p.symbol} @ ₹${p.avg_price} (token: ${p.token})`);
      }
    } else {
      console.log(`  No open positions for ${acct.account_code || acct.id}`);
    }
    console.log('');
  }

  // ── 7. Daily Metrics ───────────────────────────────────────────────────
  console.log('─── 7. RECENT DAILY METRICS ──────────────────────────────');
  for (const acct of activeAccounts) {
    const { data: metrics } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('trading_account_id', acct.id)
      .order('date', { ascending: false })
      .limit(5);

    if (metrics && metrics.length > 0) {
      console.log(`  Account: ${acct.account_code || acct.id}`);
      for (const m of metrics) {
        console.log(`    [${m.date}] P&L: ₹${m.realized_pnl} | Trades: ${m.total_trades} | Drawdown: ₹${m.max_drawdown || 0}`);
      }
    } else {
      console.log(`  No daily metrics for ${acct.account_code || acct.id}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AUDIT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
