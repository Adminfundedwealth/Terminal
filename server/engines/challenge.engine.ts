/**
 * CHALLENGE RULES ENGINE
 * 
 * Enforces prop firm challenge rules per account.
 * Each account has a set of rules that gate trading.
 * 
 * Called by: TradingEngine (before order), PostTrade evaluations
 */

import type { OrderRequest, RiskCheckResult, Account, Challenge, RiskRule } from '../types/index.js';

export interface IChallengeEngine {
  /**
   * Validate order against challenge-specific rules.
   * Different from risk engine — these are business rules not safety checks.
   */
  validateOrder(accountId: string, order: OrderRequest): Promise<RiskCheckResult>;

  /**
   * Check if challenge has been passed (profit target met).
   */
  checkPassed(accountId: string): Promise<{ passed: boolean; profit: number; target: number }>;

  /**
   * Check if challenge has failed (max drawdown breached).
   */
  checkFailed(accountId: string): Promise<{ failed: boolean; drawdown: number; maxAllowed: number }>;

  /**
   * Check if challenge has expired.
   */
  checkExpired(challengeId: string): Promise<boolean>;

  /**
   * Get challenge progress for display.
   */
  getProgress(accountId: string): Promise<{
    status: string;
    daysTraded: number;
    daysRemaining: number;
    currentBalance: number;
    startingBalance: number;
    profitTarget: number;
    profitAchieved: number;
    maxDrawdownAllowed: number;
    currentDrawdown: number;
    dailyLossLimit: number;
    todayLoss: number;
  }>;

  /**
   * Lock account (stop all trading). Called when rules are breached.
   */
  lockAccount(accountId: string, reason: string): Promise<void>;

  /**
   * Pass the challenge. Update status, notify dashboard.
   */
  passChallenge(accountId: string): Promise<void>;

  /**
   * Fail the challenge. Update status, close positions, notify dashboard.
   */
  failChallenge(accountId: string, reason: string): Promise<void>;
}
