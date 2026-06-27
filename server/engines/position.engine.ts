/**
 * POSITION ENGINE
 * 
 * Tracks all open positions per account.
 * Updates P&L in real-time using market data feed.
 * Persists to database.
 * 
 * Called by: TradingEngine (after fills), MarketDataEngine (for MTM)
 */

import type { Position, Trade, FundsData } from '../types/index.js';

export interface IPositionEngine {
  /**
   * Get all open positions for an account.
   */
  getPositions(accountId: string): Promise<Position[]>;

  /**
   * Update position after a trade execution.
   * Handles: new position, add to position, partial close, full close.
   */
  processTrade(accountId: string, trade: Trade): Promise<Position>;

  /**
   * Update LTP and MTM for all positions of an account.
   * Called on every tick from market data engine.
   */
  updateMTM(accountId: string, tokenPrices: Map<string, number>): void;

  /**
   * Get total unrealized P&L across all positions.
   */
  getUnrealizedPnl(accountId: string): number;

  /**
   * Get total realized P&L for today.
   */
  getRealizedPnl(accountId: string): Promise<number>;

  /**
   * Get current margin utilization.
   */
  getMarginUsed(accountId: string): Promise<number>;

  /**
   * Get net exposure per segment.
   */
  getExposure(accountId: string): Promise<Record<string, number>>;
}
