/**
 * DASHBOARD SYNC API
 *
 * Public endpoints called by fundedwealth.com main site to display
 * terminal analytics, P&L, and trade data on the Analytics page.
 *
 * Auth: x-dashboard-key header (set DASHBOARD_API_KEY env var)
 *
 * Base path: /api/dashboard
 *
 * Endpoints:
 *   GET /api/dashboard/account/:accountCode/analytics
 *   GET /api/dashboard/account/:accountCode/risk
 *   GET /api/dashboard/account/:accountCode/trades
 */

import { Router } from 'express';
import { supabase } from '../db/client.js';

const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || process.env.PROVISIONING_API_KEY || process.env.WEBSITE_CALLBACK_KEY;

function requireDashboardKey(req, res, next) {
  const key = req.headers['x-dashboard-key'] || req.headers['x-callback-key'] || req.query.key;
  if (!DASHBOARD_API_KEY) return next(); // no key configured = open (dev mode)
  if (key === DASHBOARD_API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── FIFO P&L calculator ──────────────────────────────────────────────────────
function calcFifoPnl(trades) {
  if (!trades?.length) return { realized: 0, winning: 0, losing: 0, grossProfit: 0, grossLoss: 0, pairs: [] };

  const byToken = {};
  for (const t of trades) {
    const key = t.token || t.symbol;
    if (!byToken[key]) byToken[key] = [];
    byToken[key].push(t);
  }

  let realized = 0, winning = 0, losing = 0, grossProfit = 0, grossLoss = 0;
  const pairs = []; // closed trade pairs { pnl, date, symbol }

  for (const [, symbolTrades] of Object.entries(byToken)) {
    symbolTrades.sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    let netQty = 0, avgCost = 0;

    for (const t of symbolTrades) {
      const qty = parseInt(t.qty) || 0;
      const price = parseFloat(t.price) || 0;
      const date = (t.executed_at || '').split('T')[0];

      if (t.side === 'BUY') {
        const total = avgCost * netQty + price * qty;
        netQty += qty;
        avgCost = netQty > 0 ? total / netQty : 0;
      } else {
        if (netQty > 0) {
          const closeQty = Math.min(qty, netQty);
          const pnl = (price - avgCost) * closeQty;
          realized += pnl;
          pairs.push({ pnl, date, symbol: t.symbol });
          if (pnl > 0) { winning++; grossProfit += pnl; }
          else if (pnl < 0) { losing++; grossLoss += Math.abs(pnl); }
          netQty -= closeQty;
          if (netQty <= 0) { netQty = 0; avgCost = 0; }
        } else {
          // Short
          const total = avgCost * Math.abs(netQty) + price * qty;
          netQty -= qty;
          avgCost = netQty < 0 ? total / Math.abs(netQty) : 0;
        }
      }
    }
  }
  return { realized, winning, losing, grossProfit, grossLoss, pairs };
}

export function createDashboardSyncRouter() {
  const router = Router();

  // ── GET /api/dashboard/accounts — list all account codes (for debugging) ──
  router.get('/accounts', requireDashboardKey, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('trading_accounts')
        .select('id, account_code, status, balance')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ accounts: data || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dashboard/account/:accountCode/analytics ─────────────────────
  router.get('/account/:accountCode/analytics', requireDashboardKey, async (req, res) => {
    try {
      const { accountCode } = req.params;

      // Resolve account — try account_code first, then id, then trader external_id
      let account = null;
      // Try account_code
      { const { data } = await supabase.from('trading_accounts').select('id, trader_id, balance, challenge_id, status').eq('account_code', accountCode).maybeSingle(); account = data; }
      // Try without prefix (FW- stripped)
      if (!account) { const { data } = await supabase.from('trading_accounts').select('id, trader_id, balance, challenge_id, status').ilike('account_code', `%${accountCode.replace(/^FW-/i,'').replace(/-/g,'')}%`).maybeSingle(); account = data; }
      // Try by id directly (if a UUID was passed)
      if (!account && accountCode.includes('-') && accountCode.length > 20) { const { data } = await supabase.from('trading_accounts').select('id, trader_id, balance, challenge_id, status').eq('id', accountCode).maybeSingle(); account = data; }

      if (!account) return res.status(404).json({ error: 'Account not found', tried: accountCode });

      // Fetch all executions
      const { data: allTrades } = await supabase
        .from('executions')
        .select('*')
        .eq('trading_account_id', account.id)
        .order('executed_at', { ascending: true });

      // Date helpers
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const dow = now.getDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - mondayOffset); weekStart.setHours(0,0,0,0);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

      const todayTrades = (allTrades || []).filter(t => (t.executed_at||'').startsWith(today));

      const allPnl   = calcFifoPnl(allTrades || []);
      const todayPnl = calcFifoPnl(todayTrades);

      // Period P&L from pairs
      const dailyPnl   = allPnl.pairs.filter(p => p.date === today).reduce((s,p) => s+p.pnl, 0);
      const weeklyPnl  = allPnl.pairs.filter(p => p.date >= weekStartStr).reduce((s,p) => s+p.pnl, 0);
      const monthlyPnl = allPnl.pairs.filter(p => p.date >= monthStart).reduce((s,p) => s+p.pnl, 0);
      const totalPnl   = allPnl.realized;

      const totalTrades = allPnl.pairs.length;
      const winners = allPnl.winning;
      const losers  = allPnl.losing;
      const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
      const pf = allPnl.grossLoss > 0 ? allPnl.grossProfit / allPnl.grossLoss : (allPnl.grossProfit > 0 ? null : 0);
      const avgWin = winners > 0 ? allPnl.grossProfit / winners : 0;
      const avgLoss = losers > 0 ? allPnl.grossLoss / losers : 0;
      const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
      const bestTrade  = allPnl.pairs.length > 0 ? Math.max(...allPnl.pairs.map(p=>p.pnl)) : 0;
      const worstTrade = allPnl.pairs.length > 0 ? Math.min(...allPnl.pairs.map(p=>p.pnl)) : 0;
      const expectancy = totalTrades > 0 ? ((winRate/100)*avgWin) - ((1-winRate/100)*avgLoss) : 0;

      // Today stats
      const dailyTradeCount = todayPnl.pairs.length;
      const dailyWinRate = dailyTradeCount > 0 ? (todayPnl.winning / dailyTradeCount) * 100 : 0;

      // Streaks
      let maxWinStreak=0, maxLossStreak=0, cur=0, streakType=null;
      for (const p of allPnl.pairs) {
        if (p.pnl > 0) { cur = streakType==='win' ? cur+1 : 1; streakType='win'; maxWinStreak=Math.max(maxWinStreak,cur); }
        else if (p.pnl < 0) { cur = streakType==='loss' ? cur+1 : 1; streakType='loss'; maxLossStreak=Math.max(maxLossStreak,cur); }
      }

      // Symbol breakdown
      const symbolMap = {};
      for (const p of allPnl.pairs) {
        if (!p.symbol) continue;
        if (!symbolMap[p.symbol]) symbolMap[p.symbol] = { symbol: p.symbol, trades: 0, pnl: 0 };
        symbolMap[p.symbol].trades++;
        symbolMap[p.symbol].pnl += p.pnl;
      }
      const symbolBreakdown = Object.values(symbolMap).sort((a,b) => Math.abs(b.pnl)-Math.abs(a.pnl)).slice(0,10);

      // P&L calendar (last 30 days)
      const calendarMap = {};
      for (const p of allPnl.pairs) {
        if (!calendarMap[p.date]) calendarMap[p.date] = { date: p.date, pnl: 0, trades: 0 };
        calendarMap[p.date].pnl += p.pnl;
        calendarMap[p.date].trades++;
      }
      const pnlCalendar = Object.values(calendarMap).sort((a,b) => a.date.localeCompare(b.date));

      // Open positions unrealized P&L
      const { data: positions } = await supabase
        .from('positions')
        .select('unrealized_pnl, pnl')
        .eq('trading_account_id', account.id)
        .eq('status', 'open');
      const unrealizedPnl = (positions||[]).reduce((s,p) => s + parseFloat(p.unrealized_pnl || p.pnl || 0), 0);

      res.json({
        accountCode,
        accountId: account.id,
        // Period P&L
        dailyPnl:   Math.round(dailyPnl   * 100) / 100,
        weeklyPnl:  Math.round(weeklyPnl  * 100) / 100,
        monthlyPnl: Math.round(monthlyPnl * 100) / 100,
        totalPnl:   Math.round(totalPnl   * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        // Key metrics
        totalTrades, winners, losers,
        winRate:      Math.round(winRate * 100) / 100,
        profitFactor: pf !== null ? Math.round(pf * 100) / 100 : null,
        avgWin:       Math.round(avgWin  * 100) / 100,
        avgLoss:      Math.round(avgLoss * 100) / 100,
        avgRR:        Math.round(avgRR   * 100) / 100,
        expectancy:   Math.round(expectancy * 100) / 100,
        bestTrade:    Math.round(bestTrade  * 100) / 100,
        worstTrade:   Math.round(worstTrade * 100) / 100,
        grossProfit:  Math.round(allPnl.grossProfit * 100) / 100,
        grossLoss:    Math.round(allPnl.grossLoss   * 100) / 100,
        // Daily
        dailyTradeCount,
        dailyWinRate: Math.round(dailyWinRate * 100) / 100,
        // Streaks
        maxWinStreak, maxLossStreak,
        // Breakdowns
        symbolBreakdown,
        pnlCalendar,
        // Meta
        computedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[DashboardSync] analytics error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dashboard/account/:accountCode/risk ───────────────────────────
  router.get('/account/:accountCode/risk', requireDashboardKey, async (req, res) => {
    try {
      const { accountCode } = req.params;

      let account = null;
      { const { data } = await supabase.from('trading_accounts').select('id, balance, challenge_id, status, peak_balance').eq('account_code', accountCode).maybeSingle(); account = data; }
      if (!account) { const { data } = await supabase.from('trading_accounts').select('id, balance, challenge_id, status, peak_balance').ilike('account_code', `%${accountCode.replace(/^FW-/i,'').replace(/-/g,'')}%`).maybeSingle(); account = data; }
      if (!account && accountCode.length > 20) { const { data } = await supabase.from('trading_accounts').select('id, balance, challenge_id, status, peak_balance').eq('id', accountCode).maybeSingle(); account = data; }

      if (!account) return res.status(404).json({ error: 'Account not found' });

      // Challenge rules
      let challenge = null;
      if (account.challenge_id) {
        const { data } = await supabase.from('challenge_accounts').select('*').eq('id', account.challenge_id).single();
        challenge = data;
      }

      const balance = parseFloat(account.balance) || 0;
      const initialBalance = parseFloat(challenge?.initial_balance || balance);
      const peakBalance = Math.max(parseFloat(account.peak_balance || 0), balance);

      // Today realized P&L
      const today = new Date(); today.setHours(0,0,0,0);
      const { data: todayTrades } = await supabase
        .from('executions').select('side,qty,price,token,symbol,executed_at')
        .eq('trading_account_id', account.id)
        .gte('executed_at', today.toISOString())
        .order('executed_at', { ascending: true });

      const todayPnl = calcFifoPnl(todayTrades || []);

      // Unrealized
      const { data: positions } = await supabase.from('positions').select('unrealized_pnl,pnl').eq('trading_account_id', account.id).eq('status','open');
      const unrealizedPnl = (positions||[]).reduce((s,p) => s + parseFloat(p.unrealized_pnl||p.pnl||0), 0);

      const totalDailyPnl = todayPnl.realized + unrealizedPnl;
      const currentEquity = balance + unrealizedPnl;
      const pnlFromStart  = currentEquity - initialBalance;

      const dailyLossPct    = parseFloat(challenge?.daily_loss_limit_pct || 5);
      const maxDrawdownPct  = parseFloat(challenge?.max_drawdown_pct || 10);
      const profitTargetPct = parseFloat(challenge?.profit_target_pct || 10);

      const dailyLossLimit    = (dailyLossPct / 100) * initialBalance;
      const maxDrawdownLimit  = (maxDrawdownPct / 100) * initialBalance;
      const profitTargetAmt   = (profitTargetPct / 100) * initialBalance;

      const dailyLoss = totalDailyPnl < 0 ? Math.abs(totalDailyPnl) : 0;
      const drawdown  = Math.max(0, peakBalance - currentEquity);

      const targetPct = profitTargetAmt > 0 ? Math.min(100, Math.max(0, (pnlFromStart / profitTargetAmt) * 100)) : 0;

      const { count: todayTradeCount } = await supabase.from('executions').select('id', { count: 'exact', head: true })
        .eq('trading_account_id', account.id).gte('executed_at', today.toISOString());

      res.json({
        accountCode, accountId: account.id,
        balance, currentEquity, initialBalance, peakBalance,
        todayRealizedPnl: Math.round(todayPnl.realized * 100) / 100,
        unrealizedPnl:    Math.round(unrealizedPnl * 100) / 100,
        totalDailyPnl:    Math.round(totalDailyPnl * 100) / 100,
        pnlFromStart:     Math.round(pnlFromStart  * 100) / 100,
        dailyLoss, dailyLossLimit,
        dailyLossUsedPct:   dailyLossLimit > 0 ? Math.min(100, (dailyLoss / dailyLossLimit) * 100) : 0,
        dailyLossRemaining: Math.max(0, dailyLossLimit - dailyLoss),
        drawdown, maxDrawdownLimit,
        maxDrawdownUsedPct: maxDrawdownLimit > 0 ? Math.min(100, (drawdown / maxDrawdownLimit) * 100) : 0,
        maxDrawdownRemaining: Math.max(0, maxDrawdownLimit - drawdown),
        profitTargetAmount: profitTargetAmt,
        targetProgressPct:  Math.round(targetPct * 100) / 100,
        targetRemaining:    Math.max(0, profitTargetAmt - Math.max(0, pnlFromStart)),
        todayTradeCount: todayTradeCount || 0,
        accountStatus: account.status,
        computedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[DashboardSync] risk error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dashboard/account/:accountCode/trades ─────────────────────────
  router.get('/account/:accountCode/trades', requireDashboardKey, async (req, res) => {
    try {
      const { accountCode } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const period = req.query.period || 'all'; // today | week | month | all

      let account = null;
      { const { data } = await supabase.from('trading_accounts').select('id').eq('account_code', accountCode).maybeSingle(); account = data; }
      if (!account) { const { data } = await supabase.from('trading_accounts').select('id').ilike('account_code', `%${accountCode.replace(/^FW-/i,'').replace(/-/g,'')}%`).maybeSingle(); account = data; }
      if (!account && accountCode.length > 20) { const { data } = await supabase.from('trading_accounts').select('id').eq('id', accountCode).maybeSingle(); account = data; }
      if (!account) return res.status(404).json({ error: 'Account not found' });

      let query = supabase.from('executions').select('*')
        .eq('trading_account_id', account.id)
        .order('executed_at', { ascending: false })
        .limit(limit);

      if (period !== 'all') {
        const from = new Date();
        if (period === 'today') from.setHours(0,0,0,0);
        else if (period === 'week') from.setDate(from.getDate() - 7);
        else if (period === 'month') from.setMonth(from.getMonth() - 1);
        query = query.gte('executed_at', from.toISOString());
      }

      const { data: trades, error } = await query;
      if (error) throw error;

      res.json({ accountCode, trades: trades || [], count: trades?.length || 0 });
    } catch (err) {
      console.error('[DashboardSync] trades error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
