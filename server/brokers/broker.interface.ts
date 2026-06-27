/**
 * BROKER ADAPTER INTERFACE
 * 
 * Every broker (Angel One, Dhan, Upstox, Shoonya) must implement this interface.
 * The terminal never calls broker APIs directly — always through this adapter.
 * 
 * Usage:
 *   const broker = BrokerFactory.create('angelone', credentials);
 *   await broker.connect(credentials);
 *   const positions = await broker.getPositions();
 */

import type {
  IBrokerAdapter,
  BrokerCredentials,
  BrokerSession,
  BrokerProvider,
  Quote,
  OHLC,
  OHLCRequest,
  MarketDepth,
  OptionChainRequest,
  OptionChainEntry,
  OrderRequest,
  OrderResponse,
  ModifyOrderRequest,
  CancelResponse,
  Position,
  Order,
  Trade,
  FundsData,
  Instrument,
  QuoteCallback,
  DepthCallback,
} from '../types/index.js';

export abstract class BaseBrokerAdapter implements IBrokerAdapter {
  abstract readonly name: string;
  protected session: BrokerSession | null = null;

  get isConnected(): boolean {
    if (!this.session) return false;
    return this.session.expiresAt > Date.now();
  }

  // === Authentication ===
  abstract connect(credentials: BrokerCredentials): Promise<BrokerSession>;
  abstract disconnect(): Promise<void>;
  abstract refreshSession(): Promise<BrokerSession>;

  // === Market Data ===
  abstract getQuotes(tokens: string[]): Promise<Quote[]>;
  abstract getOHLC(params: OHLCRequest): Promise<OHLC[]>;
  abstract getDepth(token: string): Promise<MarketDepth>;
  abstract getOptionChain(params: OptionChainRequest): Promise<OptionChainEntry[]>;

  // === Trading ===
  abstract placeOrder(order: OrderRequest): Promise<OrderResponse>;
  abstract modifyOrder(orderId: string, params: ModifyOrderRequest): Promise<OrderResponse>;
  abstract cancelOrder(orderId: string): Promise<CancelResponse>;

  // === Portfolio ===
  abstract getPositions(): Promise<Position[]>;
  abstract getOrders(): Promise<Order[]>;
  abstract getTrades(): Promise<Trade[]>;
  abstract getFunds(): Promise<FundsData>;

  // === Instruments ===
  abstract getInstruments(): Promise<Instrument[]>;

  // === Option Chain Build (most brokers lack direct OC API) ===
  abstract getOptionInstruments(underlying: string, expiry: string): Promise<Instrument[]>;

  // === Margin Calculation ===
  abstract getMarginRequired(order: OrderRequest): Promise<{ required: number; available: number }>;

  // === Holdings (CNC delivery) ===
  abstract getHoldings(): Promise<any[]>;

  // === Order Status Callbacks ===
  abstract onOrderUpdate(callback: (order: Order) => void): void;

  // === Real-time Feed ===
  abstract subscribeQuotes(tokens: string[], callback: QuoteCallback): void;
  abstract subscribeDepth(tokens: string[], callback: DepthCallback): void;
  abstract unsubscribe(tokens: string[]): void;
}
