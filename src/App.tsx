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
import { useHotkeys } from '@/hooks/useHotkeys';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { useThemeStore } from '@/store/themeStore';
import { initLayoutObserver } from '@/store/layoutStore';
import { wsService } from '@/services/websocket';

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
      className="h-[3px] min-h-[3px] bg-fw-border/40 hover:bg-fw-accent/60 cursor-row-resize transition-colors z-10 flex-shrink-0"
      title="Drag to resize"
    />
  );
}

export default function App() {
  const { theme, showOptionChain, panels, activeWorkspace } = useAppStore();
  const { isAuthenticated, isLoading, error } = useAuth();

  // Resizable panel widths/heights
  const [watchlistWidth, setWatchlistWidth] = useState(250);
  const [orderPanelWidth, setOrderPanelWidth] = useState(290);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(180);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useHotkeys();

  // Initialize layout observer (auto-collapse docks on small viewport)
  useEffect(() => { initLayoutObserver(); }, []);

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

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-fw-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-2 rounded-xl bg-gradient-to-br from-[#00D4FF]/20 via-[#4F46E5]/15 to-[#7C3AED]/20 blur-lg opacity-60 animate-pulse" />
            <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-[#0a0a0a] to-[#1a1a2e] border border-white/10 flex items-center justify-center">
              <img src="/logo.png" alt="FW" className="w-9 h-9 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[14px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">
              FUNDEDWEALTH
            </span>
            <span className="text-[10px] font-bold tracking-[0.25em] text-fw-accent/70">
              TERMINAL
            </span>
          </div>
          <div className="flex items-center gap-2 text-fw-text-muted text-[11px]">
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

  return (
    <ToastProvider>
    <div className="h-screen w-screen flex bg-fw-bg overflow-hidden text-[13px]">
      {/* Left Sidebar Rail */}
      <Sidebar />

      {/* Main Terminal Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Holiday Banner */}
        <HolidayBanner />

        {/* Top Bar */}
        <TopBar />

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left - Watchlist */}
          {panels.watchlist && (
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
          )}

          {/* Center - Chart + OC + Bottom */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Chart + Option Chain side by side for options workspace */}
            <div className="flex flex-1 overflow-hidden">
              <div className={showOC ? 'w-[55%] min-w-[300px] flex-shrink-0' : 'flex-1'}>
                <ErrorBoundary fallbackTitle="Chart Error">
                  <ChartPanel />
                </ErrorBoundary>
              </div>
              {showOC && (
                <>
                  <VDivider onDrag={() => {}} />
                  <div className="flex-1 overflow-hidden min-w-0">
                    <ErrorBoundary fallbackTitle="Option Chain Error">
                      <OptionChainModal />
                    </ErrorBoundary>
                  </div>
                </>
              )}
            </div>

            {/* Bottom Panel */}
            {panels.bottomPanel && (
              <>
                <HDivider onDrag={handleBottomResize} />
                <div
                  style={{ height: bottomPanelHeight, minHeight: 140 }}
                  className="border-t border-fw-border overflow-hidden flex-shrink-0"
                >
                  <ErrorBoundary fallbackTitle="Panel Error">
                    <BottomPanel />
                  </ErrorBoundary>
                </div>
              </>
            )}
          </div>

          {/* Right - Order + DOM + Risk */}
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
                {panels.marketDepth && (
                  <div className="border-t border-fw-border flex-shrink-0 min-h-[220px] max-h-[280px]">
                    <ErrorBoundary fallbackTitle="Market Depth Error">
                      <MarketDepthPanel />
                    </ErrorBoundary>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Status Bar */}
        <StatusBar />
      </div>

      {/* Search Modal */}
      <SearchModal />

      {/* Risk Overlay (locked/breached) */}
      <RiskOverlay />

      {/* Risk Monitor (invisible — fires toasts) */}
      <RiskMonitor />
    </div>
    </ToastProvider>
  );
}
