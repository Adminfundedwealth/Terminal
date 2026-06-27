import { useEffect } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { wsService } from '@/services/websocket';

export function useMarketData(tokens: string[]) {
  const quotes = useMarketStore((s) => s.quotes);

  useEffect(() => {
    if (tokens.length === 0) return;
    wsService.subscribe(tokens);
    return () => {
      wsService.unsubscribe(tokens);
    };
  }, [tokens.join(',')]);

  return tokens.map((t) => quotes[t]).filter(Boolean);
}

export function useQuote(token: string | undefined) {
  const quotes = useMarketStore((s) => s.quotes);

  useEffect(() => {
    if (!token) return;
    wsService.subscribe([token]);
    return () => {
      wsService.unsubscribe([token]);
    };
  }, [token]);

  return token ? quotes[token] : undefined;
}

export function useDepth(token: string | undefined) {
  const depth = useMarketStore((s) => s.depth);

  useEffect(() => {
    if (!token) return;
    wsService.send({ type: 'subscribe_depth', tokens: [token] });

    // Also fetch depth via REST API as initial load / fallback
    // This ensures data shows even if WebSocket depth stream isn't active
    const fetchDepthRest = async () => {
      try {
        const resp = await fetch(`/api/market/depth?token=${token}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.bids?.length > 0 || data.asks?.length > 0)) {
            useMarketStore.getState().updateDepth(token, data);
          }
        }
      } catch { /* silent — WebSocket stream is the primary source */ }
    };
    fetchDepthRest();

    // Poll depth every 3 seconds as a fallback for instruments not on mode 3
    const interval = setInterval(fetchDepthRest, 3000);

    return () => {
      clearInterval(interval);
      wsService.send({ type: 'unsubscribe_depth', tokens: [token] });
    };
  }, [token]);

  return token ? depth[token] : undefined;
}
