import { useMemo, useState } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useJournalStore } from '@/store/journalStore';
import { cn } from '@/utils/helpers';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Calendar Analytics Panel
 * Shows a monthly calendar with P&L heatmap per day.
 * Data from journal entries + positions.
 */
export function CalendarAnalyticsPanel() {
  const { entries } = useJournalStore();
  const positions = useTradingStore((s) => s.positions);

  const [viewDate, setViewDate] = useState(new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() - 1); setViewDate(d); };
  const nextMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() + 1); setViewDate(d); };

  const dayPnlMap = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>();
    entries.forEach(e => {
      if (e.pnl) {
        const existing = map.get(e.date) || { pnl: 0, trades: 0 };
        existing.pnl += e.pnl;
        existing.trades++;
        map.set(e.date, existing);
      }
    });
    // Today's unrealized from positions
    const today = new Date().toISOString().split('T')[0];
    const todayPnl = positions.reduce((s, p) => s + p.pnl, 0);
    if (todayPnl !== 0) {
      const existing = map.get(today) || { pnl: 0, trades: 0 };
      existing.pnl += todayPnl;
      existing.trades += positions.length;
      map.set(today, existing);
    }
    return map;
  }, [entries, positions]);

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const monthStr = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Summary stats for displayed month
  const monthStats = useMemo(() => {
    let totalPnl = 0, greenDays = 0, redDays = 0, totalTrades = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const data = dayPnlMap.get(dateStr);
      if (data) {
        totalPnl += data.pnl;
        totalTrades += data.trades;
        if (data.pnl > 0) greenDays++;
        else if (data.pnl < 0) redDays++;
      }
    }
    return { totalPnl, greenDays, redDays, totalTrades };
  }, [dayPnlMap, year, month, daysInMonth]);

  const maxDayPnl = Math.max(...Array.from(dayPnlMap.values()).map(v => Math.abs(v.pnl)), 1);

  return (
    <div className="h-full flex flex-col bg-[#0c0e14]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-fw-hover text-fw-text-muted"><ChevronLeft size={14} /></button>
          <span className="text-[14px] font-bold text-fw-text w-36 text-center">{monthStr}</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-fw-hover text-fw-text-muted"><ChevronRight size={14} /></button>
        </div>
        <div className="flex items-center gap-3 text-[14px]">
          <span className={cn('font-mono font-bold', monthStats.totalPnl >= 0 ? 'text-green' : 'text-red')}>
            {monthStats.totalPnl >= 0 ? '+' : ''}₹{monthStats.totalPnl.toLocaleString('en-IN')}
          </span>
          <span className="text-green">{monthStats.greenDays}G</span>
          <span className="text-red">{monthStats.redDays}R</span>
          <span className="text-fw-text-muted">{monthStats.totalTrades} trades</span>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 px-3 py-1.5 border-b border-fw-border/30 flex-shrink-0">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-[13px] font-bold text-fw-text-muted uppercase">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5 mb-0.5">
            {week.map((day, di) => {
              if (day === null) return <div key={di} />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const data = dayPnlMap.get(dateStr);
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              const intensity = data ? Math.min(Math.abs(data.pnl) / maxDayPnl, 1) : 0;

              let bgColor = 'transparent';
              if (data && data.pnl > 0) bgColor = `rgba(34,197,94,${0.1 + intensity * 0.4})`;
              else if (data && data.pnl < 0) bgColor = `rgba(239,68,68,${0.1 + intensity * 0.4})`;

              return (
                <div
                  key={di}
                  className={cn(
                    'aspect-square rounded p-1 flex flex-col items-center justify-center relative transition-colors',
                    isToday && 'ring-1 ring-fw-accent',
                    !data && 'opacity-60'
                  )}
                  style={{ backgroundColor: bgColor }}
                >
                  <span className={cn('text-[13px] font-bold', isToday ? 'text-fw-accent' : data ? 'text-fw-text' : 'text-fw-text-muted')}>{day}</span>
                  {data && (
                    <span className={cn('text-[8px] font-mono font-bold', data.pnl >= 0 ? 'text-green' : 'text-red')}>
                      {data.pnl >= 0 ? '+' : ''}{data.pnl >= 1000 ? `${(data.pnl / 1000).toFixed(1)}K` : data.pnl.toFixed(0)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
