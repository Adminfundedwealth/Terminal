/**
 * MARKET DATA ENGINE
 * 
 * Aggregates real-time market data from broker feeds.
 * Distributes to: WebSocket clients, Position Engine (MTM), Chart.
 * 
 * Architecture:
 *   Broker WebSocket Feed → MarketDataEngine → Redis Cache → WS Server → Frontend
 */

import type {
  Quote,
  OHLC,
  OHLCRequest,
  MarketDepth,
  OptionChainEntry,
  OptionChainRequest,
  Instrument,
  QuoteCallback,
  DepthCallback,
} from '../types/index.js';

export interface IMarketDataEngine {
  /**
   * Initialize the engine. Connect to broker feeds.
   */
  initialize(): Promise<void>;

  /**
   * Shutdown cleanly.
   */
  shutdown(): Promise<void>;

  /**
   * Subscribe to real-time quotes for given tokens.
   * Callback fires on every tick.
   */
  subscribeQuotes(tokens: string[], callback: QuoteCallback): void;

  /**
   * Unsubscribe from quotes.
   */
  unsubscribeQuotes(tokens: string[], callback: QuoteCallback): void;

  /**
   * Subscribe to Level 2 market depth.
   */
  subscribeDepth(tokens: string[], callback: DepthCallback): void;

  /**
   * Unsubscribe from depth.
   */
  unsubscribeDepth(tokens: string[], callback: DepthCallback): void;

  /**
   * Get latest cached quote for a token.
   */
  getQuote(token: string): Quote | undefined;

  /**
   * Get historical OHLC candles.
   */
  getOHLC(params: OHLCRequest): Promise<OHLC[]>;

  /**
   * Get full option chain for underlying+expiry.
   */
  getOptionChain(params: OptionChainRequest): Promise<OptionChainEntry[]>;

  /**
   * Get 5-level market depth snapshot.
   */
  getDepth(token: string): Promise<MarketDepth>;

  /**
   * Get all available expiry dates for a symbol.
   */
  getExpiries(symbol: string): Promise<string[]>;

  /**
   * Search instruments by query.
   */
  searchInstruments(query: string, segment?: string): Promise<Instrument[]>;

  /**
   * Get current market status.
   */
  getMarketStatus(): 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'POST_CLOSE';
}
