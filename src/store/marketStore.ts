import { create } from 'zustand';
import type { MarketQuote, MarketDepth, OHLC } from '@/types';

interface MarketState {
  quotes: Record<string, MarketQuote>;
  depth: Record<string, MarketDepth>;
  subscribedTokens: Set<string>;
  marketStatus: 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'POST_CLOSE';

  updateQuote: (token: string, quote: Partial<MarketQuote>) => void;
  updateDepth: (token: string, depth: MarketDepth) => void;
  subscribe: (token: string) => void;
  unsubscribe: (token: string) => void;
  setMarketStatus: (status: MarketState['marketStatus']) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  quotes: {},
  depth: {},
  subscribedTokens: new Set(),
  marketStatus: 'CLOSED',

  updateQuote: (token, quote) =>
    set((state) => ({
      quotes: {
        ...state.quotes,
        [token]: { ...state.quotes[token], ...quote } as MarketQuote,
      },
    })),

  updateDepth: (token, depth) =>
    set((state) => ({
      depth: { ...state.depth, [token]: depth },
    })),

  subscribe: (token) =>
    set((state) => {
      const newSet = new Set(state.subscribedTokens);
      newSet.add(token);
      return { subscribedTokens: newSet };
    }),

  unsubscribe: (token) =>
    set((state) => {
      const newSet = new Set(state.subscribedTokens);
      newSet.delete(token);
      return { subscribedTokens: newSet };
    }),

  setMarketStatus: (status) => set({ marketStatus: status }),
}));
