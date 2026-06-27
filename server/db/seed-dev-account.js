/**
 * Seed a development trader + challenge + trading account + risk rules
 * into Supabase for the terminal dev-bypass user.
 * 
 * Run: node server/db/seed-dev-account.js
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function seed() {
  console.log('[Seed] Starting dev account seed...');

  // 1. Create terminal trader
  const { data: trader, error: traderErr } = await supabase
    .from('terminal_traders')
    .upsert({
      external_id: 'dev-user',
      email: 'dev@fundedwealth.com',
      display_name: 'Dev Trader',
      plan: '1l',
      status: 'active',
    }, { onConflict: 'external_id' })
    .select()
    .single();

  if (traderErr) { console.error('[Seed] Trader error:', traderErr.message); return; }
  console.log(`[Seed] ✓ Trader: ${trader.id} (${trader.display_name})`);

  // 2. Create challenge account (Phase 1 evaluation, ₹10L)
  const { data: existingChallenge } = await supabase
    .from('challenge_accounts')
    .select('id')
    .eq('trader_id', trader.id)
    .eq('status', 'active')
    .single();

  let challenge;
  if (existingChallenge) {
    challenge = existingChallenge;
    console.log(`[Seed] ✓ Challenge exists: ${challenge.id}`);
  } else {
    const { data: ch, error: chErr } = await supabase
      .from('challenge_accounts')
      .insert({
        trader_id: trader.id,
        type: 'evaluation_phase1',
        plan: '1l',
        initial_balance: 1000000,
        current_balance: 1000000,
        peak_balance: 1000000,
        profit_target_pct: 10.00,
        daily_loss_limit_pct: 5.00,
        max_drawdown_pct: 10.00,
        min_trading_days: 5,
        max_calendar_days: 30,
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (chErr) { console.error('[Seed] Challenge error:', chErr.message); return; }
    challenge = ch;
    console.log(`[Seed] ✓ Challenge created: ${challenge.id} (Phase 1, ₹10L)`);
  }

  // 3. Create trading account
  const { data: existingAccount } = await supabase
    .from('trading_accounts')
    .select('id')
    .eq('trader_id', trader.id)
    .eq('challenge_id', challenge.id)
    .single();

  let tradingAccount;
  if (existingAccount) {
    tradingAccount = existingAccount;
    console.log(`[Seed] ✓ Trading account exists: ${tradingAccount.id}`);
  } else {
    const { data: ta, error: taErr } = await supabase
      .from('trading_accounts')
      .insert({
        trader_id: trader.id,
        challenge_id: challenge.id,
        account_code: 'FW-DEV-001',
        broker_provider: 'angelone',
        broker_client_id: 'A1209499',
        balance: 1000000,
        available_margin: 1000000,
        used_margin: 0,
        status: 'active',
      })
      .select()
      .single();

    if (taErr) { console.error('[Seed] Trading account error:', taErr.message); return; }
    tradingAccount = ta;
    console.log(`[Seed] ✓ Trading account created: ${tradingAccount.id} (FW-DEV-001)`);
  }

  // 4. Create risk rules
  const rules = [
    { rule_type: 'daily_loss_limit', value: { percent: 5, amount: 50000 } },
    { rule_type: 'max_drawdown', value: { percent: 10, amount: 100000 } },
    { rule_type: 'profit_target', value: { percent: 10, amount: 100000 } },
    { rule_type: 'max_positions', value: { count: 10 } },
    { rule_type: 'max_lot_size', value: { nfo: 36, mcx: 10, default: 50 } },
    { rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'MCX', 'CDS'] } },
    { rule_type: 'trading_hours', value: { start: '09:15', end: '15:30' } },
    { rule_type: 'no_overnight', value: { cutoffTime: '15:15', allowedProducts: ['MIS'] } },
    { rule_type: 'max_daily_trades', value: { count: 50 } },
  ];

  for (const rule of rules) {
    const { error } = await supabase
      .from('risk_rules')
      .upsert({
        trading_account_id: tradingAccount.id,
        rule_type: rule.rule_type,
        value: rule.value,
        is_active: true,
      }, { onConflict: 'trading_account_id,rule_type' });
    if (error) {
      console.warn(`[Seed] Rule ${rule.rule_type} error: ${error.message}`);
    }
  }
  console.log(`[Seed] ✓ ${rules.length} risk rules configured`);

  // 5. Output summary
  console.log('\n[Seed] ══════════════════════════════════════');
  console.log(`[Seed] Trader ID:          ${trader.id}`);
  console.log(`[Seed] Challenge ID:       ${challenge.id}`);
  console.log(`[Seed] Trading Account ID: ${tradingAccount.id}`);
  console.log(`[Seed] Account Code:       FW-DEV-001`);
  console.log(`[Seed] Balance:            ₹10,00,000`);
  console.log(`[Seed] Phase:              Phase 1 (Evaluation)`);
  console.log(`[Seed] Daily Loss Limit:   5% (₹50,000)`);
  console.log(`[Seed] Max Drawdown:       10% (₹1,00,000)`);
  console.log(`[Seed] Profit Target:      10% (₹1,00,000)`);
  console.log('[Seed] ══════════════════════════════════════\n');
}

seed().catch(console.error);
