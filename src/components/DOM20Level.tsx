import { useState, useEffect } from 'react';
import { Layers } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { wsService } from '@/services/websocket';

interface DepthLevel {
  price: number;
  qty: number;
  orders: number;
  cumQty: number;
}

interface DOMData {
  bids: DepthLevel[];
  asks: DepthLevel[];
  totalBuyQty: number;
  totalSellQty: number;
  ltp: number;
  spread: number;
}

export function DOM20Level() {
  const { activeSymbol } = useAppStore();
  const [dom, setDom] = useState<DOMData>({
    bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0, ltp: 0, spread: 0
  });
  const [levels, setLevels] = useState<20 | 10 | 5>(20);

  useEffect(() => {
    if (!activeSymbol?.token) return;

    const handler = (data: any) => {
      if (data.token !== activeSymbol.token || !data.bids) return;

      let cumBuy = 0, cumSell = 0;
      const bids: DepthLevel[] = (data.bids || []).slice(0, levels).map((b: any) => {
        cumBuy += b.qty;
        return { ...b, cumQty: cumBuy };
      });
      const asks: DepthLevel[] = (data.asks || []).slice(0, levels).map((a: any) => {
        cumSell += a.qty;
        return { ...a, cumQty: cumSell };
      });

      const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0;

      setDom({
        bids, asks,
        totalBuyQty: data.totalBuyQty || cumBuy,
        totalSellQty: data.totalSellQty || cumSell,
        ltp: data.ltp || 0,
        spread,
      });
    };

    wsService.subscribe([activeSymbol.token]);
    const depthHandler = (data: any) => {
      if (data.token === activeSymbol.token) handler(data);
    };
    wsService.on('depth', depthHandler);

    return () => {
      wsService.off('depth', depthHandler);
      wsService.unsubscribe([activeSymbol.token]);
    };
  }, [activeSymbol?.token, levels]);

  const maxQty = Math.max(
    ...dom.bids.map(b => b.cumQty),
    ...dom.asks.map(a => a.cumQty),
    1
  );

  const pressure = dom.totalBuyQty + dom.totalSellQty > 0
    ? (dom.totalBuyQty / (dom.totalBuyQty + dom.totalSellQty)) * 100
    : 50;

  function handleClickPrice(price: number, side: 'BUY' | 'SELL') {
    const { setOrderDefaults } = useAppStore.getState() as any;
    if (setOrderDefaults) {
      setOrderDefaults({ price, side, orderType: 'LIMIT' });
    }
  }

  return (
    <div className="flex flex-col h-full bg-fw-surface text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-fw-accent" />
          <span className="font-bold text-fw-text uppercase tracking-wide">DOM</span>
          {activeSymbol && <span className="text-fw-text-secondary">{activeSymbol.symbol}</span>}
        </div>
        <div className="flex items-center gap-1">
          {([5, 10, 20] as const).map(l => (
            <button
              key={l}
              onClick={() => setLevels(l)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${levels === l ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover'}`}
            >
              {l}L
            </button>
          ))}
        </div>
      </div>

      {/* Pressure Bar */}
      <div className="px-3 py-1.5 border-b border-fw-border">
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          <span className="text-green font-mono">{dom.totalBuyQty.toLocaleString('en-IN')} Buy</span>
          <span className="text-fw-text-muted">Spread: {dom.spread.toFixed(2)}</span>
          <span className="text-red font-mono">{dom.totalSellQty.toLocaleString('en-IN')} Sell</span>
        </div>
        <div className="h-2 rounded-full bg-fw-surface-2 overflow-hidden flex">
          <div className="bg-green-500/60 transition-all" style={{ width: `${pressure}%` }} />
          <div className="bg-red-500/60 transition-all" style={{ width: `${100 - pressure}%` }} />
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-6 px-2 py-1 border-b border-fw-border text-[9px] text-fw-text-muted font-bold uppercase">
        <span>Orders</span>
        <span className="text-right">Qty</span>
        <span className="text-right text-green">Bid</span>
        <span className="text-left text-red pl-2">Ask</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Orders</span>
      </div>

      {/* Depth Rows */}
      <div className="flex-1 overflow-y-auto">
        {dom.bids.length === 0 && dom.asks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-fw-text-muted">
            {activeSymbol ? 'Waiting for depth...' : 'Select a symbol'}
          </div>
        ) : (
          Array.from({ length: Math.max(dom.bids.length, dom.asks.length) }, (_, i) => {
            const bid = dom.bids[i];
            const ask = dom.asks[i];

            return (
              <div key={i} className="grid grid-cols-6 px-2 py-[2px] relative hover:bg-fw-hover">
                {/* Bid fill background */}
                {bid && (
                  <div
                    className="absolute left-0 top-0 h-full bg-green-500/8 pointer-events-none"
                    style={{ width: `${(bid.cumQty / maxQty) * 50}%` }}
                  />
                )}
                {/* Ask fill background */}
                {ask && (
                  <div
                    className="absolute right-0 top-0 h-full bg-red-500/8 pointer-events-none"
                    style={{ width: `${(ask.cumQty / maxQty) * 50}%` }}
                  />
                )}

                <span className="font-mono text-fw-text-muted relative">{bid?.orders || ''}</span>
                <span className="font-mono text-right text-fw-text-secondary relative">{bid?.qty?.toLocaleString('en-IN') || ''}</span>
                <span
                  className="font-mono text-right text-green font-bold relative cursor-pointer hover:underline"
                  onClick={() => bid && handleClickPrice(bid.price, 'BUY')}
                >
                  {bid?.price.toFixed(2) || ''}
                </span>
                <span
                  className="font-mono text-left text-red font-bold relative pl-2 cursor-pointer hover:underline"
                  onClick={() => ask && handleClickPrice(ask.price, 'SELL')}
                >
                  {ask?.price.toFixed(2) || ''}
                </span>
                <span className="font-mono text-right text-fw-text-secondary relative">{ask?.qty?.toLocaleString('en-IN') || ''}</span>
                <span className="font-mono text-right text-fw-text-muted relative">{ask?.orders || ''}</span>
              </div>
            );
          })
        )}
      </div>

      {/* LTP */}
      {dom.ltp > 0 && (
        <div className="px-3 py-1.5 border-t border-fw-border text-center">
          <span className="text-fw-text-muted text-[10px]">LTP: </span>
          <span className="font-mono font-bold text-fw-accent">{dom.ltp.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
