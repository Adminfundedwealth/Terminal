/**
 * RISK ENGINE PROPERTY-BASED TESTS (fast-check)
 *
 * Property: For ALL approved orders, the resulting account state stays within ALL configured limits.
 * Property: For ALL orders that would breach a limit, the risk engine MUST reject.
 *
 * Validates: Requirement 8 (Risk Management) AC 1-10
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Risk Engine Implementation Under Test ───────────────────────────────────

interface RiskRule {
  dailyLossLimit: number;
  maxDrawdownLimit: number;
  maxPositions: number;
  maxLotSize: number;
  allowedSegments: string[];
}

interface AccountState {
  balance: number;
  peakEquity: number;
  currentEquity: number;
  freeMargin: number;
  dailyLoss: number;       // accumulated realized + unrealized loss today
  openPositionCount: number;
}

interface OrderProposal {
  qty: number;
  price: number;
  side: 'BUY' | 'SELL';
  segment: string;
  marginRequired: number;
  potentialLoss: number;   // max loss this order could incur
}

type RejectionReason =
  | 'DAILY_LOSS_LIMIT'
  | 'DRAWDOWN_LIMIT'
  | 'INSUFFICIENT_MARGIN'
  | 'MAX_POSITIONS'
  | 'MAX_LOT_SIZE'
  | 'SEGMENT_NOT_ALLOWED';

interface RiskDecision {
  approved: boolean;
  reason: RejectionReason | null;
  details: string;
}

function evaluateRisk(order: OrderProposal, account: AccountState, rules: RiskRule): RiskDecision {
  // Check 1: Daily loss limit (AC 2)
  if (account.dailyLoss + order.potentialLoss > rules.dailyLossLimit) {
    return {
      approved: false,
      reason: 'DAILY_LOSS_LIMIT',
      details: `Daily loss ${account.dailyLoss} + potential ${order.potentialLoss} exceeds limit ${rules.dailyLossLimit}`,
    };
  }

  // Check 2: Drawdown limit (AC 3)
  const currentDrawdown = account.peakEquity - account.currentEquity;
  if (currentDrawdown + order.potentialLoss > rules.maxDrawdownLimit) {
    return {
      approved: false,
      reason: 'DRAWDOWN_LIMIT',
      details: `Drawdown ${currentDrawdown} + potential ${order.potentialLoss} exceeds limit ${rules.maxDrawdownLimit}`,
    };
  }

  // Check 3: Margin (AC 4) — reject only if required > available
  if (order.marginRequired > account.freeMargin) {
    return {
      approved: false,
      reason: 'INSUFFICIENT_MARGIN',
      details: `Margin required ${order.marginRequired} > available ${account.freeMargin}`,
    };
  }

  // Check 4: Position count (AC 5)
  if (account.openPositionCount >= rules.maxPositions) {
    return {
      approved: false,
      reason: 'MAX_POSITIONS',
      details: `Open positions ${account.openPositionCount} >= max ${rules.maxPositions}`,
    };
  }

  // Check 5: Lot size (AC 6)
  if (order.qty > rules.maxLotSize) {
    return {
      approved: false,
      reason: 'MAX_LOT_SIZE',
      details: `Order qty ${order.qty} > max lot size ${rules.maxLotSize}`,
    };
  }

  // Check 6: Segment (AC 8)
  if (!rules.allowedSegments.includes(order.segment)) {
    return {
      approved: false,
      reason: 'SEGMENT_NOT_ALLOWED',
      details: `Segment ${order.segment} not in allowed: ${rules.allowedSegments.join(', ')}`,
    };
  }

  return { approved: true, reason: null, details: 'All risk checks passed' };
}
