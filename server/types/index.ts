// ============================================================
// BROKER INTERFACE — All brokers must implement this contract
// ============================================================

export interface IBrokerAdapter {
  readonly name: string;
  readonly isConnected: boolean;

  // Authentication
  connect(credentials: BrokerCredentials): Promise<BrokerSession>;
  disconnect(): Promise<void>;
  refreshSession(): Promise<BrokerSession>;

  // Market Data
  getQuotes(tokens: string[]): Promise<Quote[]>;
  getOHLC(params: OHLCRequest): Promise<OHLC[]>;
  getDepth(token: string): Promise<MarketDepth>;
  getOptionChain(params: OptionChainRequest): Promise<OptionChainEntry[]>;

  // Trading
  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, params: ModifyOrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<CancelResponse>;

  // Portfolio
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  getTrades(): Promise<Trade[]>;
  getFunds(): Promise<FundsData>;

  // Instruments
  getInstruments(): Promise<Instrument[]>;

  // Option Chain Build (most brokers lack direct OC API)
  getOptionInstruments(underlying: string, expiry: string): Promise<Instrument[]>;

  // Margin Calculation
  getMarginRequired(order: OrderRequest): Promise<{ required: number; available: number }>;

  // Holdings (CNC delivery, separate from positions)
  getHoldings(): Promise<any[]>;

  // Order Status Callbacks
  onOrderUpdate(callback: (order: Order) => void): void;

  // WebSocket Feed
  subscribeQuotes(tokens: string[], callback: QuoteCallback): void;
  subscribeDepth(tokens: string[], callback: DepthCallback): void;
  unsubscribe(tokens: string[]): void;
}

// ============================================================
// CREDENTIALS & SESSION
// ============================================================

export interface BrokerCredentials {
  provider: BrokerProvider;
  apiKey: string;
  clientId: string;
  password?: string;
  totpSecret?: string;
  accessToken?: string;
}

export interface BrokerSession {
  provider: BrokerProvider;
  clientId: string;
  token: string;
  refreshToken?: string;
  expiresAt: number;
}

export type BrokerProvider = 'angelone' | 'dhan' | 'upstox' | 'shoonya';

// ============================================================
// MARKET DATA TYPES
// ============================================================

export interface Quote {
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
}

export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCRequest {
  token: string;
  exchange: string;
  timeframe: Timeframe;
  from: Date;
  to: Date;
}

export type Timeframe = '1' | '3' | '5' | '15' | '30' | '60' | '240' | 'D' | 'W';

export interface MarketDepth {
  token: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  totalBuyQty: number;
  totalSellQty: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
  orders: number;
}

export interface OptionChainRequest {
  symbol: string;
  exchange: string;
  expiry: string;
}

export interface OptionChainEntry {
  strike: number;
  callToken: string;
  callLtp: number;
  callVolume: number;
  callOi: number;
  callOiChange: number;
  callIv: number;
  callDelta: number;
  callGamma: number;
  callTheta: number;
  callVega: number;
  putToken: string;
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

// ============================================================
// TRADING TYPES
// ============================================================

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
export type ProductType = 'MIS' | 'CNC' | 'NRML' | 'BO' | 'CO';
export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type Segment = 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'CDS' | 'BFO';

export interface OrderRequest {
  accountId: string;
  symbol: string;
  token: string;
  exchange: string;
  segment: Segment;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  qty: number;
  price?: number;
  triggerPrice?: number;
  targetPrice?: number;     // For bracket orders
  stoplossPrice?: number;   // For bracket orders
}

export interface OrderResponse {
  orderId: string;
  brokerOrderId: string;
  status: OrderStatus;
  message?: string;
}

export interface ModifyOrderRequest {
  qty?: number;
  price?: number;
  triggerPrice?: number;
  orderType?: OrderType;
}

export interface CancelResponse {
  orderId: string;
  status: 'cancelled' | 'failed';
  message?: string;
}

export interface Order {
  id: string;
  accountId: string;
  brokerOrderId: string;
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
  rejectReason?: string;
  placedAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  token: string;
  segment: Segment;
  productType: ProductType;
  qty: number;
  avgPrice: number;
  ltp: number;
  pnl: number;
  mtm: number;
  buyQty: number;
  sellQty: number;
  buyAvg: number;
  sellAvg: number;
}

export interface Trade {
  id: string;
  accountId: string;
  orderId: string;
  symbol: string;
  token: string;
  segment: Segment;
  side: OrderSide;
  qty: number;
  price: number;
  executedAt: string;
}

export interface FundsData {
  balance: number;
  availableMargin: number;
  usedMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

// ============================================================
// INSTRUMENT TYPES
// ============================================================

export interface Instrument {
  token: string;
  symbol: string;
  name: string;
  segment: Segment;
  exchange: string;
  instrumentType: 'EQ' | 'FUT' | 'CE' | 'PE';
  lotSize: number;
  tickSize: number;
  expiry?: string;
  strike?: number;
  optionType?: 'CE' | 'PE';
}

// ============================================================
// ACCOUNT & CHALLENGE TYPES
// ============================================================

export interface User {
  id: string;
  fwUserId: string;
  email: string;
  name: string;
  status: 'active' | 'suspended';
}

export interface Account {
  id: string;
  userId: string;
  accountCode: string;           // FW-10001
  challengeId: string;
  brokerProvider: BrokerProvider;
  brokerClientId: string;
  balance: number;
  status: 'active' | 'breached' | 'completed' | 'expired';
}

export interface Challenge {
  id: string;
  userId: string;
  type: 'evaluation' | 'funded';
  plan: string;                  // '10K' | '25K' | '50K' | '1L'
  initialBalance: number;
  status: 'active' | 'passed' | 'failed' | 'expired';
  startedAt: string;
  expiresAt?: string;
}

export interface RiskRule {
  id: string;
  accountId: string;
  ruleType: RiskRuleType;
  value: any;
  isActive: boolean;
}

export type RiskRuleType =
  | 'daily_loss_limit'
  | 'max_drawdown'
  | 'profit_target'
  | 'max_positions'
  | 'max_lot_size'
  | 'allowed_segments'
  | 'trading_hours'
  | 'no_overnight'
  | 'news_blackout'
  | 'max_daily_trades'
  | 'min_trading_days'
  | 'min_payout_days';

export interface AccountMetrics {
  id: string;
  accountId: string;
  date: string;
  startingBalance: number;
  endingBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdown: number;
  dailyLoss: number;
}

// ============================================================
// RISK ENGINE TYPES
// ============================================================

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  ruleType?: RiskRuleType;
  currentValue?: number;
  limitValue?: number;
}

export interface RiskAlert {
  type: 'warning' | 'breach';
  ruleType: RiskRuleType;
  message: string;
  currentValue: number;
  limitValue: number;
  percentUsed: number;
}

// ============================================================
// WEBSOCKET MESSAGE TYPES
// ============================================================

export type WSClientMessage =
  | { type: 'subscribe'; tokens: string[] }
  | { type: 'unsubscribe'; tokens: string[] }
  | { type: 'subscribe_depth'; tokens: string[] }
  | { type: 'unsubscribe_depth'; tokens: string[] }
  | { type: 'subscribe_oc'; symbol: string; expiry: string }
  | { type: 'ping' };

export type WSServerMessage =
  | { type: 'quote'; token: string; data: Quote }
  | { type: 'depth'; token: string; data: MarketDepth }
  | { type: 'order_update'; data: Order }
  | { type: 'position_update'; data: Position }
  | { type: 'risk_alert'; data: RiskAlert }
  | { type: 'market_status'; status: string }
  | { type: 'pong'; timestamp: number };

// ============================================================
// CALLBACK TYPES
// ============================================================

export type QuoteCallback = (token: string, quote: Quote) => void;
export type DepthCallback = (token: string, depth: MarketDepth) => void;

// ============================================================
// SSO / AUTH TYPES
// ============================================================

export interface SSOToken {
  token: string;
  userId: string;
  accountId: string;
  challengeId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionJWT {
  userId: string;
  accountId: string;
  challengeId: string;
  brokerProvider: BrokerProvider;
  permissions: string[];
  iat: number;
  exp: number;
}
