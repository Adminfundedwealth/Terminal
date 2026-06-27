/**
 * REPORTING ENGINE
 * 
 * Handles P&L calculations, daily metrics, and trade analytics.
 * Persists account_metrics snapshots daily.
 * 
 * Called by: TradingEngine (after fills), Scheduler (EOD), Frontend (display)
 */

import type { AccountMetrics, Trade } from '../types/index.js';

export interface IReportingEngine {
  /**
   * Record a new trade in the database.
   */
  recordTrade(trade: Trade): Promise<void>;

  /**
   * Get today's metrics for an account.
   */
  getTodayMetrics(accountId: string): Promise<AccountMetrics>;

  /**
   * Get historical metrics for date range.
   */
  getHistoricalMetrics(accountId: string, from: string, to: string): Promise<AccountMetrics[]>;

  /**
   * Take end-of-day snapshot. Called by scheduler at 15:30 IST.
   */
  takeEODSnapshot(accountId: string): Promise<void>;

  /**
   * Calculate win rate, avg win, avg loss, profit factor, etc.
   */
  getTradeStats(accountId: string, period?: 'today' | 'week' | 'month' | 'all'): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    largestWin: number;
    largestLoss: number;
    totalPnl: number;
  }>;

  /**
   * Get equity curve data (daily balance over time).
   */
  getEquityCurve(accountId: string): Promise<{ date: string; balance: number }[]>;
}
