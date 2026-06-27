import { useEffect, useRef, useMemo } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useJournalStore } from '@/store/journalStore';
import { cn } from '@/utils/helpers';

/**
 * Equity Curve Panel
 * Renders a visual equity curve from trade data + journal entries.
 * Uses canvas for performance. Persists via analytics_snapshots table.
 */
export function EquityCurvePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positions = useTradingStore((s) => s.positions);
  const trades = useTradingStore((s) => s.trades);
  const { entries } = useJournalStore();

  const equityData = useMemo(() => {
    const points: { date: string; balance: number; pnl: number }[] = [];
    let balance = 100000; // Starting balance

    // Collect all P&L events sorted by date
    const allPnl: { date: string; pnl: number }[] = [];

    entries.forEach(e => {
      if (e.pnl) allPnl.push({ date: e.date, pnl: e.pnl });
    });

    // Sort by date
    allPnl.sort((a, b) => a.date.localeCompare(b.date));

    // Build equity curve
    const dateMap = new Map<string, number>();
    for (const p of allPnl) {
      dateMap.set(p.date, (dateMap.get(p.date) || 0) + p.pnl);
    }

    for (const [date, dayPnl] of dateMap) {
      balance += dayPnl;
      points.push({ date, balance, pnl: dayPnl });
    }

    // Add today's unrealized P&L
    const todayPnl = positions.reduce((s, p) => s + p.pnl, 0);
    if (todayPnl !== 0) {
      const today = new Date().toISOString().split('T')[0];
      balance += todayPnl;
      points.push({ date: today, balance, pnl: todayPnl });
    }

    return points;
  }, [positions, trades, entries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || equityData.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    const w = rect.width;
    const h = rect.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    const balances = equityData.map(d => d.balance);
    const minBal = Math.min(...balances) * 0.995;
    const maxBal = Math.max(...balances) * 1.005;
    const range = maxBal - minBal || 1;

    // Draw grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw equity line
    ctx.beginPath();
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    equityData.forEach((d, i) => {
      const x = (i / (equityData.length - 1)) * w;
      const y = h - ((d.balance - minBal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under curve
    const lastX = w;
    const lastY = h - ((equityData[equityData.length - 1].balance - minBal) / range) * h;
    ctx.lineTo(lastX, h);
    ctx.lineTo(0, h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(79,70,229,0.2)');
    gradient.addColorStop(1, 'rgba(79,70,229,0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw start/end balance labels
    ctx.font = '10px Inter, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`₹${balances[0]?.toLocaleString('en-IN')}`, 4, 14);
    ctx.fillText(`₹${balances[balances.length - 1]?.toLocaleString('en-IN')}`, w - 80, lastY - 4);
  }, [equityData]);

  const totalReturn = equityData.length > 0 ? equityData[equityData.length - 1].balance - 100000 : 0;
  const returnPct = (totalReturn / 100000) * 100;
  const maxDrawdown = useMemo(() => {
    let peak = 100000;
    let maxDD = 0;
    for (const d of equityData) {
      if (d.balance > peak) peak = d.balance;
      const dd = ((peak - d.balance) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }, [equityData]);

  return (
    <div className="h-full flex flex-col bg-[#0c0e14]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        <span className="text-[12px] font-bold text-fw-text">Equity Curve</span>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[9px] text-fw-text-muted block">Return</span>
            <span className={cn('text-[12px] font-mono font-bold', totalReturn >= 0 ? 'text-green' : 'text-red')}>
              {totalReturn >= 0 ? '+' : ''}₹{totalReturn.toLocaleString('en-IN')} ({returnPct.toFixed(2)}%)
            </span>
          </div>
          <div className="text-right">
            <span className="text-[9px] text-fw-text-muted block">Max DD</span>
            <span className="text-[12px] font-mono font-bold text-red">{maxDrawdown.toFixed(2)}%</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {equityData.length < 2 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-fw-text-muted">
            Need at least 2 data points. Add journal entries with P&L to build curve.
          </div>
        ) : (
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        )}
      </div>
    </div>
  );
}
