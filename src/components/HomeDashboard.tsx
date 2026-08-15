/**
 * HomeDashboard.tsx — FundedWealth Terminal Home Workspace
 * Structural dashboard: Account Overview + Market/Trade + Market Movers + Trending/Insights
 * Uses ONLY existing store data/components — no new APIs, no new DB tables.
 */
import { useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Target, AlertTriangle,
  BarChart3, DollarSign, Layers, Zap, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { useAppStore, type Workspace } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice } from '@/utils/helpers';

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10_000_000) return `${(val / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `${(val / 100_000).toFixed(2)}L`;
  if (abs >= 1_000)      return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(0);
}

// ── Index tokens ──────────────────────────────────────────────────────────────
const INDEX_TOKENS = [
  { token: '99926000', symbol: 'NIFTY 50',    segment: 'NSE' as const },
  { token: '99926009', symbol: 'BANKNIFTY',   segment: 'NSE' as const },
  { token: '99926037', symbol: 'FINNIFTY',    segment: 'NSE' as const },
  { token: '99919000', symbol: 'SENSEX',      segment: 'BSE' as const },
  { token: '99926074', symbol: 'MIDCPNIFTY',  segment: 'NSE' as const },
];

// ── Section heading ───────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-[3px] h-4 rounded-full bg-fw-accent" />
      <span className="text-[12px] font-bold tracking-widest uppercase text-fw-text-muted">{children}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, color, icon,
}: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-[#0d0f18] border border-fw-border/40 rounded px-3 py-2 min-w-0">
      <div className="flex items-center gap-1 text-fw-text-muted text-[11px] font-medium uppercase tracking-wider truncate">
        {icon && <span className="opacity-70">{icon}</span>}
        {label}
      </div>
      <span className={cn('text-[16px] font-bold tabular-nums truncate', color || 'text-fw-text')}>{value}</span>
      {sub && <span className="text-[11px] text-fw-text-muted truncate">{sub}</span>}
    </div>
  );
}

// ── Index quote tile ──────────────────────────────────────────────────────────
function IndexTile({ token, symbol, onClick }: { token: string; symbol: string; onClick: () => void }) {
  const q = useMarketStore((s) => s.quotes[token]);
  const up = (q?.changePercent ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-0.5 bg-[#0d0f18] border border-fw-border/40 hover:border-fw-accent/40 rounded px-3 py-2 text-left transition-colors min-w-0 group"
    >
      <span className="text-[11px] text-fw-text-muted font-medium uppercase tracking-wider">{symbol}</span>
      {q ? (
        <>
          <span className={cn('text-[15px] font-bold tabular-nums', up ? 'text-emerald-400' : 'text-red-400')}>
            {formatPrice(q.ltp)}
          </span>
          <span className={cn('text-[11px] font-medium tabular-nums', up ? 'text-emerald-400' : 'text-red-400')}>
            {up ? '+' : ''}{(q.changePercent || 0).toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="text-[13px] text-fw-text-muted/40">—</span>
      )}
    </button>
  );
}

// ── Market segment button ─────────────────────────────────────────────────────
function SegmentBtn({ ws, label, color }: { ws: Workspace; label: string; color: string }) {
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  return (
    <button
      onClick={() => setActiveWorkspace(ws)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-fw-border/40 hover:border-fw-accent/50 bg-[#0d0f18] hover:bg-fw-hover/40 text-[12px] font-bold text-fw-text-muted hover:text-fw-text transition-all uppercase tracking-wider"
      style={{ borderLeftColor: color, borderLeftWidth: 2 }}
    >
      {label}
      <ArrowUpRight size={11} className="text-fw-accent/60" />
    </button>
  );
}

// ── Watchlist mover row ───────────────────────────────────────────────────────
function MoverRow({ token, symbol, rank }: { token: string; symbol: string; rank: number }) {
  const q = useMarketStore((s) => s.quotes[token]);
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const up = (q?.changePercent ?? 0) >= 0;

  const handleClick = () => {
    setActiveSymbol({ token, symbol, name: symbol, segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 });
    setActiveWorkspace('stocks');
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-fw-hover/30 transition-colors text-left"
    >
      <span className="text-[11px] text-fw-text-muted/50 w-4 tabular-nums">{rank}</span>
      <span className="flex-1 text-[13px] font-medium text-fw-text truncate">{symbol}</span>
      {q ? (
        <>
          <span className="text-[12px] tabular-nums text-fw-text font-mono">{formatPrice(q.ltp)}</span>
          <span className={cn('text-[11px] tabular-nums font-medium w-14 text-right', up ? 'text-emerald-400' : 'text-red-400')}>
            {up ? '+' : ''}{(q.changePercent || 0).toFixed(2)}%
          </span>
          {up ? <TrendingUp size={10} className="text-emerald-400 flex-shrink-0" /> : <TrendingDown size={10} className="text-red-400 flex-shrink-0" />}
        </>
      ) : (
        <span className="text-[12px] text-fw-text-muted/40">—</span>
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function HomeDashboard() {
  const account    = useTradingStore((s) => s.account);
  const positions  = useTradingStore((s) => s.positions);
  const watchlists = useAppStore((s) => s.watchlists);
  const quotes     = useMarketStore((s) => s.quotes);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSymbol    = useAppStore((s) => s.setActiveSymbol);

  // Account figures
  const balance    = account?.balance ?? 0;
  const totalMTM   = positions.reduce((sum, p) => sum + (p.pnl || p.mtm || 0), 0);
  const equity     = balance + totalMTM;
  const openCount  = positions.filter((p) => p.qty !== 0).length;

  // Gainers / losers derived from ALL watchlist items that have a live quote
  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const out: { token: string; symbol: string }[] = [];
    watchlists.forEach((wl) => {
      wl.items.forEach((item) => {
        if (!seen.has(item.token)) { seen.add(item.token); out.push(item); }
      });
    });
    return out;
  }, [watchlists]);

  const quoted = useMemo(
    () => allItems.filter((i) => quotes[i.token]),
    [allItems, quotes]
  );

  const gainers = useMemo(
    () => [...quoted].sort((a, b) => (quotes[b.token]?.changePercent ?? 0) - (quotes[a.token]?.changePercent ?? 0)).slice(0, 8),
    [quoted, quotes]
  );
  const losers = useMemo(
    () => [...quoted].sort((a, b) => (quotes[a.token]?.changePercent ?? 0) - (quotes[b.token]?.changePercent ?? 0)).slice(0, 8),
    [quoted, quotes]
  );

  return (
    <div className="h-full w-full overflow-y-auto bg-fw-bg px-4 py-3 flex flex-col gap-4">

      {/* ── ACCOUNT OVERVIEW ────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Account Overview</SectionTitle>
        <div className="grid grid-cols-6 gap-2">
          <StatCard
            label="Balance"
            value={`₹${fmt(balance)}`}
            icon={<DollarSign size={11} />}
          />
          <StatCard
            label="Equity"
            value={`₹${fmt(equity)}`}
            color={equity >= balance ? 'text-emerald-400' : 'text-red-400'}
            icon={<Activity size={11} />}
          />
          <StatCard
            label="Daily P&L"
            value={`${totalMTM >= 0 ? '+' : ''}₹${fmt(Math.abs(totalMTM))}`}
            color={totalMTM >= 0 ? 'text-emerald-400' : 'text-red-400'}
            icon={totalMTM >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          />
          <StatCard
            label="Open Positions"
            value={String(openCount)}
            sub={openCount === 0 ? 'No open trades' : `${openCount} active`}
            color={openCount > 0 ? 'text-fw-accent' : 'text-fw-text-muted'}
            icon={<Layers size={11} />}
          />
          <StatCard
            label="Daily Loss Limit"
            value={account?.challenge?.dailyLossLimitPct ? `${account.challenge.dailyLossLimitPct}%` : '—'}
            icon={<AlertTriangle size={11} />}
            color="text-orange-400"
          />
          <StatCard
            label="Profit Target"
            value={account?.challenge?.profitTargetPct ? `${account.challenge.profitTargetPct}%` : '—'}
            icon={<Target size={11} />}
            color="text-emerald-400"
          />
        </div>
      </section>

      {/* ── MARKET / TRADE + INDEX QUOTES ──────────────────────────────── */}
      <section>
        <SectionTitle>Market / Trade</SectionTitle>
        <div className="flex flex-col gap-2">
          {/* Index live tiles */}
          <div className="grid grid-cols-5 gap-2">
            {INDEX_TOKENS.map(({ token, symbol }) => (
              <IndexTile
                key={token}
                token={token}
                symbol={symbol}
                onClick={() => {
                  setActiveSymbol({ token, symbol, name: symbol, segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 });
                  setActiveWorkspace('index');
                }}
              />
            ))}
          </div>
          {/* Segment buttons */}
          <div className="flex flex-wrap gap-2 mt-1">
            <SegmentBtn ws="index"   label="INDEX"   color="#2962ff" />
            <SegmentBtn ws="stocks"  label="STOCKS"  color="#26a69a" />
            <SegmentBtn ws="options" label="OPTIONS" color="#ab47bc" />
            <SegmentBtn ws="futures" label="FUTURES" color="#ff9800" />
            <SegmentBtn ws="mcx"    label="MCX"     color="#f59e0b" />
            <SegmentBtn ws="cds"    label="CDS"     color="#06b6d4" />
          </div>
        </div>
      </section>

      {/* ── MARKET MOVERS + TRENDING / INSIGHTS ────────────────────────── */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* Market Movers */}
        <section className="flex-1 min-w-0">
          <SectionTitle>Market Movers</SectionTitle>
          <div className="flex gap-3 h-full">
            {/* Gainers */}
            <div className="flex-1 bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-emerald-900/10">
                <TrendingUp size={11} className="text-emerald-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Top Gainers</span>
              </div>
              <div className="overflow-y-auto">
                {gainers.length === 0 ? (
                  <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
                ) : (
                  gainers.map((item, i) => (
                    <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
                  ))
                )}
              </div>
            </div>
            {/* Losers */}
            <div className="flex-1 bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-red-900/10">
                <TrendingDown size={11} className="text-red-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Top Losers</span>
              </div>
              <div className="overflow-y-auto">
                {losers.length === 0 ? (
                  <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
                ) : (
                  losers.map((item, i) => (
                    <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Trending / Insights */}
        <section className="w-[280px] flex-shrink-0">
          <SectionTitle>Trending / Insights</SectionTitle>
          <div className="bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden h-full flex flex-col">
            {/* Most Traded */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-fw-accent/5">
              <BarChart3 size={11} className="text-fw-accent" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-fw-accent/80">Most Traded</span>
            </div>
            <div className="overflow-y-auto flex-1">
              {quoted.slice(0, 10).map((item, i) => (
                <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
              ))}
              {quoted.length === 0 && (
                <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
              )}
            </div>
            {/* Open positions quick view */}
            {openCount > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-fw-border/30 bg-fw-hover/20">
                  <Zap size={11} className="text-yellow-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-yellow-400">Open Positions</span>
                </div>
                <div className="overflow-y-auto max-h-[120px]">
                  {positions.filter(p => p.qty !== 0).slice(0, 5).map((p) => {
                    const pnl = p.pnl || p.mtm || 0;
                    return (
                      <div key={p.positionId || p.symbol} className="flex items-center gap-2 px-2 py-1.5 hover:bg-fw-hover/20 rounded mx-1 transition-colors">
                        <span className={cn('text-[10px] font-bold px-1 rounded', p.side === 'BUY' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400')}>
                          {p.side === 'BUY' ? 'L' : 'S'}
                        </span>
                        <span className="flex-1 text-[12px] text-fw-text truncate">{p.symbol}</span>
                        <span className={cn('text-[11px] tabular-nums font-medium', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {pnl >= 0 ? '+' : ''}₹{fmt(Math.abs(pnl))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
