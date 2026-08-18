/**
 * DRAWING LAYERS PANEL — Object Manager
 *
 * Lists every drawn object with type, identifier, visibility toggle, delete button.
 * Clicking a row fires onHighlight(id) so ChartPanel can flash it.
 */

import React from 'react';
import {
  X,
  Eye,
  EyeOff,
  Trash2,
  TrendingUp,
  ArrowUpRight,
  Minus,
  AlignCenter,
  GitBranch,
  Square,
  Type,
  Brush,
  Smile,
  Ruler,
} from 'lucide-react';
import { cn } from '@/utils/helpers';

export interface DrawingItem {
  id: number;
  type: string;
  label: string;
  hidden?: boolean;
}

interface Props {
  items: DrawingItem[];
  onClose: () => void;
  onHighlight: (id: number) => void;
  onToggleVisibility: (id: number) => void;
  onDelete: (id: number) => void;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  trendline:  <TrendingUp  size={10} />,
  arrow:      <ArrowUpRight size={10} />,
  ray:        <Minus       size={10} />,
  hline:      <Minus       size={10} />,
  vline:      <AlignCenter size={10} />,
  fibonacci:  <GitBranch   size={10} />,
  rectangle:  <Square      size={10} />,
  text:       <Type        size={10} />,
  brush:      <Brush       size={10} />,
  emoji:      <Smile       size={10} />,
  measure:    <Ruler       size={10} />,
};

const TYPE_LABEL: Record<string, string> = {
  trendline:  'Trend Line',
  arrow:      'Arrow',
  ray:        'Ray',
  hline:      'H-Line',
  vline:      'V-Line',
  fibonacci:  'Fibonacci',
  rectangle:  'Price Zone',
  text:       'Text',
  brush:      'Brush',
  emoji:      'Emoji',
  measure:    'Measure',
};

export function DrawingLayersPanel({ items, onClose, onHighlight, onToggleVisibility, onDelete }: Props) {
  return (
    <div
      className="absolute left-[38px] top-4 z-[200] w-[220px] bg-transparent backdrop-blur-sm"
      style={{ background: 'var(--fw-surface)' }}
    >
      <div
        className="w-[220px] rounded-lg border border-fw-border shadow-2xl overflow-hidden"
        style={{ background: 'var(--fw-surface)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border/50">
          <span className="text-[13px] font-semibold text-fw-text">Layers</span>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-fw-text-muted">{items.length} object{items.length !== 1 ? 's' : ''}</span>
            <button onClick={onClose} className="p-0.5 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors">
              <X size={11} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-[320px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-6 text-center text-[14px] text-fw-text-muted">No drawings yet</div>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => onHighlight(item.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors group',
                  item.hidden ? 'opacity-40' : '',
                  'hover:bg-fw-hover/60',
                )}
              >
                {/* Icon */}
                <span className="text-fw-text-muted shrink-0">
                  {TYPE_ICON[item.type] ?? <Minus size={10} />}
                </span>

                {/* Label */}
                <span className="flex-1 text-[14px] text-fw-text truncate">
                  {TYPE_LABEL[item.type] ?? item.type}
                  <span className="text-fw-text-muted ml-1 text-[13px]">#{idx + 1}</span>
                </span>

                {/* Visibility toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleVisibility(item.id); }}
                  className="shrink-0 p-0.5 rounded text-fw-text-muted hover:text-fw-text transition-colors opacity-0 group-hover:opacity-100"
                  title={item.hidden ? 'Show' : 'Hide'}
                >
                  {item.hidden ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                  className="shrink-0 p-0.5 rounded text-red-500/50 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
