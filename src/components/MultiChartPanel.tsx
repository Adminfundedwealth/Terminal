import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { ChartPanel } from '@/components/ChartPanel';
import { cn } from '@/utils/helpers';
import { Grid2x2, Grid3x3, Maximize2 } from 'lucide-react';
import type { ChartLayout, Instrument, Timeframe } from '@/types';

export const CHART_GRID_LAYOUTS: { value: ChartLayout; label: string; icon: typeof Maximize2; cols: number; rows: number }[] = [
  { value: 'single', label: '1', icon: Maximize2, cols: 1, rows: 1 },
  { value: '2h', label: '2H', icon: Grid2x2, cols: 2, rows: 1 },
  { value: '2v', label: '2V', icon: Grid2x2, cols: 1, rows: 2 },
  { value: '4', label: '4', icon: Grid2x2, cols: 2, rows: 2 },
  { value: '8-chart', label: '8', icon: Grid3x3, cols: 4, rows: 2 },
];

export function getChartGridDimensions(layout: ChartLayout) {
  const selected = CHART_GRID_LAYOUTS.find((entry) => entry.value === layout) || CHART_GRID_LAYOUTS[0];
  return { cols: selected.cols, rows: selected.rows, count: selected.cols * selected.rows };
}

interface PaneConfig {
  symbol: Instrument | null;
  timeframe: Timeframe;
}

/**
 * Multi-Chart Panel
 * Supports 1, 2, 4, and 8-chart layouts.
 * Each chart cell has its own symbol/timeframe via chartLayout config.
 */
export function MultiChartPanel() {
  const { chartLayout, setChartLayout, activeSymbol, timeframe, watchlists } = useAppStore();
  const dimensions = getChartGridDimensions(chartLayout);
  const [panes, setPanes] = useState<PaneConfig[]>(() => Array.from({ length: 8 }, () => ({ symbol: activeSymbol, timeframe })));
  const symbolOptions = watchlists.flatMap((watchlist) => watchlist.items).reduce<Instrument[]>((options, item) => {
    if (options.some((option) => option.token === item.token)) return options;
    options.push({
      token: item.token,
      symbol: item.symbol,
      name: item.symbol,
      segment: item.segment,
      instrumentType: item.segment === 'NFO' ? 'FUT' : 'EQ',
      exchange: item.segment,
      lotSize: 1,
      tickSize: 0.05,
    });
    return options;
  }, activeSymbol ? [activeSymbol] : []);

  const updatePane = (index: number, update: Partial<PaneConfig>) => {
    setPanes((current) => current.map((pane, paneIndex) => paneIndex === index ? { ...pane, ...update } : pane));
  };

  return (
    <div className="h-full flex flex-col bg-fw-bg">
      {/* Layout selector */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-fw-border bg-fw-surface-2 flex-shrink-0">
        {CHART_GRID_LAYOUTS.map(l => (
          <button
            key={l.value}
            onClick={() => setChartLayout(l.value)}
            className={cn(
              'px-2 py-1 text-[14px] font-bold rounded transition-colors',
              chartLayout === l.value ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text bg-fw-bg border border-fw-border'
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Chart Grid */}
      <div
        className="flex-1 grid gap-[1px] bg-fw-border/30 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${dimensions.cols}, 1fr)`, gridTemplateRows: `repeat(${dimensions.rows}, 1fr)` }}
      >
        {Array.from({ length: dimensions.count }).map((_, i) => (
          <div key={i} className="overflow-hidden min-h-0 min-w-0 flex flex-col">
            <div className="flex items-center gap-1 px-1 py-0.5 bg-fw-surface-2 border-b border-fw-border/50 flex-shrink-0">
              <select
                aria-label={`Pane ${i + 1} symbol`}
                value={panes[i]?.symbol?.token || ''}
                onChange={(event) => updatePane(i, { symbol: symbolOptions.find((option) => option.token === event.target.value) || activeSymbol })}
                className="min-w-0 flex-1 bg-fw-bg text-fw-text text-[10px] border border-fw-border rounded px-1 py-0.5"
              >
                {symbolOptions.map((option) => <option key={option.token} value={option.token}>{option.symbol}</option>)}
              </select>
              <select
                aria-label={`Pane ${i + 1} timeframe`}
                value={panes[i]?.timeframe || timeframe}
                onChange={(event) => updatePane(i, { timeframe: event.target.value as Timeframe })}
                className="w-12 bg-fw-bg text-fw-text text-[10px] border border-fw-border rounded px-1 py-0.5"
              >
                {['1', '3', '5', '15', '30', '60', '240', 'D', 'W'].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="flex-1 min-h-0">
              <ChartPanel symbolOverride={panes[i]?.symbol || activeSymbol} timeframeOverride={panes[i]?.timeframe || timeframe} onTimeframeChange={(next) => updatePane(i, { timeframe: next })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
