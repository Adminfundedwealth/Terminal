/**
 * MARGIN SERVICE
 * 
 * Calculates required margin for orders and tracks margin usage.
 * 
 * Margin Rules:
 *   - Equity Delivery (CNC): 100% of order value
 *   - Equity Intraday (MIS): 20% of order value (or leverage-adjusted)
 *   - F&O (NRML): Exchange-defined lot margins (leverage-adjusted for prop-firm accounts)
 *   - F&O Intraday (MIS): 40% of NRML margin (leverage-adjusted)
 *   - F&O Option BUY: Premium only (qty × LTP) — no SPAN margin
 *   - MCX: Hardcoded lot margins per commodity (leverage-adjusted)
 *   - CDS: Hardcoded per lot (leverage-adjusted)
 * 
 * Prop-firm Leverage:
 *   When an account has intraday leverage (e.g. 5x, 10x, 50x), the margin
 *   requirement is reduced by that factor:
 *     effectiveMargin = baseMargin / leverageMultiplier
 *   
 *   Option BUY orders only require the premium amount (qty × LTP), regardless
 *   of leverage settings, since max loss is capped at premium paid.
 * 
 * Available Margin = account.balance - sum(margin used by open positions)
 */

import { supabase } from '../db/client.js';

// Default lot margins (₹) — used when exchange margin data unavailable
const LOT_MARGINS = {
  // Index Futures
  'NIFTY': 100000,
  'BANKNIFTY': 100000,
  'FINNIFTY': 50000,
  'MIDCPNIFTY': 50000,
  // Index Options (approximate SPAN)
  'NIFTY_OPT': 50000,
  'BANKNIFTY_OPT': 50000,
  'FINNIFTY_OPT': 30000,
  // Stock Futures (approximate)
  'STOCK_FUT': 150000,
  // MCX
  'GOLD': 500000,
  'GOLDM': 25000,
  'SILVER': 150000,
  'SILVERM': 50000,
  'CRUDEOIL': 400000,
  'NATURALGAS': 200000,
  'COPPER': 100000,
  // CDS
  'USDINR': 25000,
  'EURINR': 30000,
  'GBPINR': 30000,
  'JPYINR': 25000,
};

// MIS margin multiplier (intraday gets reduced margin)
const MIS_MULTIPLIER = 0.4;

export class MarginService {
  /**
   * DhanHistoricalService reference — injected via setHistoricalService().
   * null until server/index.js calls MarginService.setHistoricalService()
   * during startup. _getLotSize() falls back to hardcoded values when null.
   * @type {import('../brokers/dhan/dhan.historical.js').DhanHistoricalService|null}
   */
  static _historicalService = null;

  /**
   * Calculate required margin for an order.
   * @param {object} orderParams - { symbol, token, segment, side, orderType, productType, qty, price }
   * @param {function} quoteProvider - (token) => ltp
   * @param {object} [account] - Account object with leverage_max or leverage settings
   * @returns {{ requiredMargin: number, marginType: string }}
   */
  static calculateOrderMargin(orderParams, quoteProvider = null, account = null) {
    const { symbol, token, segment, productType, qty, price, side } = orderParams;
    const ltp = price || (quoteProvider ? quoteProvider(token) : 0);

    if (!ltp || !qty) {
      return { requiredMargin: 0, marginType: 'unknown' };
    }

    // ── Determine leverage multiplier from account/risk-profile ──
    // Prop-firm accounts get reduced margin based on their leverage setting.
    // Default: 1 (no leverage discount — full exchange margin).
    const leverageMax = this._getAccountLeverage(account);

    let requiredMargin = 0;
    let marginType = '';

    switch (segment) {
      case 'NSE':
      case 'BSE': {
        // Equity segment
        const orderValue = ltp * qty;
        if (productType === 'CNC') {
          // Delivery: 100% margin (no leverage on delivery)
          requiredMargin = orderValue;
          marginType = 'delivery_100pct';
        } else {
          // Intraday (MIS): leverage-adjusted
          // With leverage_max=5 → 20% margin; leverage_max=10 → 10% margin; leverage_max=50 → 2%
          requiredMargin = orderValue / leverageMax;
          marginType = `equity_intraday_${leverageMax}x`;
        }
        break;
      }

      case 'NFO':
      case 'BFO': {
        // F&O segment
        const isOption = this._isOptionSymbol(symbol, orderParams);
        const isBuySide = (side || '').toUpperCase() === 'BUY';

        if (isOption && isBuySide) {
          // Option BUY: Premium only (max loss = premium paid)
          // No SPAN margin needed — just the cost of the option
          requiredMargin = ltp * qty;
          marginType = 'option_buy_premium';
        } else if (isOption && !isBuySide) {
          // Option SELL (writing): requires SPAN margin with leverage discount
          const lotMargin = this._getFOLotMargin(symbol, token);
          const lotSize = this._getLotSize(symbol, segment);
          const lots = Math.ceil(qty / lotSize);
          const baseMargin = lotMargin * lots;

          if (productType === 'MIS') {
            requiredMargin = (baseMargin * MIS_MULTIPLIER) / leverageMax;
            marginType = `fo_option_sell_intraday_${leverageMax}x`;
          } else {
            requiredMargin = baseMargin / leverageMax;
            marginType = `fo_option_sell_nrml_${leverageMax}x`;
          }
        } else {
          // Futures: use lot-based margin with leverage discount
          const lotMargin = this._getFOLotMargin(symbol, token);
          const lotSize = this._getLotSize(symbol, segment);
          const lots = Math.ceil(qty / lotSize);
          const baseMargin = lotMargin * lots;

          if (productType === 'MIS') {
            requiredMargin = (baseMargin * MIS_MULTIPLIER) / leverageMax;
            marginType = `fo_futures_intraday_${leverageMax}x`;
          } else {
            requiredMargin = baseMargin / leverageMax;
            marginType = `fo_futures_nrml_${leverageMax}x`;
          }
        }
        break;
      }

      case 'MCX': {
        // Commodity segment
        const mcxMargin = this._getMCXMargin(symbol);
        const mcxLotSize = this._getLotSize(symbol, segment);
        const mcxLots = Math.ceil(qty / mcxLotSize);

        const baseMargin = mcxMargin * mcxLots;

        if (productType === 'MIS') {
          requiredMargin = (baseMargin * MIS_MULTIPLIER) / leverageMax;
          marginType = `mcx_intraday_${leverageMax}x`;
        } else {
          requiredMargin = baseMargin / leverageMax;
          marginType = `mcx_nrml_${leverageMax}x`;
        }
        break;
      }

      case 'CDS': {
        // Currency derivatives
        const cdsMargin = this._getCDSMargin(symbol);
        const cdsLotSize = this._getLotSize(symbol, segment);
        const cdsLots = Math.ceil(qty / cdsLotSize);

        const baseMargin = cdsMargin * cdsLots;

        if (productType === 'MIS') {
          requiredMargin = (baseMargin * MIS_MULTIPLIER) / leverageMax;
          marginType = `cds_intraday_${leverageMax}x`;
        } else {
          requiredMargin = baseMargin / leverageMax;
          marginType = `cds_nrml_${leverageMax}x`;
        }
        break;
      }

      default: {
        // Fallback: leverage-adjusted
        requiredMargin = (ltp * qty) / leverageMax;
        marginType = `default_${leverageMax}x`;
      }
    }

    return {
      requiredMargin: Math.round(requiredMargin * 100) / 100,
      marginType,
    };
  }

  /**
   * Calculate total margin used by open positions.
   * @param {string} accountId
   * @param {function} quoteProvider - (token) => ltp
   * @param {object} [account] - Account object with leverage settings
   * @returns {number} Total margin locked
   */
  static async calculateUsedMargin(accountId, quoteProvider = null, account = null) {
    if (!supabase) return 0;

    const { data: positions, error } = await supabase
      .from('positions')
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('is_open', true);

    if (error || !positions || positions.length === 0) return 0;

    let totalUsed = 0;

    for (const pos of positions) {
      if (!pos.qty || pos.qty === 0) continue;

      const absQty = Math.abs(pos.qty);
      const ltp = quoteProvider ? quoteProvider(pos.token) : pos.avg_price;
      const segment = pos.segment || 'NSE';
      const productType = pos.product_type || 'MIS';

      const { requiredMargin } = this.calculateOrderMargin({
        symbol: pos.symbol,
        token: pos.token,
        segment,
        productType,
        qty: absQty,
        price: ltp || pos.avg_price,
        side: pos.side,
      }, quoteProvider, account);

      totalUsed += requiredMargin;
    }

    return Math.round(totalUsed * 100) / 100;
  }

  /**
   * Get available margin for an account.
   * Available = balance - usedMargin
   */
  static async getAvailableMargin(accountId, balance, quoteProvider = null, account = null) {
    const usedMargin = await this.calculateUsedMargin(accountId, quoteProvider, account);
    return {
      balance,
      usedMargin,
      availableMargin: Math.max(0, balance - usedMargin),
    };
  }

  /**
   * Validate if account has sufficient margin for an order.
   * Returns { allowed: true } or { allowed: false, reason: "..." }
   */
  static async validateMargin(accountId, orderParams, balance, quoteProvider = null, account = null) {
    const { requiredMargin } = this.calculateOrderMargin(orderParams, quoteProvider, account);
    const { availableMargin, usedMargin } = await this.getAvailableMargin(accountId, balance, quoteProvider, account);

    if (requiredMargin > availableMargin) {
      return {
        allowed: false,
        reason: `Insufficient margin. Required: ₹${requiredMargin.toLocaleString('en-IN')}, Available: ₹${availableMargin.toLocaleString('en-IN')} (Used: ₹${usedMargin.toLocaleString('en-IN')})`,
      };
    }

    return { allowed: true, requiredMargin, availableMargin };
  }

  // ─── Internal Helpers ──────────────────────────────────────

  /**
   * Extract the effective leverage multiplier from an account's risk profile.
   * Sources (priority order):
   *   1. account.leverage_max (from instant/flash/2-step risk profile)
   *   2. account.risk_profile?.leverage_max
   *   3. account.challenge?.leverage_max
   *   4. Default: 10 (standard prop-firm intraday leverage)
   *
   * For prop-firm accounts, typical values:
   *   - 5x  → conservative (20% margin)
   *   - 10x → standard prop-firm intraday (10% margin)
   *   - 20x → aggressive intraday (5% margin)
   *   - 50x → flash challenge (2% margin)
   *   - Option BUY always uses premium-only regardless of this value.
   *
   * @param {object|null} account
   * @returns {number} leverage multiplier (minimum 1)
   */
  static _getAccountLeverage(account) {
    if (!account) return 10; // Default prop-firm leverage (10x = 10% margin)

    const lev = account.leverage_max
      || account.risk_profile?.leverage_max
      || account.challenge?.leverage_max;

    // If no leverage configured at all, use 10x as standard prop-firm default
    if (!lev || lev <= 0) return 10;

    return Math.max(1, Number(lev) || 10);
  }

  static _getFOLotMargin(symbol, token) {
    // Check if it's an option (CE/PE in symbol)
    const isOption = /\d+(CE|PE)$/i.test(symbol);
    const baseSymbol = symbol.replace(/\d{2}[A-Z]{3}\d+[CP]E?$/i, '').replace(/FUT$/i, '').trim();

    if (isOption) {
      if (baseSymbol.includes('NIFTY') && !baseSymbol.includes('BANK') && !baseSymbol.includes('FIN') && !baseSymbol.includes('MID')) {
        return LOT_MARGINS['NIFTY_OPT'];
      }
      if (baseSymbol.includes('BANKNIFTY')) return LOT_MARGINS['BANKNIFTY_OPT'];
      if (baseSymbol.includes('FINNIFTY')) return LOT_MARGINS['FINNIFTY_OPT'];
      return LOT_MARGINS['NIFTY_OPT']; // Default option margin
    }

    // Futures
    if (baseSymbol.includes('NIFTY') && !baseSymbol.includes('BANK') && !baseSymbol.includes('FIN') && !baseSymbol.includes('MID')) {
      return LOT_MARGINS['NIFTY'];
    }
    if (baseSymbol.includes('BANKNIFTY')) return LOT_MARGINS['BANKNIFTY'];
    if (baseSymbol.includes('FINNIFTY')) return LOT_MARGINS['FINNIFTY'];
    if (baseSymbol.includes('MIDCPNIFTY')) return LOT_MARGINS['MIDCPNIFTY'];

    return LOT_MARGINS['STOCK_FUT'];
  }

  static _getMCXMargin(symbol) {
    const upper = (symbol || '').toUpperCase();
    if (upper.includes('GOLDM')) return LOT_MARGINS['GOLDM'];
    if (upper.includes('GOLD')) return LOT_MARGINS['GOLD'];
    if (upper.includes('SILVERM')) return LOT_MARGINS['SILVERM'];
    if (upper.includes('SILVER')) return LOT_MARGINS['SILVER'];
    if (upper.includes('CRUDE')) return LOT_MARGINS['CRUDEOIL'];
    if (upper.includes('NATURAL') || upper.includes('NG')) return LOT_MARGINS['NATURALGAS'];
    if (upper.includes('COPPER')) return LOT_MARGINS['COPPER'];
    return 100000; // Default MCX margin
  }

  static _getCDSMargin(symbol) {
    const upper = (symbol || '').toUpperCase();
    if (upper.includes('USD')) return LOT_MARGINS['USDINR'];
    if (upper.includes('EUR')) return LOT_MARGINS['EURINR'];
    if (upper.includes('GBP')) return LOT_MARGINS['GBPINR'];
    if (upper.includes('JPY')) return LOT_MARGINS['JPYINR'];
    return 25000;
  }

  /**
   * Determine if a symbol represents an option contract.
   * Checks multiple patterns: "24200CE", "NIFTY25AUG24200CE", etc.
   * Also checks orderParams.instrumentType if available.
   */
  static _isOptionSymbol(symbol, orderParams = {}) {
    if (orderParams.instrumentType === 'OPTIDX' || orderParams.instrumentType === 'OPTSTK' || orderParams.instrumentType === 'OPTFUT') {
      return true;
    }
    if (!symbol) return false;
    // Match CE/PE at end (with or without digits before)
    if (/\d+(CE|PE)$/i.test(symbol)) return true;
    // Match patterns like "NIFTY 24200 CE" or "NIFTY24200CE"
    if (/(CE|PE)\s*$/i.test(symbol)) return true;
    return false;
  }

  /**
   * Resolve lot size for a given symbol and segment.
   *
   * Source-of-truth chain (NFO / BFO):
   *   1. MarginService._historicalService.getLotSize(underlying)
   *      Injected at server startup via MarginService.setHistoricalService().
   *      Reads the SEM_LOT_UNITS value loaded from the Dhan scrip master by
   *      DhanHistoricalService._loadScripMaster().
   *   2. Hardcoded fallbacks — used ONLY on cold start before the scrip master
   *      has been downloaded. These are the Aug 2026 NSE values; they will
   *      auto-correct once setHistoricalService() is called.
   *
   * MCX and CDS lot sizes are NOT in the NSE scrip master; they keep their
   * existing hardcoded values which match exchange specifications.
   */

  /**
   * Inject the DhanHistoricalService so _getLotSize() can read current lot
   * sizes directly from the in-memory scrip master.
   *
   * Called once from server/index.js immediately after
   * futuresContractService.init(dhanAdapter.historical):
   *   MarginService.setHistoricalService(dhanAdapter.historical);
   *
   * Follows the same pattern as marketDataEngine.setLtpFallbacks().
   * Safe to call multiple times (idempotent — just overwrites the reference).
   *
   * @param {import('../brokers/dhan/dhan.historical.js').DhanHistoricalService} historicalSvc
   */
  static setHistoricalService(historicalSvc) {
    MarginService._historicalService = historicalSvc;
  }

  static _getLotSize(symbol, segment) {
    const upper = (symbol || '').toUpperCase();

    switch (segment) {
      case 'NFO':
      case 'BFO': {
        // Derive the canonical underlying name from the symbol.
        // Examples: 'NIFTY FUT' → 'NIFTY', 'BANKNIFTY FUT' → 'BANKNIFTY',
        //           'NIFTY-Aug2026-FUT' → 'NIFTY', 'RELIANCE FUT' → 'RELIANCE'
        const underlying = upper
          .replace(/\s+FUT(URES?)?$/i, '')   // strip " FUT" / " FUTURES" suffix
          .replace(/-[A-Z0-9]+-FUT$/i, '')   // strip Dhan tradingSymbol suffix
          .replace(/\s+\d+(CE|PE).*$/i, '')  // strip option strike suffix
          .trim();

        // Primary: scrip-master derived lot size via injected DhanHistoricalService.
        // Returns the SEM_LOT_UNITS value for this underlying, or 1 as fallback.
        const scraped = MarginService._historicalService?.getLotSize?.(underlying) || 0;
        if (scraped > 1) return scraped;

        // Cold-start fallback — setHistoricalService() not yet called (scrip
        // master still loading). Values from Aug 2026 NSE revision; will
        // auto-correct once setHistoricalService() is called at startup.
        if (upper.includes('MIDCPNIFTY'))                        return 120;
        if (upper.includes('BANKNIFTY'))                         return 30;
        if (upper.includes('FINNIFTY'))                          return 60;
        if (upper.includes('NIFTY') &&
            !upper.includes('BANK') &&
            !upper.includes('FIN')  &&
            !upper.includes('MID'))                              return 65;
        if (upper.includes('SENSEX') || upper.includes('BANKEX')) return 20;
        return 1; // Stock F&O — unknown lot size at cold start
      }

      case 'MCX':
        if (upper.includes('GOLDM'))                              return 10;
        if (upper.includes('GOLD'))                               return 100;
        if (upper.includes('SILVERM'))                            return 5;
        if (upper.includes('SILVER'))                             return 30;
        if (upper.includes('CRUDE'))                              return 100;
        if (upper.includes('NATURAL') || upper.includes('NG'))   return 1250;
        if (upper.includes('COPPER'))                             return 2500;
        return 1;

      case 'CDS':
        return 1000;

      default:
        return 1;
    }
  }
}
