/**
 * ORDER MESSAGE HELPERS
 *
 * Centralises all order-related notification text.
 * Funded / evaluation / challenge / instant / live accounts NEVER see "(paper)".
 */

// ─── Message builders ─────────────────────────────────────────────────────────

/**
 * Returns a clean order success message — no paper label, ever.
 *   "BUY 1×NIFTY 50 order placed successfully."
 */
export function orderSuccessMessage(opts: {
  side: string;
  qty: number;
  symbol: string;
}): string {
  const { side, qty, symbol } = opts;
  return `${side} ${qty}×${symbol} order placed successfully.`;
}

/**
 * Returns a clean exit message — no paper label, ever.
 *   "Exited LONG 1×NIFTY 50"
 */
export function exitSuccessMessage(opts: {
  side: 'LONG' | 'SHORT';
  qty: number;
  symbol: string;
}): string {
  const { side, qty, symbol } = opts;
  return `Exited ${side} ${qty}×${symbol}`;
}
