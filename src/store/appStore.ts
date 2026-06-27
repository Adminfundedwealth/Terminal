import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme, ChartLayout, Timeframe, ChartType, Watchlist, Instrument } from '@/types';

export type Workspace = 'index' | 'stocks' | 'futures' | 'options' | 'mcx' | 'cds';
export type TerminalLayout = 'standard' | 'dom' | 'options' | 'commodity' | 'currency' | 'compact';

interface PanelVisibility {
  watchlist: boolean;
  orderPanel: boolean;
  bottomPanel: boolean;
  marketDepth: boolean;
  optionChain: boolean;
}

interface AppState {
  theme: Theme;
  chartLayout: ChartLayout;
  timeframe: Timeframe;
  chartType: ChartType;
  activeSymbol: Instrument | null;
  watchlists: Watchlist[];
  activeWorkspace: Workspace;
  terminalLayout: TerminalLayout;
  showOptionChain: boolean;
  showMarketDepth: boolean;
  bottomTab: 'positions' | 'orders' | 'trades' | 'journal' | 'alerts' | 'analytics' | 'risk' | 'ai' | 'accounts' | 'activity' | 'scanner';
  searchOpen: boolean;
  panels: PanelVisibility;
  pinnedTokens: string[];
  activeWatchlistTab: string | null;

  setTheme: (theme: Theme) => void;
  setChartLayout: (layout: ChartLayout) => void;
  setTimeframe: (tf: Timeframe) => void;
  setChartType: (type: ChartType) => void;
  setActiveSymbol: (instrument: Instrument) => void;
  setWatchlists: (watchlists: Watchlist[]) => void;
  setActiveWorkspace: (ws: Workspace) => void;
  setTerminalLayout: (layout: TerminalLayout) => void;
  addToWatchlist: (watchlistId: string, item: { token: string; symbol: string; segment: any }) => void;
  removeFromWatchlist: (watchlistId: string, token: string) => void;
  setShowOptionChain: (show: boolean) => void;
  setShowMarketDepth: (show: boolean) => void;
  setBottomTab: (tab: AppState['bottomTab']) => void;
  setSearchOpen: (open: boolean) => void;
  togglePanel: (panel: keyof PanelVisibility) => void;
  setPinnedTokens: (tokens: string[]) => void;
  togglePinToken: (token: string) => void;
  setActiveWatchlistTab: (tab: string | null) => void;
}

const defaultWatchlists: Watchlist[] = [
  { id: 'index', name: 'INDEX', color: '#2962ff', items: [
    { token: '99926000', symbol: 'NIFTY 50', segment: 'NSE' },
    { token: '99926009', symbol: 'BANKNIFTY', segment: 'NSE' },
    { token: '99926037', symbol: 'FINNIFTY', segment: 'NSE' },
    { token: '99926074', symbol: 'MIDCPNIFTY', segment: 'NSE' },
    { token: '99919000', symbol: 'SENSEX', segment: 'BSE' },
  ]},
  { id: 'stocks', name: 'STOCKS', color: '#26a69a', items: [
    { token: '2885', symbol: 'RELIANCE', segment: 'NSE' },
    { token: '1333', symbol: 'HDFCBANK', segment: 'NSE' },
    { token: '4963', symbol: 'ICICIBANK', segment: 'NSE' },
    { token: '3045', symbol: 'SBIN', segment: 'NSE' },
    { token: '11536', symbol: 'TCS', segment: 'NSE' },
    { token: '1594', symbol: 'INFY', segment: 'NSE' },
    { token: '11630', symbol: 'ITC', segment: 'NSE' },
    { token: '5258', symbol: 'LT', segment: 'NSE' },
    { token: '317', symbol: 'AXISBANK', segment: 'NSE' },
  ]},
  { id: 'futures', name: 'FUTURES', color: '#ff9800', items: [
    { token: 'NF_FUT', symbol: 'NIFTY FUT', segment: 'NFO' },
    { token: 'BNF_FUT', symbol: 'BANKNIFTY FUT', segment: 'NFO' },
    { token: 'REL_FUT', symbol: 'RELIANCE FUT', segment: 'NFO' },
    { token: 'HDFC_FUT', symbol: 'HDFCBANK FUT', segment: 'NFO' },
    { token: 'SBIN_FUT', symbol: 'SBIN FUT', segment: 'NFO' },
  ]},
  { id: 'options', name: 'OPTIONS', color: '#ab47bc', items: [
    { token: '99926000', symbol: 'NIFTY', segment: 'NSE' },
    { token: '99926009', symbol: 'BANKNIFTY', segment: 'NSE' },
    { token: '99926037', symbol: 'FINNIFTY', segment: 'NSE' },
  ]},
  { id: 'mcx', name: 'MCX', color: '#f59e0b', items: [
    { token: 'GOLD_F', symbol: 'GOLD', segment: 'MCX' },
    { token: 'SILVER_F', symbol: 'SILVER', segment: 'MCX' },
    { token: 'CRUDE_F', symbol: 'CRUDEOIL', segment: 'MCX' },
    { token: 'NG_F', symbol: 'NATURALGAS', segment: 'MCX' },
    { token: 'COPPER_F', symbol: 'COPPER', segment: 'MCX' },
  ]},
  { id: 'cds', name: 'CDS', color: '#06b6d4', items: [
    { token: 'USDINR_F', symbol: 'USDINR', segment: 'CDS' },
    { token: 'EURINR_F', symbol: 'EURINR', segment: 'CDS' },
    { token: 'GBPINR_F', symbol: 'GBPINR', segment: 'CDS' },
    { token: 'JPYINR_F', symbol: 'JPYINR', segment: 'CDS' },
  ]},
];

// Default instruments per workspace (auto-load on workspace switch)
const workspaceDefaults: Record<Workspace, Instrument> = {
  index: { token: '99926000', symbol: 'NIFTY 50', name: 'Nifty 50', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
  stocks: { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
  futures: { token: 'NF_FUT', symbol: 'NIFTY FUT', name: 'Nifty Futures', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50, tickSize: 0.05, expiry: '2026-06-25' },
  options: { token: '99926000', symbol: 'NIFTY', name: 'Nifty 50', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
  mcx: { token: 'GOLD_F', symbol: 'GOLD', name: 'Gold Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 100, tickSize: 1, expiry: '2026-08-05' },
  cds: { token: 'USDINR_F', symbol: 'USDINR', name: 'USD/INR Futures', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-06-25' },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      chartLayout: 'single',
      timeframe: '5',
      chartType: 'candlestick',
      activeSymbol: workspaceDefaults.index,
      watchlists: defaultWatchlists,
      activeWorkspace: 'index',
      terminalLayout: 'standard',
      showOptionChain: false,
      showMarketDepth: false,
      bottomTab: 'positions',
      searchOpen: false,
      panels: { watchlist: true, orderPanel: true, bottomPanel: true, marketDepth: true, optionChain: false },
      pinnedTokens: [],
      activeWatchlistTab: null,

      setTheme: (theme) => {
        if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', theme);
        set({ theme });
      },
      setChartLayout: (chartLayout) => set({ chartLayout }),
      setTimeframe: (timeframe) => set({ timeframe }),
      setChartType: (chartType) => set({ chartType }),
      setActiveSymbol: (activeSymbol) => set({ activeSymbol }),
      setWatchlists: (watchlists) => set({ watchlists }),
      setActiveWorkspace: (ws) => {
        const defaultSymbol = workspaceDefaults[ws];
        const showOC = ws === 'options';
        const layout: TerminalLayout = ws === 'options' ? 'options' : ws === 'mcx' ? 'commodity' : ws === 'cds' ? 'currency' : 'standard';
        set({
          activeWorkspace: ws,
          activeSymbol: defaultSymbol,
          showOptionChain: showOC,
          terminalLayout: layout,
          panels: {
            watchlist: true,
            orderPanel: true,
            bottomPanel: true,
            marketDepth: ws === 'futures' || ws === 'mcx',
            optionChain: showOC,
          },
        });
      },
      setTerminalLayout: (terminalLayout) => set({ terminalLayout }),
      addToWatchlist: (watchlistId, item) =>
        set((state) => ({
          watchlists: state.watchlists.map((wl) =>
            wl.id === watchlistId
              ? { ...wl, items: [...wl.items.filter((i) => i.token !== item.token), item] }
              : wl
          ),
        })),
      removeFromWatchlist: (watchlistId, token) =>
        set((state) => ({
          watchlists: state.watchlists.map((wl) =>
            wl.id === watchlistId
              ? { ...wl, items: wl.items.filter((i) => i.token !== token) }
              : wl
          ),
        })),
      setShowOptionChain: (showOptionChain) => set({ showOptionChain }),
      setShowMarketDepth: (showMarketDepth) => set({ showMarketDepth }),
      setBottomTab: (bottomTab) => set({ bottomTab }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      togglePanel: (panel) => set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } })),
      setPinnedTokens: (pinnedTokens) => set({ pinnedTokens }),
      togglePinToken: (token) => set((state) => ({
        pinnedTokens: state.pinnedTokens.includes(token)
          ? state.pinnedTokens.filter((t) => t !== token)
          : [...state.pinnedTokens, token],
      })),
      setActiveWatchlistTab: (activeWatchlistTab) => set({ activeWatchlistTab }),
    }),
    {
      name: 'fw-terminal-v4',
      partialize: (state) => ({
        theme: state.theme,
        timeframe: state.timeframe,
        chartType: state.chartType,
        activeWorkspace: state.activeWorkspace,
        panels: state.panels,
        watchlists: state.watchlists,
        pinnedTokens: state.pinnedTokens,
        activeWatchlistTab: state.activeWatchlistTab,
      }),
    }
  )
);
