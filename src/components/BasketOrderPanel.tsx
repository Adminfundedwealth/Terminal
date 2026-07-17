import { useState } from 'react';
import { placeOrder } from '@/services/api';
import { cn } from '@/utils/helpers';
import { Plus, Trash2, Play, X } from 'lucide-react';
import type { OrderSide, OrderType, ProductType } from '@/types';

interface BasketLeg {
  id: string;
  symbol: string;
  token: string;
  segment: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  qty: number;
  price: number;
}

export function BasketOrderPanel() {
  const [legs, setLegs] = useState<BasketLeg[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<{ symbol: string; status: string }[]>([]);

  const addLeg = () => {
    setLegs([...legs, {
      id: crypto.randomUUID(),
      symbol: '', token: '', segment: 'NSE',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 1, price: 0,
    }]);
  };

  const updateLeg = (id: string, updates: Partial<BasketLeg>) => {
    setLegs(legs.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLeg = (id: string) => {
    setLegs(legs.filter(l => l.id !== id));
  };

  const executeBasket = async () => {
    if (legs.length === 0) return;
    setIsExecuting(true);
    setResults([]);
    const execResults: { symbol: string; status: string }[] = [];

    for (const leg of legs) {
      if (!leg.symbol || !leg.token) {
        execResults.push({ symbol: leg.symbol || '?', status: 'SKIP — no symbol' });
        continue;
      }
      try {
        await placeOrder({
          symbol: leg.symbol, token: leg.token, segment: leg.segment,
          side: leg.side, orderType: leg.orderType, productType: leg.productType,
          qty: leg.qty, price: leg.orderType === 'LIMIT' ? leg.price : undefined,
        });
        execResults.push({ symbol: leg.symbol, status: 'PLACED' });
      } catch (e: any) {
        execResults.push({ symbol: leg.symbol, status: 'FAIL: ' + (e.message || 'unknown') });
      }
    }

    setResults(execResults);
    setIsExecuting(false);
  };

  return (
    <div className="h-full flex flex-col bg-[#0c0e14]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        <span className="text-[14px] font-bold text-fw-text">Basket Orders</span>
        <div className="flex items-center gap-2">
          <button onClick={addLeg} className="flex items-center gap-1 px-2 py-1 text-[14px] bg-fw-accent text-white rounded font-bold hover:brightness-110">
            <Plus size={10} /> Add Leg
          </button>
          {legs.length > 0 && (
            <button onClick={executeBasket} disabled={isExecuting} className="flex items-center gap-1 px-2 py-1 text-[14px] bg-green text-white rounded font-bold hover:brightness-110 disabled:opacity-50">
              <Play size={10} /> {isExecuting ? 'Executing...' : 'Execute All'}
            </button>
          )}
        </div>
      </div>

      {/* Legs */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {legs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-fw-text-muted">
            <span className="text-[14px]">No legs in basket</span>
            <span className="text-[14px]">Click "Add Leg" to build a multi-order basket</span>
          </div>
        ) : (
          legs.map((leg, idx) => (
            <div key={leg.id} className="p-2 bg-fw-bg border border-fw-border rounded">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[14px] font-bold text-fw-text-secondary">Leg {idx + 1}</span>
                <button onClick={() => removeLeg(leg.id)} className="text-red-400 hover:text-red-300"><Trash2 size={11} /></button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <input placeholder="Symbol" value={leg.symbol} onChange={e => updateLeg(leg.id, { symbol: e.target.value.toUpperCase() })} className="col-span-2 bg-[#141720] border border-fw-border rounded text-[13px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
                <input placeholder="Token" value={leg.token} onChange={e => updateLeg(leg.id, { token: e.target.value })} className="bg-[#141720] border border-fw-border rounded text-[13px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
                <select value={leg.segment} onChange={e => updateLeg(leg.id, { segment: e.target.value })} className="bg-[#141720] border border-fw-border rounded text-[14px] px-1 py-1.5 text-fw-text">
                  <option>NSE</option><option>NFO</option><option>MCX</option><option>CDS</option>
                </select>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mt-1.5">
                <select value={leg.side} onChange={e => updateLeg(leg.id, { side: e.target.value as OrderSide })} className={cn('rounded text-[14px] font-bold px-1 py-1.5 border', leg.side === 'BUY' ? 'bg-green-900/20 text-green border-green-800/30' : 'bg-red-900/20 text-red border-red-800/30')}>
                  <option value="BUY">BUY</option><option value="SELL">SELL</option>
                </select>
                <select value={leg.orderType} onChange={e => updateLeg(leg.id, { orderType: e.target.value as OrderType })} className="bg-[#141720] border border-fw-border rounded text-[14px] px-1 py-1.5 text-fw-text">
                  <option>MARKET</option><option>LIMIT</option><option>SL</option><option>SL-M</option>
                </select>
                <select value={leg.productType} onChange={e => updateLeg(leg.id, { productType: e.target.value as ProductType })} className="bg-[#141720] border border-fw-border rounded text-[14px] px-1 py-1.5 text-fw-text">
                  <option>MIS</option><option>NRML</option><option>CNC</option>
                </select>
                <input type="number" placeholder="Qty" value={leg.qty || ''} onChange={e => updateLeg(leg.id, { qty: parseInt(e.target.value) || 1 })} className="bg-[#141720] border border-fw-border rounded text-[14px] font-mono px-1 py-1.5 text-fw-text text-center outline-none" />
                {leg.orderType === 'LIMIT' && (
                  <input type="number" placeholder="Price" value={leg.price || ''} onChange={e => updateLeg(leg.id, { price: parseFloat(e.target.value) || 0 })} className="bg-[#141720] border border-fw-border rounded text-[14px] font-mono px-1 py-1.5 text-fw-text text-center outline-none" />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="px-3 py-2 border-t border-fw-border bg-[#10121a] flex-shrink-0 space-y-0.5">
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-[14px]">
              <span className="text-fw-text-secondary">{r.symbol}</span>
              <span className={cn('font-bold', r.status === 'PLACED' ? 'text-green' : 'text-red')}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
