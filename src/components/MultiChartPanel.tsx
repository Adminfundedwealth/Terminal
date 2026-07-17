import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { ChartPanel } from '@/components/ChartPanel';
import { cn } from '@/utils/helpers';
import { Grid2x2, Grid3x3, Maximize2 } from 'lucide-react';
import type { ChartLayout } from '@/types';

const LAYOUTS: { value: ChartLayout; label: string; icon: any; cols: number; rows: number }[] = [
  { value: 'single', label: '1', icon: Maximize2, cols: 1, rows: 1 },
  { value: '2h', label: '2H', icon: Grid2x2, cols: 2, rows: 1 },
  { value: '2v', label: '2V', icon: Grid2x2, cols: 1, rows: 2 },
  { value: '4', label: '4', icon: Grid2x2, cols: 2, rows: 2 },
];

/**
 * Multi-Chart Panel
 * Supports 1, 2, 4-chart layouts.
 * Each chart cell has its own symbol/timeframe via chartLayout config.
 */
export function MultiChartPanel() {
  const { chartLayout, setChartLayout } = useAppStore();
  const layout = LAYOUTS.find(l => l.value === chartLayout) || LAYOUTS[0];

  const cellCount = layout.cols * layout.rows;

  return (
    <div className="h-full flex flex-col bg-[#0c0e14]">
      {/* Layout selector */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        {LAYOUTS.map(l => (
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
        style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}
      >
        {Array.from({ length: cellCount }).map((_, i) => (
          <div key={i} className="overflow-hidden min-h-0 min-w-0">
            <ChartPanel />
          </div>
        ))}
      </div>
    </div>
  );
}
