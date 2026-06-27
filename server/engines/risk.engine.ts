/**
 * RISK ENGINE
 * 
 * Pre-trade and post-trade risk checks.
 * Enforces challenge rules before every order reaches the broker.
 * 
 * Called by: Trading Engine (before placeOrder)
 * Reads from: risk_rules table, account_metrics, positions
 */

import type {
  OrderRequest,
  RiskCheckResult,
  RiskAlert,
  RiskRule,
  AccountMetrics,
  Position,
} from '../types/index.js';

export interface IRiskEngine {
  /**
   * Pre-trade check. Must pass before order goes to broker.
   * Returns { allowed: true } or { allowed: false, reason: '...' }
   */
  checkOrder(order: OrderRequest): Promise<RiskCheckResult>;

  /**
   * Post-trade evaluation. Called after every fill.
   * Checks if any limits are breached, sends alerts.
   */
  evaluatePostTrade(accountId: string): Promise<RiskAlert[]>;

  /**
   * Load rules for an account from database.
   */
  loadRules(accountId: string): Promise<RiskRule[]>;

  /**
   * Check if account should be locked (limit breached).
   */
  shouldLockAccount(accountId: string): Promise<{ lock: boolean; reason?: string }>;

  /**
   * Get current risk metrics for display.
   */
  getMetrics(accountId: string): Promise<{
    dailyLoss: number;
    dailyLossLimit: number;
    dailyLossPercent: number;
    drawdown: number;
    maxDrawdown: number;
    drawdownPercent: number;
    profitTarget: number;
    currentProfit: number;
    profitPercent: number;
    openPositions: number;
    maxPositions: number;
  }>;
}

/**
 * Risk checks performed in order:
 * 
 * 1. MARKET HOURS — Is the market open for this segment?
 * 2. SEGMENT ALLOWED — Is this segment permitted for this account?
 * 3. POSITION LIMIT — Would this exceed max open positions?
 * 4. LOT SIZE — Does qty exceed max lot size rule?
 * 5. DAILY LOSS — Would a full adverse move breach daily loss limit?
 * 6. DRAWDOWN — Would this bring account below max drawdown?
 * 7. MARGIN — Is there sufficient margin for this trade?
 * 8. OVERNIGHT — If near market close, is overnight holding allowed?
 * 9. INSTRUMENT — Is this specific instrument allowed? (blacklist check)
 */
