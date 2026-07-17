import { useState, useEffect } from 'react';
import { Grid3X3 } from 'lucide-react';
import { apiService } from '@/services/api';
import { useAppStore } from '@/store/appStore';

interface HeatmapItem {
  token: string;
  symbol: string;
  changePct: number;
  marketCap?: number;
  sector?: string;
}

type HeatmapView = 'nifty50' | 'banknifty' | 'sectoral' | 'midcap';

export function HeatmapPanel() {
  const [view, setView] = useState<HeatmapView>('nifty50');
  const [items, setItems] = useState<HeatmapItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { setActiveSymbol } = useAppStore();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await apiService.get<HeatmapItem[]>(`/market/heatmap?view=${view}`);
        setItems(res || []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [view]);

  function getColor(pct: number): string {
    if (pct >= 3) return 'bg-green-600';
    if (pct >= 2) return 'bg-green-600/80';
    if (pct >= 1) return 'bg-green-600/60';
    if (pct >= 0.5) return 'bg-green-600/40';
    if (pct > 0) return 'bg-green-600/20';
    if (pct === 0) return 'bg-fw-surface-2';
    if (pct > -0.5) return 'bg-red-600/20';
    if (pct > -1) return 'bg-red-600/40';
    if (pct > -2) return 'bg-red-600/60';
    if (pct > -3) return 'bg-red-600/80';
    return 'bg-red-600';
  }

  function getTextColor(pct: number): string {
    if (Math.abs(pct) >= 2) return 'text-white';
    return pct >= 0 ? 'text-green' : 'text-red';
  }

  return (
    <div className="flex flex-col h-full bg-fw-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-fw-accent" />
          <span className="text-xs font-bold text-fw-text uppercase tracking-wide">Heatmap</span>
        </div>
        <div className="flex items-center gap-1">
          {(['nifty50', 'banknifty', 'sectoral', 'midcap'] as HeatmapView[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-2 py-0.5 rounded capitalize ${view === v ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover'}`}
            >
              {v === 'nifty50' ? 'NIFTY 50' : v === 'banknifty' ? 'BANKNIFTY' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="flex-1 overflow-auto p-2">
        {loading && (
          <div className="flex items-center justify-center h-full text-fw-text-secondary text-xs">Loading...</div>
        )}
        {!loading && items.length === 0 && (
          <div className="flex items-center justify-center h-full text-fw-text-secondary text-xs">No data</div>
        )}
        {!loading && items.length > 0 && (
          <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 gap-1 auto-rows-[60px]">
            {items.map(item => (
              <div
                key={item.token}
                onClick={() => (setActiveSymbol as any)({ token: item.token, symbol: item.symbol, segment: 'NSE' })}
                className={`rounded flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-105 border border-white/5 ${getColor(item.changePct)}`}
              >
                <span className="text-xs font-bold text-white/90 truncate max-w-full px-1">
                  {item.symbol.replace('NSE:', '').substring(0, 8)}
                </span>
                <span className={`text-sm font-mono font-bold ${getTextColor(item.changePct)}`}>
                  {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-t border-fw-border">
        <span className="text-xs text-fw-text-secondary mr-1">-3%</span>
        {[-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3].map(v => (
          <div key={v} className={`w-4 h-3 rounded-sm ${getColor(v)}`} />
        ))}
        <span className="text-xs text-fw-text-secondary ml-1">+3%</span>
      </div>
    </div>
  );
}
