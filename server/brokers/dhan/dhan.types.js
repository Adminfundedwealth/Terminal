/**
 * DHAN TYPES & CONSTANTS
 * 
 * Exchange segment mapping, order type conversion,
 * and security ID mappings for Dhan API v2.
 */

// Dhan exchange segment codes
export const DHAN_SEGMENTS = {
  NSE_EQ: 'NSE_EQ',
  NSE_FNO: 'NSE_FNO',
  BSE_EQ: 'BSE_EQ',
  BSE_FNO: 'BSE_FNO',
  MCX_COMM: 'MCX_COMM',
  CUR: 'CUR',
};

// Map our segment codes to Dhan's
export const SEGMENT_MAP = {
  'NSE': 'NSE_EQ',
  'BSE': 'BSE_EQ',
  'NFO': 'NSE_FNO',
  'BFO': 'BSE_FNO',
  'MCX': 'MCX_COMM',
  'CDS': 'CUR',
};

// Dhan product types
export const DHAN_PRODUCT_TYPES = {
  'MIS': 'INTRADAY',
  'CNC': 'CNC',
  'NRML': 'MARGIN',
  'BO': 'BO',
  'CO': 'CO',
};

// Dhan order types
export const DHAN_ORDER_TYPES = {
  'MARKET': 'MARKET',
  'LIMIT': 'LIMIT',
  'SL': 'STOP_LOSS',
  'SL-M': 'STOP_LOSS_MARKET',
};

// Dhan order statuses
export const DHAN_STATUS_MAP = {
  'TRANSIT': 'PENDING',
  'PENDING': 'OPEN',
  'TRADED': 'FILLED',
  'CANCELLED': 'CANCELLED',
  'REJECTED': 'REJECTED',
  'EXPIRED': 'CANCELLED',
};

// Dhan underlying security IDs (for option chain)
export const DHAN_UNDERLYING_IDS = {
  'NIFTY': '13',
  'NIFTY 50': '13',
  'BANKNIFTY': '25',
  'NIFTY BANK': '25',
  'FINNIFTY': '27',
  'NIFTY FIN SERVICE': '27',
  'MIDCPNIFTY': '442',
  'NIFTY MIDCAP SELECT': '442',
  'SENSEX': '51',
};

// Angel One token → Dhan security ID mapping (common indices/stocks)
// These are used by the DataProviderSwitch when routing Angel token requests to Dhan
export const ANGEL_TO_DHAN_MAP = {
  // Indices
  '99926000': '13',     // NIFTY 50
  '99926009': '25',     // BANKNIFTY
  '99926037': '27',     // FINNIFTY
  '99926074': '442',    // MIDCPNIFTY
  '99919000': '51',     // SENSEX
  // NIFTY 50 top stocks (Angel token → Dhan securityId)
  '2885': '2885',       // RELIANCE
  '3045': '3045',       // SBIN
  '1333': '1333',       // HDFCBANK
  '11536': '11536',     // TCS
  '1594': '1594',       // INFY
  '317': '317',         // BAJFINANCE
  '5633': '5633',       // MARUTI
  '11483': '11483',     // NTPC
  '3787': '3787',       // TECHM
  '2031': '2031',       // KOTAKBANK
};

// Dhan timeframe intervals (intraday)
export const DHAN_INTERVALS = {
  '1': '1',
  '5': '5',
  '15': '15',
  '25': '25',
  '60': '60',
};

// Dhan historical intervals
export const DHAN_HISTORICAL_INTERVALS = {
  'DAY': 'DAY',
};
