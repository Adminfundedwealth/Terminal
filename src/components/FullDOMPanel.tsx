import { useAppStore } from '@/store/appStore';
import { useDepth } from '@/hooks/useMarketData';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice } from '@/utils/helpers';

function fmtQty(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000) return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

/**
 * 20-Level DOM (Depth of Market)
 * Shows full 20 bid/ask levels with volume visualization
 */
export function FullDOMPanel() {
  const { activeSymbol } = useAppStore();
  const liveDepth = useDepth(activeSymbol?.token);
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const { setOrderForm } = useTradingStore();

  const bids = liveDepth?.bids || [];
  const asks = liveDepth?.asks || [];

  // Extend to 20 levels (or pad with empty)
  const levels = 20;
  const paddedBids = [...bids, ...Array(Math.max(0, levels - bids.length)).fill(null)].slice(0, levels);
  const paddedAsks = [...asks, ...Array(Math.max(0, levels - asks.length)).fill(null)].slice(0, levels);

  const maxBidQty = Math.max(...bids.map(b => b.qty), 1);
  const maxAskQty = Math.max(...asks.map(a => a.qty), 1);
  const maxQty = Math.max(maxBidQty, maxAskQty);

  const totalBid = bids.reduce((s, b) => s + b.qty, 0);
  const totalAsk = asks.reduce((s, a) => s + a.qty, 0);
  const bidPct = totalBid + totalAsk > 0 ? (totalBid / (totalBid + totalAsk)) * 100 : 50;

  return (
    <div className="h-full flex flex-col bg-fw-surface select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-fw-surface flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-fw-text">20-Level DOM</span>
          {activeSymbol && <span className="text-xs text-fw-text-secondary">{activeSymbol.symbol}</span>}
        </div>
        {quote && (
          <span className={cn('text-md font-mono font-black', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
            {formatPrice(quote.ltp)}
          </span>
        )}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[50px_1fr_80px_80px_1fr_50px] px-1 py-1 border-b border-fw-border/30 bg-fw-surface-2 flex-shrink-0 text-xs font-bold text-fw-text-secondary uppercase">
        <span className="text-center">#</span>
        <span className="text-right pr-1">Bid Qty</span>
        <span className="text-center text-green">Bid</span>
        <span className="text-center text-red">Ask</span>
        <span className="text-left pl-1">Ask Qty</span>
        <span className="text-center">#</span>
      </div>

      {/* 20 Depth Levels */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {Array.from({ length: levels }, (_, i) => {
          const bid = paddedBids[i];
          const ask = paddedAsks[i];
          const bidBarW = bid ? (bid.qty / maxQty) * 100 : 0;
          const askBarW = ask ? (ask.qty / maxQty) * 100 : 0;

          return (
            <div key={i} className="grid grid-cols-[50px_1fr_80px_80px_1fr_50px] items-center relative h-[24px] border-b border-fw-border/5 group hover:bg-fw-hover/10">
              {/* Volume bars */}
              <div className="absolute top-0 bottom-0 right-1/2 pointer-events-none">
                <div className="absolute right-0 top-[1px] bottom-[1px] rounded-l-sm" style={{ width: `${bidBarW * 0.45}%`, background: `rgba(34,197,94,${0.08 + (bidBarW/100)*0.12})` }} />
              </div>
              <div className="absolute top-0 bottom-0 left-1/2 pointer-events-none">
                <div className="absolute left-0 top-[1px] bottom-[1px] rounded-r-sm" style={{ width: `${askBarW * 0.45}%`, background: `rgba(239,68,68,${0.08 + (askBarW/100)*0.12})` }} />
              </div>

              {/* Bid # Orders */}
              <div className="relative text-center text-xs font-mono text-fw-text-secondary tabular-nums">
                {bid?.orders || ''}
              </div>

              {/* Bid Qty */}
              <div
                className="relative text-right pr-2 text-sm font-mono tabular-nums text-green/80 font-semibold cursor-pointer hover:text-green"
                onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY' })}
              >
                {bid ? fmtQty(bid.qty) : ''}
              </div>

              {/* Bid Price */}
              <div
                className={cn('relative text-center text-sm font-mono tabular-nums font-bold cursor-pointer hover:text-green', i === 0 ? 'text-green' : 'text-fw-text/80')}
                onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY' })}
              >
                {bid ? formatPrice(bid.price) : ''}
              </div>

              {/* Ask Price */}
              <div
                className={cn('relative text-center text-sm font-mono tabular-nums font-bold cursor-pointer hover:text-red', i === 0 ? 'text-red' : 'text-fw-text/80')}
                onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL' })}
              >
                {ask ? formatPrice(ask.price) : ''}
              </div>

              {/* Ask Qty */}
              <div
                className="relative text-left pl-2 text-sm font-mono tabular-nums text-red/80 font-semibold cursor-pointer hover:text-red"
                onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL' })}
              >
                {ask ? fmtQty(ask.qty) : ''}
              </div>

              {/* Ask # Orders */}
              <div className="relative text-center text-xs font-mono text-fw-text-secondary tabular-nums">
                {ask?.orders || ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals + Pressure */}
      <div className="border-t border-fw-border bg-fw-surface px-3 py-2 flex-shrink-0">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-mono text-green font-bold tabular-nums">{fmtQty(totalBid)}</span>
          <span className="text-xs text-fw-text-secondary">{bidPct.toFixed(0)}% / {(100-bidPct).toFixed(0)}%</span>
          <span className="font-mono text-red font-bold tabular-nums">{fmtQty(totalAsk)}</span>
        </div>
        <div className="h-[6px] rounded-full overflow-hidden bg-fw-border/30 flex">
          <div className="h-full rounded-l-full transition-all duration-500" style={{ width: `${bidPct}%`, background: 'linear-gradient(to right, #16a34a, #22c55e)' }} />
          <div className="h-full flex-1 rounded-r-full" style={{ background: 'linear-gradient(to right, #ef4444, #dc2626)' }} />
        </div>
        <div className="text-xs text-fw-text-secondary mt-1 text-center">
          {bids.length + asks.length > 10 ? `${bids.length} bid + ${asks.length} ask levels` : 'Awaiting full depth from broker feed'}
        </div>
      </div>
    </div>
  );
}
