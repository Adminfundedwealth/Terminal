import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useJournalStore } from '@/store/journalStore';
import { getRiskState } from '@/services/api';
import { cn, getChallengeRulePct } from '@/utils/helpers';
import { ShieldAlert, TrendingDown, Target, AlertTriangle, BarChart3, Activity } from 'lucide-react';

export function RiskPanel() {
  const positions = useTradingStore((s) => s.positions);
  const orders = useTradingStore((s) => s.orders);
  const account = useTradingStore((s) => s.account);
  const { entries } = useJournalStore();

  // Live risk state from server (includes closed-trade P&L)
  const [riskState, setRiskState] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getRiskState()
        .then(r => { if (!cancelled) setRiskState(r); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Account fundamentals — prefer server riskState, fall back to store
  const balance = riskState?.balance || account?.balance || 0;
  const initialBalance = riskState?.initialBalance || account?.challenge?.initialBalance || balance || 1000000;
  const peakBalance = riskState?.peakBalance || account?.peakBalance || Math.max(balance, initialBalance);
  const availableMargin = account?.availableMargin || balance;
  const usedMargin = account?.usedMargin || 0;
  const challengePlan = account?.challenge?.plan;

  // Use server-computed P&L (includes ALL closed trades, not just open positions)
  const todayRealizedPnl = riskState?.todayRealizedPnl ?? 0;
  const unrealizedPnl = riskState?.unrealizedPnl ?? positions.reduce((s, p) => s + (p.mtm || 0), 0);
  const totalDailyPnl = riskState?.totalDailyPnl ?? (todayRealizedPnl + unrealizedPnl);
  const totalMTM = unrealizedPnl;
  const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);

  const openPositionCount = positions.length;
  const longPositions = positions.filter((p) => p.qty > 0);
  const shortPositions = positions.filter((p) => p.qty < 0);

  // Exposure calculation
  const totalExposure = positions.reduce((sum, p) => sum + Math.abs(p.avgPrice * p.qty), 0);
  const longExposure = longPositions.reduce((sum, p) => sum + (p.avgPrice * p.qty), 0);
  const shortExposure = shortPositions.reduce((sum, p) => sum + Math.abs(p.avgPrice * p.qty), 0);
  const netExposure = longExposure - shortExposure;

  // Risk limits (challenge-based or standard prop firm rules)
  const dailyLossLimitPct = getChallengeRulePct(account?.challenge?.dailyLossLimitPct, challengePlan, 'dailyLossLimitPct');
  const maxDrawdownPct = getChallengeRulePct(account?.challenge?.maxDrawdownPct, challengePlan, 'maxDrawdownPct');
  const profitTargetPct = getChallengeRulePct(account?.challenge?.profitTargetPct, challengePlan, 'profitTargetPct');
  const dailyLossLimit = riskState?.dailyLossLimit || initialBalance * (dailyLossLimitPct / 100);
  const maxDrawdownLimit = riskState?.maxDrawdownLimit || initialBalance * (maxDrawdownPct / 100);
  const profitTarget = initialBalance * (profitTargetPct / 100);
  const maxPositionSize = initialBalance * 0.20;

  // Use server daily loss (negative totalDailyPnl = loss)
  const dailyLoss = totalDailyPnl < 0 ? Math.abs(totalDailyPnl) : 0;
  const dailyLossPct = dailyLossLimit > 0 ? (dailyLoss / dailyLossLimit) * 100 : 0;

  // Drawdown — prefer server value
  const drawdown = riskState?.drawdown ?? Math.max(0, peakBalance - (balance + totalMTM));
  const drawdownPct = maxDrawdownLimit > 0 ? (drawdown / maxDrawdownLimit) * 100 : 0;
  const drawdownFromPeakPct = peakBalance > 0 ? (drawdown / peakBalance) * 100 : 0;

  // Profit progress — use server pnlFromStart if available
  const pnlFromStart = riskState?.pnlFromStart ?? (balance + totalMTM - initialBalance);
  const profitAchieved = pnlFromStart;
  const targetPct = profitTarget > 0 ? (Math.max(0, profitAchieved) / profitTarget) * 100 : 0;
  const currentEquity = riskState?.currentEquity ?? (balance + totalMTM);

  // Margin utilization
  const marginUtilization = balance > 0 ? (usedMargin / balance) * 100 : 0;

  // Largest position risk
  const largestPosition = positions.reduce((max, p) => {
    const posValue = Math.abs(p.avgPrice * p.qty);
    return posValue > max ? posValue : max;
  }, 0);
  const largestPositionPct = maxPositionSize > 0 ? (largestPosition / maxPositionSize) * 100 : 0;

  // Open orders exposure
  const pendingOrdersExposure = orders
    .filter((o) => o.status === 'OPEN')
    .reduce((sum, o) => sum + (o.price || 0) * o.qty, 0);

  // Win/loss from journal
  const recentEntries = entries.slice(0, 20);
  const recentWins = recentEntries.filter((e) => (e.pnl || 0) > 0).length;
  const recentLosses = recentEntries.filter((e) => (e.pnl || 0) < 0).length;
  const streakData = computeStreak(entries);

  // Risk score (0-100, higher = more risky)
  const riskScore = Math.min(100, Math.round(
    (dailyLossPct * 0.3) +
    (drawdownPct * 0.3) +
    (marginUtilization * 0.2) +
    (largestPositionPct * 0.2)
  ));

  const riskLevel = riskScore <= 30 ? 'LOW' : riskScore <= 60 ? 'MODERATE' : riskScore <= 80 ? 'HIGH' : 'CRITICAL';
  const riskColor = riskScore <= 30 ? 'text-green' : riskScore <= 60 ? 'text-yellow-400' : riskScore <= 80 ? 'text-orange-400' : 'text-red';
  const riskBg = riskScore <= 30 ? 'bg-green/10' : riskScore <= 60 ? 'bg-yellow-400/10' : riskScore <= 80 ? 'bg-orange-400/10' : 'bg-red/10';

  return (
    <div className="h-full overflow-y-auto px-3 py-2">
      {/* Risk Score Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className={riskColor} />
          <span className="text-[14px] font-bold text-fw-text">Risk Management Dashboard</span>
        </div>
        <div className={cn('flex items-center gap-2 px-3 py-1 rounded-md', riskBg)}>
          <span className="text-[14px] text-fw-text-secondary">Risk Score:</span>
          <span className={cn('text-[16px] font-bold font-mono', riskColor)}>{riskScore}</span>
          <span className={cn('text-[14px] font-semibold', riskColor)}>{riskLevel}</span>
        </div>
      </div>

      {/* Main Risk Bars */}
      <div className="grid grid-cols-1 gap-2 mb-3">
        <RiskProgressBar
          label="Daily Loss Limit"
          current={dailyLoss}
          limit={dailyLossLimit}
          pct={dailyLossPct}
          color="red"
          icon={<TrendingDown size={12} />}
          formatVal={formatINR}
        />
        <RiskProgressBar
          label="Max Drawdown"
          current={Math.max(0, drawdown)}
          limit={maxDrawdownLimit}
          pct={drawdownPct}
          color="orange"
          icon={<AlertTriangle size={12} />}
          formatVal={formatINR}
        />
        <RiskProgressBar
          label="Profit Target"
          current={Math.max(0, profitAchieved)}
          limit={profitTarget}
          pct={targetPct}
          color="green"
          icon={<Target size={12} />}
          formatVal={formatINR}
        />
        <RiskProgressBar
          label="Margin Utilization"
          current={usedMargin}
          limit={balance || 1}
          pct={marginUtilization}
          color={marginUtilization > 80 ? 'red' : marginUtilization > 50 ? 'orange' : 'green'}
          icon={<BarChart3 size={12} />}
          formatVal={formatINR}
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <MetricCard label="Equity" value={formatINR(currentEquity)} />
        <MetricCard label="Balance" value={formatINR(balance)} />
        <MetricCard label="Today Realized" value={formatINR(todayRealizedPnl)} color={todayRealizedPnl >= 0 ? 'green' : 'red'} />
        <MetricCard label="Unrealized" value={formatINR(unrealizedPnl)} color={unrealizedPnl >= 0 ? 'green' : 'red'} />
        <MetricCard label="Peak Balance" value={formatINR(peakBalance)} />
        <MetricCard label="DD from Peak" value={`${drawdownFromPeakPct.toFixed(2)}%`} color={drawdownFromPeakPct > 5 ? 'red' : drawdownFromPeakPct > 2 ? 'orange' : 'green'} />
        <MetricCard label="Open Positions" value={openPositionCount.toString()} />
        <MetricCard label="Total Daily P&L" value={formatINR(totalDailyPnl)} color={totalDailyPnl >= 0 ? 'green' : 'red'} />
        <MetricCard label="Long Exposure" value={formatINR(longExposure)} color="green" />
        <MetricCard label="Short Exposure" value={formatINR(shortExposure)} color="red" />
        <MetricCard label="Net Exposure" value={formatINR(netExposure)} color={netExposure >= 0 ? 'green' : 'red'} />
        <MetricCard label="Available Margin" value={formatINR(availableMargin)} />
      </div>

      {/* Streak & Performance */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-fw-bg border border-fw-border rounded px-3 py-2">
          <div className="text-[13px] text-fw-text-secondary uppercase mb-1">Current Streak</div>
          <div className={cn('text-[14px] font-bold font-mono', streakData.type === 'win' ? 'text-green' : streakData.type === 'loss' ? 'text-red' : 'text-fw-text-secondary')}>
            {streakData.count > 0 ? `${streakData.count} ${streakData.type === 'win' ? 'Wins' : 'Losses'}` : 'No data'}
          </div>
        </div>
        <div className="bg-fw-bg border border-fw-border rounded px-3 py-2">
          <div className="text-[13px] text-fw-text-secondary uppercase mb-1">Recent (Last 20)</div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-mono text-green">{recentWins}W</span>
            <span className="text-[14px] text-fw-text-secondary">/</span>
            <span className="text-[14px] font-mono text-red">{recentLosses}L</span>
          </div>
        </div>
        <div className="bg-fw-bg border border-fw-border rounded px-3 py-2">
          <div className="text-[13px] text-fw-text-secondary uppercase mb-1">Risk Alerts</div>
          <div className="space-y-0.5">
            {dailyLossPct >= 80 && <div className="text-[14px] text-red font-medium">⚠ Near daily limit</div>}
            {drawdownPct >= 80 && <div className="text-[14px] text-red font-medium">⚠ Near max DD</div>}
            {marginUtilization >= 80 && <div className="text-[14px] text-orange-400 font-medium">⚠ High margin use</div>}
            {dailyLossPct < 80 && drawdownPct < 80 && marginUtilization < 80 && (
              <div className="text-[14px] text-green font-medium">✓ All within limits</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskProgressBar({ label, current, limit, pct, color, icon, formatVal }: {
  label: string;
  current: number;
  limit: number;
  pct: number;
  color: 'red' | 'orange' | 'green';
  icon: React.ReactNode;
  formatVal: (v: number) => string;
}) {
  const barColor = color === 'red' ? 'bg-red-500' : color === 'orange' ? 'bg-orange-500' : 'bg-emerald-500';
  const textColor = color === 'red' ? 'text-red' : color === 'orange' ? 'text-orange-400' : 'text-green';
  const safePct = Math.min(Math.max(0, pct), 100);

  return (
    <div className="bg-fw-bg/50 border border-fw-border rounded px-3 py-1.5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-fw-text-secondary">
          {icon}
          <span className="text-[13px] font-medium">{label}</span>
        </div>
        <span className={cn('text-[13px] font-mono font-semibold', textColor)}>
          {formatVal(current)} / {formatVal(limit)} ({safePct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-fw-border rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${safePct}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'orange' }) {
  const textColor = color === 'green' ? 'text-green' : color === 'red' ? 'text-red' : color === 'orange' ? 'text-orange-400' : 'text-fw-text';
  return (
    <div className="bg-fw-bg border border-fw-border rounded px-2 py-1.5">
      <div className="text-[13px] text-fw-text-secondary uppercase">{label}</div>
      <div className={cn('text-[14px] font-bold font-mono truncate', textColor)}>{value}</div>
    </div>
  );
}

function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function computeStreak(entries: { pnl?: number }[]): { type: 'win' | 'loss' | 'none'; count: number } {
  if (entries.length === 0) return { type: 'none', count: 0 };

  const first = entries[0];
  if (!first.pnl) return { type: 'none', count: 0 };

  const type = first.pnl > 0 ? 'win' : 'loss';
  let count = 0;

  for (const entry of entries) {
    if (!entry.pnl) break;
    if (type === 'win' && entry.pnl > 0) count++;
    else if (type === 'loss' && entry.pnl < 0) count++;
    else break;
  }

  return { type, count };
}
