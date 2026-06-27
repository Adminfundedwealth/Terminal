import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType } from 'lightweight-charts';
import { TrendingUp } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { apiService } from '@/services/api';

interface EquityPoint {
  time: string;
  value: number;
}

export function EquityCurve() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const [data, setData] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ start: 0, current: 0, pnl: 0, pnlPct: 0 });

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await apiService.get<any[]>('/account/equity-curve');
        const points: EquityPoint[] = (res || []).map((d: any) => ({
          time: d.date,
          value: d.ending_balance,
        }));
        setData(points);
        if (points.length >= 2) {
          const start = points[0].value;
          const current = points[points.length - 1].value;
          const pnl = current - start;
          setStats({ start, current, pnl, pnlPct: (pnl / start) * 100 });
        }
      } catch {
        // Use empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    chart.current = createChart(chartRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#6b7280' },
      grid: { vertLines: { color: '#262a36' }, horzLines: { color: '#262a36' } },
      rightPriceScale: { borderColor: '#262a36' },
      timeScale: { borderColor: '#262a36', timeVisible: true },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });

    const isPositive = stats.pnl >= 0;
    series.current = chart.current.addAreaSeries({
      lineColor: isPositive ? '#22c55e' : '#ef4444',
      topColor: isPositive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      bottomColor: 'transparent',
      lineWidth: 2,
    });

    series.current.setData(data);
    chart.current.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartRef.current && chart.current) {
        chart.current.applyOptions({ width: chartRef.current.clientWidth });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.current?.remove();
    };
  }, [data, stats.pnl]);

  const isPos = stats.pnl >= 0;

  return (
    <div className="flex flex-col h-full bg-fw-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-fw-accent" />
          <span className="text-xs font-bold text-fw-text uppercase tracking-wide">Equity Curve</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-fw-text-secondary">Start: <span className="text-fw-text font-mono">₹{stats.start.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></span>
          <span className="text-fw-text-secondary">Current: <span className="text-fw-text font-mono">₹{stats.current.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></span>
          <span className={`font-mono font-bold ${isPos ? 'text-green' : 'text-red'}`}>
            {isPos ? '+' : ''}₹{stats.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({isPos ? '+' : ''}{stats.pnlPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-fw-text-muted text-xs">
            Loading equity data...
          </div>
        )}
        {!loading && data.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fw-text-muted">
            <TrendingUp className="w-8 h-8 opacity-30" />
            <span className="text-xs">No equity data yet. Start trading to see your curve.</span>
          </div>
        )}
        <div ref={chartRef} className="w-full h-full" />
      </div>
    </div>
  );
}
