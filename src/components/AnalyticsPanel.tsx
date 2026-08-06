/**
 * ANALYTICS PANEL
 *
 * Fetches P&L and trade statistics from the server-side
 * /api/account/analytics endpoint (FIFO computation from the
 * executions table) instead of relying on the in-memory Zustand
 * store which is lost on page refresh and misses historical trades.
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/utils/helpers';
import { getAccountAnalytics, type AccountAnalytics } from '@/services/api';
import { RefreshCw } from 'lucide-react';

export function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AccountAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      setError(null);
      const data = await getAccountAnalytics();
      setAnalytics(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and refresh every 15 seconds
  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[14px] text-fw-text-secondary animate-pulse">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="text-[14px] text-red-400">{error}</div>
        <button
          onClick={fetchAnalytics}
          className="text-[13px] text-fw-accent hover:underline"
        >Retry</button>
      </div>
    );
  }

  const a = analytics!;
  const pf = a.profitFactor;

  return (
    <div className="h-full overflow-y-auto px-3 py-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[14px] font-bold text-fw-text">Performance Analytics</div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] text-fw-text-muted">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchAnalytics}
            className="p-1 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {a.totalTrades === 0 && a.unrealizedPnl === 0 ? (
        <div className="text-[14px] text-fw-text-secondary text-center py-8">
          No trades yet. Analytics will appear after your first completed trade.
        </div>
      ) : (
        <div className="space-y-3">

          {/* P&L Summary */}
          <div>
            <div className="text-[13px] text-fw-text-secondary uppercase font-semibold mb-1.5 tracking-wide">P&L Summary</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Daily P&L"   value={formatINR(a.dailyPnl)}   color={a.dailyPnl   >= 0 ? 'green' : 'red'} />
              <StatCard label="Weekly P&L"  value={formatINR(a.weeklyPnl)}  color={a.weeklyPnl  >= 0 ? 'green' : 'red'} />
              <StatCard label="Monthly P&L" value={formatINR(a.monthlyPnl)} color={a.monthlyPnl >= 0 ? 'green' : 'red'} />
              <StatCard label="Total P&L"   value={formatINR(a.totalPnl)}   color={a.totalPnl   >= 0 ? 'green' : 'red'} />
            </div>
          </div>

          {/* Unrealized P&L row if any open positions */}
          {a.unrealizedPnl !== 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-fw-bg border border-fw-border/50 rounded text-[13px]">
              <span className="text-fw-text-muted">Open P&L (Unrealized):</span>
              <span className={cn('font-bold font-mono', a.unrealizedPnl >= 0 ? 'text-green' : 'text-red')}>
                {formatINR(a.unrealizedPnl)}
              </span>
            </div>
          )}

          {/* Key Metrics */}
          <div>
            <div className="text-[13px] text-fw-text-secondary uppercase font-semibold mb-1.5 tracking-wide">Key Metrics</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Win Rate"      value={`${a.winRate.toFixed(1)}%`}                                  color={a.winRate >= 50 ? 'green' : 'red'} />
              <StatCard label="Profit Factor" value={pf === null ? '∞' : pf >= 100 ? '∞' : pf.toFixed(2)}        color={pf === null || pf >= 1.5 ? 'green' : pf >= 1 ? 'yellow' : 'red'} />
              <StatCard label="Avg RR"        value={a.avgRR > 0 ? `1:${a.avgRR.toFixed(1)}` : '—'}              color={a.avgRR >= 1.5 ? 'green' : 'yellow'} />
              <StatCard label="Expectancy"    value={formatINR(a.expectancy)}                                     color={a.expectancy > 0 ? 'green' : 'red'} />
            </div>
          </div>

          {/* Trade Stats */}
          <div>
            <div className="text-[13px] text-fw-text-secondary uppercase font-semibold mb-1.5 tracking-wide">Trade Statistics</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Total Trades"   value={a.totalTrades.toString()} />
              <StatCard label="Today's Trades" value={a.dailyTradeCount.toString()} />
              <StatCard label="Winners"        value={a.winners.toString()} color="green" />
              <StatCard label="Losers"         value={a.losers.toString()}  color="red" />
              <StatCard label="Avg Win"        value={`+${formatINR(a.avgWin)}`}  color="green" />
              <StatCard label="Avg Loss"       value={`-${formatINR(a.avgLoss)}`} color="red" />
              <StatCard label="Best Trade"     value={formatINR(a.bestTrade)}     color="green" />
              <StatCard label="Worst Trade"    value={formatINR(a.worstTrade)}    color="red" />
              <StatCard label="Max Win Streak"  value={a.maxWinStreak.toString()}  color="green" />
              <StatCard label="Max Loss Streak" value={a.maxLossStreak.toString()} color="red" />
              <StatCard label="Today Win Rate"  value={`${a.dailyWinRate.toFixed(0)}%`} color={a.dailyWinRate >= 50 ? 'green' : 'red'} />
              <StatCard label="Gross Profit"    value={formatINR(a.grossProfit)}   color="green" />
            </div>
          </div>

          {/* Symbol Breakdown */}
          {a.symbolBreakdown && a.symbolBreakdown.length > 0 && (
            <div>
              <div className="text-[13px] text-fw-text-secondary uppercase font-semibold mb-1.5 tracking-wide">By Symbol</div>
              <div className="space-y-1">
                {a.symbolBreakdown.map((s) => (
                  <div key={s.symbol} className="flex items-center justify-between px-2 py-1 bg-fw-bg border border-fw-border/40 rounded text-[13px]">
                    <span className="text-fw-text font-medium">{s.symbol}</span>
                    <span className="text-fw-text-muted">{s.trades} trade{s.trades !== 1 ? 's' : ''}</span>
                    <span className={cn('font-bold font-mono', s.pnl >= 0 ? 'text-green' : 'text-red')}>
                      {formatINR(s.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'yellow' }) {
  const textColor = color === 'green' ? 'text-green' : color === 'red' ? 'text-red' : color === 'yellow' ? 'text-yellow-400' : 'text-fw-text';
  return (
    <div className="bg-fw-bg border border-fw-border rounded px-2 py-1.5">
      <div className="text-[11px] text-fw-text-muted uppercase tracking-wide leading-tight mb-0.5">{label}</div>
      <div className={cn('text-[14px] font-bold font-mono', textColor)}>{value}</div>
    </div>
  );
}

function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000)     return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}
