/**
 * DHAN TYPES & CONSTANTS
 * 
 * Exchange segment mapping and order type conversion
 * for Dhan API v2.
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
