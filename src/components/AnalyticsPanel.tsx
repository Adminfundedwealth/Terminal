import { useMemo } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useJournalStore } from '@/store/journalStore';
import { cn } from '@/utils/helpers';

export function AnalyticsPanel() {
  const positions = useTradingStore((s) => s.positions);
  const orders = useTradingStore((s) => s.orders);
  const trades = useTradingStore((s) => s.trades);
  const { entries } = useJournalStore();

  const analytics = useMemo(() => {
    // Combine all trade data sources: positions P&L, executed trades, journal entries with P&L
    const allTrades: { pnl: number; date: string; symbol?: string }[] = [];

    // From positions (active P&L)
    positions.forEach((p) => {
      if (p.pnl !== 0) {
        allTrades.push({ pnl: p.pnl, date: new Date().toISOString().split('T')[0], symbol: p.symbol });
      }
    });

    // From journal entries (historical trades)
    entries.forEach((e) => {
      if (e.pnl !== undefined && e.pnl !== 0) {
        allTrades.push({ pnl: e.pnl, date: e.date, symbol: e.symbol });
      }
    });

    // From trade book (calculate P&L from buy/sell pairs)
    // Group trades by symbol to compute realized P&L
    const tradesBySymbol: Record<string, { side: string; qty: number; price: number; timestamp: string }[]> = {};
    trades.forEach((t) => {
      if (!tradesBySymbol[t.symbol]) tradesBySymbol[t.symbol] = [];
      tradesBySymbol[t.symbol].push({ side: t.side, qty: t.qty, price: t.price, timestamp: t.timestamp });
    });

    // Compute PnL from matched trades per symbol
    Object.entries(tradesBySymbol).forEach(([symbol, symbolTrades]) => {
      let netQty = 0;
      let avgCost = 0;
      symbolTrades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      for (const t of symbolTrades) {
        if (t.side === 'BUY') {
          avgCost = (avgCost * netQty + t.price * t.qty) / (netQty + t.qty);
          netQty += t.qty;
        } else {
          // SELL closes position
          const realizedPnl = (t.price - avgCost) * t.qty;
          if (netQty > 0) {
            allTrades.push({ pnl: realizedPnl, date: t.timestamp.split('T')[0], symbol });
          }
          netQty -= t.qty;
          if (netQty <= 0) { netQty = 0; avgCost = 0; }
        }
      }
    });

    const totalTrades = allTrades.length;
    const winners = allTrades.filter((t) => t.pnl > 0);
    const losers = allTrades.filter((t) => t.pnl < 0);
    const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
    const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
    const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
    const bestTrade = allTrades.length > 0 ? Math.max(...allTrades.map((t) => t.pnl)) : 0;
    const worstTrade = allTrades.length > 0 ? Math.min(...allTrades.map((t) => t.pnl)) : 0;
    const filledOrders = orders.filter((o) => o.status === 'FILLED').length;

    // Daily, Weekly, Monthly PnL calculations
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Get start of week (Monday)
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Get start of month
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const dailyPnl = allTrades.filter((t) => t.date === today).reduce((s, t) => s + t.pnl, 0);
    const weeklyPnl = allTrades.filter((t) => t.date >= weekStartStr).reduce((s, t) => s + t.pnl, 0);
    const monthlyPnl = allTrades.filter((t) => t.date >= monthStart).reduce((s, t) => s + t.pnl, 0);

    // Daily trades count for daily metrics
    const dailyTrades = allTrades.filter((t) => t.date === today);
    const dailyWinRate = dailyTrades.length > 0 ? (dailyTrades.filter((t) => t.pnl > 0).length / dailyTrades.length) * 100 : 0;

    // Consecutive wins/losses (streak)
    let maxWinStreak = 0, maxLossStreak = 0, currentStreak = 0, streakType: 'win' | 'loss' | null = null;
    for (const t of allTrades) {
      if (t.pnl > 0) {
        if (streakType === 'win') { currentStreak++; } else { currentStreak = 1; streakType = 'win'; }
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else if (t.pnl < 0) {
        if (streakType === 'loss') { currentStreak++; } else { currentStreak = 1; streakType = 'loss'; }
        maxLossStreak = Math.max(maxLossStreak, currentStreak);
      }
    }

    // Expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss)
    const expectancy = totalTrades > 0 ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;

    return {
      totalTrades, winners: winners.length, losers: losers.length,
      winRate, totalPnl, grossProfit, grossLoss, profitFactor,
      avgWin, avgLoss, avgRR, bestTrade, worstTrade, filledOrders,
      dailyPnl, weeklyPnl, monthlyPnl, dailyWinRate,
      maxWinStreak, maxLossStreak, expectancy,
      dailyTradeCount: dailyTrades.length,
    };
  }, [positions, orders, trades, entries]);

  return (
    <div className="h-full overflow-y-auto px-3 py-2">
      <div className="text-[12px] font-bold text-fw-text mb-2">Performance Analytics</div>

      {analytics.totalTrades === 0 ? (
        <div className="text-[12px] text-fw-text-secondary text-center py-8">
          No trade data yet. Analytics compute from positions, trade book, and journal entries.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Period P&L Section */}
          <div>
            <div className="text-[10px] text-fw-text-secondary uppercase font-semibold mb-1.5">P&L Summary</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Daily P&L" value={formatINR(analytics.dailyPnl)} color={analytics.dailyPnl >= 0 ? 'green' : 'red'} />
              <StatCard label="Weekly P&L" value={formatINR(analytics.weeklyPnl)} color={analytics.weeklyPnl >= 0 ? 'green' : 'red'} />
              <StatCard label="Monthly P&L" value={formatINR(analytics.monthlyPnl)} color={analytics.monthlyPnl >= 0 ? 'green' : 'red'} />
              <StatCard label="Total P&L" value={formatINR(analytics.totalPnl)} color={analytics.totalPnl >= 0 ? 'green' : 'red'} />
            </div>
          </div>

          {/* Key Metrics */}
          <div>
            <div className="text-[10px] text-fw-text-secondary uppercase font-semibold mb-1.5">Key Metrics</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Win Rate" value={`${analytics.winRate.toFixed(1)}%`} color={analytics.winRate >= 50 ? 'green' : 'red'} />
              <StatCard label="Profit Factor" value={analytics.profitFactor === Infinity ? '∞' : analytics.profitFactor.toFixed(2)} color={analytics.profitFactor >= 1.5 ? 'green' : analytics.profitFactor >= 1 ? 'yellow' : 'red'} />
              <StatCard label="Avg RR" value={analytics.avgRR > 0 ? `1:${analytics.avgRR.toFixed(1)}` : '—'} color={analytics.avgRR >= 1.5 ? 'green' : 'yellow'} />
              <StatCard label="Expectancy" value={formatINR(analytics.expectancy)} color={analytics.expectancy > 0 ? 'green' : 'red'} />
            </div>
          </div>

          {/* Trade Stats */}
          <div>
            <div className="text-[10px] text-fw-text-secondary uppercase font-semibold mb-1.5">Trade Statistics</div>
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Total Trades" value={analytics.totalTrades.toString()} />
              <StatCard label="Today's Trades" value={analytics.dailyTradeCount.toString()} />
              <StatCard label="Winners" value={analytics.winners.toString()} color="green" />
              <StatCard label="Losers" value={analytics.losers.toString()} color="red" />
              <StatCard label="Avg Win" value={`+${formatINR(analytics.avgWin)}`} color="green" />
              <StatCard label="Avg Loss" value={`-${formatINR(analytics.avgLoss)}`} color="red" />
              <StatCard label="Best Trade" value={formatINR(analytics.bestTrade)} color="green" />
              <StatCard label="Worst Trade" value={formatINR(analytics.worstTrade)} color="red" />
              <StatCard label="Max Win Streak" value={analytics.maxWinStreak.toString()} color="green" />
              <StatCard label="Max Loss Streak" value={analytics.maxLossStreak.toString()} color="red" />
              <StatCard label="Today Win Rate" value={`${analytics.dailyWinRate.toFixed(0)}%`} color={analytics.dailyWinRate >= 50 ? 'green' : 'red'} />
              <StatCard label="Orders Filled" value={analytics.filledOrders.toString()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'yellow' }) {
  const textColor = color === 'green' ? 'text-green' : color === 'red' ? 'text-red' : color === 'yellow' ? 'text-yellow-400' : 'text-fw-text';
  return (
    <div className="bg-fw-bg border border-fw-border rounded px-2 py-1.5">
      <div className="text-[9px] text-fw-text-secondary uppercase">{label}</div>
      <div className={cn('text-[14px] font-bold font-mono', textColor)}>{value}</div>
    </div>
  );
}

function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}
