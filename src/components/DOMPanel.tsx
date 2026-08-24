import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice } from '@/utils/helpers';
import type { MarketDepthLevel } from '@/types';
import { SymbolLogo } from '@/components/SymbolLogo';

/**
 * 20-Level DOM (Depth of Market) Panel
 * Full ladder view with 20 bid/ask levels.
 * Click to set order price.
 */
export function DOMPanel() {
  const { activeSymbol } = useAppStore();
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const { setOrderForm } = useTradingStore();
  const [depth, setDepth] = useState<{ bids: MarketDepthLevel[]; asks: MarketDepthLevel[] }>({ bids: [], asks: [] });

  // Fetch 20-level depth
  useEffect(() => {
    if (!activeSymbol?.token) return;
    let active = true;

    const fetchDepth = async () => {
      try {
        const resp = await fetch(`/api/market/depth?token=${activeSymbol.token}&levels=20`, { credentials: 'include' });
        const data = await resp.json();
        if (active && data) {
          setDepth({
            bids: (data.bids || []).slice(0, 20),
            asks: (data.asks || []).slice(0, 20),
          });
        }
      } catch {}
    };

    fetchDepth();
    const interval = setInterval(fetchDepth, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [activeSymbol?.token]);

  const maxQty = Math.max(
    ...depth.bids.map(b => b.qty),
    ...depth.asks.map(a => a.qty),
    1
  );

  const totalBid = depth.bids.reduce((s, b) => s + b.qty, 0);
  const totalAsk = depth.asks.reduce((s, a) => s + a.qty, 0);
  const grandTotal = totalBid + totalAsk;
  const bidPct = grandTotal > 0 ? (totalBid / grandTotal) * 100 : 50;

  const fmtQty = (n: number) => {
    if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
    if (n >= 100_000) return (n / 100_000).toFixed(1) + 'L';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  };

  const LEVELS = 20;

  return (
    <div className="h-full flex flex-col bg-fw-bg select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-fw-border bg-fw-surface flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-fw-text-secondary uppercase tracking-wider">20-Level DOM</span>
          {activeSymbol && (
            <>
              <SymbolLogo symbol={activeSymbol.symbol} size={16} className="flex-shrink-0" />
              <span className="text-[13px] font-bold text-fw-text truncate">{activeSymbol.symbol}</span>
            </>
          )}
        </div>
        {quote && (
          <span className={cn('font-mono font-black text-[14px] tabular-nums', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
            {formatPrice(quote.ltp)}
          </span>
        )}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_70px_70px_1fr] px-2 py-[3px] border-b border-fw-border/30 bg-fw-surface flex-shrink-0">
        <span className="text-[8px] text-fw-text-muted font-bold text-right pr-1">BID QTY</span>
        <span className="text-[8px] text-green font-bold text-center">BID</span>
        <span className="text-[8px] text-red font-bold text-center">ASK</span>
        <span className="text-[8px] text-fw-text-muted font-bold text-left pl-1">ASK QTY</span>
      </div>

      {/* DOM Levels */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: LEVELS }).map((_, i) => {
          const bid = depth.bids[i];
          const ask = depth.asks[i];
          const bidBarW = bid ? (bid.qty / maxQty) * 100 : 0;
          const askBarW = ask ? (ask.qty / maxQty) * 100 : 0;

          return (
            <div key={i} className="grid grid-cols-[1fr_70px_70px_1fr] items-center relative h-[22px] border-b border-fw-border/10 group">
              {/* Bid bar */}
              <div className="absolute top-0 bottom-0 right-1/2 pointer-events-none">
                <div className="absolute right-0 top-[1px] bottom-[1px] rounded-l-sm" style={{ width: `${bidBarW * 0.85}%`, background: `rgba(34,197,94,${0.08 + (i === 0 ? 0.12 : 0.04)})` }} />
              </div>
              {/* Ask bar */}
              <div className="absolute top-0 bottom-0 left-1/2 pointer-events-none">
                <div className="absolute left-0 top-[1px] bottom-[1px] rounded-r-sm" style={{ width: `${askBarW * 0.85}%`, background: `rgba(239,68,68,${0.08 + (i === 0 ? 0.12 : 0.04)})` }} />
              </div>

              {/* Bid Qty */}
              <div
                className="relative text-right pr-2 text-[13px] font-mono tabular-nums text-green/70 font-semibold cursor-pointer hover:text-green"
                onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY' })}
              >
                {bid ? fmtQty(bid.qty) : '—'}
                {bid && bid.orders && <span className="text-[8px] text-fw-text-muted ml-0.5">({bid.orders})</span>}
              </div>

              {/* Bid Price */}
              <div
                className={cn('relative text-center text-[13px] font-mono tabular-nums font-bold cursor-pointer hover:text-green', i === 0 ? 'text-green' : 'text-fw-text/80')}
                onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY' })}
              >
                {bid ? formatPrice(bid.price) : '—'}
              </div>

              {/* Ask Price */}
              <div
                className={cn('relative text-center text-[13px] font-mono tabular-nums font-bold cursor-pointer hover:text-red', i === 0 ? 'text-red' : 'text-fw-text/80')}
                onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL' })}
              >
                {ask ? formatPrice(ask.price) : '—'}
              </div>

              {/* Ask Qty */}
              <div
                className="relative text-left pl-2 text-[13px] font-mono tabular-nums text-red/70 font-semibold cursor-pointer hover:text-red"
                onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL' })}
              >
                {ask ? fmtQty(ask.qty) : '—'}
                {ask && ask.orders && <span className="text-[8px] text-fw-text-muted ml-0.5">({ask.orders})</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals + Pressure Bar */}
      <div className="border-t border-fw-border bg-fw-surface px-3 py-2 flex-shrink-0">
        <div className="flex justify-between text-[14px] mb-1">
          <span className="font-mono text-green font-bold tabular-nums">{fmtQty(totalBid)}</span>
          <span className="text-[13px] text-fw-text-muted">{bidPct.toFixed(0)}% / {(100 - bidPct).toFixed(0)}%</span>
          <span className="font-mono text-red font-bold tabular-nums">{fmtQty(totalAsk)}</span>
        </div>
        <div className="h-[5px] rounded-full overflow-hidden bg-fw-border/30 flex">
          <div className="h-full rounded-l-full transition-all duration-500" style={{ width: `${bidPct}%`, background: 'linear-gradient(to right, #16a34a, #22c55e)' }} />
          <div className="h-full flex-1 rounded-r-full" style={{ background: 'linear-gradient(to right, #ef4444, #dc2626)' }} />
        </div>
      </div>
    </div>
  );
}
