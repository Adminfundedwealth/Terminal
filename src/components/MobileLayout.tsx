/**
 * MOBILE LAYOUT
 * 
 * Tabbed interface for screens < 768px.
 * Tabs: Chart, Order, Positions, Watchlist
 */

import { useState } from 'react';
import { BarChart2, ShoppingCart, Briefcase, List } from 'lucide-react';
import { ChartPanel } from './ChartPanel';
import { OrderPanel } from './OrderPanel';
import { BottomPanel } from './BottomPanel';
import { Watchlist } from './Watchlist';
import { ErrorBoundary } from './ErrorBoundary';
import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import { cn, formatPrice } from '@/utils/helpers';

type MobileTab = 'chart' | 'order' | 'positions' | 'watchlist';

const TABS: { id: MobileTab; icon: React.ReactNode; label: string }[] = [
  { id: 'chart', icon: <BarChart2 size={18} />, label: 'Chart' },
  { id: 'order', icon: <ShoppingCart size={18} />, label: 'Order' },
  { id: 'positions', icon: <Briefcase size={18} />, label: 'Positions' },
  { id: 'watchlist', icon: <List size={18} />, label: 'Watchlist' },
];

export function MobileLayout() {
  const [activeTab, setActiveTab] = useState<MobileTab>('chart');
  const account = useTradingStore((s) => s.account);
  const { activeSymbol } = useAppStore();
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);

  return (
    <div className="h-screen w-screen flex flex-col bg-fw-bg overflow-hidden">
      {/* Mobile Top Bar */}
      <header className="h-[44px] min-h-[44px] bg-[#12141c] border-b border-fw-border flex items-center px-3 gap-2">
        <div className="flex flex-col leading-none">
          <span className="text-[10px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] to-[#7C3AED] bg-clip-text text-transparent">FW</span>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {activeSymbol && quote && (
            <>
              <span className="text-[11px] font-bold text-fw-text truncate">{activeSymbol.symbol}</span>
              <span className={cn('text-[11px] font-mono font-bold', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
                {formatPrice(quote.ltp)}
              </span>
              <span className={cn('text-[9px] font-mono', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
                {(quote.changePercent || 0) >= 0 ? '+' : ''}{quote.changePercent?.toFixed(2)}%
              </span>
            </>
          )}
        </div>
        {account && (
          <span className="text-[9px] font-mono text-fw-text-secondary">₹{((account.balance || 0) / 100000).toFixed(1)}L</span>
        )}
      </header>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chart' && (
          <ErrorBoundary fallbackTitle="Chart Error">
            <ChartPanel />
          </ErrorBoundary>
        )}
        {activeTab === 'order' && (
          <div className="h-full overflow-y-auto">
            <ErrorBoundary fallbackTitle="Order Error">
              <OrderPanel />
            </ErrorBoundary>
          </div>
        )}
        {activeTab === 'positions' && (
          <div className="h-full overflow-hidden">
            <ErrorBoundary fallbackTitle="Panel Error">
              <BottomPanel />
            </ErrorBoundary>
          </div>
        )}
        {activeTab === 'watchlist' && (
          <div className="h-full overflow-hidden">
            <ErrorBoundary fallbackTitle="Watchlist Error">
              <Watchlist />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* Bottom Tab Bar */}
      <nav className="h-[56px] min-h-[56px] bg-[#12141c] border-t border-fw-border flex items-center justify-around px-2 safe-area-bottom">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[60px]',
              activeTab === tab.id ? 'text-fw-accent' : 'text-fw-text-muted'
            )}
          >
            {tab.icon}
            <span className="text-[9px] font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
