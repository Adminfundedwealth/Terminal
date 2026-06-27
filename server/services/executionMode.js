/**
 * EXECUTION MODE — Production Safety Layer
 * 
 * Controls whether the terminal can submit real orders to the broker.
 * 
 * Modes:
 *   'paper'  — Orders are validated, persisted, and simulated. NOT sent to broker.
 *   'live'   — Orders are sent to the real broker. REAL MONEY AT RISK.
 * 
 * Default: 'paper' — safe until explicitly switched to live.
 * 
 * To switch to live mode:
 *   1. Set EXECUTION_MODE=live in server/.env
 *   2. Ensure LIVE_TRADING_ALLOWED=true is also set (double gate)
 *   3. Restart server
 * 
 * The double-gate prevents accidental live trading from a single misconfiguration.
 */

const EXECUTION_MODE = process.env.EXECUTION_MODE || 'paper';
const LIVE_TRADING_ALLOWED = process.env.LIVE_TRADING_ALLOWED === 'true';

export class ExecutionMode {
  static get mode() {
    return EXECUTION_MODE;
  }

  static get isLive() {
    return EXECUTION_MODE === 'live' && LIVE_TRADING_ALLOWED;
  }

  static get isPaper() {
    return !this.isLive;
  }

  /**
   * Get full execution state for API / frontend visibility.
   */
  static getState() {
    return {
      mode: this.isPaper ? 'paper' : 'live',
      configuredMode: EXECUTION_MODE,
      liveAllowed: LIVE_TRADING_ALLOWED,
      isLive: this.isLive,
      isPaper: this.isPaper,
      reason: this.isPaper
        ? (EXECUTION_MODE === 'live' && !LIVE_TRADING_ALLOWED
          ? 'LIVE_TRADING_ALLOWED not set — safety gate active'
          : 'EXECUTION_MODE is paper')
        : 'Live trading enabled',
    };
  }

  /**
   * Guard that rejects order submission in paper mode.
   * Call before sending to broker adapter.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  static validateExecution() {
    if (this.isPaper) {
      return {
        allowed: false,
        reason: 'Terminal is in PAPER mode. Order was validated and simulated but NOT sent to broker.',
      };
    }
    return { allowed: true };
  }
}
