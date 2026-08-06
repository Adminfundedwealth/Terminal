/**
 * EMERGENCY DASHBOARD SYNC
 * 
 * Run this to immediately sync all P&L data from executions table
 * to account_metrics and challenge_accounts so the dashboard shows
 * correct values right now.
 * 
 * Usage: node server/scripts/sync-dashboard-now.js
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

// Also try root .env
import { existsSync } from 'fs';
const rootEnv = resolve(__dirname, '../../.env');
const serverEnv = resolve(__dirname, '../.env');
if (existsSync(serverEnv)) config({ path: serverEnv, override: true });
if (existsSync(rootEnv)) config({ path: rootEnv, override: true });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  console.log('=== Dashboard Sync ===\n');

  // 1. Get all active trading accounts with their challenges
  const { data: accounts, error: accErr } = await supabase
    .from('trading_accounts')
    .select('id, trader_id, balance, challenge_id, status')
    .in('status', ['active', 'funded']);

  if (accErr) { console.error('Failed to fetch accounts:', accErr.message); process.exit(1); }
  console.log(`Found ${accounts.length} active accounts\n`);

  for (const account of accounts) {
    console.log(`\n--- Account ${account.id} ---`);

    // 2. Get all executions for FIFO P&L
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data: todayTrades } = await supabase
      .from('executions')
      .select('*')
      .eq('trading_account_id', account.id)
      .gte('executed_at', today.toISOString())
      .order('executed_at', { ascending: true });

    const { data: allTrades } = await supabase
      .from('executions')
      .select('*')
      .eq('trading_account_id', account.id)
      .order('executed_at', { ascending: true });

    console.log(`  Today trades: ${todayTrades?.length || 0}, All trades: ${allTrades?.length || 0}`);

    // 3. FIFO P&L calculation
    function calcPnl(trades) {
      if (!trades?.length) return { realized: 0, winning: 0, losing: 0, grossProfit: 0, grossLoss: 0 };
      const byToken = {};
      for (const t of trades) {
        const key = t.token || t.symbol;
        if (!byToken[key]) byToken[key] = [];
        byToken[key].push(t);
      }
      let realized = 0, winning = 0, losing = 0, grossProfit = 0, grossLoss = 0;
      for (const symbolTrades of Object.values(byToken)) {
        let netQty = 0, avgCost = 0;
        for (const t of symbolTrades) {
          const qty = parseInt(t.qty) || 0;
          const price = parseFloat(t.price) || 0;
          if (t.side === 'BUY') {
            const total = avgCost * netQty + price * qty;
            netQty += qty;
            avgCost = netQty > 0 ? total / netQty : 0;
          } else {
            if (netQty > 0) {
              const closeQty = Math.min(qty, netQty);
              const pnl = (price - avgCost) * closeQty;
              realized += pnl;
              if (pnl > 0) { winning++; grossProfit += pnl; }
              else if (pnl < 0) { losing++; grossLoss += Math.abs(pnl); }
              netQty -= closeQty;
              if (netQty <= 0) { netQty = 0; avgCost = 0; }
            }
          }
        }
      }
      return { realized, winning, losing, grossProfit, grossLoss };
    }

    const todayPnl = calcPnl(todayTrades);
    const allPnl = calcPnl(allTrades);
    console.log(`  Today realized P&L: ₹${Math.round(todayPnl.realized)}`);
    console.log(`  All realized P&L: ₹${Math.round(allPnl.realized)}`);

    // 4. Get challenge
    let challenge = null;
    if (account.challenge_id) {
      const { data } = await supabase
        .from('challenge_accounts')
        .select('*')
        .eq('id', account.challenge_id)
        .single();
      challenge = data;
    }

    const initialBalance = parseFloat(challenge?.initial_balance || account.balance) || 0;
    const newBalance = Math.round((initialBalance + allPnl.realized) * 100) / 100;
    console.log(`  Initial balance: ₹${initialBalance}`);
    console.log(`  New balance: ₹${newBalance}`);

    // 5. Update trading_accounts.balance
    const { error: taErr } = await supabase
      .from('trading_accounts')
      .update({ balance: newBalance })
      .eq('id', account.id);
    if (taErr) console.error('  trading_accounts update failed:', taErr.message);
    else console.log('  ✓ trading_accounts.balance updated');

    // 6. Update challenge_accounts.current_balance
    if (challenge?.id) {
      const { error: caErr } = await supabase
        .from('challenge_accounts')
        .update({
          current_balance: newBalance,
          peak_balance: Math.max(parseFloat(challenge.peak_balance || 0), newBalance),
          updated_at: new Date().toISOString(),
        })
        .eq('id', challenge.id);
      if (caErr) console.error('  challenge_accounts update failed:', caErr.message);
      else console.log('  ✓ challenge_accounts.current_balance updated');
    }

    // 7. Upsert account_metrics for today
    const dateStr = today.toISOString().split('T')[0];
    const { data: existingMetric } = await supabase
      .from('account_metrics')
      .select('id')
      .eq('trading_account_id', account.id)
      .eq('date', dateStr)
      .single();

    const metrics = {
      trading_account_id: account.id,
      challenge_id: account.challenge_id,
      date: dateStr,
      starting_balance: initialBalance,
      ending_balance: newBalance,
      realized_pnl: Math.round(todayPnl.realized * 100) / 100,
      total_trades: todayTrades?.length || 0,
      winning_trades: todayPnl.winning,
      losing_trades: todayPnl.losing,
      gross_profit: Math.round(todayPnl.grossProfit * 100) / 100,
      gross_loss: Math.round(todayPnl.grossLoss * 100) / 100,
    };

    let metricErr;
    if (existingMetric) {
      ({ error: metricErr } = await supabase.from('account_metrics').update(metrics).eq('id', existingMetric.id));
    } else {
      ({ error: metricErr } = await supabase.from('account_metrics').insert(metrics));
    }
    if (metricErr) console.error('  account_metrics update failed:', metricErr.message);
    else console.log(`  ✓ account_metrics updated (today trades: ${metrics.total_trades}, P&L: ₹${Math.round(todayPnl.realized)})`);
  }

  console.log('\n=== Sync Complete ===');
  console.log('Refresh the dashboard now — P&L should show correctly.');
}

main().catch(e => { console.error(e); process.exit(1); });
