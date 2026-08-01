/**
 * MAIN SITE SYNC CLIENT
 *
 * Called by the terminal after every trade fill / position close to keep
 * the Dashboard, Accounts, and Analytics in sync with real trading data.
 *
 * Two endpoints on Main API Server:
 *   POST /api/terminal/trade-event  — per-trade, immediate
 *   POST /api/terminal/sync         — balance/stats snapshot, per fill
 *
 * Auth: x-sso-api-key header (shared secret between terminal and main site)
 */

import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../db/client.js';

const MAIN_SITE_API_URL = process.env.MAIN_SITE_API_URL
  || process.env.WEBSITE_API_URL
  || 'https://api.fundedwealth.com';
const SSO_API_KEY = process.env.SSO_API_KEY || '';
const SYNC_TIMEOUT = 8000;
const MAX_RETRIES = 2;

// De-duplicate rapid back-to-back syncs (e.g. 2 legs of a bracket order)
const _recentSyncIds = new Set();
const DEDUP_WINDOW_MS = 5000;

function _markSent(id) {
  _recentSyncIds.add(id);
  setTimeout(() => _recentSyncIds.delete(id), DEDUP_WINDOW_MS);
}

async function _post(path, payload) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.post(`${MAIN_SITE_API_URL}${path}`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-sso-api-key': SSO_API_KEY,
          'x-api-key': SSO_API_KEY, // fallback header name
        },
        timeout: SYNC_TIMEOUT,
      });
      return { success: true, data: res.data };
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      if (status && status >= 400 && status < 500) {
        // 4xx = client error, no point retrying
        console.warn(`[MainSiteSync] ${path} rejected (${status}): ${msg}`);
        return { success: false, error: msg, status };
      }
      if (attempt === MAX_RETRIES) {
        console.warn(`[MainSiteSync] ${path} failed after ${MAX_RETRIES} attempts: ${msg}`);
        return { success: false, error: msg };
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return { success: false, error: 'unknown' };
}

/**
 * Fetch the current account snapshot from Supabase for the sync payload.
 * Returns null if the account cannot be resolved.
 */
async function _getAccountSnapshot(tradingAccountId) {
  if (!supabase || !tradingAccountId) return null;
  try {
    const { data: ta } = await supabase
      .from('trading_accounts')
      .select('id, trader_id, challenge_id, balance, available_margin, peak_balance, status')
      .eq('id', tradingAccountId)
      .single();
    if (!ta) return null;

    const { data: ca } = ta.challenge_id
      ? await supabase
          .from('challenge_accounts')
          .select('id, initial_balance, max_drawdown_pct, profit_target_pct, status')
          .eq('id', ta.challenge_id)
          .single()
      : { data: null };

    // Trade stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: execs } = await supabase
      .from('executions')
      .select('id, pnl, side, executed_at')
      .eq('trading_account_id', tradingAccountId)
      .order('executed_at', { ascending: false })
      .limit(500);

    const rows = execs || [];
    const totalTrades = rows.length;
    const winningTrades = rows.filter(e => (parseFloat(e.pnl) || 0) > 0).length;
    const losingTrades = rows.filter(e => (parseFloat(e.pnl) || 0) < 0).length;
    const grossProfit = rows.filter(e => (parseFloat(e.pnl) || 0) > 0)
      .reduce((s, e) => s + (parseFloat(e.pnl) || 0), 0);
    const grossLoss = rows.filter(e => (parseFloat(e.pnl) || 0) < 0)
      .reduce((s, e) => s + (parseFloat(e.pnl) || 0), 0);
    const todayPnl = rows
      .filter(e => e.executed_at && new Date(e.executed_at) >= today)
      .reduce((s, e) => s + (parseFloat(e.pnl) || 0), 0);

    const balance = parseFloat(ta.balance) || 0;
    const peakBalance = Math.max(balance, parseFloat(ta.peak_balance) || balance);

    return {
      tradingAccountId: ta.id,
      challengeAccountId: ta.challenge_id || null,
      terminalId: ta.trader_id,
      currentBalance: balance,
      availableMargin: parseFloat(ta.available_margin) || balance * 0.8,
      peakBalance,
      totalTrades,
      winningTrades,
      losingTrades,
      grossProfit,
      grossLoss: Math.abs(grossLoss),
      dailyPnL: todayPnl,
      currentDrawdown: Math.max(0, peakBalance - balance),
      maxDrawdownHit: ca
        ? Math.max(0, (parseFloat(ca.initial_balance) || balance) * (parseFloat(ca.max_drawdown_pct) || 10) / 100)
        : 0,
    };
  } catch (err) {
    console.warn('[MainSiteSync] _getAccountSnapshot failed:', err.message);
    return null;
  }
}

export class MainSiteSyncClient {
  /**
   * Called after every trade execution (position open or close).
   * Posts a trade-event for immediate dashboard update + a full sync snapshot.
   *
   * @param {string} tradingAccountId
   * @param {object} tradeData  { tradeId, symbol, side, entryPrice, exitPrice, quantity, pnl, commission, enteredAt, exitedAt }
   */
  static async onTradeFilled(tradingAccountId, tradeData = {}) {
    if (!SSO_API_KEY) {
      console.warn('[MainSiteSync] SSO_API_KEY not set — skipping sync');
      return;
    }

    // ── 1. Immediate trade-event ──────────────────────────────
    if (tradeData.tradeId) {
      const eventKey = `trade-${tradeData.tradeId}`;
      if (!_recentSyncIds.has(eventKey)) {
        _markSent(eventKey);

        // Resolve challenge account id for the trade-event endpoint
        let challengeAccountId = tradeData.challengeAccountId || null;
        if (!challengeAccountId && tradingAccountId && supabase) {
          try {
            const { data: ta } = await supabase
              .from('trading_accounts')
              .select('challenge_id, trader_id')
              .eq('id', tradingAccountId)
              .single();
            challengeAccountId = ta?.challenge_id || ta?.trader_id || tradingAccountId;
          } catch {}
        }

        _post('/api/terminal/trade-event', {
          tradingAccountId,
          challengeAccountId: challengeAccountId || tradingAccountId,
          tradeId: String(tradeData.tradeId),
          symbol: tradeData.symbol || '',
          side: tradeData.side || '',
          entryPrice: tradeData.entryPrice || 0,
          exitPrice: tradeData.exitPrice || tradeData.price || 0,
          quantity: tradeData.quantity || tradeData.qty || 0,
          pnl: tradeData.pnl || 0,
          commission: tradeData.commission || 0,
          enteredAt: tradeData.enteredAt || tradeData.executedAt || new Date().toISOString(),
          exitedAt: tradeData.exitedAt || tradeData.executedAt || new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // ── 2. Full balance/stats sync ────────────────────────────
    const syncKey = `sync-${tradingAccountId}-${Date.now()}`;
    const syncId = crypto.randomUUID ? crypto.randomUUID()
      : `${tradingAccountId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const snapshot = await _getAccountSnapshot(tradingAccountId);
    if (!snapshot || !snapshot.challengeAccountId || !snapshot.terminalId) {
      console.warn(`[MainSiteSync] Missing IDs for account ${tradingAccountId} — skipping full sync`);
      return;
    }

    await _post('/api/terminal/sync', {
      syncId,
      timestamp: new Date().toISOString(),
      terminalId: snapshot.terminalId,
      tradingAccountId: snapshot.tradingAccountId,
      challengeAccountId: snapshot.challengeAccountId,
      currentBalance: snapshot.currentBalance,
      availableMargin: snapshot.availableMargin,
      peakBalance: snapshot.peakBalance,
      totalTrades: snapshot.totalTrades,
      winningTrades: snapshot.winningTrades,
      losingTrades: snapshot.losingTrades,
      grossProfit: snapshot.grossProfit,
      grossLoss: snapshot.grossLoss,
      currentDrawdown: snapshot.currentDrawdown,
      maxDrawdownHit: snapshot.maxDrawdownHit,
      dailyPnL: snapshot.dailyPnL,
      lastTradeAt: new Date().toISOString(),
    });
  }

  /**
   * Called when a position is fully closed to push the final PnL.
   * Delegates to onTradeFilled with the realized PnL.
   */
  static async onPositionClosed(tradingAccountId, positionData = {}) {
    return this.onTradeFilled(tradingAccountId, {
      tradeId: positionData.positionId || positionData.id || `pos-close-${Date.now()}`,
      symbol: positionData.symbol,
      side: positionData.side === 'LONG' ? 'SELL' : 'BUY',
      pnl: positionData.realizedPnl || positionData.pnl || 0,
      quantity: positionData.qty || 0,
      exitedAt: new Date().toISOString(),
      challengeAccountId: positionData.challengeAccountId,
    });
  }
}
