import { useEffect, useRef, useState, useCallback } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { Watchlist } from '@/components/Watchlist';
import { ChartPanel } from '@/components/ChartPanel';
import { OrderPanel } from '@/components/OrderPanel';
import { BottomPanel } from '@/components/BottomPanel';
import { SearchModal } from '@/components/SearchModal';
import { OptionChainModal } from '@/components/OptionChainModal';
import { MarketDepthPanel } from '@/components/MarketDepthPanel';
import { RiskWidget } from '@/components/RiskWidget';
import { StatusBar } from '@/components/StatusBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AccessDenied } from '@/components/AccessDenied';
import { HolidayBanner } from '@/components/HolidayBanner';
import { RiskOverlay } from '@/components/RiskOverlay';
import { RiskMonitor } from '@/components/RiskMonitor';
import { TerminalReadiness } from '@/components/TerminalReadiness';
import { ToastProvider } from '@/components/ToastProvider';
import { MobileLayout } from '@/components/MobileLayout';
import { HomeDashboard } from '@/components/HomeDashboard';
import { CalendarAnalytics } from '@/components/CalendarAnalytics';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlistSync } from '@/hooks/useWatchlistSync';
import { useAppStore } from '@/store/appStore';
import { useThemeStore } from '@/store/themeStore';
import { initLayoutObserver } from '@/store/layoutStore';
import { wsService } from '@/services/websocket';
import { startSync, stopSync, startPersistence, stopPersistence } from '@/features/chart-trading';
import { cn } from '@/utils/helpers';
// Vertical drag divider for resizing panels horizontally
function VDivider({ onDrag }: { onDrag: (dx: number) => void }) {
  const isDragging = useRef(false);
  const startX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      onDrag(e.clientX - startX.current);
      startX.current = e.clientX;
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[3px] min-w-[3px] bg-fw-border/40 hover:bg-fw-accent/60 cursor-col-resize transition-colors z-10 flex-shrink-0"
      title="Drag to resize"
    />
  );
}

// Horizontal drag divider for resizing panels vertically
function HDivider({ onDrag }: { onDrag: (dy: number) => void }) {
  const isDragging = useRef(false);
  const startY = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      onDrag(e.clientY - startY.current);
      startY.current = e.clientY;
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="group h-[8px] min-h-[8px] bg-fw-border/30 hover:bg-fw-accent/20 cursor-row-resize transition-colors z-10 flex-shrink-0 flex items-center justify-center"
      title="Drag to resize depth panel"
    >
      {/* Visible grip dots */}
      <div className="flex gap-[3px] pointer-events-none">
        <div className="w-[3px] h-[3px] rounded-full bg-fw-text-muted/40 group-hover:bg-fw-accent/80 transition-colors" />
        <div className="w-[3px] h-[3px] rounded-full bg-fw-text-muted/40 group-hover:bg-fw-accent/80 transition-colors" />
        <div className="w-[3px] h-[3px] rounded-full bg-fw-text-muted/40 group-hover:bg-fw-accent/80 transition-colors" />
        <div className="w-[3px] h-[3px] rounded-full bg-fw-text-muted/40 group-hover:bg-fw-accent/80 transition-colors" />
        <div className="w-[3px] h-[3px] rounded-full bg-fw-text-muted/40 group-hover:bg-fw-accent/80 transition-colors" />
      </div>
    </div>
  );
}

export default function App() {
  const { theme, showOptionChain, panels, activeWorkspace } = useAppStore();
  const { isAuthenticated, isLoading, error } = useAuth();

  // Sync watchlists with backend
  useWatchlistSync();

  // Resizable panel widths/heights
  const [watchlistWidth, setWatchlistWidth] = useState(250);
  const [orderPanelWidth, setOrderPanelWidth] = useState(290);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(180);
  const [depthPanelHeight, setDepthPanelHeight] = useState(320);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useHotkeys();

  // Initialize layout observer (auto-collapse docks on small viewport)
  useEffect(() => { initLayoutObserver(); }, []);

  // Bootstrap Overlay Engine synchronization — starts watching Zustand store for position changes
  useEffect(() => {
    startSync();
    startPersistence();
    return () => {
      stopSync();
      stopPersistence();
    };
  }, []);

  // Initialize theme engine on mount
  useEffect(() => {
    const themeState = useThemeStore.getState();
    themeState.applyTheme(themeState.activeThemeId);
  }, []);

  // Responsive detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    if (isAuthenticated) {
      wsService.connect();
      // Auto-subscribe all watchlist tokens for live data
      const allTokens = new Set<string>();
      useAppStore.getState().watchlists.forEach(wl => {
        wl.items.forEach(item => allTokens.add(item.token));
      });
      if (allTokens.size > 0) {
        // Small delay to ensure WS is connected before subscribing
        const subTimer = setTimeout(() => {
          wsService.subscribe(Array.from(allTokens));
        }, 1000);
        return () => {
          clearTimeout(subTimer);
          wsService.disconnect();
        };
      }
    }
    return () => wsService.disconnect();
  }, [isAuthenticated]);

  const handleWatchlistResize = useCallback((dx: number) => {
    setWatchlistWidth((w) => Math.max(160, Math.min(400, w + dx)));
  }, []);

  const handleOrderPanelResize = useCallback((dx: number) => {
    setOrderPanelWidth((w) => Math.max(200, Math.min(420, w - dx)));
  }, []);

  const handleBottomResize = useCallback((dy: number) => {
    setBottomPanelHeight((h) => Math.max(120, Math.min(400, h - dy)));
  }, []);

  const handleDepthResize = useCallback((dy: number) => {
    setDepthPanelHeight((h) => Math.max(160, Math.min(520, h - dy)));
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-fw-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-2 rounded-xl bg-gradient-to-br from-[#00D4FF]/20 via-[#4F46E5]/15 to-[#7C3AED]/20 blur-lg opacity-60 animate-pulse" />
            <div className="relative w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 0 20px rgba(139,92,246,0.5)' }}>
              <img src="/logo.png" alt="FW" className="w-14 h-14 object-contain" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[14px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">
              FUNDEDWEALTH
            </span>
            <span className="text-[14px] font-bold tracking-[0.25em] text-fw-accent/70">
              TERMINAL
            </span>
          </div>
          <div className="flex items-center gap-2 text-fw-text-muted text-[14px]">
            <div className="w-3 h-3 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            Connecting...
          </div>
        </div>
      </div>
    );
  }

  // PRODUCTION GATE: If not authenticated, show access denied page.
  // Terminal NEVER renders without a valid SSO session.
  if (!isAuthenticated) {
    return <AccessDenied error={error} />;
  }

  const showOC = showOptionChain || activeWorkspace === 'options';
  const isHome     = activeWorkspace === 'home';
  const isChartWs  = ['index', 'stocks', 'futures', 'options', 'etf', 'mcx', 'cds'].includes(activeWorkspace);
  const isOrd      = activeWorkspace === 'ord';
  const isWl       = activeWorkspace === 'wl';
  const isDom      = activeWorkspace === 'dom';
  const isBtm      = activeWorkspace === 'btm';
  const isCalendar = activeWorkspace === 'calendar';

  // Mobile layout
  if (isMobile) {
    return (
      <ToastProvider>
        <MobileLayout />
        <RiskOverlay />
        <RiskMonitor />
        <SearchModal />
      </ToastProvider>
    );
  }

  // ── Right panel JSX — reused across chart workspaces ──────────────────────
  const rightPanel = panels.orderPanel ? (
    <>
      <VDivider onDrag={handleOrderPanelResize} />
      <div
        style={{ width: orderPanelWidth, minWidth: 240 }}
        className="border-l border-fw-border flex flex-col overflow-hidden flex-shrink-0"
      >
        <ErrorBoundary fallbackTitle="Risk Widget Error">
          <TerminalReadiness />
          <RiskWidget />
        </ErrorBoundary>
        <div className="flex-1 overflow-y-auto min-h-0">
          <ErrorBoundary fallbackTitle="Order Panel Error">
            <OrderPanel />
          </ErrorBoundary>
        </div>
        {panels.marketDepth && (
          <>
            <HDivider onDrag={handleDepthResize} />
            <div style={{ height: depthPanelHeight, minHeight: 200, maxHeight: 600 }} className="flex-shrink-0 overflow-hidden">
              <ErrorBoundary fallbackTitle="Market Depth Error">
                <MarketDepthPanel />
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>
    </>
  ) : null;

  // ── Watchlist sidebar JSX ──────────────────────────────────────────────────
  const watchlistPanel = panels.watchlist ? (
    <>
      <div
        style={{ width: watchlistWidth, minWidth: 180 }}
        className="border-r border-fw-border flex flex-col overflow-hidden flex-shrink-0"
      >
        <ErrorBoundary fallbackTitle="Watchlist Error">
          <Watchlist />
        </ErrorBoundary>
      </div>
      <VDivider onDrag={handleWatchlistResize} />
    </>
  ) : null;

  // ── Bottom dock JSX ────────────────────────────────────────────────────────
  const bottomDock = panels.bottomPanel ? (
    <>
      <HDivider onDrag={handleBottomResize} />
      <div style={{ height: bottomPanelHeight, minHeight: 140 }} className="border-t border-fw-border overflow-hidden flex-shrink-0">
        <ErrorBoundary fallbackTitle="Panel Error"><BottomPanel /></ErrorBoundary>
      </div>
    </>
  ) : null;

  return (
    <ToastProvider>
    <div className="h-screen w-screen flex bg-fw-bg overflow-hidden text-[15px]">
      {/* Left Sidebar Rail */}
      <Sidebar />

      {/* Main Terminal Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <HolidayBanner />
        <TopBar />

        {/* ── MAIN WORKSPACE AREA ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              HOME — Dashboard, no chart
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isHome && (
            <>
              {watchlistPanel}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex-1 overflow-hidden min-h-0">
                  <ErrorBoundary fallbackTitle="Home Dashboard Error">
                    <HomeDashboard />
                  </ErrorBoundary>
                </div>
                {bottomDock}
              </div>
              {rightPanel}
            </>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              CHART WORKSPACES: index/stocks/futures/options/mcx/cds
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isChartWs && (
            <>
              {watchlistPanel}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex flex-1 overflow-hidden">
                  <div className={showOC ? 'w-[55%] min-w-[300px] flex-shrink-0' : 'flex-1'}>
                    <ErrorBoundary fallbackTitle="Chart Error"><ChartPanel /></ErrorBoundary>
                  </div>
                  {showOC && (
                    <>
                      <VDivider onDrag={() => {}} />
                      <div className="flex-1 overflow-hidden min-w-0">
                        <ErrorBoundary fallbackTitle="Option Chain Error"><OptionChainModal /></ErrorBoundary>
                      </div>
                    </>
                  )}
                </div>
                {bottomDock}
              </div>
              {rightPanel}
            </>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              ORD — Orders workspace
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isOrd && (
            <>
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ErrorBoundary fallbackTitle="Orders Error">
                  <OrdWorkspace />
                </ErrorBoundary>
              </div>
              <VDivider onDrag={handleOrderPanelResize} />
              <div style={{ width: orderPanelWidth, minWidth: 240 }} className="border-l border-fw-border flex flex-col overflow-hidden flex-shrink-0">
                <ErrorBoundary fallbackTitle="Risk Widget Error">
                  <TerminalReadiness />
                  <RiskWidget />
                </ErrorBoundary>
              </div>
            </>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              WL — Watchlist workspace (full width)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isWl && (
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary fallbackTitle="Watchlist Error"><Watchlist /></ErrorBoundary>
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              DOM — Full center Market Depth + order panel right
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isDom && (
            <>
              {watchlistPanel}
              {/* Center: full Market Depth panel */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex-1 overflow-hidden min-h-0">
                  <ErrorBoundary fallbackTitle="Market Depth Error">
                    <MarketDepthPanel />
                  </ErrorBoundary>
                </div>
                {bottomDock}
              </div>
              {/* Right: order entry only (no duplicate DOM) */}
              {panels.orderPanel && (
                <>
                  <VDivider onDrag={handleOrderPanelResize} />
                  <div
                    style={{ width: orderPanelWidth, minWidth: 240 }}
                    className="border-l border-fw-border flex flex-col overflow-hidden flex-shrink-0"
                  >
                    <ErrorBoundary fallbackTitle="Risk Widget Error">
                      <TerminalReadiness />
                      <RiskWidget />
                    </ErrorBoundary>
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <ErrorBoundary fallbackTitle="Order Panel Error">
                        <OrderPanel />
                      </ErrorBoundary>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              BTM — Bottom dock as primary workspace
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isBtm && (
            <div className="flex-1 overflow-hidden min-h-0">
              <ErrorBoundary fallbackTitle="Bottom Panel Error"><BottomPanel /></ErrorBoundary>
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              CALENDAR — Calendar analytics
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {isCalendar && (
            <div className="flex-1 overflow-hidden min-h-0">
              <ErrorBoundary fallbackTitle="Calendar Error"><CalendarAnalytics /></ErrorBoundary>
            </div>
          )}

        </div>

        <StatusBar />
      </div>

      <SearchModal />
      <RiskOverlay />
      <RiskMonitor />
    </div>
    </ToastProvider>
  );
}

// ── ORD workspace — full-screen orders view ───────────────────────────────────
function OrdWorkspace() {
  const { setBottomTab } = useAppStore();
  useEffect(() => { setBottomTab('orders'); }, [setBottomTab]);
  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-fw-border bg-[#0a0c12] flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-widest text-fw-accent">Orders</span>
        <span className="text-[11px] text-fw-text-muted">— All open, filled, cancelled, rejected orders</span>
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        <BottomPanel />
      </div>
    </div>
  );
}
