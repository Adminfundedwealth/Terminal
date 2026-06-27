import { useAppStore } from '@/store/appStore';
import { useDepth } from '@/hooks/useMarketData';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice } from '@/utils/helpers';
import { Layers, ArrowUpDown } from 'lucide-react';
import type { MarketDepthLevel } from '@/types';

function fmtQty(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000) return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function MarketDepthPanel() {
  const { activeSymbol } = useAppStore();
  const liveDepth = useDepth(activeSymbol?.token);
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const { setOrderForm } = useTradingStore();

  const depth = liveDepth ?? { bids: [] as MarketDepthLevel[], asks: [] as MarketDepthLevel[], totalBuyQty: 0, totalSellQty: 0 };

  const maxBidQty = Math.max(...depth.bids.map((b) => b.qty), 1);
  const maxAskQty = Math.max(...depth.asks.map((a) => a.qty), 1);
  const maxQty = Math.max(maxBidQty, maxAskQty);

  const totalBid = depth.totalBuyQty || depth.bids.reduce((s, b) => s + b.qty, 0);
  const totalAsk = depth.totalSellQty || depth.asks.reduce((s, a) => s + a.qty, 0);
  const grandTotal = totalBid + totalAsk;
  const bidPct = grandTotal > 0 ? (totalBid / grandTotal) * 100 : 50;
  const spread = depth.asks[0] && depth.bids[0] ? (depth.asks[0].price - depth.bids[0].price) : 0;

  const hasData = depth.bids.length > 0 || depth.asks.length > 0;

  return (
    <div className="flex flex-col bg-[#090b10] select-none h-full overflow-hidden">
      {/* Header — Strong */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-gradient-to-r from-[#10121a] to-[#0e1018] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-fw-accent" />
          <span className="text-[10px] font-black text-fw-text uppercase tracking-wider">Depth</span>
          {activeSymbol && <span className="text-[9px] text-fw-text-muted font-mono ml-1">{activeSymbol.symbol}</span>}
        </div>
        {quote && (
          <span className={cn('text-[13px] font-mono font-black tabular-nums', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
            {formatPrice(quote.ltp)}
          </span>
        )}
      </div>

      {/* Spread + Pressure Summary */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-fw-border/30 bg-[#0b0d12] flex-shrink-0">
        <div className="flex items-center gap-1">
          <ArrowUpDown size={9} className="text-fw-text-muted" />
          <span className="text-[9px] text-fw-text-muted">Spread:</span>
          <span className="text-[10px] font-mono font-bold text-fw-text tabular-nums">{spread > 0 ? formatPrice(spread) : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-green tabular-nums font-bold">{fmtQty(totalBid)}</span>
          <span className="text-[8px] text-fw-text-muted">vs</span>
          <span className="text-[9px] font-mono text-red tabular-nums font-bold">{fmtQty(totalAsk)}</span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_68px_68px_1fr] px-2 py-1 border-b border-fw-border/20 flex-shrink-0">
        <span className="text-[8px] text-fw-text-muted font-bold uppercase text-right pr-2">BID QTY</span>
        <span className="text-[8px] text-green font-bold uppercase text-center">BID</span>
        <span className="text-[8px] text-red font-bold uppercase text-center">ASK</span>
        <span className="text-[8px] text-fw-text-muted font-bold uppercase text-left pl-2">ASK QTY</span>
      </div>

      {/* Depth Levels */}
      <div className="flex-1 overflow-hidden min-h-0">
        {!hasData ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-4">
            <Layers size={20} className="text-fw-text-muted/20" />
            <span className="text-[10px] text-fw-text-muted">Waiting for depth data</span>
            <span className="text-[9px] text-fw-text-muted/60">Click price to set order</span>
          </div>
        ) : (
          [0, 1, 2, 3, 4].map((i) => {
            const bid = depth.bids[i];
            const ask = depth.asks[i];
            const bidBarW = bid ? (bid.qty / maxQty) * 100 : 0;
            const askBarW = ask ? (ask.qty / maxQty) * 100 : 0;

            return (
              <div key={i} className="grid grid-cols-[1fr_68px_68px_1fr] items-center relative h-[30px] border-b border-fw-border/[0.06] group hover:bg-fw-hover/20">
                {/* Bid bar */}
                <div className="absolute top-0 bottom-0 right-1/2 pointer-events-none">
                  <div className="absolute right-0 top-[2px] bottom-[2px] rounded-l-sm transition-all duration-300" style={{ width: `${bidBarW * 0.85}%`, background: 'linear-gradient(to left, rgba(34,197,94,0.18), rgba(34,197,94,0.04))' }} />
                </div>
                {/* Ask bar */}
                <div className="absolute top-0 bottom-0 left-1/2 pointer-events-none">
                  <div className="absolute left-0 top-[2px] bottom-[2px] rounded-r-sm transition-all duration-300" style={{ width: `${askBarW * 0.85}%`, background: 'linear-gradient(to right, rgba(239,68,68,0.18), rgba(239,68,68,0.04))' }} />
                </div>

                {/* Bid Qty */}
                <div className="relative text-right pr-2 text-[11px] font-mono tabular-nums text-green/80 font-bold cursor-pointer hover:text-green transition-colors" onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY', orderType: 'LIMIT' })}>
                  {bid ? fmtQty(bid.qty) : <span className="text-fw-text-muted/30">—</span>}
                </div>
                {/* Bid Price */}
                <div className={cn('relative text-center text-[11px] font-mono tabular-nums font-bold cursor-pointer hover:text-green transition-colors', i === 0 ? 'text-green' : 'text-fw-text/80')} onClick={() => bid && setOrderForm({ price: bid.price, side: 'BUY', orderType: 'LIMIT' })}>
                  {bid ? formatPrice(bid.price) : <span className="text-fw-text-muted/30">—</span>}
                </div>
                {/* Ask Price */}
                <div className={cn('relative text-center text-[11px] font-mono tabular-nums font-bold cursor-pointer hover:text-red transition-colors', i === 0 ? 'text-red' : 'text-fw-text/80')} onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL', orderType: 'LIMIT' })}>
                  {ask ? formatPrice(ask.price) : <span className="text-fw-text-muted/30">—</span>}
                </div>
                {/* Ask Qty */}
                <div className="relative text-left pl-2 text-[11px] font-mono tabular-nums text-red/80 font-bold cursor-pointer hover:text-red transition-colors" onClick={() => ask && setOrderForm({ price: ask.price, side: 'SELL', orderType: 'LIMIT' })}>
                  {ask ? fmtQty(ask.qty) : <span className="text-fw-text-muted/30">—</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pressure Bar — Full Width */}
      <div className="border-t border-fw-border bg-[#0b0d14] px-3 py-2 flex-shrink-0">
        <div className="flex items-center justify-between text-[9px] mb-1">
          <span className="font-mono text-green font-bold">{bidPct.toFixed(0)}% Buy</span>
          <span className="font-mono text-red font-bold">{(100 - bidPct).toFixed(0)}% Sell</span>
        </div>
        <div className="h-[6px] rounded-full overflow-hidden bg-fw-border/20 flex">
          <div className="h-full rounded-l-full transition-all duration-500" style={{ width: `${bidPct}%`, background: 'linear-gradient(to right, #16a34a, #22c55e)' }} />
          <div className="h-full flex-1 rounded-r-full" style={{ background: 'linear-gradient(to right, #ef4444, #dc2626)' }} />
        </div>
      </div>
    </div>
  );
}
