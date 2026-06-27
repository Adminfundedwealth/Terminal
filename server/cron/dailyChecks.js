/**
 * DAILY CHECKS — CRON SERVICE
 * 
 * Runs at start of each trading day:
 *   - Unlocks accounts locked for daily loss (new day reset)
 *   - Checks challenge expiry
 *   - Records previous day's metrics if missing
 * 
 * Can be triggered by:
 *   - External cron (e.g., Railway cron, Supabase Edge Function, GitHub Action)
 *   - Manual call to POST /admin/daily-checks (with admin auth)
 *   - setInterval at server startup (simple approach)
 */

import { supabase } from '../db/client.js';
import { ChallengeService } from '../services/challengeService.js';
import { RiskEngine } from '../services/riskEngine.js';

/**
 * Run daily checks for all active accounts.
 * Call this at 09:00 IST (before market open).
 */
export async function runDailyChecks() {
  if (!supabase) {
    console.warn('[DailyChecks] Supabase not configured — skipping');
    return { processed: 0, results: [] };
  }

  console.log('[DailyChecks] Starting daily checks...');

  // Get all accounts that are active or locked (not breached/completed/expired)
  const { data: accounts, error } = await supabase
    .from('trading_accounts')
    .select('id, status, trader_id')
    .in('status', ['active', 'locked']);

  if (error) {
    console.error('[DailyChecks] Failed to fetch accounts:', error.message);
    return { processed: 0, error: error.message };
  }

  const results = [];

  for (const account of accounts) {
    try {
      const checkResults = await ChallengeService.dailyCheck(account.id);
      if (checkResults.length > 0) {
        results.push({ accountId: account.id, actions: checkResults });
      }
    } catch (err) {
      results.push({ accountId: account.id, error: err.message });
    }
  }

  console.log(`[DailyChecks] Processed ${accounts.length} accounts, ${results.length} had actions`);
  return { processed: accounts.length, results };
}

/**
 * Record end-of-day metrics for all active accounts.
 * Call this at 15:45 IST (after market close).
 */
export async function runEndOfDayMetrics() {
  if (!supabase) {
    console.warn('[EODMetrics] Supabase not configured — skipping');
    return { processed: 0 };
  }

  console.log('[EODMetrics] Recording end-of-day metrics...');

  const { data: accounts, error } = await supabase
    .from('trading_accounts')
    .select('id')
    .eq('status', 'active');

  if (error) {
    console.error('[EODMetrics] Failed to fetch accounts:', error.message);
    return { processed: 0, error: error.message };
  }

  let processed = 0;

  for (const account of accounts) {
    try {
      await RiskEngine.recordDailyMetrics(account.id);

      // Also record challenge_progress for accounts with active challenges
      try {
        const { data: ta } = await supabase.from('trading_accounts').select('challenge_id, balance').eq('id', account.id).single();
        if (ta && ta.challenge_id) {
          const { data: ch } = await supabase.from('challenge_accounts').select('initial_balance, peak_balance').eq('id', ta.challenge_id).single();
          if (ch) {
            const balance = parseFloat(ta.balance) || 0;
            const initial = parseFloat(ch.initial_balance) || balance;
            const peak = parseFloat(ch.peak_balance) || balance;
            const pnl = balance - initial;
            const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
            const { data: trades } = await supabase.from('trading_orders').select('id', { count: 'exact', head: true }).eq('trading_account_id', account.id).eq('status', 'FILLED').gte('placed_at', new Date().toISOString().split('T')[0]);
            const tradesToday = trades || 0;

            const { ChallengeMetricsRepository } = await import('../repositories/challenge-metrics.repository.js');
            const cpRepo = new ChallengeMetricsRepository();
            await cpRepo.upsertDailyProgress(ta.challenge_id, account.id, {
              date: new Date().toISOString().split('T')[0],
              tradingDayNumber: 1,
              dayPnl: 0,
              cumulativePnl: pnl,
              balanceEod: balance,
              peakBalance: peak,
              drawdownPct: drawdown,
              dailyLossPct: 0,
              tradesToday,
              isProfitableDay: pnl > 0,
              isTradingDay: tradesToday > 0,
            });
          }
        }
      } catch (cpErr) {
        // Non-fatal — challenge_progress is supplementary
        console.warn(`[EODMetrics] challenge_progress failed for ${account.id}:`, cpErr.message);
      }

      processed++;
    } catch (err) {
      console.error(`[EODMetrics] Failed for account ${account.id}:`, err.message);
    }
  }

  console.log(`[EODMetrics] Recorded metrics for ${processed}/${accounts.length} accounts`);
  return { processed };
}

/**
 * Schedule daily checks using setInterval.
 * Simple approach — checks every minute if it's time to run.
 * For production, use external cron (Supabase Edge Function, Railway, etc.).
 */
export function scheduleDailyChecks() {
  let lastDailyRun = null;
  let lastEodRun = null;

  setInterval(async () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const dateKey = now.toISOString().split('T')[0];

    // Run daily checks at 09:00 IST
    if (hours === 9 && minutes === 0 && lastDailyRun !== dateKey) {
      lastDailyRun = dateKey;
      await runDailyChecks();
    }

    // Run EOD metrics at 15:45 IST
    if (hours === 15 && minutes === 45 && lastEodRun !== dateKey) {
      lastEodRun = dateKey;
      await runEndOfDayMetrics();
    }
  }, 60000); // Check every minute

  console.log('[Cron] Daily checks scheduler started (09:00 daily unlock, 15:45 EOD metrics)');
}

