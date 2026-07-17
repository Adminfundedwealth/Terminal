import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { apiService } from '@/services/api';

interface DayMetric {
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

export function CalendarAnalytics() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [metrics, setMetrics] = useState<Record<string, DayMetric>>({});
  const [selected, setSelected] = useState<DayMetric | null>(null);
  const [monthStats, setMonthStats] = useState({ pnl: 0, trades: 0, tradingDays: 0, winDays: 0 });

  useEffect(() => {
    async function load() {
      try {
        const from = new Date(year, month, 1).toISOString().split('T')[0];
        const to = new Date(year, month + 1, 0).toISOString().split('T')[0];
        const res = await apiService.get<any[]>(`/account/metrics?from=${from}&to=${to}`);
        const map: Record<string, DayMetric> = {};
        let totalPnl = 0, totalTrades = 0, tradingDays = 0, winDays = 0;

        for (const row of res || []) {
          map[row.date] = {
            date: row.date,
            pnl: row.realized_pnl,
            trades: row.total_trades,
            winRate: row.total_trades > 0 ? (row.winning_trades / row.total_trades) * 100 : 0,
          };
          if (row.total_trades > 0) {
            totalPnl += row.realized_pnl;
            totalTrades += row.total_trades;
            tradingDays++;
            if (row.realized_pnl > 0) winDays++;
          }
        }

        setMetrics(map);
        setMonthStats({ pnl: totalPnl, trades: totalTrades, tradingDays, winDays });
      } catch {
        // Empty
      }
    }
    load();
  }, [year, month]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0=Mon

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prev = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const today = new Date();

  return (
    <div className="flex flex-col h-full bg-fw-surface text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-fw-accent" />
          <span className="font-bold text-fw-text uppercase tracking-wide">Calendar Analytics</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prev} className="p-1 rounded hover:bg-fw-hover text-fw-text-secondary"><ChevronLeft className="w-4 h-4" /></button>
          <span className="font-bold text-fw-text w-28 text-center">{MONTHS[month]} {year}</span>
          <button onClick={next} className="p-1 rounded hover:bg-fw-hover text-fw-text-secondary"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Month Summary */}
      <div className="flex gap-4 px-4 py-2 border-b border-fw-border">
        <div>
          <div className="text-fw-text-secondary">Month P&L</div>
          <div className={`font-mono font-bold ${monthStats.pnl >= 0 ? 'text-green' : 'text-red'}`}>
            {monthStats.pnl >= 0 ? '+' : ''}₹{monthStats.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div className="text-fw-text-secondary">Trading Days</div>
          <div className="font-mono font-bold text-fw-text">{monthStats.tradingDays}</div>
        </div>
        <div>
          <div className="text-fw-text-secondary">Win Days</div>
          <div className="font-mono font-bold text-green">{monthStats.winDays}</div>
        </div>
        <div>
          <div className="text-fw-text-secondary">Total Trades</div>
          <div className="font-mono font-bold text-fw-text">{monthStats.trades}</div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto p-3">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS.map(d => (
            <div key={d} className="text-center text-fw-text-secondary font-bold py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} />;

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const metric = metrics[dateStr];
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const isWeekend = ((firstDow + day - 1) % 7) >= 5;
            const hasTrades = metric && metric.trades > 0;
            const isProfit = hasTrades && metric.pnl > 0;
            const isLoss = hasTrades && metric.pnl < 0;

            return (
              <div
                key={dateStr}
                onClick={() => setSelected(hasTrades ? metric : null)}
                className={`
                  relative rounded p-1.5 min-h-[52px] cursor-pointer transition-all border
                  ${isToday ? 'border-fw-accent' : 'border-transparent'}
                  ${isProfit ? 'bg-fw-green-dim hover:bg-[rgba(34,197,94,0.18)]' : ''}
                  ${isLoss ? 'bg-fw-red-dim hover:bg-[rgba(239,68,68,0.18)]' : ''}
                  ${!hasTrades ? 'bg-fw-surface-2 hover:bg-fw-hover' : ''}
                  ${isWeekend && !hasTrades ? 'opacity-40' : ''}
                `}
              >
                <div className={`font-bold ${isToday ? 'text-fw-accent' : 'text-fw-text'}`}>{day}</div>
                {hasTrades && (
                  <>
                    <div className={`font-mono text-xs font-bold mt-0.5 ${isProfit ? 'text-green' : 'text-red'}`}>
                      {isProfit ? '+' : ''}₹{Math.abs(metric.pnl) >= 1000
                        ? (metric.pnl / 1000).toFixed(1) + 'k'
                        : metric.pnl.toFixed(0)}
                    </div>
                    <div className="text-fw-text-secondary text-xs">{metric.trades}T</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Detail */}
      {selected && (
        <div className="px-4 py-2 border-t border-fw-border bg-fw-surface-2 flex items-center gap-6">
          <span className="text-fw-text-secondary">{selected.date}</span>
          <span className={`font-mono font-bold ${selected.pnl >= 0 ? 'text-green' : 'text-red'}`}>
            {selected.pnl >= 0 ? '+' : ''}₹{selected.pnl.toFixed(2)}
          </span>
          <span className="text-fw-text-secondary">{selected.trades} trades</span>
          <span className="text-fw-text-secondary">Win rate: {selected.winRate.toFixed(0)}%</span>
          <button onClick={() => setSelected(null)} className="ml-auto text-fw-text-secondary hover:text-fw-text">✕</button>
        </div>
      )}
    </div>
  );
}
