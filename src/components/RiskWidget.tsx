import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { cn, getChallengeRulePct, formatChallengePhase } from '@/utils/helpers';
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

  const balance = riskState?.balance ?? account?.balance ?? 0;
  const equity = riskState?.currentEquity ?? balance;

  // initialBalance must be > 0 to avoid divide-by-zero in all limit calculations.
  // Prefer the authoritative server value, then challenge config, then current balance —
  // but only use balance as a fallback when it is actually non-zero.
  const rawInitial = riskState?.initialBalance ?? account?.challenge?.initialBalance ?? (balance > 0 ? balance : null);
  const initialBalance = rawInitial && rawInitial > 0 ? rawInitial : null;

  const challengePlan = account?.challenge?.plan;
  const dailyLossLimitPct = getChallengeRulePct(account?.challenge?.dailyLossLimitPct, challengePlan, 'dailyLossLimitPct');
  const maxDrawdownPct = getChallengeRulePct(account?.challenge?.maxDrawdownPct, challengePlan, 'maxDrawdownPct');
  const profitTargetPct = getChallengeRulePct(account?.challenge?.profitTargetPct, challengePlan, 'profitTargetPct');

  // Limits: prefer server values; fall back only when initialBalance is known
  const dailyLossLimit = riskState?.dailyLossLimit ?? (initialBalance ? initialBalance * (dailyLossLimitPct / 100) : null);
  const maxDrawdownLimit = riskState?.maxDrawdownLimit ?? (initialBalance ? initialBalance * (maxDrawdownPct / 100) : null);
  const profitTargetAmount = riskState?.profitTargetAmount ?? (initialBalance ? initialBalance * (profitTargetPct / 100) : null);

  const dailyLoss = riskState?.dailyLoss ?? 0;
  // Remaining: only compute when we have a valid limit; otherwise show null (loading)
  const dailyLossRemaining = riskState?.dailyLossRemaining ?? (dailyLossLimit != null ? Math.max(0, dailyLossLimit - dailyLoss) : null);
  const dailyPct = riskState?.dailyLossUsedPct ?? (dailyLossLimit != null && dailyLossLimit > 0 ? Math.min(100, (dailyLoss / dailyLossLimit) * 100) : null);

  const drawdown = riskState?.drawdown ?? 0;
  const ddRemaining = riskState?.maxDrawdownRemaining ?? (maxDrawdownLimit != null ? Math.max(0, maxDrawdownLimit - drawdown) : null);
  const ddPct = riskState?.maxDrawdownUsedPct ?? (maxDrawdownLimit != null && maxDrawdownLimit > 0 ? Math.min(100, (drawdown / maxDrawdownLimit) * 100) : null);

  const targetPct = riskState?.targetProgressPct ?? 0;
  const targetRemaining = riskState?.targetRemaining ?? (profitTargetAmount ?? 0);

  const totalMTM = positions.reduce((s, p) => s + (p.mtm || p.pnl || 0), 0);
  const todayPnl = riskState?.totalDailyPnl ?? totalMTM;
  const todayTrades = riskState?.todayTradeCount ?? 0;

  const phase = formatChallengePhase(account?.challenge?.plan, account?.challenge?.type || riskState?.challengeType);
  const status = riskState?.accountStatus || account?.status || 'active';
  const isLocked = status === 'locked' || status === 'breached';

  const overallRisk = Math.max(dailyPct ?? 0, ddPct ?? 0);
  const riskLevel = overallRisk > 80 ? 'CRITICAL' : overallRisk > 60 ? 'HIGH' : overallRisk > 30 ? 'CAUTION' : 'SAFE';

  return (
    <div className="border-b border-fw-border bg-gradient-to-b from-[#0c0e16] to-[#0a0c12] select-none">
      {/* Challenge Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border/30">
        <div className="flex items-center gap-2">
          <div className="fw-badge fw-badge-blue">
            <Zap size={9} className="text-fw-accent" />
            {phase}
          </div>
          {isLocked && (
            <div className="fw-badge fw-badge-red">
              <Lock size={8} className="text-red-400" />
              LOCKED
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
            <span className="text-[13px] text-fw-text-muted">Day P&L</span>
            <span className={cn('text-[13px] font-mono font-bold tabular-nums', todayPnl >= 0 ? 'text-green' : 'text-red')}>
              {todayPnl >= 0 ? '+' : ''}₹{fmtRisk(Math.abs(todayPnl))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Activity size={9} className="text-fw-text-muted" />
            <span className="text-[13px] text-fw-text-muted">Trades</span>
            <span className="text-[14px] font-mono font-bold text-fw-text tabular-nums">{todayTrades}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[13px] text-fw-text-muted">Equity</span>
          <span className="text-[14px] font-mono font-bold text-fw-text tabular-nums">₹{fmtRisk(equity)}</span>
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
          limit={profitTargetAmount ?? 0}
          color="green"
          isTarget
        />
      </div>
    </div>
  );
}

function RiskRow({ icon, label, pct, remaining, limit, color, isTarget }: {
  icon: React.ReactNode;
  label: string;
  pct: number | null;
  remaining: number | null;
  limit: number | null;
  color: 'red' | 'orange' | 'green';
  isTarget?: boolean;
}) {
  const barColor = color === 'red' ? 'bg-red-500' : color === 'orange' ? 'bg-orange-500' : 'bg-emerald-500';
  const textColor = color === 'red' ? 'text-red-400' : color === 'orange' ? 'text-orange-400' : 'text-emerald-400';
  const bgTint = color === 'red' ? 'bg-red-500/6' : color === 'orange' ? 'bg-orange-500/6' : 'bg-emerald-500/6';
  const iconColor = color === 'red' ? 'text-red-400/70' : color === 'orange' ? 'text-orange-400/70' : 'text-emerald-400/70';

  // Not yet loaded — render a neutral placeholder row
  const isLoading = pct == null || remaining == null || limit == null;

  const safePct = isLoading ? 0 : Math.min(pct!, 100);
  const pctLabel = isLoading ? '—' : `${pct!.toFixed(0)}%`;
  const remainingLabel = isLoading
    ? '—'
    : isTarget
      ? `₹${fmtRisk(Math.max(0, limit! - remaining!))} / ₹${fmtRisk(limit!)}`
      : `₹${fmtRisk(remaining!)} left`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={iconColor}>{icon}</span>
          <span className="text-[14px] text-fw-text-secondary font-semibold">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-fw-text-muted font-mono tabular-nums">
            {remainingLabel}
          </span>
          <span className={cn(
            'text-[14px] font-mono font-black tabular-nums min-w-[28px] text-right',
            isLoading ? 'text-fw-text-muted' : textColor,
          )}>
            {pctLabel}
          </span>
        </div>
      </div>
      <div className={cn('h-[5px] rounded-full overflow-hidden', bgTint)}>
        <div
          className={cn('h-full rounded-full transition-all duration-700', isLoading ? 'bg-fw-border/40' : barColor)}
          style={{ width: `${safePct}%` }}
        />
      </div>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const variantMap: Record<string, string> = {
    SAFE: 'fw-badge-green',
    CAUTION: 'fw-badge-yellow',
    HIGH: 'fw-badge-orange',
    CRITICAL: 'fw-badge-red',
  };
  const iconColorMap: Record<string, string> = {
    SAFE: 'text-emerald-400',
    CAUTION: 'text-yellow-400',
    HIGH: 'text-orange-400',
    CRITICAL: 'text-red-400',
  };
  const variant = variantMap[level] || 'fw-badge-green';
  const iconColor = iconColorMap[level] || 'text-emerald-400';
  return (
    <div className={cn('fw-badge', variant)}>
      <Shield size={8} className={iconColor} />
      {level}
    </div>
  );
}

function fmtRisk(val: number): string {
  if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return val.toFixed(0);
}
