import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';
import { Shield, Zap, TrendingDown, TrendingUp, Target, AlertTriangle, Lock, Activity } from 'lucide-react';
import { getRiskState, type RiskState } from '@/services/api';

export function RiskWidget() {
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);
  const [riskState, setRiskState] = useState<RiskState | null>(null);

  useEffect(() => {
    fetchRisk();
    const interval = setInterval(fetchRisk, 8000);
    return () => clearInterval(interval);
  }, []);

  async function fetchRisk() {
    try { const rs = await getRiskState(); setRiskState(rs); } catch {}
  }

  const balance = riskState?.balance || account?.balance || 0;
  const equity = riskState?.currentEquity || balance;
  const initialBalance = riskState?.initialBalance || account?.challenge?.initialBalance || balance || 1000000;
  const dailyLossLimit = riskState?.dailyLossLimit || initialBalance * 0.05;
  const maxDrawdownLimit = riskState?.maxDrawdownLimit || initialBalance * 0.10;
  const profitTargetAmount = riskState?.profitTargetAmount || initialBalance * 0.10;

  const dailyLoss = riskState?.dailyLoss || 0;
  const dailyLossRemaining = riskState?.dailyLossRemaining ?? Math.max(0, dailyLossLimit - dailyLoss);
  const dailyPct = riskState?.dailyLossUsedPct || (dailyLossLimit > 0 ? (dailyLoss / dailyLossLimit) * 100 : 0);

  const drawdown = riskState?.drawdown || 0;
  const ddRemaining = riskState?.maxDrawdownRemaining ?? Math.max(0, maxDrawdownLimit - drawdown);
  const ddPct = riskState?.maxDrawdownUsedPct || (maxDrawdownLimit > 0 ? (drawdown / maxDrawdownLimit) * 100 : 0);

  const targetPct = riskState?.targetProgressPct || 0;
  const targetRemaining = riskState?.targetRemaining ?? profitTargetAmount;

  const totalMTM = positions.reduce((s, p) => s + (p.mtm || p.pnl || 0), 0);
  const todayPnl = riskState?.totalDailyPnl || totalMTM;
  const todayTrades = riskState?.todayTradeCount || 0;

  const phase = riskState?.challengeType === 'evaluation_phase1' ? 'Phase 1' : riskState?.challengeType === 'evaluation_phase2' ? 'Phase 2' : riskState?.challengeType === 'funded' ? 'Funded' : account?.challenge?.type === 'evaluation_phase1' ? 'Phase 1' : 'Phase 1';
  const status = riskState?.accountStatus || account?.status || 'active';
  const isLocked = status === 'locked' || status === 'breached';

  const overallRisk = Math.max(dailyPct, ddPct);
  const riskLevel = overallRisk > 80 ? 'CRITICAL' : overallRisk > 60 ? 'HIGH' : overallRisk > 30 ? 'CAUTION' : 'SAFE';

  return (
    <div className="border-b border-fw-border bg-gradient-to-b from-[#0c0e16] to-[#0a0c12] select-none">
      {/* Challenge Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border/30">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-fw-accent/10 border border-fw-accent/20">
            <Zap size={9} className="text-fw-accent" />
            <span className="text-[9px] font-black text-fw-accent">{phase}</span>
          </div>
          {isLocked && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/20 border border-red-800/30">
              <Lock size={8} className="text-red-400" />
              <span className="text-[9px] font-bold text-red-400">LOCKED</span>
            </div>
          )}
        </div>
        <RiskBadge level={riskLevel} />
      </div>

      {/* P&L + Account Quick Stats */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-fw-border/20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {todayPnl >= 0 ? <TrendingUp size={10} className="text-green" /> : <TrendingDown size={10} className="text-red" />}
            <span className="text-[9px] text-fw-text-muted">Day P&L</span>
            <span className={cn('text-[11px] font-mono font-bold tabular-nums', todayPnl >= 0 ? 'text-green' : 'text-red')}>
              {todayPnl >= 0 ? '+' : ''}₹{fmtRisk(Math.abs(todayPnl))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Activity size={9} className="text-fw-text-muted" />
            <span className="text-[9px] text-fw-text-muted">Trades</span>
            <span className="text-[10px] font-mono font-bold text-fw-text tabular-nums">{todayTrades}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-fw-text-muted">Equity</span>
          <span className="text-[10px] font-mono font-bold text-fw-text tabular-nums">₹{fmtRisk(equity)}</span>
        </div>
      </div>

      {/* Risk Metrics — Dense Grid */}
      <div className="px-3 py-2 space-y-2">
        <RiskRow
          icon={<TrendingDown size={10} />}
          label="Daily Loss"
          pct={dailyPct}
          remaining={dailyLossRemaining}
          limit={dailyLossLimit}
          color="red"
        />
        <RiskRow
          icon={<AlertTriangle size={10} />}
          label="Max Drawdown"
          pct={ddPct}
          remaining={ddRemaining}
          limit={maxDrawdownLimit}
          color="orange"
        />
        <RiskRow
          icon={<Target size={10} />}
          label="Profit Target"
          pct={targetPct}
          remaining={targetRemaining}
          limit={profitTargetAmount}
          color="green"
          isTarget
        />
      </div>
    </div>
  );
}

function RiskRow({ icon, label, pct, remaining, limit, color, isTarget }: {
  icon: React.ReactNode; label: string; pct: number; remaining: number; limit: number; color: 'red' | 'orange' | 'green'; isTarget?: boolean;
}) {
  const barColor = color === 'red' ? 'bg-red-500' : color === 'orange' ? 'bg-orange-500' : 'bg-emerald-500';
  const textColor = color === 'red' ? 'text-red-400' : color === 'orange' ? 'text-orange-400' : 'text-emerald-400';
  const bgTint = color === 'red' ? 'bg-red-500/6' : color === 'orange' ? 'bg-orange-500/6' : 'bg-emerald-500/6';
  const iconColor = color === 'red' ? 'text-red-400/70' : color === 'orange' ? 'text-orange-400/70' : 'text-emerald-400/70';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={iconColor}>{icon}</span>
          <span className="text-[10px] text-fw-text-secondary font-semibold">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-fw-text-muted font-mono tabular-nums">
            {isTarget ? `₹${fmtRisk(Math.max(0, limit - remaining))} / ₹${fmtRisk(limit)}` : `₹${fmtRisk(remaining)} left`}
          </span>
          <span className={cn('text-[10px] font-mono font-black tabular-nums min-w-[28px] text-right', textColor)}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className={cn('h-[5px] rounded-full overflow-hidden', bgTint)}>
        <div className={cn('h-full rounded-full transition-all duration-700', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string; border: string }> = {
    SAFE: { bg: 'bg-emerald-900/15', text: 'text-emerald-400', border: 'border-emerald-800/30' },
    CAUTION: { bg: 'bg-yellow-900/15', text: 'text-yellow-400', border: 'border-yellow-800/30' },
    HIGH: { bg: 'bg-orange-900/15', text: 'text-orange-400', border: 'border-orange-800/30' },
    CRITICAL: { bg: 'bg-red-900/15', text: 'text-red-400', border: 'border-red-800/30' },
  };
  const c = config[level] || config.SAFE;
  return (
    <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold', c.bg, c.border)}>
      <Shield size={8} className={c.text} />
      <span className={c.text}>{level}</span>
    </div>
  );
}

function fmtRisk(val: number): string {
  if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return val.toFixed(0);
}
