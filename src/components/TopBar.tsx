import { Search, Moon, Palette, Shield, Zap, TrendingUp, TrendingDown, Activity, Target, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import { cn, formatPrice } from '@/utils/helpers';
import { AccountSelector } from './AccountSelector';
import { useState, useEffect } from 'react';
import { getMarginInfo, getRiskState, type RiskState } from '@/services/api';
import type { Theme } from '@/types';

function formatCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10000000) return `${(val / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${(val / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toFixed(0);
}

const PULSE_TOKENS = [
  { token: '99926000', symbol: 'NIFTY' },
  { token: '99926009', symbol: 'BANKNIFTY' },
  { token: '99926037', symbol: 'FINNIFTY' },
  { token: '99919000', symbol: 'SENSEX' },
];

export function TopBar() {
  const { theme, setTheme, setSearchOpen, showOptionChain, setShowOptionChain, panels, togglePanel } = useAppStore();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);
  const marketStatus = useMarketStore((s) => s.marketStatus);
  const quotes = useMarketStore((s) => s.quotes);
  const [marginInfo, setMarginInfo] = useState<{ usedMargin: number; availableMargin: number } | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [account?.id]);

  async function fetchData() {
    try { const info = await getMarginInfo(); setMarginInfo(info); } catch {}
    try { const rs = await getRiskState(); setRiskState(rs); } catch {}
  }

  const balance = riskState?.balance || account?.balance || 0;
  const initialBalance = riskState?.initialBalance || account?.challenge?.initialBalance || balance || 1000000;
  const dailyLossLimitPct = account?.challenge?.dailyLossLimitPct || 5;
  const maxDDPct = account?.challenge?.maxDrawdownPct || 10;
  const profitTargetPct = account?.challenge?.profitTargetPct || 10;
  const totalMTM = positions.reduce((sum, p) => sum + (p.pnl || p.mtm || 0), 0);
  const equity = riskState?.currentEquity || (balance + totalMTM);
  const dailyLossLimit = riskState?.dailyLossLimit || (initialBalance * (dailyLossLimitPct / 100));
  const maxDDLimit = riskState?.maxDrawdownLimit || (initialBalance * (maxDDPct / 100));
  const profitTarget = riskState?.profitTargetAmount || (initialBalance * (profitTargetPct / 100));
  const dailyLoss = riskState?.dailyLoss || (totalMTM < 0 ? Math.abs(totalMTM) : 0);
  const dailyLossRemaining = riskState?.dailyLossRemaining ?? Math.max(0, dailyLossLimit - dailyLoss);
  const ddRemaining = riskState?.maxDrawdownRemaining ?? Math.max(0, maxDDLimit - Math.max(0, (account?.peakBalance || balance) - equity));
  const targetPct = riskState?.targetProgressPct ?? (profitTarget > 0 ? Math.min(100, (Math.max(0, equity - initialBalance) / profitTarget) * 100) : 0);
  const pnlValue = riskState?.totalDailyPnl || account?.totalPnl || totalMTM;
  const phase = riskState?.challengeType === 'evaluation_phase1' ? 'Phase 1' : riskState?.challengeType === 'evaluation_phase2' ? 'Phase 2' : riskState?.challengeType === 'funded' ? 'Funded' : account?.challenge?.type === 'evaluation_phase1' ? 'Phase 1' : 'Phase 1';

  const riskLevel = dailyLoss > dailyLossLimit * 0.7 ? 'HIGH' : dailyLoss > dailyLossLimit * 0.4 ? 'CAUTION' : 'SAFE';
  const riskColor = riskLevel === 'HIGH' ? 'text-red' : riskLevel === 'CAUTION' ? 'text-orange-400' : 'text-emerald-400';
  const riskBg = riskLevel === 'HIGH' ? 'bg-red-900/15 border-red-800/30' : riskLevel === 'CAUTION' ? 'bg-orange-900/15 border-orange-800/30' : 'bg-emerald-900/15 border-emerald-800/30';

  return (
    <header className="min-h-[64px] bg-gradient-to-b from-[#0e1018] to-[#0c0e14] border-b border-fw-border flex flex-col select-none overflow-hidden">
      {/* Row 1: Main Command Bar */}
      <div className="flex items-center px-3 h-[38px]">
        {/* Brand */}
        <div data-brand className="flex items-center gap-2 mr-3 flex-shrink-0">
          <div className="relative">
            <div className="absolute -inset-0.5 rounded-md bg-gradient-to-br from-[#00D4FF]/10 via-[#4F46E5]/8 to-[#7C3AED]/10 blur-sm opacity-60" />
            <div className="relative w-6 h-6 rounded-md bg-gradient-to-br from-[#0a0a0a] to-[#1a1a2e] border border-white/10 flex items-center justify-center">
              <img src="/logo.png" alt="FW" className="w-4 h-4 object-contain" onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = 'none'; el.parentElement!.innerHTML = '<span class="text-[7px] font-black bg-gradient-to-br from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">FW</span>'; }} />
            </div>
          </div>
          <div className="flex flex-col leading-none items-center">
            <span className="text-[13px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">FUNDEDWEALTH</span>
            <span className="text-[9px] font-bold tracking-[0.2em] text-fw-accent/80 drop-shadow-[0_0_6px_rgba(59,130,246,0.5)]">TERMINAL</span>
          </div>
        </div>

        {/* Market + Feed Status */}
        <div className="flex items-center gap-1.5 mr-3 flex-shrink-0">
          <div className={cn('flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border', marketStatus === 'OPEN' ? 'border-emerald-700/40 bg-emerald-900/15 text-emerald-400' : 'border-red-800/30 bg-red-900/15 text-red-400')}>
            <div className={cn('w-2 h-2 rounded-full', marketStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
            {marketStatus === 'OPEN' ? 'LIVE' : 'CLOSED'}
          </div>
        </div>

        {/* Challenge Phase Badge */}
        <div className="flex items-center gap-1.5 mr-3 pr-3 border-r border-fw-border/30 flex-shrink-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-fw-accent/10 border border-fw-accent/25">
            <Zap size={11} className="text-fw-accent" />
            <span className="text-[11px] font-black text-fw-accent uppercase">{phase}</span>
          </div>
          <div className={cn('flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border', riskBg)}>
            <Shield size={10} className={riskColor} />
            <span className={riskColor}>{riskLevel}</span>
          </div>
        </div>

        {/* Index Pulse Strip */}
        <div className="flex items-center gap-3 mr-3 pr-3 border-r border-fw-border/30 flex-shrink-0 overflow-hidden">
          {PULSE_TOKENS.map(({ token, symbol }) => {
            const q = quotes[token];
            return (
              <div key={token} className="flex items-center gap-1">
                <span className="text-[11px] font-bold text-fw-text-muted">{symbol}</span>
                {q ? (
                  <span className={cn('text-[12px] font-mono font-bold tabular-nums', (q.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
                    {formatPrice(q.ltp)}
                    <span className="text-[10px] ml-0.5">{(q.changePercent || 0) >= 0 ? '+' : ''}{(q.changePercent || 0).toFixed(1)}%</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-fw-text-muted/50 font-mono">—</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Panel Toggles */}
        <div className="flex items-center gap-0.5 mr-3 flex-shrink-0">
          <PanelBtn label="WL" active={panels.watchlist} onClick={() => togglePanel('watchlist')} />
          <PanelBtn label="ORD" active={panels.orderPanel} onClick={() => togglePanel('orderPanel')} />
          <PanelBtn label="OC" active={showOptionChain} onClick={() => setShowOptionChain(!showOptionChain)} />
          <PanelBtn label="DOM" active={panels.marketDepth} onClick={() => togglePanel('marketDepth')} />
          <PanelBtn label="BTM" active={panels.bottomPanel} onClick={() => togglePanel('bottomPanel')} />
        </div>

        <div className="flex-1" />

        {/* Account + Theme + Search */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AccountSelector />
          <div className="flex items-center bg-fw-bg rounded border border-fw-border p-0.5">
            {([{ value: 'dark' as Theme, label: 'D' }, { value: 'fw-blue' as Theme, label: 'B' }]).map((t) => (
              <button key={t.value} onClick={() => setTheme(t.value)} className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', theme === t.value ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text')}>{t.label}</button>
            ))}
          </div>
          <button onClick={() => setSearchOpen(true)} className="p-1 rounded hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text" title="Search (Ctrl+K)">
            <Search size={13} />
          </button>
        </div>
      </div>

      {/* Row 2: Account Metrics + Challenge Context Strip */}
      <div className="flex items-center px-3 h-[26px] border-t border-fw-border/20 bg-[#090b10]">
        {/* Account Metrics */}
        <div className="flex items-center gap-4 text-[12px] mr-4 pr-4 border-r border-fw-border/20">
          <MetricInline label="Balance" value={`₹${formatCompact(balance)}`} />
          <MetricInline label="Equity" value={`₹${formatCompact(equity)}`} className={equity >= balance ? 'text-emerald-400' : 'text-red-400'} />
          <MetricInline label="Margin" value={`₹${formatCompact(marginInfo?.usedMargin || 0)}`} className="text-orange-400" />
          <MetricInline label="Free" value={`₹${formatCompact(marginInfo?.availableMargin || balance)}`} className="text-emerald-400" />
          <div className="flex items-center gap-1">
            <span className="text-fw-text-muted">P&L</span>
            {pnlValue >= 0 ? <TrendingUp size={10} className="text-green" /> : <TrendingDown size={10} className="text-red" />}
            <span className={cn('font-mono font-bold tabular-nums', pnlValue >= 0 ? 'text-green' : 'text-red')}>
              {pnlValue >= 0 ? '+' : ''}₹{formatCompact(Math.abs(pnlValue))}
            </span>
          </div>
        </div>

        {/* Challenge Risk Context */}
        <div className="flex items-center gap-4 text-[12px]">
          <div className="flex items-center gap-1">
            <AlertTriangle size={9} className="text-red-400/70" />
            <span className="text-fw-text-muted">Daily Left:</span>
            <span className="font-mono font-bold text-red-400 tabular-nums">₹{formatCompact(dailyLossRemaining)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Activity size={9} className="text-orange-400/70" />
            <span className="text-fw-text-muted">DD Left:</span>
            <span className="font-mono font-bold text-orange-400 tabular-nums">₹{formatCompact(ddRemaining)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Target size={9} className="text-emerald-400/70" />
            <span className="text-fw-text-muted">Target:</span>
            <span className="font-mono font-bold text-emerald-400 tabular-nums">{targetPct.toFixed(0)}%</span>
            <div className="w-16 h-[4px] rounded-full bg-fw-border/30 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${targetPct}%` }} />
            </div>
          </div>
        </div>

        <div className="flex-1" />
        <span className="text-[9px] text-fw-text-muted/50 font-mono">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </div>
    </header>
  );
}

function MetricInline({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-fw-text-muted">{label}</span>
      <span className={cn('font-mono font-bold tabular-nums text-fw-text', className)}>{value}</span>
    </div>
  );
}

function PanelBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn('px-2 py-1 text-[11px] font-bold rounded transition-all', active ? 'bg-fw-accent/15 text-fw-accent border border-fw-accent/30' : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover border border-transparent')}>
      {label}
    </button>
  );
}
