/**
 * DRAWING TOOLS
 * 
 * Chart drawing tools dropdown with mode selection.
 * Supports: Trendline, Horizontal Line, Fibonacci, Rectangle, Text.
 * Drawings stored in localStorage per symbol.
 */

import { useState } from 'react';
import { PenTool, Minus, GitBranch, Square, Type, Trash2, X } from 'lucide-react';
import { cn } from '@/utils/helpers';

export type DrawingMode = 'none' | 'trendline' | 'hline' | 'fibonacci' | 'rectangle' | 'text';

interface DrawingToolsProps {
  activeMode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  onClearAll: () => void;
  drawingCount: number;
}

const TOOLS: { mode: DrawingMode; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { mode: 'trendline', icon: <PenTool size={11} />, label: 'Trendline', shortcut: 'Click 2 points' },
  { mode: 'hline', icon: <Minus size={11} />, label: 'Horizontal Line', shortcut: 'Click price level' },
  { mode: 'fibonacci', icon: <GitBranch size={11} />, label: 'Fibonacci Retracement', shortcut: 'Click high/low' },
  { mode: 'rectangle', icon: <Square size={11} />, label: 'Price Zone', shortcut: 'Drag to draw' },
  { mode: 'text', icon: <Type size={11} />, label: 'Text Note', shortcut: 'Click to place' },
];

export function DrawingTools({ activeMode, onModeChange, onClearAll, drawingCount }: DrawingToolsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors',
          activeMode !== 'none' ? 'bg-fw-accent/20 text-fw-accent' : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover'
        )}
      >
        <PenTool size={11} />
        Draw{drawingCount > 0 && ` (${drawingCount})`}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[200px] bg-fw-surface border border-fw-border rounded-lg shadow-xl z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-fw-border/50 flex items-center justify-between">
            <span className="text-[10px] font-bold text-fw-text-muted uppercase tracking-wider">Drawing Tools</span>
            <button onClick={() => setIsOpen(false)} className="p-0.5 rounded hover:bg-fw-hover">
              <X size={10} className="text-fw-text-muted" />
            </button>
          </div>

          <div className="py-1">
            {TOOLS.map((tool) => (
              <button
                key={tool.mode}
                onClick={() => {
                  onModeChange(activeMode === tool.mode ? 'none' : tool.mode);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 hover:bg-fw-hover transition-colors text-left',
                  activeMode === tool.mode && 'bg-fw-accent/10'
                )}
              >
                <div className={cn('text-fw-text-secondary', activeMode === tool.mode && 'text-fw-accent')}>
                  {tool.icon}
                </div>
                <div className="flex-1">
                  <span className={cn('text-[11px] block', activeMode === tool.mode ? 'text-fw-accent font-medium' : 'text-fw-text')}>
                    {tool.label}
                  </span>
                  <span className="text-[9px] text-fw-text-muted">{tool.shortcut}</span>
                </div>
              </button>
            ))}
          </div>

          {drawingCount > 0 && (
            <div className="border-t border-fw-border/50 p-2">
              <button
                onClick={() => { onClearAll(); setIsOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={10} />
                Clear All Drawings ({drawingCount})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
