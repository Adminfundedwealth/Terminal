import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { wsService } from '@/services/websocket';

interface Tick {
  id: number;
  time: string;
  price: number;
  qty: number;
  side: 'buy' | 'sell' | 'neutral';
  change: number;
}

const MAX_TICKS = 200;

export function TimeAndSales() {
  const { activeSymbol } = useAppStore();
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [paused, setPaused] = useState(false);
  const lastPrice = useRef<number>(0);
  const tickId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeSymbol?.token) return;
    setTicks([]);
    lastPrice.current = 0;

    const handler = (data: any) => {
      if (paused) return;
      if (data.token !== activeSymbol.token) return;
      if (!data.ltp) return;

      const ltp = data.ltp;
      const prev = lastPrice.current;
      const side: Tick['side'] = ltp > prev ? 'buy' : ltp < prev ? 'sell' : 'neutral';
      lastPrice.current = ltp;

      const now = new Date();
      const tick: Tick = {
        id: ++tickId.current,
        time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`,
        price: ltp,
        qty: data.volume || 0,
        side,
        change: prev > 0 ? ltp - prev : 0,
      };

      setTicks(prev => [tick, ...prev].slice(0, MAX_TICKS));
    };

    const quoteHandler = (data: any) => {
      if (data.token === activeSymbol.token) handler(data);
    };
    wsService.on('quote', quoteHandler);

    return () => { wsService.off('quote', quoteHandler); };
  }, [activeSymbol?.token, paused]);

  return (
    <div className="flex flex-col h-full bg-fw-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-fw-accent" />
          <span className="text-xs font-bold text-fw-text uppercase tracking-wide">Time & Sales</span>
          {activeSymbol && <span className="text-xs text-fw-text-secondary">{activeSymbol.symbol}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused(p => !p)}
            className={`text-[10px] px-2 py-0.5 rounded border ${paused ? 'border-fw-accent text-fw-accent' : 'border-fw-border text-fw-text-secondary'}`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            onClick={() => setTicks([])}
            className="text-[10px] px-2 py-0.5 rounded border border-fw-border text-fw-text-secondary hover:border-fw-text-secondary"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-4 px-3 py-1 border-b border-fw-border text-[10px] text-fw-text-muted font-bold uppercase">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Change</span>
        <span className="text-right">Volume</span>
      </div>

      {/* Tick Stream */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {ticks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-fw-text-muted text-xs">
            {activeSymbol ? 'Waiting for ticks...' : 'Select a symbol'}
          </div>
        )}
        {ticks.map((tick) => (
          <div
            key={tick.id}
            className={`grid grid-cols-4 px-3 py-[3px] border-b border-fw-border/20 text-xs font-mono
              ${tick.side === 'buy' ? 'bg-fw-green-dim' : tick.side === 'sell' ? 'bg-fw-red-dim' : ''}`}
          >
            <span className="text-fw-text-muted">{tick.time}</span>
            <span className={`text-right font-bold ${tick.side === 'buy' ? 'text-green' : tick.side === 'sell' ? 'text-red' : 'text-fw-text'}`}>
              {tick.price.toFixed(2)}
            </span>
            <span className={`text-right ${tick.change > 0 ? 'text-green' : tick.change < 0 ? 'text-red' : 'text-fw-text-muted'}`}>
              {tick.change > 0 ? '+' : ''}{tick.change !== 0 ? tick.change.toFixed(2) : '—'}
            </span>
            <span className="text-right text-fw-text-secondary">
              {tick.qty > 0 ? tick.qty.toLocaleString('en-IN') : '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-fw-border text-[10px] text-fw-text-muted">
        {ticks.length} ticks{paused ? ' (paused)' : ''}
      </div>
    </div>
  );
}
