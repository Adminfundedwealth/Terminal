/**
 * MARGIN SERVICE
 * 
 * Calculates required margin for orders and tracks margin usage.
 * 
 * Margin Rules:
 *   - Equity Delivery (CNC): 100% of order value
 *   - Equity Intraday (MIS): 20% of order value
 *   - F&O (NRML): Exchange-defined lot margins
 *   - F&O Intraday (MIS): 40% of NRML margin
 *   - MCX: Hardcoded lot margins per commodity
 *   - CDS: Hardcoded per lot
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
   * Calculate required margin for an order.
   * @param {object} orderParams - { symbol, token, segment, side, orderType, productType, qty, price }
   * @param {function} quoteProvider - (token) => ltp
   * @returns {{ requiredMargin: number, marginType: string }}
   */
  static calculateOrderMargin(orderParams, quoteProvider = null) {
    const { symbol, token, segment, productType, qty, price } = orderParams;
    const ltp = price || (quoteProvider ? quoteProvider(token) : 0);

    if (!ltp || !qty) {
      return { requiredMargin: 0, marginType: 'unknown' };
    }

    let requiredMargin = 0;
    let marginType = '';

    switch (segment) {
      case 'NSE':
      case 'BSE': {
        // Equity segment
        const orderValue = ltp * qty;
        if (productType === 'CNC') {
          // Delivery: 100% margin
          requiredMargin = orderValue;
          marginType = 'delivery_100pct';
        } else {
          // Intraday (MIS): 20% of order value
          requiredMargin = orderValue * 0.20;
          marginType = 'equity_intraday_20pct';
        }
        break;
      }

      case 'NFO':
      case 'BFO': {
        // F&O segment
        const lotMargin = this._getFOLotMargin(symbol, token);
        const lotSize = this._getLotSize(symbol, segment);
        const lots = Math.ceil(qty / lotSize);

        if (productType === 'MIS') {
          requiredMargin = lotMargin * lots * MIS_MULTIPLIER;
          marginType = 'fo_intraday_40pct';
        } else {
          requiredMargin = lotMargin * lots;
          marginType = 'fo_nrml';
        }
        break;
      }

      case 'MCX': {
        // Commodity segment
        const mcxMargin = this._getMCXMargin(symbol);
        const mcxLotSize = this._getLotSize(symbol, segment);
        const mcxLots = Math.ceil(qty / mcxLotSize);

        if (productType === 'MIS') {
          requiredMargin = mcxMargin * mcxLots * MIS_MULTIPLIER;
          marginType = 'mcx_intraday';
        } else {
          requiredMargin = mcxMargin * mcxLots;
          marginType = 'mcx_nrml';
        }
        break;
      }

      case 'CDS': {
        // Currency derivatives
        const cdsMargin = this._getCDSMargin(symbol);
        const cdsLotSize = this._getLotSize(symbol, segment);
        const cdsLots = Math.ceil(qty / cdsLotSize);

        if (productType === 'MIS') {
          requiredMargin = cdsMargin * cdsLots * MIS_MULTIPLIER;
          marginType = 'cds_intraday';
        } else {
          requiredMargin = cdsMargin * cdsLots;
          marginType = 'cds_nrml';
        }
        break;
      }

      default: {
        // Fallback: 20% of order value
        requiredMargin = ltp * qty * 0.20;
        marginType = 'default_20pct';
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
   * @returns {number} Total margin locked
   */
  static async calculateUsedMargin(accountId, quoteProvider = null) {
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
      }, quoteProvider);

      totalUsed += requiredMargin;
    }

    return Math.round(totalUsed * 100) / 100;
  }

  /**
   * Get available margin for an account.
   * Available = balance - usedMargin
   */
  static async getAvailableMargin(accountId, balance, quoteProvider = null) {
    const usedMargin = await this.calculateUsedMargin(accountId, quoteProvider);
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
  static async validateMargin(accountId, orderParams, balance, quoteProvider = null) {
    const { requiredMargin } = this.calculateOrderMargin(orderParams, quoteProvider);
    const { availableMargin, usedMargin } = await this.getAvailableMargin(accountId, balance, quoteProvider);

    if (requiredMargin > availableMargin) {
      return {
        allowed: false,
        reason: `Insufficient margin. Required: ₹${requiredMargin.toLocaleString('en-IN')}, Available: ₹${availableMargin.toLocaleString('en-IN')} (Used: ₹${usedMargin.toLocaleString('en-IN')})`,
      };
    }

    return { allowed: true, requiredMargin, availableMargin };
  }

  // ─── Internal Helpers ──────────────────────────────────────

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

  static _getLotSize(symbol, segment) {
    const upper = (symbol || '').toUpperCase();
    switch (segment) {
      case 'NFO':
      case 'BFO':
        if (upper.includes('NIFTY') && !upper.includes('BANK') && !upper.includes('FIN') && !upper.includes('MID')) return 50;
        if (upper.includes('BANKNIFTY')) return 30;
        if (upper.includes('FINNIFTY')) return 40;
        if (upper.includes('MIDCPNIFTY')) return 50;
        return 1; // Stock F&O — lot size varies, use 1 as fallback
      case 'MCX':
        if (upper.includes('GOLDM')) return 10;
        if (upper.includes('GOLD')) return 100;
        if (upper.includes('SILVERM')) return 5;
        if (upper.includes('SILVER')) return 30;
        if (upper.includes('CRUDE')) return 100;
        if (upper.includes('NATURAL') || upper.includes('NG')) return 1250;
        if (upper.includes('COPPER')) return 2500;
        return 1;
      case 'CDS':
        return 1000;
      default:
        return 1;
    }
  }
}
