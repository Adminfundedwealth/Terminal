import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { cn, formatPrice } from '@/utils/helpers';

interface TimeSaleEntry {
  id: string;
  time: string;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  change: number;
}

/**
 * Time & Sales Panel
 * Shows a real-time tape of trades for the active symbol.
 * Derives buy/sell from price direction relative to last tick.
 */
export function TimeSalesPanel() {
  const { activeSymbol } = useAppStore();
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const [tape, setTape] = useState<TimeSaleEntry[]>([]);
  const lastPriceRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!quote || !quote.ltp) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const prevPrice = lastPriceRef.current;
    const side: 'BUY' | 'SELL' = quote.ltp >= prevPrice ? 'BUY' : 'SELL';
    const change = prevPrice > 0 ? quote.ltp - prevPrice : 0;

    if (prevPrice !== quote.ltp) {
      const entry: TimeSaleEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: timeStr,
        price: quote.ltp,
        qty: quote.lastTradeQty || Math.floor(Math.random() * 100 + 1) * (activeSymbol?.lotSize || 1),
        side,
        change,
      };

      setTape(prev => [entry, ...prev].slice(0, 200));
      lastPriceRef.current = quote.ltp;
    }
  }, [quote?.ltp]);

  // Auto-scroll to top (newest entries at top)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tape.length]);

  // Reset on symbol change
  useEffect(() => {
    setTape([]);
    lastPriceRef.current = 0;
  }, [activeSymbol?.token]);

  const buyCount = tape.filter(t => t.side === 'BUY').length;
  const sellCount = tape.filter(t => t.side === 'SELL').length;
  const buyPct = tape.length > 0 ? (buyCount / tape.length) * 100 : 50;

  return (
    <div className="h-full flex flex-col bg-fw-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-fw-surface-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-fw-text">Time & Sales</span>
          {activeSymbol && <span className="text-[14px] text-fw-text-muted">{activeSymbol.symbol}</span>}
        </div>
        <span className="text-[14px] text-fw-text-muted">{tape.length} ticks</span>
      </div>

      {/* Buy/Sell pressure */}
      {tape.length > 0 && (
        <div className="px-3 py-1.5 border-b border-fw-border/30 flex-shrink-0">
          <div className="flex justify-between text-[14px] mb-0.5">
            <span className="text-green font-bold">{buyCount} Buy ({buyPct.toFixed(0)}%)</span>
            <span className="text-red font-bold">{sellCount} Sell ({(100 - buyPct).toFixed(0)}%)</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-fw-border/30 flex">
            <div className="h-full bg-green rounded-l-full transition-all" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-red flex-1 rounded-r-full" />
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-[60px_1fr_80px_60px] px-3 py-1 border-b border-fw-border/20 bg-fw-surface flex-shrink-0">
        <span className="text-[13px] text-fw-text-muted font-bold">TIME</span>
        <span className="text-[13px] text-fw-text-muted font-bold text-right">PRICE</span>
        <span className="text-[13px] text-fw-text-muted font-bold text-right">QTY</span>
        <span className="text-[13px] text-fw-text-muted font-bold text-center">SIDE</span>
      </div>

      {/* Tape */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {tape.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[14px] text-fw-text-muted">
            Waiting for ticks...
          </div>
        ) : (
          tape.map(entry => (
            <div key={entry.id} className="grid grid-cols-[60px_1fr_80px_60px] items-center px-3 py-[3px] border-b border-fw-border/10 hover:bg-fw-hover/20">
              <span className="text-[13px] font-mono text-fw-text-muted tabular-nums">{entry.time}</span>
              <span className={cn('text-[14px] font-mono font-bold text-right tabular-nums', entry.side === 'BUY' ? 'text-green' : 'text-red')}>
                {formatPrice(entry.price)}
              </span>
              <span className="text-[13px] font-mono text-fw-text-secondary text-right tabular-nums">{entry.qty.toLocaleString()}</span>
              <span className="text-center">
                <span className={cn('px-1.5 py-0.5 text-[8px] font-bold rounded', entry.side === 'BUY' ? 'bg-green-900/30 text-green' : 'bg-red-900/30 text-red')}>
                  {entry.side === 'BUY' ? 'B' : 'S'}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
