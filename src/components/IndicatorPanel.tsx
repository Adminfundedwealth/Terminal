/**
 * INDICATOR PANEL
 * 
 * Dropdown menu to toggle chart indicators on/off.
 * Each indicator has configurable period settings.
 */

import { useState } from 'react';
import { TrendingUp, Settings, X, Check } from 'lucide-react';
import { cn } from '@/utils/helpers';

export type IndicatorType = 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'vwap' | 'volume';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  label: string;
  enabled: boolean;
  period?: number;
  periods?: number[];
  color?: string;
  pane?: 'main' | 'separate';
}

const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { id: 'sma9', type: 'sma', label: 'SMA 9', enabled: false, period: 9, color: '#f59e0b', pane: 'main' },
  { id: 'sma21', type: 'sma', label: 'SMA 21', enabled: false, period: 21, color: '#3b82f6', pane: 'main' },
  { id: 'sma50', type: 'sma', label: 'SMA 50', enabled: false, period: 50, color: '#8b5cf6', pane: 'main' },
  { id: 'sma200', type: 'sma', label: 'SMA 200', enabled: false, period: 200, color: '#ef4444', pane: 'main' },
  { id: 'ema9', type: 'ema', label: 'EMA 9', enabled: false, period: 9, color: '#10b981', pane: 'main' },
  { id: 'ema21', type: 'ema', label: 'EMA 21', enabled: false, period: 21, color: '#06b6d4', pane: 'main' },
  { id: 'ema50', type: 'ema', label: 'EMA 50', enabled: false, period: 50, color: '#ec4899', pane: 'main' },
  { id: 'rsi', type: 'rsi', label: 'RSI (14)', enabled: false, period: 14, pane: 'separate' },
  { id: 'macd', type: 'macd', label: 'MACD (12,26,9)', enabled: false, pane: 'separate' },
  { id: 'bollinger', type: 'bollinger', label: 'Bollinger (20,2)', enabled: false, period: 20, pane: 'main' },
  { id: 'vwap', type: 'vwap', label: 'VWAP', enabled: false, color: '#a855f7', pane: 'main' },
  { id: 'volume', type: 'volume', label: 'Volume', enabled: false, pane: 'separate' },
];

interface IndicatorPanelProps {
  indicators: IndicatorConfig[];
  onToggle: (id: string) => void;
  onUpdatePeriod: (id: string, period: number) => void;
}

export function IndicatorPanel({ indicators, onToggle, onUpdatePeriod }: IndicatorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const activeCount = indicators.filter(i => i.enabled).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors',
          activeCount > 0 ? 'bg-fw-accent/20 text-fw-accent' : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover'
        )}
      >
        <TrendingUp size={11} />
        Indicators{activeCount > 0 && ` (${activeCount})`}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[220px] bg-fw-surface border border-fw-border rounded-lg shadow-xl z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-fw-border/50 flex items-center justify-between">
            <span className="text-[10px] font-bold text-fw-text-muted uppercase tracking-wider">Indicators</span>
            <button onClick={() => setIsOpen(false)} className="p-0.5 rounded hover:bg-fw-hover">
              <X size={10} className="text-fw-text-muted" />
            </button>
          </div>

          <div className="max-h-[350px] overflow-y-auto py-1">
            {/* Overlay Indicators */}
            <div className="px-3 py-1">
              <span className="text-[9px] font-bold text-fw-text-muted uppercase">Overlays</span>
            </div>
            {indicators.filter(i => i.pane === 'main').map((ind) => (
              <IndicatorRow
                key={ind.id}
                indicator={ind}
                onToggle={onToggle}
                editingId={editingId}
                setEditingId={setEditingId}
                editValue={editValue}
                setEditValue={setEditValue}
                onUpdatePeriod={onUpdatePeriod}
              />
            ))}

            <div className="h-px bg-fw-border/50 my-1" />

            {/* Separate Pane Indicators */}
            <div className="px-3 py-1">
              <span className="text-[9px] font-bold text-fw-text-muted uppercase">Separate Panes</span>
            </div>
            {indicators.filter(i => i.pane === 'separate').map((ind) => (
              <IndicatorRow
                key={ind.id}
                indicator={ind}
                onToggle={onToggle}
                editingId={editingId}
                setEditingId={setEditingId}
                editValue={editValue}
                setEditValue={setEditValue}
                onUpdatePeriod={onUpdatePeriod}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IndicatorRow({
  indicator: ind, onToggle, editingId, setEditingId, editValue, setEditValue, onUpdatePeriod,
}: {
  indicator: IndicatorConfig;
  onToggle: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editValue: string;
  setEditValue: (v: string) => void;
  onUpdatePeriod: (id: string, period: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-fw-hover transition-colors">
      <button onClick={() => onToggle(ind.id)} className="flex-shrink-0">
        <div className={cn(
          'w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors',
          ind.enabled ? 'bg-fw-accent border-fw-accent' : 'border-fw-border'
        )}>
          {ind.enabled && <Check size={8} className="text-white" />}
        </div>
      </button>
      {ind.color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ind.color }} />}
      <span className={cn('text-[11px] flex-1', ind.enabled ? 'text-fw-text' : 'text-fw-text-secondary')}>
        {ind.label}
      </span>
      {ind.period && ind.type !== 'rsi' && ind.type !== 'macd' && (
        editingId === ind.id ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              const v = parseInt(editValue);
              if (v > 0 && v < 500) onUpdatePeriod(ind.id, v);
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = parseInt(editValue);
                if (v > 0 && v < 500) onUpdatePeriod(ind.id, v);
                setEditingId(null);
              }
              if (e.key === 'Escape') setEditingId(null);
            }}
            className="w-8 text-[9px] text-center bg-fw-bg border border-fw-border rounded px-1 py-0.5 text-fw-text"
          />
        ) : (
          <button
            onClick={() => { setEditingId(ind.id); setEditValue(String(ind.period)); }}
            className="text-[9px] text-fw-text-muted hover:text-fw-text px-1"
            title="Edit period"
          >
            <Settings size={9} />
          </button>
        )
      )}
    </div>
  );
}

export { DEFAULT_INDICATORS };
