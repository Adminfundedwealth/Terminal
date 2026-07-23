/**
 * INDICATOR PANEL
 *
 * Searchable dropdown to toggle chart indicators on/off.
 * Indicators are grouped into Overlays and Separate Panes.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { TrendingUp, Settings, X, Check, Search, Trash2 } from 'lucide-react';
import { cn } from '@/utils/helpers';

export type IndicatorType =
  // Original
  | 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'vwap' | 'volume'
  // Tier 1
  | 'atr' | 'stochastic' | 'stochrsi' | 'supertrend' | 'psar'
  | 'adx' | 'cci' | 'ichimoku' | 'pivots' | 'williamsr' | 'stddev'
  | 'dema' | 'tema'
  // Tier 2
  | 'ao' | 'momentum' | 'roc' | 'keltner' | 'donchian' | 'envelopes'
  | 'hma' | 'trix' | 'ultimateosc' | 'priceoscillator' | 'histvolatility'
  | 'massindex' | 'vortex'
  // Tier 3
  | 'aroon' | 'cmo' | 'choppiness' | 'dpo' | 'fisher' | 'connorsrsi'
  | 'coppock' | 'linearreg' | 'lsma' | 'mcginley' | 'bop'
  | 'typicalprice' | 'medianprice' | 'avgprice' | 'rvi';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  label: string;
  enabled: boolean;
  period?: number;
  color?: string;
  pane: 'main' | 'separate';
  params?: Record<string, number>; // extra params (multiplier, fast/slow, etc.)
}

const OVERLAY_COLOR_PALETTE = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#06b6d4',
  '#ec4899', '#f97316', '#84cc16', '#14b8a6', '#a855f7', '#0ea5e9',
];
let _colorIdx = 0;
function nextColor() { return OVERLAY_COLOR_PALETTE[_colorIdx++ % OVERLAY_COLOR_PALETTE.length]; }

export const DEFAULT_INDICATORS: IndicatorConfig[] = [
  // ── Overlays ──────────────────────────────────────────────
  { id: 'sma9',       type: 'sma',       label: 'SMA 9',              enabled: false, period: 9,   color: '#f59e0b', pane: 'main' },
  { id: 'sma21',      type: 'sma',       label: 'SMA 21',             enabled: false, period: 21,  color: '#3b82f6', pane: 'main' },
  { id: 'sma50',      type: 'sma',       label: 'SMA 50',             enabled: false, period: 50,  color: '#8b5cf6', pane: 'main' },
  { id: 'sma200',     type: 'sma',       label: 'SMA 200',            enabled: false, period: 200, color: '#ef4444', pane: 'main' },
  { id: 'ema9',       type: 'ema',       label: 'EMA 9',              enabled: false, period: 9,   color: '#10b981', pane: 'main' },
  { id: 'ema21',      type: 'ema',       label: 'EMA 21',             enabled: false, period: 21,  color: '#06b6d4', pane: 'main' },
  { id: 'ema50',      type: 'ema',       label: 'EMA 50',             enabled: false, period: 50,  color: '#ec4899', pane: 'main' },
  { id: 'dema14',     type: 'dema',      label: 'DEMA 14',            enabled: false, period: 14,  color: '#f97316', pane: 'main' },
  { id: 'tema14',     type: 'tema',      label: 'TEMA 14',            enabled: false, period: 14,  color: '#84cc16', pane: 'main' },
  { id: 'hma9',       type: 'hma',       label: 'HMA 9',              enabled: false, period: 9,   color: '#14b8a6', pane: 'main' },
  { id: 'mcginley14', type: 'mcginley',  label: 'McGinley 14',        enabled: false, period: 14,  color: '#a855f7', pane: 'main' },
  { id: 'lsma14',     type: 'lsma',      label: 'LSMA 14',            enabled: false, period: 14,  color: '#0ea5e9', pane: 'main' },
  { id: 'linearreg14', type: 'linearreg', label: 'Lin Reg 14',         enabled: false, period: 14,  color: '#fb923c', pane: 'main' },
  { id: 'bollinger',  type: 'bollinger', label: 'Bollinger (20,2)',   enabled: false, period: 20,  pane: 'main' },
  { id: 'vwap',       type: 'vwap',      label: 'VWAP',               enabled: false, color: '#a855f7', pane: 'main' },
  { id: 'keltner',    type: 'keltner',   label: 'Keltner (20,10)',    enabled: false, period: 20,  pane: 'main' },
  { id: 'donchian',   type: 'donchian',  label: 'Donchian (20)',      enabled: false, period: 20,  pane: 'main' },
  { id: 'envelopes',  type: 'envelopes', label: 'Envelopes (20,2.5%)',enabled: false, period: 20,  pane: 'main' },
  { id: 'supertrend', type: 'supertrend', label: 'SuperTrend (10,3)', enabled: false, period: 10,  params: { multiplier: 3 }, pane: 'main' },
  { id: 'psar',       type: 'psar',      label: 'Parabolic SAR',      enabled: false, pane: 'main' },
  { id: 'ichimoku',   type: 'ichimoku',  label: 'Ichimoku Cloud',     enabled: false, pane: 'main' },
  { id: 'pivots',     type: 'pivots',    label: 'Pivot Points',       enabled: false, pane: 'main' },
  { id: 'typicalprice', type: 'typicalprice', label: 'Typical Price', enabled: false, color: '#67e8f9', pane: 'main' },
  { id: 'medianprice', type: 'medianprice', label: 'Median Price',    enabled: false, color: '#fde68a', pane: 'main' },
  { id: 'avgprice',   type: 'avgprice',  label: 'Average Price',      enabled: false, color: '#bbf7d0', pane: 'main' },
  { id: 'bop',        type: 'bop',       label: 'Balance of Power',   enabled: false, pane: 'separate' },
  // ── Separate Panes ─────────────────────────────────────────
  { id: 'rsi',        type: 'rsi',       label: 'RSI (14)',           enabled: false, period: 14,  pane: 'separate' },
  { id: 'macd',       type: 'macd',      label: 'MACD (12,26,9)',     enabled: false, pane: 'separate' },
  { id: 'volume',     type: 'volume',    label: 'Volume',             enabled: false, pane: 'separate' },
  { id: 'stochastic', type: 'stochastic', label: 'Stochastic (14,3)', enabled: false, period: 14,  pane: 'separate' },
  { id: 'stochrsi',   type: 'stochrsi',  label: 'Stoch RSI (14)',     enabled: false, period: 14,  pane: 'separate' },
  { id: 'adx',        type: 'adx',       label: 'ADX (14)',           enabled: false, period: 14,  pane: 'separate' },
  { id: 'atr',        type: 'atr',       label: 'ATR (14)',           enabled: false, period: 14,  pane: 'separate' },
  { id: 'cci',        type: 'cci',       label: 'CCI (20)',           enabled: false, period: 20,  pane: 'separate' },
  { id: 'williamsr',  type: 'williamsr', label: 'Williams %R (14)',   enabled: false, period: 14,  pane: 'separate' },
  { id: 'stddev',     type: 'stddev',    label: 'Std Deviation (20)', enabled: false, period: 20,  pane: 'separate' },
  { id: 'ao',         type: 'ao',        label: 'Awesome Oscillator', enabled: false, pane: 'separate' },
  { id: 'momentum',   type: 'momentum',  label: 'Momentum (10)',      enabled: false, period: 10,  pane: 'separate' },
  { id: 'roc',        type: 'roc',       label: 'ROC (9)',            enabled: false, period: 9,   pane: 'separate' },
  { id: 'trix',       type: 'trix',      label: 'TRIX (14)',          enabled: false, period: 14,  pane: 'separate' },
  { id: 'ultimateosc', type: 'ultimateosc', label: 'Ultimate Osc (7,14,28)', enabled: false, pane: 'separate' },
  { id: 'histvolatility', type: 'histvolatility', label: 'Hist Volatility (20)', enabled: false, period: 20, pane: 'separate' },
  { id: 'priceoscillator', type: 'priceoscillator', label: 'Price Oscillator', enabled: false, period: 9, pane: 'separate' },
  { id: 'massindex',  type: 'massindex', label: 'Mass Index (25)',    enabled: false, pane: 'separate' },
  { id: 'vortex',     type: 'vortex',    label: 'Vortex (14)',        enabled: false, period: 14,  pane: 'separate' },
  { id: 'aroon',      type: 'aroon',     label: 'Aroon (14)',         enabled: false, period: 14,  pane: 'separate' },
  { id: 'cmo',        type: 'cmo',       label: 'CMO (9)',            enabled: false, period: 9,   pane: 'separate' },
  { id: 'choppiness', type: 'choppiness', label: 'Choppiness (14)',   enabled: false, period: 14,  pane: 'separate' },
  { id: 'dpo',        type: 'dpo',       label: 'DPO (20)',           enabled: false, period: 20,  pane: 'separate' },
  { id: 'fisher',     type: 'fisher',    label: 'Fisher Transform (9)',enabled: false, period: 9,  pane: 'separate' },
  { id: 'connorsrsi', type: 'connorsrsi', label: 'Connors RSI',       enabled: false, pane: 'separate' },
  { id: 'coppock',    type: 'coppock',   label: 'Coppock Curve',      enabled: false, pane: 'separate' },
  { id: 'rvi',        type: 'rvi',       label: 'RVI (10)',           enabled: false, period: 10,  pane: 'separate' },
];

interface IndicatorPanelProps {
  indicators: IndicatorConfig[];
  onToggle: (id: string) => void;
  onUpdatePeriod: (id: string, period: number) => void;
  onDisableAll?: () => void;
}

export function IndicatorPanel({ indicators, onToggle, onUpdatePeriod, onDisableAll }: IndicatorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return indicators;
    return indicators.filter(i => i.label.toLowerCase().includes(q) || i.type.toLowerCase().includes(q));
  }, [indicators, search]);

  const overlays = filtered.filter(i => i.pane === 'main');
  const panes = filtered.filter(i => i.pane === 'separate');
  const noResults = filtered.length === 0;

  const activeCount = indicators.filter(i => i.enabled).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 text-[14px] rounded font-medium transition-colors',
          activeCount > 0 ? 'bg-fw-accent/20 text-fw-accent' : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover'
        )}
      >
        <TrendingUp size={11} />
        Indicators{activeCount > 0 && ` (${activeCount})`}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[99]" onClick={() => setIsOpen(false)} />

          <div className="absolute top-full left-0 mt-1 w-[240px] bg-fw-surface border border-fw-border rounded-lg shadow-xl z-[100] overflow-hidden flex flex-col" style={{ maxHeight: '480px' }}>
            {/* Header */}
            <div className="px-3 py-2 border-b border-fw-border/50 flex items-center justify-between flex-shrink-0">
              <span className="text-[14px] font-bold text-fw-text-muted uppercase tracking-wider">Indicators</span>
              <button onClick={() => setIsOpen(false)} className="p-0.5 rounded hover:bg-fw-hover">
                <X size={10} className="text-fw-text-muted" />
              </button>
            </div>

            {/* Search */}
            <div className="px-2 py-1.5 border-b border-fw-border/30 flex-shrink-0">
              <div className="flex items-center gap-1.5 bg-fw-bg border border-fw-border/60 rounded px-2 py-1">
                <Search size={10} className="text-fw-text-muted flex-shrink-0" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search indicators…"
                  className="flex-1 bg-transparent text-[13px] text-fw-text placeholder-fw-text-muted outline-none min-w-0"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-fw-text-muted hover:text-fw-text">
                    <X size={9} />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto py-1 flex-1">
              {noResults ? (
                <div className="px-3 py-4 text-center text-[13px] text-fw-text-muted">No indicators found</div>
              ) : (
                <>
                  {overlays.length > 0 && (
                    <>
                      <div className="px-3 py-1">
                        <span className="text-[13px] font-bold text-fw-text-muted uppercase tracking-wider">Overlays</span>
                      </div>
                      {overlays.map(ind => (
                        <IndicatorRow key={ind.id} indicator={ind} onToggle={onToggle}
                          editingId={editingId} setEditingId={setEditingId}
                          editValue={editValue} setEditValue={setEditValue}
                          onUpdatePeriod={onUpdatePeriod} />
                      ))}
                    </>
                  )}

                  {overlays.length > 0 && panes.length > 0 && (
                    <div className="h-px bg-fw-border/50 my-1 mx-2" />
                  )}

                  {panes.length > 0 && (
                    <>
                      <div className="px-3 py-1">
                        <span className="text-[13px] font-bold text-fw-text-muted uppercase tracking-wider">Separate Panes</span>
                      </div>
                      {panes.map(ind => (
                        <IndicatorRow key={ind.id} indicator={ind} onToggle={onToggle}
                          editingId={editingId} setEditingId={setEditingId}
                          editValue={editValue} setEditValue={setEditValue}
                          onUpdatePeriod={onUpdatePeriod} />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Footer — Clear All */}
            {activeCount > 0 && onDisableAll && (
              <div className="border-t border-fw-border/50 p-2 flex-shrink-0">
                <button
                  onClick={() => { onDisableAll(); setIsOpen(false); }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={10} />
                  Remove all ({activeCount})
                </button>
              </div>
            )}
          </div>
        </>
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
  const hasPeriod = !!ind.period && !['macd', 'ao', 'ultimateosc', 'connorsrsi', 'coppock', 'ichimoku', 'pivots', 'psar', 'vwap', 'volume', 'bop', 'typicalprice', 'medianprice', 'avgprice'].includes(ind.type);

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
      {ind.color && (
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ind.color }} />
      )}
      <span className={cn('text-[13px] flex-1 truncate', ind.enabled ? 'text-fw-text' : 'text-fw-text-secondary')}>
        {ind.label}
      </span>
      {hasPeriod && (
        editingId === ind.id ? (
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => {
              const v = parseInt(editValue);
              if (v > 0 && v < 1000) onUpdatePeriod(ind.id, v);
              setEditingId(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseInt(editValue);
                if (v > 0 && v < 1000) onUpdatePeriod(ind.id, v);
                setEditingId(null);
              }
              if (e.key === 'Escape') setEditingId(null);
            }}
            className="w-9 text-[13px] text-center bg-fw-bg border border-fw-border rounded px-1 py-0.5 text-fw-text"
          />
        ) : (
          <button
            onClick={() => { setEditingId(ind.id); setEditValue(String(ind.period)); }}
            className="text-[13px] text-fw-text-muted hover:text-fw-text px-1"
            title="Edit period"
          >
            <Settings size={9} />
          </button>
        )
      )}
    </div>
  );
}

export { DEFAULT_INDICATORS as DEFAULT_INDICATORS_LIST };
