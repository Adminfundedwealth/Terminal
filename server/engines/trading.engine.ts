/**
 * TRADING ENGINE
 * 
 * Central order routing. Orchestrates the full order lifecycle:
 * 1. Receive order from frontend
 * 2. Run risk checks
 * 3. Run challenge rule checks
 * 4. Route to broker adapter
 * 5. Handle response
 * 6. Update position engine
 * 7. Log trade
 * 8. Post-trade risk evaluation
 * 
 * Called by: trading.routes.ts
 * Calls: RiskEngine, ChallengeEngine, BrokerAdapter, PositionEngine, ReportingEngine
 */

import type {
  OrderRequest,
  OrderResponse,
  ModifyOrderRequest,
  CancelResponse,
  RiskCheckResult,
} from '../types/index.js';

export interface ITradingEngine {
  /**
   * Place a new order. Full validation pipeline.
   * Returns order response or throws with rejection reason.
   */
  placeOrder(order: OrderRequest): Promise<OrderResponse>;

  /**
   * Modify an existing open order.
   */
  modifyOrder(accountId: string, orderId: string, params: ModifyOrderRequest): Promise<OrderResponse>;

  /**
   * Cancel an open order.
   */
  cancelOrder(accountId: string, orderId: string): Promise<CancelResponse>;

  /**
   * Exit a specific position (market order opposite side).
   */
  exitPosition(accountId: string, positionId: string): Promise<OrderResponse>;

  /**
   * Reverse a position (exit + enter opposite side same qty).
   */
  reversePosition(accountId: string, positionId: string): Promise<OrderResponse>;

  /**
   * Close all open positions for an account.
   * Used for: daily square-off, account breach, manual close-all.
   */
  closeAllPositions(accountId: string, reason: string): Promise<OrderResponse[]>;

  /**
   * Partial close — exit a portion of position qty.
   */
  partialClose(accountId: string, positionId: string, qty: number): Promise<OrderResponse>;
}
