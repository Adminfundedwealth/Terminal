import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice } from '@/utils/helpers';
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, BarChart3, Briefcase } from 'lucide-react';

const marketPulse = [
  { symbol: 'NIFTY', token: '99926000' },
  { symbol: 'BANKNIFTY', token: '99926009' },
  { symbol: 'FINNIFTY', token: '99926037' },
  { symbol: 'SENSEX', token: '99919000' },
];

const marketTabs = ['INDEX', 'STOCKS', 'OPTIONS', 'FUTURES', 'MCX', 'CDS'];

export function HomeWorkspace() {
  const { activeWorkspace, setActiveWorkspace } = useAppStore();
  const quotes = useMarketStore((s) => s.quotes);
  const { positions } = useTradingStore();

  const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);

  return (
    <div className="h-full flex flex-col bg-fw-bg text-fw-text">
      <div className="px-3 py-2 border-b border-fw-border bg-fw-surface">
        <div className="flex items-center gap-2 flex-wrap">
          {marketPulse.map(({ symbol, token }) => {
            const quote = quotes[token];
            const up = (quote?.changePercent || 0) >= 0;
            return (
              <div key={token} className="flex items-center gap-2 px-2 py-1 rounded-md border border-fw-border bg-fw-bg/40">
                <span className="text-[12px] font-bold text-fw-text-secondary">{symbol}</span>
                {quote ? (
                  <>
                    <span className={cn('font-mono text-[12px] font-bold', up ? 'text-green' : 'text-red')}>
                      {formatPrice(quote.ltp)}
                    </span>
                    <span className={cn('text-[11px] font-bold', up ? 'text-green' : 'text-red')}>
                      {up ? '+' : ''}{(quote.changePercent || 0).toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-fw-text-muted">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-3">
          <section className="rounded-lg border border-fw-border bg-fw-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-fw-text-secondary">Account Overview</h3>
              <span className="text-[11px] text-fw-text-muted">Live</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { label: 'Balance', value: '₹24.10L', tone: 'text-fw-text' },
                { label: 'Equity', value: '₹24.84L', tone: 'text-green' },
                { label: 'Margin', value: '₹12.42L', tone: 'text-orange-400' },
                { label: 'P&L', value: `₹${(totalPnl / 100000).toFixed(2)}L`, tone: totalPnl >= 0 ? 'text-green' : 'text-red' },
                { label: 'Open Positions', value: `${positions.length}`, tone: 'text-fw-text' },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-fw-border bg-fw-surface p-2">
                  <div className="text-[11px] text-fw-text-muted uppercase tracking-wide">{item.label}</div>
                  <div className={cn('mt-1 text-[16px] font-bold tabular-nums', item.tone)}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-fw-border bg-fw-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-fw-text-secondary">Market / Trade</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {marketTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    const wsMap: Record<string, 'home' | 'index' | 'stocks' | 'options' | 'futures' | 'mcx' | 'cds'> = {
                      INDEX: 'index',
                      STOCKS: 'stocks',
                      OPTIONS: 'options',
                      FUTURES: 'futures',
                      MCX: 'mcx',
                      CDS: 'cds',
                    };
                    const target = wsMap[tab] ?? 'home';
                    setActiveWorkspace(target);
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] border',
                    activeWorkspace === (tab === 'INDEX' ? 'index' : tab === 'STOCKS' ? 'stocks' : tab === 'OPTIONS' ? 'options' : tab === 'FUTURES' ? 'futures' : tab === 'MCX' ? 'mcx' : 'cds')
                      ? 'border-fw-accent/40 bg-fw-accent/10 text-fw-accent'
                      : 'border-fw-border bg-fw-bg text-fw-text-secondary hover:text-fw-text'
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <section className="rounded-lg border border-fw-border bg-fw-surface-2 p-3 min-h-[180px]">
              <div className="mb-2 flex items-center gap-2">
                <BarChart3 size={14} className="text-fw-accent" />
                <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-fw-text-secondary">Market Movers</h3>
              </div>
              <div className="space-y-2">
                {[
                  { name: 'RELIANCE', change: '+2.45%', tone: 'text-green', icon: ArrowUpRight },
                  { name: 'SBIN', change: '+1.82%', tone: 'text-green', icon: ArrowUpRight },
                  { name: 'TCS', change: '-0.91%', tone: 'text-red', icon: ArrowDownRight },
                  { name: 'INFY', change: '+0.64%', tone: 'text-green', icon: ArrowUpRight },
                ].map(({ name, change, tone, icon: Icon }) => (
                  <div key={name} className="flex items-center justify-between rounded-md border border-fw-border bg-fw-surface px-2 py-1.5">
                    <span className="text-[12px] font-bold">{name}</span>
                    <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold', tone)}>
                      <Icon size={12} />
                      {change}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-fw-border bg-fw-surface-2 p-3 min-h-[180px]">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp size={14} className="text-fw-accent" />
                <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-fw-text-secondary">Trending / Insights</h3>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Most Traded', value: 'NIFTY • 4.8L contracts' },
                  { label: 'Momentum', value: 'Banking sector leading' },
                  { label: 'AI Signal', value: 'Bullish continuation bias' },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-fw-border bg-fw-surface px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-fw-text-muted">{item.label}</div>
                    <div className="mt-1 text-[12px] font-semibold text-fw-text">{item.value}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
