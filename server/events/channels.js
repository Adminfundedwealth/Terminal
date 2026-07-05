/**
 * EVENT BUS CHANNELS — Schema Definitions
 * 
 * Each channel defines:
 *   - description: What this event represents
 *   - requiredFields: Fields that MUST be present in payload
 *   - scope: "global" (all clients) or "account" (per-account routing)
 *   - wsEvent: The WebSocket/Socket.IO event name sent to frontend
 *   - throttleMs: Minimum interval between emissions for same key (0 = no throttle)
 */

export const CHANNELS = {
  'market.tick': {
    description: 'LTP/quote update from broker feed or simulation',
    requiredFields: ['token', 'ltp', 'timestamp'],
    scope: 'global',
    wsEvent: 'quote',
    throttleMs: 0,
  },

  'order.created': {
    description: 'New order placed by user (before broker confirmation)',
    requiredFields: ['orderId', 'symbol', 'side', 'qty', 'orderType'],
    scope: 'account',
    wsEvent: 'order_update',
    throttleMs: 0,
  },

  'order.updated': {
    description: 'Order status changed (filled, partially filled, rejected, cancelled)',
    requiredFields: ['orderId', 'status'],
    scope: 'account',
    wsEvent: 'order_update',
    throttleMs: 0,
  },

  'position.updated': {
    description: 'Position P&L or quantity changed (from fill or MTM recalc)',
    requiredFields: ['symbol', 'token', 'qty', 'pnl'],
    scope: 'account',
    wsEvent: 'position_update',
    throttleMs: 250,
  },

  'trade.executed': {
    description: 'Trade fill confirmed from broker',
    requiredFields: ['tradeId', 'orderId', 'symbol', 'side', 'qty', 'price'],
    scope: 'account',
    wsEvent: 'trade_executed',
    throttleMs: 0,
  },

  'challenge.updated': {
    description: 'Challenge status or progress changed',
    requiredFields: ['challengeId', 'status'],
    scope: 'account',
    wsEvent: 'challenge_update',
    throttleMs: 1000,
  },

  'risk.alert': {
    description: 'Risk threshold warning or breach notification',
    requiredFields: ['type', 'ruleType', 'message'],
    scope: 'account',
    wsEvent: 'risk_alert',
    throttleMs: 5000,
  },

  'account.unlocked': {
    description: 'Account unlocked after daily loss lock (next trading day)',
    requiredFields: ['accountId', 'previousReason'],
    scope: 'account',
    wsEvent: 'account_unlocked',
    throttleMs: 0,
  },

  'account.locked': {
    description: 'Account locked due to rule violation',
    requiredFields: ['accountId', 'reason'],
    scope: 'account',
    wsEvent: 'account_locked',
    throttleMs: 0,
  },

  'account.breached': {
    description: 'Account permanently breached (max drawdown exceeded)',
    requiredFields: ['accountId', 'reason'],
    scope: 'account',
    wsEvent: 'account_breached',
    throttleMs: 0,
  },

  'risk.progress': {
    description: 'Live rule progress update (currentValue, allowedValue, status per rule)',
    requiredFields: ['accountId', 'rules'],
    scope: 'account',
    wsEvent: 'risk_progress',
    throttleMs: 2000,
  },

  'market.feedStatus': {
    description: 'Market data feed health status (live, stale, disconnected)',
    requiredFields: ['status', 'timestamp'],
    scope: 'global',
    wsEvent: 'feed_status',
    throttleMs: 5000,
  },

  'account.provisioned': {
    description: 'New trading account provisioned',
    requiredFields: ['tradingAccountId', 'plan', 'orderId'],
    scope: 'account',
    wsEvent: 'account_provisioned',
    throttleMs: 0,
  },
};


/**
 * Validate that a payload contains required fields for a channel.
 * @param {string} channel
 * @param {object} payload
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePayload(channel, payload) {
  const def = CHANNELS[channel];
  if (!def) return { valid: false, reason: `Unknown channel: ${channel}` };
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Payload must be a non-null object' };
  }

  for (const field of def.requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      return { valid: false, reason: `Missing required field: ${field}` };
    }
  }

  return { valid: true };
}

/**
 * Get all channel names.
 */
export function getChannelNames() {
  return Object.keys(CHANNELS);
}

/**
 * Get channel definition.
 */
export function getChannelDef(channel) {
  return CHANNELS[channel] || null;
}
