import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme, ChartLayout, Timeframe, ChartType, Watchlist, Instrument } from '@/types';
import { apiService } from '@/services/api';

// Helper to sync watchlist changes to backend (fire-and-forget)
async function syncWatchlistToBackend(watchlistId: string, watchlist: Watchlist | undefined) {
  if (!watchlist) return;
  try {
    await apiService.put(`/watchlists/${watchlistId}`, {
      name: watchlist.name,
      color: watchlist.color,
      items: watchlist.items,
    });
  } catch (err) {
    console.warn('[WatchlistSync] Failed to sync to backend:', err);
  }
}

export type Workspace = 'home' | 'index' | 'stocks' | 'futures' | 'options' | 'etf' | 'mcx' | 'cds' | 'ord' | 'wl' | 'dom' | 'btm' | 'calendar';
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
  bottomTab: 'positions' | 'orders' | 'trades' | 'journal' | 'alerts' | 'analytics' | 'risk' | 'ai' | 'accounts' | 'activity' | 'scanner' | 'admin';
  searchOpen: boolean;
  panels: PanelVisibility;
  pinnedTokens: string[];
  activeWatchlistTab: string | null;
  /** Remember last selected instrument per category workspace */
  lastInstrumentPerWorkspace: Partial<Record<Workspace, Instrument>>;

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
    { token: '1660', symbol: 'ITC', segment: 'NSE' },
    { token: '11483', symbol: 'LT', segment: 'NSE' },
    { token: '5900', symbol: 'AXISBANK', segment: 'NSE' },
    { token: '7229', symbol: 'HCLTECH', segment: 'NSE' },
    { token: '317', symbol: 'BAJFINANCE', segment: 'NSE' },
    { token: '1922', symbol: 'KOTAKBANK', segment: 'NSE' },
    { token: '3456', symbol: 'TATAMOTORS', segment: 'NSE' },
    { token: '3499', symbol: 'TATASTEEL', segment: 'NSE' },
    { token: '10999', symbol: 'MARUTI', segment: 'NSE' },
    { token: '3506', symbol: 'TITAN', segment: 'NSE' },
    // FIX: token '25' = BANKNIFTY (IDX_I) in Dhan. ADANIENT equity = scrip 25215 (NSE_EQ).
    { token: '25215', symbol: 'ADANIENT', segment: 'NSE' },
    { token: '15083', symbol: 'ADANIPORTS', segment: 'NSE' },
    { token: '383', symbol: 'BEL', segment: 'NSE' },
    { token: '2303', symbol: 'HAL', segment: 'NSE' },
    { token: '5097', symbol: 'ZOMATO', segment: 'NSE' },
    { token: '14732', symbol: 'DLF', segment: 'NSE' },
    { token: '881', symbol: 'SUNPHARMA', segment: 'NSE' },
    { token: '14977', symbol: 'POWERGRID', segment: 'NSE' },
    { token: '11630', symbol: 'NTPC', segment: 'NSE' },
    { token: '694', symbol: 'COALINDIA', segment: 'NSE' },
    { token: '467', symbol: 'BHARTIARTL', segment: 'NSE' },
    { token: '1410', symbol: 'TIINDIA', segment: 'NSE' },
    { token: '3718', symbol: 'VOLTAS', segment: 'NSE' },
    { token: '3787', symbol: 'WIPRO', segment: 'NSE' },
  ]},
  { id: 'futures', name: 'FUTURES', color: '#ff9800', items: [
    // Index Futures
    { token: 'NF_FUT', symbol: 'NIFTY FUT', segment: 'NFO' },
    { token: 'BNF_FUT', symbol: 'BANKNIFTY FUT', segment: 'NFO' },
    { token: 'FNF_FUT', symbol: 'FINNIFTY FUT', segment: 'NFO' },
    { token: 'MNF_FUT', symbol: 'MIDCPNIFTY FUT', segment: 'NFO' },
    { token: 'SNX_FUT', symbol: 'SENSEX FUT', segment: 'NFO' },
    // Stock Futures (all 30 F&O stocks)
    { token: 'REL_FUT', symbol: 'RELIANCE FUT', segment: 'NFO' },
    { token: 'HDFC_FUT', symbol: 'HDFCBANK FUT', segment: 'NFO' },
    { token: 'ICICI_FUT', symbol: 'ICICIBANK FUT', segment: 'NFO' },
    { token: 'SBIN_FUT', symbol: 'SBIN FUT', segment: 'NFO' },
    { token: 'TCS_FUT', symbol: 'TCS FUT', segment: 'NFO' },
    { token: 'INFY_FUT', symbol: 'INFY FUT', segment: 'NFO' },
    { token: 'ITC_FUT', symbol: 'ITC FUT', segment: 'NFO' },
    { token: 'LT_FUT', symbol: 'LT FUT', segment: 'NFO' },
    { token: 'AXIS_FUT', symbol: 'AXISBANK FUT', segment: 'NFO' },
    { token: 'HCL_FUT', symbol: 'HCLTECH FUT', segment: 'NFO' },
    { token: 'BAJF_FUT', symbol: 'BAJFINANCE FUT', segment: 'NFO' },
    { token: 'KOTAK_FUT', symbol: 'KOTAKBANK FUT', segment: 'NFO' },
    { token: 'TATAM_FUT', symbol: 'TATAMOTORS FUT', segment: 'NFO' },
    { token: 'TATAS_FUT', symbol: 'TATASTEEL FUT', segment: 'NFO' },
    { token: 'MARUTI_FUT', symbol: 'MARUTI FUT', segment: 'NFO' },
    { token: 'TITAN_FUT', symbol: 'TITAN FUT', segment: 'NFO' },
    { token: 'ADANIE_FUT', symbol: 'ADANIENT FUT', segment: 'NFO' },
    { token: 'ADANIP_FUT', symbol: 'ADANIPORTS FUT', segment: 'NFO' },
    { token: 'BEL_FUT', symbol: 'BEL FUT', segment: 'NFO' },
    { token: 'HAL_FUT', symbol: 'HAL FUT', segment: 'NFO' },
    { token: 'ZOMATO_FUT', symbol: 'ZOMATO FUT', segment: 'NFO' },
    { token: 'DLF_FUT', symbol: 'DLF FUT', segment: 'NFO' },
    { token: 'SUNP_FUT', symbol: 'SUNPHARMA FUT', segment: 'NFO' },
    { token: 'PWRGRD_FUT', symbol: 'POWERGRID FUT', segment: 'NFO' },
    { token: 'NTPC_FUT', symbol: 'NTPC FUT', segment: 'NFO' },
    { token: 'COAL_FUT', symbol: 'COALINDIA FUT', segment: 'NFO' },
    { token: 'BHARTI_FUT', symbol: 'BHARTIARTL FUT', segment: 'NFO' },
    { token: 'TIIN_FUT', symbol: 'TIINDIA FUT', segment: 'NFO' },
    { token: 'VOLTAS_FUT', symbol: 'VOLTAS FUT', segment: 'NFO' },
    { token: 'WIPRO_FUT', symbol: 'WIPRO FUT', segment: 'NFO' },
  ]},
  { id: 'options', name: 'OPTIONS', color: '#ab47bc', items: [
    // Index Options
    { token: '99926000', symbol: 'NIFTY', segment: 'NSE' },
    { token: '99926009', symbol: 'BANKNIFTY', segment: 'NSE' },
    { token: '99926037', symbol: 'FINNIFTY', segment: 'NSE' },
    { token: '99926074', symbol: 'MIDCPNIFTY', segment: 'NSE' },
    // Top Stock Options
    { token: '2885', symbol: 'RELIANCE', segment: 'NSE' },
    { token: '1333', symbol: 'HDFCBANK', segment: 'NSE' },
    { token: '4963', symbol: 'ICICIBANK', segment: 'NSE' },
    { token: '3045', symbol: 'SBIN', segment: 'NSE' },
    { token: '11536', symbol: 'TCS', segment: 'NSE' },
    { token: '1594', symbol: 'INFY', segment: 'NSE' },
    { token: '3456', symbol: 'TATAMOTORS', segment: 'NSE' },
    { token: '3499', symbol: 'TATASTEEL', segment: 'NSE' },
    { token: '317', symbol: 'BAJFINANCE', segment: 'NSE' },
    { token: '5900', symbol: 'AXISBANK', segment: 'NSE' },
    { token: '1660', symbol: 'ITC', segment: 'NSE' },
    { token: '11483', symbol: 'LT', segment: 'NSE' },
    { token: '7229', symbol: 'HCLTECH', segment: 'NSE' },
    { token: '1922', symbol: 'KOTAKBANK', segment: 'NSE' },
    { token: '10999', symbol: 'MARUTI', segment: 'NSE' },
    { token: '3506', symbol: 'TITAN', segment: 'NSE' },
    // FIX: token '25' = BANKNIFTY (IDX_I) in Dhan. ADANIENT equity = scrip 25215 (NSE_EQ).
    { token: '25215', symbol: 'ADANIENT', segment: 'NSE' },
    { token: '15083', symbol: 'ADANIPORTS', segment: 'NSE' },
    { token: '383', symbol: 'BEL', segment: 'NSE' },
    { token: '2303', symbol: 'HAL', segment: 'NSE' },
    { token: '5097', symbol: 'ZOMATO', segment: 'NSE' },
    { token: '14732', symbol: 'DLF', segment: 'NSE' },
    { token: '881', symbol: 'SUNPHARMA', segment: 'NSE' },
    { token: '14977', symbol: 'POWERGRID', segment: 'NSE' },
    { token: '11630', symbol: 'NTPC', segment: 'NSE' },
    { token: '694', symbol: 'COALINDIA', segment: 'NSE' },
    { token: '467', symbol: 'BHARTIARTL', segment: 'NSE' },
    { token: '3787', symbol: 'WIPRO', segment: 'NSE' },
  ]},
  { id: 'etf', name: 'ETF', color: '#10b981', items: [
    { token: '2150', symbol: 'NIFTYBEES', segment: 'NSE' },
    { token: '15068', symbol: 'BANKBEES', segment: 'NSE' },
    { token: '13751', symbol: 'JUNIORBEES', segment: 'NSE' },
    { token: '1660', symbol: 'GOLDBEES', segment: 'NSE' },
    { token: '22536', symbol: 'SILVERBEES', segment: 'NSE' },
    { token: '14428', symbol: 'ITBEES', segment: 'NSE' },
    { token: '14423', symbol: 'PHARMABEES', segment: 'NSE' },
  ]},
  { id: 'mcx', name: 'MCX', color: '#f59e0b', items: [
    { token: '429604', symbol: 'GOLD', segment: 'MCX' },
    { token: '429638', symbol: 'SILVER', segment: 'MCX' },
    { token: '425475', symbol: 'CRUDEOIL', segment: 'MCX' },
    { token: '431765', symbol: 'NATURALGAS', segment: 'MCX' },
    { token: '430596', symbol: 'COPPER', segment: 'MCX' },
  ]},
  { id: 'cds', name: 'CDS', color: '#06b6d4', items: [
    { token: '11091', symbol: 'USDINR', segment: 'CDS' },
    { token: '11363', symbol: 'EURINR', segment: 'CDS' },
    { token: '11096', symbol: 'GBPINR', segment: 'CDS' },
    { token: '11098', symbol: 'JPYINR', segment: 'CDS' },
  ]},
];

// Default instruments per workspace (auto-load on workspace switch)
const workspaceDefaults: Record<Workspace, Instrument | null> = {
  home:     null,
  index:    { token: '99926000', symbol: 'NIFTY 50',      name: 'Nifty 50',           segment: 'NSE', instrumentType: 'EQ',  exchange: 'NSE', lotSize: 50,   tickSize: 0.05 },
  stocks:   { token: '2885',     symbol: 'RELIANCE',       name: 'Reliance Industries', segment: 'NSE', instrumentType: 'EQ',  exchange: 'NSE', lotSize: 1,    tickSize: 0.05 },
  futures:  null,
  options:  { token: '99926000', symbol: 'NIFTY',          name: 'Nifty 50',           segment: 'NSE', instrumentType: 'EQ',  exchange: 'NSE', lotSize: 50,   tickSize: 0.05 },
  mcx:      null,
  cds:      null,
  etf:      { token: '2150',     symbol: 'NIFTYBEES',      name: 'Nippon India ETF Nifty BeES', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.01 },
  ord:      null,
  wl:       null,
  dom:      null,
  btm:      null,
  calendar: null,
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
      activeWorkspace: 'home',
      terminalLayout: 'standard',
      showOptionChain: false,
      showMarketDepth: false,
      bottomTab: 'positions',
      searchOpen: false,
      panels: { watchlist: true, orderPanel: true, bottomPanel: true, marketDepth: true, optionChain: false },
      pinnedTokens: [],
      activeWatchlistTab: 'index',
      lastInstrumentPerWorkspace: {},

      setTheme: (theme) => {
        if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', theme);
        set({ theme });
      },
      setChartLayout: (chartLayout) => set({ chartLayout }),
      setTimeframe: (timeframe) => set({ timeframe }),
      setChartType: (chartType) => set({ chartType }),
      setActiveSymbol: (activeSymbol) => set((state) => ({
        activeSymbol,
        lastInstrumentPerWorkspace: {
          ...state.lastInstrumentPerWorkspace,
          [state.activeWorkspace]: activeSymbol,
        },
      })),
      setWatchlists: (watchlists) => set({ watchlists }),
      setActiveWorkspace: (ws) => set((state) => {
        const isChartWs = ['index', 'stocks', 'futures', 'options', 'etf', 'mcx', 'cds'].includes(ws);
        const showOC = ws === 'options';
        const layout: TerminalLayout = ws === 'options' ? 'options' : ws === 'mcx' ? 'commodity' : ws === 'cds' ? 'currency' : 'standard';

        // Restore remembered instrument, or fall back to workspace default
        const remembered = state.lastInstrumentPerWorkspace[ws];
        const defaultSymbol = remembered || workspaceDefaults[ws];

        // Map workspace to watchlist tab id
        const wsToWlTab: Partial<Record<Workspace, string>> = {
          index: 'index', stocks: 'stocks', futures: 'futures', options: 'options', etf: 'etf', mcx: 'mcx', cds: 'cds',
        };

        return {
          activeWorkspace: ws,
          ...(defaultSymbol ? { activeSymbol: defaultSymbol } : {}),
          showOptionChain: showOC,
          terminalLayout: layout,
          activeWatchlistTab: wsToWlTab[ws] || state.activeWatchlistTab,
          panels: {
            watchlist: isChartWs || ws === 'home',
            orderPanel: isChartWs || ws === 'dom',
            bottomPanel: true,
            marketDepth: ws === 'futures' || ws === 'mcx' || ws === 'dom',
            optionChain: showOC,
          },
        };
      }),
      setTerminalLayout: (terminalLayout) => set({ terminalLayout }),
      addToWatchlist: (watchlistId, item) =>
        set((state) => {
          const updated = state.watchlists.map((wl) =>
            wl.id === watchlistId
              ? { ...wl, items: [...wl.items.filter((i) => i.token !== item.token), item] }
              : wl
          );
          // Sync to backend (fire-and-forget)
          const watchlist = updated.find(w => w.id === watchlistId);
          if (watchlist) syncWatchlistToBackend(watchlistId, watchlist);
          return { watchlists: updated };
        }),
      removeFromWatchlist: (watchlistId, token) =>
        set((state) => {
          const updated = state.watchlists.map((wl) =>
            wl.id === watchlistId
              ? { ...wl, items: wl.items.filter((i) => i.token !== token) }
              : wl
          );
          // Sync to backend (fire-and-forget)
          const watchlist = updated.find(w => w.id === watchlistId);
          if (watchlist) syncWatchlistToBackend(watchlistId, watchlist);
          return { watchlists: updated };
        }),
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
      name: 'fw-terminal-v8',
      version: 5,
      migrate: (persistedState: any, version: number) => {
        if (version < 4) {
          return {
            ...(persistedState as object),
            watchlists: defaultWatchlists,
            activeWatchlistTab: 'index',
          };
        }
        if (version < 5) {
          // Fix ADANIENT token collision: token '25' = BANKNIFTY in Dhan.
          // Replace with correct NSE_EQ scrip 25215 in all persisted watchlists.
          const state = persistedState as any;
          const fixedWatchlists = (state.watchlists || defaultWatchlists).map((wl: any) => ({
            ...wl,
            items: (wl.items || []).map((item: any) =>
              item.token === '25' && item.symbol === 'ADANIENT'
                ? { ...item, token: '25215' }
                : item
            ),
          }));
          return { ...state, watchlists: fixedWatchlists };
        }
        return persistedState;
      },
      partialize: (state) => ({
        theme: state.theme,
        timeframe: state.timeframe,
        chartType: state.chartType,
        activeWorkspace: state.activeWorkspace,
        panels: state.panels,
        watchlists: state.watchlists,
        pinnedTokens: state.pinnedTokens,
        activeWatchlistTab: state.activeWatchlistTab,
        lastInstrumentPerWorkspace: state.lastInstrumentPerWorkspace,
      }),
    }
  )
);
