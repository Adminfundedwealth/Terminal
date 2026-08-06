// Market Data Types
export type Segment = 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'CDS' | 'BFO';
export type InstrumentType = 'EQ' | 'FUT' | 'CE' | 'PE';
export type ProductType = 'CNC' | 'MIS' | 'NRML' | 'BO' | 'CO';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PENDING';

export interface Instrument {
  token: string;
  symbol: string;
  name: string;
  segment: Segment;
  instrumentType: InstrumentType;
  exchange: string;
  lotSize: number;
  tickSize: number;
  expiry?: string;
  strike?: number;
  optionType?: 'CE' | 'PE';
}

export interface MarketQuote {
  token: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  oi?: number;
  oiChange?: number;
  timestamp: number;
  lastTradeQty?: number;
  exchange?: string;
}

export interface MarketDepthLevel {
  price: number;
  qty: number;
  orders: number;
}

export interface MarketDepth {
  token: string;
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  totalBuyQty: number;
  totalSellQty: number;
}

export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  id: string;
  symbol: string;
  token: string;
  segment: Segment;
  productType: ProductType;
  side?: 'LONG' | 'SHORT';
  qty: number;
  avgPrice: number;
  ltp: number;
  pnl: number;
  mtm: number;
  buyQty: number;
  sellQty: number;
  buyAvg: number;
  sellAvg: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  breakEvenActivated?: boolean;
}

export interface Order {
  id: string;
  symbol: string;
  token: string;
  segment: Segment;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  qty: number;
  price: number;
  triggerPrice: number;
  filledQty: number;
  avgPrice: number;
  status: OrderStatus;
  timestamp: string;
  message?: string;
}

export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  token: string;
  segment: Segment;
  side: OrderSide;
  qty: number;
  price: number;
  timestamp: string;
  pnl?: number;        // realized P&L for this execution (FIFO-matched)
  cumPnl?: number;     // cumulative P&L for the symbol up to this trade
}

export interface WatchlistItem {
  token: string;
  symbol: string;
  segment: Segment;
}

export interface Watchlist {
  id: string;
  name: string;
  color: string;
  items: WatchlistItem[];
}

export interface OptionChainEntry {
  strike: number;
  callLtp: number;
  callVolume: number;
  callOi: number;
  callOiChange: number;
  callIv: number;
  callDelta: number;
  callGamma: number;
  callTheta: number;
  callVega: number;
  putLtp: number;
  putVolume: number;
  putOi: number;
  putOiChange: number;
  putIv: number;
  putDelta: number;
  putGamma: number;
  putTheta: number;
  putVega: number;
}

export interface AccountInfo {
  id?: string;
  accountCode?: string;
  clientId?: string; // Legacy alias for accountCode
  name?: string;
  email?: string;
  displayName?: string; // Legacy alias for name
  userId?: string;
  brokerProvider?: string;
  balance: number;
  peakBalance?: number;
  availableMargin?: number;
  usedMargin?: number;
  totalPnl?: number;
  status?: string;
  lockedReason?: string;
  challenge?: {
    id: string;
    type: string;
    plan: string;
    initialBalance: number;
    status: string;
    startedAt: string;
    expiresAt: string;
    profitTargetPct?: number;
    dailyLossLimitPct?: number;
    maxDrawdownPct?: number;
  } | null;
}

export type Theme = 'dark' | 'fw-blue' | 'light';
export type ChartType = 'candlestick' | 'hollow' | 'heikin-ashi' | 'area' | 'line' | 'renko';
export type Timeframe = '1' | '3' | '5' | '15' | '30' | '60' | '240' | 'D' | 'W';
export type ChartLayout = 'single' | '2h' | '2v' | '4' | '2-chart' | '4-chart' | '8-chart';

export interface HotkeyConfig {
  key: string;
  action: string;
  description: string;
}
