/**
 * CHART DRAWING TOOLBAR — Left vertical icon strip (TradingView-style)
 *
 * Design: icon-only, thin-stroke lucide icons at 15px, no box/border on
 * inactive buttons, subtle bg highlight on hover/active only.
 * Generous 2px gap between icons, 4px gap around dividers.
 */

import React from 'react';
import {
  MousePointer2,
  Minus,
  TrendingUp,
  GitBranch,
  Square,
  Type,
  Eraser,
  Trash2,
  AlignCenter,
  Brush,
  Smile,
  Ruler,
  ZoomIn,
  Magnet,
  Lock,
  Eye,
  EyeOff,
  Layers,
  Unlock,
} from 'lucide-react';
import { cn } from '@/utils/helpers';
import type { DrawingMode } from './DrawingTools';

interface Props {
  activeMode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  onClearLast: () => void;
  onClearAll: () => void;
  drawingCount: number;
  magnetActive: boolean;
  lockActive: boolean;
  eyeHidden: boolean;
  onToggleMagnet: () => void;
  onToggleLock: () => void;
  onToggleEye: () => void;
  onOpenLayers: () => void;
}

const DRAW_TOOLS: { mode: DrawingMode; icon: React.ReactNode; label: string; shortcut?: string }[] = [
  { mode: 'none',      icon: <MousePointer2 size={15} strokeWidth={1.5} />, label: 'Pointer',               shortcut: 'Esc' },
  { mode: 'trendline', icon: <TrendingUp    size={15} strokeWidth={1.5} />, label: 'Trend Line',            shortcut: 'T'   },
  { mode: 'hline',     icon: <Minus         size={15} strokeWidth={1.5} />, label: 'Horizontal Line',       shortcut: 'H'   },
  { mode: 'vline',     icon: <AlignCenter   size={15} strokeWidth={1.5} />, label: 'Vertical Line',         shortcut: 'V'   },
  { mode: 'fibonacci', icon: <GitBranch     size={15} strokeWidth={1.5} />, label: 'Fibonacci Retracement', shortcut: 'F'   },
  { mode: 'rectangle', icon: <Square        size={15} strokeWidth={1.5} />, label: 'Price Zone',            shortcut: 'R'   },
  { mode: 'text',      icon: <Type          size={15} strokeWidth={1.5} />, label: 'Text Note',             shortcut: 'N'   },
  { mode: 'brush',     icon: <Brush         size={15} strokeWidth={1.5} />, label: 'Brush (Freehand)',      shortcut: 'B'   },
  { mode: 'emoji',     icon: <Smile         size={15} strokeWidth={1.5} />, label: 'Emoji Marker',          shortcut: 'E'   },
  { mode: 'measure',   icon: <Ruler         size={15} strokeWidth={1.5} />, label: 'Measure',               shortcut: 'M'   },
  { mode: 'zoom',      icon: <ZoomIn        size={15} strokeWidth={1.5} />, label: 'Zoom Selection',        shortcut: 'Z'   },
];

export function ChartDrawingToolbar({
  activeMode, onModeChange, onClearLast, onClearAll, drawingCount,
  magnetActive, lockActive, eyeHidden, onToggleMagnet, onToggleLock, onToggleEye, onOpenLayers,
}: Props) {
  return (
    <div className="w-[30px] min-w-[30px] h-full flex flex-col items-center pt-2 pb-3 bg-[#10121a] border-r border-fw-border/20 select-none overflow-y-auto">

      {/* Drawing mode tools */}
      <div className="flex flex-col items-center gap-[3px] w-full px-[3px]">
        {DRAW_TOOLS.map(tool => (
          <ToolBtn
            key={tool.mode}
            icon={tool.icon}
            label={tool.label}
            shortcut={tool.shortcut}
            active={activeMode === tool.mode}
            onClick={() => onModeChange(tool.mode)}
          />
        ))}
      </div>

      <Divider />

      {/* Tool modifiers */}
      <div className="flex flex-col items-center gap-[3px] w-full px-[3px]">
        <ToolBtn
          icon={<Magnet size={15} strokeWidth={1.5} />}
          label="Snap to OHLC"
          shortcut="G"
          active={magnetActive}
          onClick={onToggleMagnet}
          accent="amber"
        />
        <ToolBtn
          icon={lockActive ? <Lock size={15} strokeWidth={1.5} /> : <Unlock size={15} strokeWidth={1.5} />}
          label={lockActive ? 'Drawings locked' : 'Lock drawings'}
          shortcut="L"
          active={lockActive}
          onClick={onToggleLock}
          accent="orange"
        />
        <ToolBtn
          icon={eyeHidden ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
          label={eyeHidden ? 'Show drawings' : 'Hide drawings'}
          active={eyeHidden}
          onClick={onToggleEye}
          accent="sky"
        />
        <ToolBtn
          icon={<Layers size={15} strokeWidth={1.5} />}
          label="Layers panel"
          onClick={onOpenLayers}
        />
      </div>

      <Divider />

      {/* Destructive actions */}
      <div className="flex flex-col items-center gap-[3px] w-full px-[3px]">
        <ToolBtn
          icon={<Eraser size={15} strokeWidth={1.5} />}
          label="Erase last"
          onClick={onClearLast}
          disabled={drawingCount === 0}
          danger
        />
        <ToolBtn
          icon={<Trash2 size={15} strokeWidth={1.5} />}
          label={`Clear all (${drawingCount})`}
          onClick={onClearAll}
          disabled={drawingCount === 0}
          danger
        />
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-[18px] h-px bg-fw-border/30 my-[5px] shrink-0" />;
}

function ToolBtn({
  icon, label, shortcut, active, onClick, disabled, danger, accent,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: 'blue' | 'amber' | 'orange' | 'sky';
}) {
  const accentClasses: Record<string, string> = {
    blue:   'text-fw-accent bg-fw-accent/15',
    amber:  'text-amber-400 bg-amber-400/15',
    orange: 'text-orange-400 bg-orange-400/15',
    sky:    'text-sky-400 bg-sky-400/15',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        // base: no background, no border, consistent size
        'w-[24px] h-[24px] flex items-center justify-center rounded-[4px]',
        'transition-colors duration-100 relative group shrink-0',
        // active state — tinted bg
        active && (accentClasses[accent ?? 'blue']),
        // inactive — muted icon, subtle hover
        !active && !danger && !disabled && [
          'text-fw-text-muted',
          'hover:text-fw-text hover:bg-white/[0.06]',
        ],
        // danger
        danger && !disabled && 'text-red-500/50 hover:text-red-400 hover:bg-red-500/10',
        // disabled
        disabled && 'opacity-20 cursor-default pointer-events-none',
      )}
    >
      {icon}

      {/* Tooltip — appears to the right */}
      <span className={cn(
        'absolute left-full ml-[7px] z-50 pointer-events-none',
        'px-[7px] py-[3px] rounded-[4px] whitespace-nowrap',
        'bg-[#1c1f2e] border border-white/10 shadow-xl',
        'text-[10px] leading-tight text-fw-text',
        'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
      )}>
        {label}
        {shortcut && (
          <span className="ml-1.5 text-fw-text-muted text-[9px] font-mono">{shortcut}</span>
        )}
      </span>
    </button>
  );
}
