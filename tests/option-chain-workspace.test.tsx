import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/appStore';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, error: null }),
}));

vi.mock('@/hooks/useWatchlistSync', () => ({
  useWatchlistSync: () => undefined,
}));

vi.mock('@/hooks/useHotkeys', () => ({
  useHotkeys: () => undefined,
}));

vi.mock('@/services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

describe('Options workspace', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeWorkspace: 'options',
      activeSymbol: {
        token: '99926000',
        symbol: 'NIFTY',
        name: 'Nifty 50',
        segment: 'NSE',
        instrumentType: 'INDEX',
        exchange: 'NSE',
        lotSize: 1,
        tickSize: 0.05,
      },
      showOptionChain: false,
      panels: { watchlist: true, orderPanel: true, bottomPanel: true, marketDepth: true, optionChain: false },
      theme: 'dark',
    });
  });

  it('selects the dedicated Options workspace configuration', () => {
    useAppStore.getState().setActiveWorkspace('options');
    const state = useAppStore.getState();

    expect(state.activeWorkspace).toBe('options');
    expect(state.showOptionChain).toBe(true);
    expect(state.panels.optionChain).toBe(true);
  });
});
