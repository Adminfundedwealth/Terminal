/**
 * ORDER MESSAGE HELPERS
 *
 * Centralises all order-related notification text so every panel uses the
 * same logic instead of hardcoded strings.
 *
 * Rule:
 *  - Paper mode (executionMode.isPaper === true OR account.challenge.type === 'paper'):
 *      show "(paper)" label
 *  - All other account types (funded, evaluation, instant, challenge, live):
 *      show clean success messages with NO paper indicator
 */

import type { AccountInfo } from '@/types';

// ─── Account-type guards ──────────────────────────────────────────────────────

/**
 * Returns true only when the account is explicitly a paper/demo account.
 * Every other type (funded, evaluation, instant, challenge, live, undefined)
 * is treated as a real/live account.
 */
export function isAccountPaper(account: AccountInfo | null | undefined): boolean {
  if (!account) return false;
  const type = account.challenge?.type?.toLowerCase() ?? '';
  // Only flag as paper when the type explicitly says so
  return type === 'paper' || type === 'demo' || type === 'virtual';
}

// ─── Message builder ──────────────────────────────────────────────────────────

interface OrderSuccessOptions {
  side: string;           // 'BUY' | 'SELL'
  qty: number;
  symbol: string;
  /** Pass the isPaper flag from TerminalStatus.executionMode.isPaper */
  isPaperMode?: boolean;
  /** Pass the current account so the helper can double-check account type */
  account?: AccountInfo | null;
}

/**
 * Returns the order success notification message.
 *
 * Live / funded / challenge / evaluation accounts:
 *   "BUY 1×NIFTY 50 order placed successfully."
 *
 * Paper accounts or paper execution mode:
 *   "BUY 1×NIFTY 50 placed (paper)"
 */
export function orderSuccessMessage(opts: OrderSuccessOptions): string {
  const { side, qty, symbol, isPaperMode = false, account } = opts;
  const paper = isPaperMode || isAccountPaper(account);

  if (paper) {
    return `${side} ${qty}×${symbol} placed (paper)`;
  }
  return `${side} ${qty}×${symbol} order placed successfully.`;
}

/**
 * Returns the order exit / close notification message.
 */
export function exitSuccessMessage(opts: {
  side: 'LONG' | 'SHORT';
  qty: number;
  symbol: string;
  isPaperMode?: boolean;
  account?: AccountInfo | null;
}): string {
  const { side, qty, symbol, isPaperMode = false, account } = opts;
  const paper = isPaperMode || isAccountPaper(account);
  const label = paper ? ' (paper)' : '';
  return `Exited ${side} ${qty}×${symbol}${label}`;
}
