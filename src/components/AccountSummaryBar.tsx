import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';

function formatCompact(val: number): string {
  if (val == null || isNaN(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 10000000) return `${(val / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toFixed(0);
}

export function AccountSummaryBar() {
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);

  const balance = account?.balance || 0;
  const initialBalance = account?.challenge?.initialBalance || 10000000;
  const totalMTM = positions.reduce((sum, p) => sum + (p.pnl || p.mtm || 0), 0);
  const equity = balance + totalMTM;
  const dayPnl = account?.totalPnl || totalMTM;
  const totalPnl = account?.totalPnl || (balance - initialBalance + totalMTM);

  // Risk metrics
  const dailyLimit = balance * 0.05;
  const maxDrawdownLimit = balance * 0.10;
  const dailyLoss = totalMTM < 0 ? Math.abs(totalMTM) : 0;
  const dailyUsedPct = dailyLimit > 0 ? (dailyLoss / dailyLimit) * 100 : 0;

  const peakBalance = Math.max(balance, initialBalance);
  const drawdown = peakBalance - equity;
  const drawdownPct = maxDrawdownLimit > 0 ? (Math.max(0, drawdown) / maxDrawdownLimit) * 100 : 0;

  const profitTarget = initialBalance * 0.10;
  const profitAchieved = equity - initialBalance;
  const targetPct = profitTarget > 0 ? (Math.max(0, profitAchieved) / profitTarget) * 100 : 0;

  const phase = account?.challenge?.type || 'Phase 1';

  return (
    <div className="h-[30px] min-h-[30px] bg-fw-surface-2 border-b border-fw-border flex items-center px-3 gap-0 select-none overflow-x-auto scrollbar-none">
      {/* Balance */}
      <MetricPill label="Balance" value={`₹${formatCompact(balance)}`} />
      <Separator />
      {/* Equity */}
      <MetricPill label="Equity" value={`₹${formatCompact(equity)}`} className={equity >= balance ? 'text-green' : 'text-red'} />
      <Separator />
      {/* Day P&L */}
      <MetricPill
        label="Day P&L"
        value={`${dayPnl >= 0 ? '+' : ''}₹${formatCompact(dayPnl)}`}
        className={dayPnl >= 0 ? 'text-green' : 'text-red'}
      />
      <Separator />
      {/* Total P&L */}
      <MetricPill
        label="Total P&L"
        value={`${totalPnl >= 0 ? '+' : ''}₹${formatCompact(totalPnl)}`}
        className={totalPnl >= 0 ? 'text-green' : 'text-red'}
      />
      <Separator />
      {/* Drawdown Used */}
      <MetricPill
        label="DD Used"
        value={`${drawdownPct.toFixed(1)}%`}
        className={drawdownPct > 70 ? 'text-red' : drawdownPct > 40 ? 'text-orange-400' : 'text-green'}
      />
      <MiniBar pct={drawdownPct} color={drawdownPct > 70 ? 'red' : drawdownPct > 40 ? 'orange' : 'green'} />
      <Separator />
      {/* Target Progress */}
      <MetricPill
        label="Target"
        value={`${Math.min(targetPct, 100).toFixed(1)}%`}
        className={targetPct >= 100 ? 'text-green' : 'text-fw-text'}
      />
      <MiniBar pct={Math.min(targetPct, 100)} color="green" />
      <Separator />
      {/* Phase */}
      <div className="flex items-center gap-1.5 px-2">
        <span className="text-[9px] text-fw-text-muted uppercase">{phase}</span>
      </div>
    </div>
  );
}

function MetricPill({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2">
      <span className="text-[9px] text-fw-text-muted uppercase whitespace-nowrap">{label}</span>
      <span className={cn('text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap', className || 'text-fw-text')}>{value}</span>
    </div>
  );
}

function MiniBar({ pct, color }: { pct: number; color: 'red' | 'orange' | 'green' }) {
  const barColor = color === 'red' ? 'bg-red-500' : color === 'orange' ? 'bg-orange-500' : 'bg-emerald-500';
  return (
    <div className="w-12 h-1.5 bg-fw-border rounded-full overflow-hidden flex-shrink-0">
      <div className={cn('h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-fw-border/60 mx-0.5 flex-shrink-0" />;
}
