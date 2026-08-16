/**
 * HomeDashboard.tsx — FundedWealth Terminal Home Workspace
 * Structural dashboard: Account Overview + Market/Trade + Market Movers + Trending/Insights
 * Uses ONLY existing store data/components — no new APIs, no new DB tables.
 */
import { useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Target, AlertTriangle,
  BarChart3, DollarSign, Layers, Zap,
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
      <span className="text-[13px] font-bold tracking-widest uppercase text-fw-text-secondary">{children}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, color, icon,
}: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-[#0d0f18] border border-fw-border/40 rounded px-3 py-2 min-w-0">
      <div className="flex items-center gap-1 text-fw-text-secondary text-[12px] font-medium uppercase tracking-wider truncate">
        {icon && <span className="opacity-70">{icon}</span>}
        {label}
      </div>
      <span className={cn('text-[17px] font-bold tabular-nums truncate', color || 'text-fw-text')}>{value}</span>
      {sub && <span className="text-[12px] text-fw-text-muted truncate">{sub}</span>}
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
      <span className="text-[12px] text-fw-text-secondary font-medium uppercase tracking-wider">{symbol}</span>
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

// ── Market category card with colorful SVG icon ──────────────────────────────
function CategoryCard({ ws, label, icon, accentColor }: { ws: Workspace; label: string; icon: React.ReactNode; accentColor: string }) {
  const { activeWorkspace, setActiveWorkspace } = useAppStore();
  const active = activeWorkspace === ws;
  return (
    <button
      onClick={() => setActiveWorkspace(ws)}
      className={cn(
        'flex-1 flex items-center gap-3 px-3 py-2 rounded-md border transition-all duration-150',
        'h-[58px] min-h-[58px] max-h-[58px]',
        active
          ? 'border-opacity-60 bg-opacity-10'
          : 'border-[rgba(120,140,170,0.28)] bg-[rgba(15,20,32,0.90)] hover:bg-[rgba(25,30,45,0.95)] hover:-translate-y-[1px] hover:border-[rgba(120,140,170,0.45)]'
      )}
      style={active ? { borderColor: accentColor, backgroundColor: `${accentColor}10` } : undefined}
    >
      <div className="flex-shrink-0 w-[28px] h-[28px]">{icon}</div>
      <div className="flex flex-col items-start leading-tight">
        <span className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-[#F1F5F9]')}>{label}</span>
        <span className="text-[10px] font-medium text-[#94A3B8]">Explore ↗</span>
      </div>
    </button>
  );
}

// ── SVG Icons for categories ──────────────────────────────────────────────────
function IndexIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="idxG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#3B82F6" /></linearGradient>
        <linearGradient id="idxG2" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#10B981" /><stop offset="100%" stopColor="#34D399" /></linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#idxG1)" opacity="0.15" />
      <rect x="6" y="20" width="4" height="6" rx="1" fill="url(#idxG1)" />
      <rect x="12" y="15" width="4" height="11" rx="1" fill="url(#idxG1)" />
      <rect x="18" y="11" width="4" height="15" rx="1" fill="url(#idxG2)" />
      <rect x="24" y="7" width="4" height="19" rx="1" fill="url(#idxG2)" />
      <path d="M6 14 L12 10 L18 6 L26 4" stroke="#34D399" strokeWidth="1.5" fill="none" opacity="0.9" />
      <circle cx="26" cy="4" r="1.5" fill="#34D399" />
    </svg>
  );
}

function StocksIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="stkG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#14B8A6" /><stop offset="100%" stopColor="#06B6D4" /></linearGradient>
        <linearGradient id="stkG2" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#10B981" /><stop offset="100%" stopColor="#6EE7B7" /></linearGradient>
      </defs>
      <rect x="5" y="10" width="10" height="16" rx="2" fill="url(#stkG1)" opacity="0.85" />
      <rect x="17" y="6" width="10" height="20" rx="2" fill="url(#stkG1)" opacity="0.6" />
      <path d="M8 16 L12 12 L16 14 L20 8 L24 10" stroke="url(#stkG2)" strokeWidth="2" fill="none" />
      <polygon points="24,6 28,10 24,10" fill="#6EE7B7" />
    </svg>
  );
}

function OptionsIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="optG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#A78BFA" /><stop offset="100%" stopColor="#7C3AED" /></linearGradient>
        <linearGradient id="optG2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#C084FC" /><stop offset="100%" stopColor="#22D3EE" /></linearGradient>
      </defs>
      <rect x="4" y="12" width="16" height="12" rx="2" fill="url(#optG1)" opacity="0.5" />
      <rect x="8" y="8" width="16" height="12" rx="2" fill="url(#optG1)" opacity="0.7" />
      <rect x="12" y="4" width="16" height="12" rx="2" fill="url(#optG2)" opacity="0.9" />
      <path d="M16 8 L20 6 L24 9" stroke="#E9D5FF" strokeWidth="1.5" opacity="0.8" />
      <circle cx="22" cy="10" r="2" fill="#C084FC" opacity="0.9" />
    </svg>
  );
}

function FuturesIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="futG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F97316" /><stop offset="100%" stopColor="#FBBF24" /></linearGradient>
        <linearGradient id="futG2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#3B82F6" /><stop offset="100%" stopColor="#60A5FA" /></linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" fill="url(#futG2)" opacity="0.12" />
      <path d="M6 22 L12 18 L16 20 L22 12 L28 8" stroke="url(#futG1)" strokeWidth="2.5" fill="none" />
      <polygon points="28,5 28,11 22,11" fill="url(#futG1)" opacity="0.8" />
      <circle cx="12" cy="18" r="2" fill="#FBBF24" opacity="0.7" />
      <circle cx="22" cy="12" r="2" fill="#F97316" opacity="0.9" />
    </svg>
  );
}

function McxIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="mcxG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F59E0B" /><stop offset="100%" stopColor="#D97706" /></linearGradient>
        <linearGradient id="mcxG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FDE68A" /><stop offset="100%" stopColor="#F59E0B" /></linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" fill="url(#mcxG1)" opacity="0.2" />
      <circle cx="16" cy="16" r="8" fill="url(#mcxG2)" opacity="0.7" />
      <circle cx="16" cy="16" r="4" fill="#FDE68A" opacity="0.9" />
      <path d="M10 26 L13 20 M22 26 L19 20" stroke="#D97706" strokeWidth="1.5" opacity="0.6" />
      <path d="M16 4 L16 8" stroke="#FDE68A" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

function CdsIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="cdsG1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#06B6D4" /><stop offset="100%" stopColor="#14B8A6" /></linearGradient>
        <linearGradient id="cdsG2" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#10B981" /></linearGradient>
      </defs>
      <circle cx="12" cy="16" r="8" fill="url(#cdsG1)" opacity="0.3" />
      <circle cx="20" cy="16" r="8" fill="url(#cdsG2)" opacity="0.3" />
      <text x="10" y="18" fontSize="8" fontWeight="bold" fill="#22D3EE" opacity="0.9">$</text>
      <text x="19" y="18" fontSize="8" fontWeight="bold" fill="#10B981" opacity="0.9">₹</text>
      <path d="M14 10 L18 10 M14 22 L18 22" stroke="#06B6D4" strokeWidth="1.2" opacity="0.5" />
      <path d="M16 7 L16 9 M16 23 L16 25" stroke="#14B8A6" strokeWidth="1.2" opacity="0.4" />
    </svg>
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
      <span className="flex-1 text-[14px] font-medium text-fw-text truncate">{symbol}</span>
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
    () => [...quoted].sort((a, b) => (quotes[b.token]?.changePercent ?? 0) - (quotes[a.token]?.changePercent ?? 0)).slice(0, 10),
    [quoted, quotes]
  );
  const losers = useMemo(
    () => [...quoted].sort((a, b) => (quotes[a.token]?.changePercent ?? 0) - (quotes[b.token]?.changePercent ?? 0)).slice(0, 10),
    [quoted, quotes]
  );

  return (
    <div className="h-full w-full overflow-y-auto bg-fw-bg px-4 py-3 flex flex-col gap-3">

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
          {/* Category cards */}
          <div className="flex gap-2 mt-2">
            <CategoryCard ws="index"   label="INDEX"   accentColor="#3B82F6" icon={<IndexIcon />} />
            <CategoryCard ws="stocks"  label="STOCKS"  accentColor="#14B8A6" icon={<StocksIcon />} />
            <CategoryCard ws="options" label="OPTIONS" accentColor="#7C3AED" icon={<OptionsIcon />} />
            <CategoryCard ws="futures" label="FUTURES" accentColor="#F97316" icon={<FuturesIcon />} />
            <CategoryCard ws="mcx"     label="MCX"     accentColor="#F59E0B" icon={<McxIcon />} />
            <CategoryCard ws="cds"     label="CDS"     accentColor="#06B6D4" icon={<CdsIcon />} />
          </div>
        </div>
      </section>

      {/* ── MARKET MOVERS + TRENDING / INSIGHTS ────────────────────────── */}
      <section>
        <SectionTitle>Market Movers</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>

          {/* Top Gainers */}
          <div className="bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-emerald-900/10">
              <TrendingUp size={11} className="text-emerald-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Top Gainers</span>
            </div>
            {gainers.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
            ) : (
              gainers.map((item, i) => (
                <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
              ))
            )}
          </div>

          {/* Top Losers */}
          <div className="bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-red-900/10">
              <TrendingDown size={11} className="text-red-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Top Losers</span>
            </div>
            {losers.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
            ) : (
              losers.map((item, i) => (
                <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
              ))
            )}
          </div>

          {/* Most Traded */}
          <div className="bg-[#0d0f18] border border-fw-border/40 rounded overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border/30 bg-fw-accent/5">
              <BarChart3 size={11} className="text-fw-accent" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-fw-accent/80">Most Traded</span>
            </div>
            {quoted.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-fw-text-muted/50">Waiting for live data…</p>
            ) : (
              quoted.slice(0, 10).map((item, i) => (
                <MoverRow key={item.token} token={item.token} symbol={item.symbol} rank={i + 1} />
              ))
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
