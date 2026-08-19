import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { getAccount } from '@/services/api';
import type { MarketQuote, MarketDepth } from '@/types';

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 30;       // was 10 — now retries for much longer
  private reconnectDelay = 1000;
  private maxReconnectDelay = 15000;       // cap backoff at 15 seconds
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private subscribedTokens: Set<string> = new Set();
  // exchange hints: token → exchange (e.g. "NFO", "MCX", "CDS")
  // sent with every subscribe message so the server can forward to AngelFeed correctly
  private exchangeHints: Map<string, string> = new Map();
  private isConnecting = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Throttle account re-fetch to prevent flooding
  private _lastAccountFetch = 0;
  private _accountFetchThrottleMs = 5000;

  // ── Tick batching ──────────────────────────────────────────────────────────
  // Incoming quote ticks are buffered here and flushed to Zustand in a single
  // batchUpdateQuotes() call every TICK_FLUSH_MS milliseconds.  This collapses
  // N rapid ticks (e.g. 20+ tokens firing within one Dhan 3-second poll cycle)
  // into one React state update, eliminating the re-render storm that causes
  // the UI freeze/lag observed at live-market open.
  private _tickBuffer: Record<string, Partial<MarketQuote>> = {};
  private _tickFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly TICK_FLUSH_MS = 100; // flush window: 100 ms

  connect(url?: string) {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;

    this.isConnecting = true;
    const wsUrl = url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this._reconnectTimer = null;

        // Resubscribe to tokens (with exchange hints)
        if (this.subscribedTokens.size > 0) {
          const tokens = Array.from(this.subscribedTokens);
          const hints: Record<string, string> = {};
          tokens.forEach((t) => {
            const h = this.exchangeHints.get(t);
            if (h) hints[t] = h;
          });
          this.send({
            type: 'subscribe',
            tokens,
            ...(Object.keys(hints).length > 0 ? { exchangeHints: hints } : {}),
          });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.isConnecting = false;
      };
    } catch (e) {
      this.isConnecting = false;
      this.attemptReconnect();
    }
  }

  private attemptReconnect() {
    if (this._reconnectTimer) return; // already scheduled

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached — reload the page to reconnect');
      // Dispatch a custom event so the UI can show a "Reconnecting..." banner
      window.dispatchEvent(new CustomEvent('ws:dead'));
      return;
    }

    this.reconnectAttempts++;
    // Capped exponential backoff: 1s, 2s, 4s, 8s, 15s, 15s, ...
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(data: any) {
    const store = useMarketStore.getState();
    const trading = useTradingStore.getState();

    switch (data.type) {
      case 'quote':
        // Buffer the tick; flush to Zustand in one batch after TICK_FLUSH_MS.
        // This prevents one setState per tick, which causes full-tree re-renders
        // when 20–100 tokens are subscribed and the Dhan poller fires every 3s.
        this._enqueueQuoteTick(data.token, data.data as Partial<MarketQuote>);
        break;
      case 'depth':
        store.updateDepth(data.token, data.data as MarketDepth);
        break;
      case 'market_status':
        store.setMarketStatus(data.status);
        break;
      case 'feed_status':
        // Feed health broadcast — log but no store update needed
        if (data.data?.status === 'stale') {
          console.warn('[WS] Market data feed stale:', data.data);
        }
        break;
      // Real-time trading event updates — forwarded by EventBridge
      case 'order_update': {
        const order = data.data || data.order;
        if (order?.id) {
          // Update existing order or prepend if new
          const existing = trading.orders.find((o) => o.id === order.id);
          if (existing) {
            trading.updateOrder(order.id, order);
          } else {
            trading.addOrder(order);
          }
        }
        break;
      }
      case 'position_update': {
        const position = data.data || data.position;
        if (position?.id) {
          // Guard: do not overwrite a valid existing stopLoss/takeProfit with
          // null/undefined from a stale MTM broadcast. Only update if the
          // incoming value is a real number (> 0). A real update (e.g. user
          // removed their SL) would arrive as 0, not null/undefined.
          const existing = useTradingStore.getState().positions.find(
            (p) => p.id === position.id
          );
          const safeUpdate = { ...position };
          if ((position.stopLoss == null) && existing?.stopLoss) {
            delete safeUpdate.stopLoss;
          }
          if ((position.takeProfit == null) && existing?.takeProfit) {
            delete safeUpdate.takeProfit;
          }
          trading.updatePosition(position.id, safeUpdate);
        }
        break;
      }
      case 'trade_executed': {
        // Refresh trades list — push new trade to front if provided
        const trade = data.data || data.trade;
        if (trade) {
          trading.setTrades([trade, ...trading.trades].slice(0, 500));
        }
        break;
      }
      case 'risk_alert': {
        // Risk alerts are surfaced via RiskMonitor toasts & RiskWidget polling.
        // Log for debug — no store mutation needed here.
        console.warn('[WS] risk_alert received:', data.data || data);
        break;
      }
      case 'account_locked':
      case 'account_breached': {
        // Force account re-fetch so RiskOverlay fires immediately (throttled)
        console.warn('[WS] account status event:', data.type, data.data || data);
        this._throttledAccountFetch();
        break;
      }
      case 'account_unlocked': {
        this._throttledAccountFetch();
        break;
      }
      case 'challenge_update':
      case 'risk_progress': {
        // Re-fetch account to sync challenge/risk progress (throttled)
        this._throttledAccountFetch();
        break;
      }
    }

    // Notify handlers (allows components to subscribe to specific event types)
    const handlers = this.handlers.get(data.type);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }

    // Also fire wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler(data));
    }
  }

  // ── Tick batching helpers ─────────────────────────────────────────────────

  /**
   * Buffer one incoming quote tick.  A flush timer is armed on the first
   * tick of each window; subsequent ticks in the same window just overwrite
   * the previous buffered value for that token (last-write-wins — correct for
   * live prices where only the latest value matters).
   */
  private _enqueueQuoteTick(token: string, quote: Partial<MarketQuote>) {
    // Merge into buffer: if the same token ticks twice before the flush fires,
    // spread the new fields on top so no field from an earlier tick is lost.
    this._tickBuffer[token] = this._tickBuffer[token]
      ? { ...this._tickBuffer[token], ...quote }
      : quote;

    if (!this._tickFlushTimer) {
      this._tickFlushTimer = setTimeout(() => this._flushTickBuffer(), WebSocketService.TICK_FLUSH_MS);
    }
  }

  /** Flush all buffered quote ticks into Zustand in a single state transition. */
  private _flushTickBuffer() {
    this._tickFlushTimer = null;
    const batch = this._tickBuffer;
    if (Object.keys(batch).length === 0) return;
    this._tickBuffer = {};
    useMarketStore.getState().batchUpdateQuotes(batch);
  }

  private _throttledAccountFetch() {
    const now = Date.now();
    if (now - this._lastAccountFetch < this._accountFetchThrottleMs) return;
    this._lastAccountFetch = now;
    getAccount().then((acc) => useTradingStore.getState().setAccount(acc)).catch(() => {});
  }

  subscribe(tokens: string[], exchangeHints?: Record<string, string>) {
    tokens.forEach((t) => this.subscribedTokens.add(t));
    // Store exchange hints so they are resent on reconnect
    if (exchangeHints) {
      tokens.forEach((t) => {
        if (exchangeHints[t]) this.exchangeHints.set(t, exchangeHints[t]);
      });
    }
    tokens.forEach((t) => useMarketStore.getState().subscribe(t));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const hints: Record<string, string> = {};
      tokens.forEach((t) => {
        const h = this.exchangeHints.get(t);
        if (h) hints[t] = h;
      });
      this.send({ type: 'subscribe', tokens, ...(Object.keys(hints).length > 0 ? { exchangeHints: hints } : {}) });
    }
  }

  unsubscribe(tokens: string[]) {
    tokens.forEach((t) => {
      this.subscribedTokens.delete(t);
      this.exchangeHints.delete(t);
    });
    tokens.forEach((t) => useMarketStore.getState().unsubscribe(t));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', tokens });
    }
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    // Flush any pending tick batch before closing so nothing is silently dropped.
    if (this._tickFlushTimer) {
      clearTimeout(this._tickFlushTimer);
      this._flushTickBuffer();
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();
