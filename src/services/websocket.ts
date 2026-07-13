import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import type { MarketQuote, MarketDepth } from '@/types';

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private subscribedTokens: Set<string> = new Set();
  private isConnecting = false;

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

        // Resubscribe to tokens
        if (this.subscribedTokens.size > 0) {
          this.send({
            type: 'subscribe',
            tokens: Array.from(this.subscribedTokens),
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  private handleMessage(data: any) {
    const store = useMarketStore.getState();
    const trading = useTradingStore.getState();

    switch (data.type) {
      case 'quote':
        store.updateQuote(data.token, data.data as Partial<MarketQuote>);
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
          trading.updatePosition(position.id, position);
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
        // Force account re-fetch so RiskOverlay fires immediately
        console.warn('[WS] account status event:', data.type, data.data || data);
        // Re-fetch account info to sync locked/breached state
        import('@/services/api').then(({ getAccount }) => {
          getAccount().then((acc) => trading.setAccount(acc)).catch(() => {});
        });
        break;
      }
      case 'account_unlocked': {
        import('@/services/api').then(({ getAccount }) => {
          getAccount().then((acc) => trading.setAccount(acc)).catch(() => {});
        });
        break;
      }
      case 'challenge_update':
      case 'risk_progress': {
        // Re-fetch account to sync challenge/risk progress
        import('@/services/api').then(({ getAccount }) => {
          getAccount().then((acc) => trading.setAccount(acc)).catch(() => {});
        });
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

  subscribe(tokens: string[]) {
    tokens.forEach((t) => this.subscribedTokens.add(t));
    tokens.forEach((t) => useMarketStore.getState().subscribe(t));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', tokens });
    }
  }

  unsubscribe(tokens: string[]) {
    tokens.forEach((t) => this.subscribedTokens.delete(t));
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
