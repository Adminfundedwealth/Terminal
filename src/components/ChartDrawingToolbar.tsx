/**
 * CHART DRAWING TOOLBAR — Left vertical toolbar like TradingView
 *
 * Renders a slim vertical strip to the left of the chart with:
 * - Cursor / pointer (escape drawing mode)
 * - Trendline
 * - Horizontal Line
 * - Vertical Line
 * - Fibonacci Retracement
 * - Price Zone (Rectangle)
 * - Text Note
 * - Separator
 * - Eraser / Clear last
 * - Clear all
 */

import { MousePointer2, Minus, TrendingUp, GitBranch, Square, Type, Eraser, Trash2, AlignCenter } from 'lucide-react';
import { cn } from '@/utils/helpers';
import type { DrawingMode } from './DrawingTools';

interface Props {
  activeMode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  onClearLast: () => void;
  onClearAll: () => void;
  drawingCount: number;
}

const TOOLS: { mode: DrawingMode; icon: React.ReactNode; label: string; shortcut?: string }[] = [
  { mode: 'none', icon: <MousePointer2 size={14} />, label: 'Pointer (Esc)', shortcut: 'Esc' },
  { mode: 'trendline', icon: <TrendingUp size={14} />, label: 'Trend Line', shortcut: 'T' },
  { mode: 'hline', icon: <Minus size={14} />, label: 'Horizontal Line', shortcut: 'H' },
  { mode: 'vline', icon: <AlignCenter size={14} />, label: 'Vertical Line', shortcut: 'V' },
  { mode: 'fibonacci', icon: <GitBranch size={14} />, label: 'Fibonacci Retracement', shortcut: 'F' },
  { mode: 'rectangle', icon: <Square size={14} />, label: 'Price Zone', shortcut: 'R' },
  { mode: 'text', icon: <Type size={14} />, label: 'Text Note', shortcut: 'N' },
];

export function ChartDrawingToolbar({ activeMode, onModeChange, onClearLast, onClearAll, drawingCount }: Props) {
  return (
    <div className="w-[30px] min-w-[30px] h-full flex flex-col items-center pt-1 pb-2 gap-0.5 bg-[#10121a] border-r border-fw-border/30 select-none">
      {TOOLS.map((tool) => (
        <ToolBtn
          key={tool.mode}
          icon={tool.icon}
          label={tool.label}
          shortcut={tool.shortcut}
          active={activeMode === tool.mode}
          onClick={() => onModeChange(tool.mode)}
        />
      ))}

      {/* Divider */}
      <div className="w-4 h-px bg-fw-border/40 my-1" />

      {/* Clear last */}
      <ToolBtn
        icon={<Eraser size={13} />}
        label="Erase Last Drawing"
        onClick={onClearLast}
        disabled={drawingCount === 0}
        danger
      />

      {/* Clear all */}
      <ToolBtn
        icon={<Trash2 size={13} />}
        label={`Clear All (${drawingCount})`}
        onClick={onClearAll}
        disabled={drawingCount === 0}
        danger
      />
    </div>
  );
}

function ToolBtn({
  icon, label, shortcut, active, onClick, disabled, danger,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        'w-[26px] h-[26px] flex items-center justify-center rounded transition-all relative group',
        active && 'bg-fw-accent/20 text-fw-accent',
        !active && !danger && !disabled && 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover',
        danger && !disabled && 'text-red-500/60 hover:text-red-400 hover:bg-red-500/10',
        disabled && 'opacity-25 cursor-default',
      )}
    >
      {icon}
      {/* Tooltip */}
      <div className="absolute left-full ml-2 px-2 py-1 bg-[#1a1d28] border border-fw-border rounded-md text-[10px] text-fw-text whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
        {label}
        {shortcut && <span className="ml-1.5 text-fw-text-muted text-[9px]">{shortcut}</span>}
      </div>
    </button>
  );
}
