import { useEffect } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { wsService } from '@/services/websocket';

const depthFetches = new Map<string, Promise<void>>();

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

    let cancelled = false;
    const controller = new AbortController();

    const fetchDepthRest = async () => {
      const key = `depth:${token}`;
      if (depthFetches.has(key)) return;

      const task = (async () => {
        try {
          const resp = await fetch(`/api/market/depth?token=${token}`, { signal: controller.signal, credentials: 'include' });
          if (!resp.ok || cancelled) return;
          const data = await resp.json();
          if (data && (data.bids?.length > 0 || data.asks?.length > 0)) {
            useMarketStore.getState().updateDepth(token, data);
          }
        } catch {
          // silent — WebSocket stream is the primary source
        }
      })();

      depthFetches.set(key, task.finally(() => depthFetches.delete(key)));
      await task;
    };

    fetchDepthRest();

    const interval = setInterval(() => {
      if (!cancelled) fetchDepthRest();
    }, 3000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      wsService.send({ type: 'unsubscribe_depth', tokens: [token] });
    };
  }, [token]);

  return token ? depth[token] : undefined;
}
