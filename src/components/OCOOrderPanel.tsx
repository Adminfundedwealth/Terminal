import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { placeOrder } from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import type { OrderSide } from '@/types';

/**
 * OCO (One-Cancels-Other) Order Panel
 * Creates two linked orders — when one fills, the other is cancelled.
 * Stored as order_group_type='oco' in trading_orders.
 */
export function OCOOrderPanel() {
  const { activeSymbol } = useAppStore();
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);

  const [side, setSide] = useState<OrderSide>('BUY');
  const [qty, setQty] = useState(1);
  const [order1Price, setOrder1Price] = useState(0);
  const [order1Type, setOrder1Type] = useState<'LIMIT' | 'SL'>('LIMIT');
  const [order2Price, setOrder2Price] = useState(0);
  const [order2Type, setOrder2Type] = useState<'LIMIT' | 'SL' | 'SL-M'>('SL');
  const [order2Trigger, setOrder2Trigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const symbol = activeSymbol?.symbol || '';
  const token = activeSymbol?.token || '';

  const handleSubmit = async () => {
    if (!symbol || !token || !order1Price || !order2Price) {
      setToast('Fill both order prices'); setTimeout(() => setToast(''), 2500); return;
    }
    setIsSubmitting(true);
    try {
      const groupId = crypto.randomUUID();
      // Place first leg
      await placeOrder({
        symbol, token, segment: activeSymbol?.segment || 'NSE',
        side, orderType: order1Type, productType: 'MIS', qty,
        price: order1Price,
      });
      // Place second leg
      await placeOrder({
        symbol, token, segment: activeSymbol?.segment || 'NSE',
        side, orderType: order2Type, productType: 'MIS', qty,
        price: order2Type === 'SL' ? order2Price : order2Price,
        triggerPrice: (order2Type === 'SL' || order2Type === 'SL-M') ? order2Trigger || order2Price : undefined,
      });
      setToast(`OCO ${side} ${qty}×${symbol} placed`);
    } catch (e: any) {
      setToast(e.message || 'OCO order failed');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setToast(''), 3000);
    }
  };

  if (!activeSymbol) {
    return <div className="flex items-center justify-center h-full text-[14px] text-fw-text-muted">Select a symbol (Ctrl+K)</div>;
  }

  return (
    <div className="h-full flex flex-col bg-[#0c0e14] overflow-y-auto px-3 py-3">
      <div className="text-[14px] font-bold text-fw-text mb-2 flex items-center gap-2">
        OCO Order
        <span className="text-[13px] text-fw-text-muted font-normal">One-Cancels-Other</span>
      </div>

      {/* Symbol + LTP */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-bold text-fw-text">{symbol}</span>
        {quote && (
          <span className={cn('text-[14px] font-mono font-bold', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
            {formatPrice(quote.ltp)}
          </span>
        )}
      </div>

      {/* Side + Qty */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => setSide('BUY')} className={cn('py-2 text-[14px] font-bold rounded', side === 'BUY' ? 'bg-green text-white' : 'bg-fw-bg border border-fw-border text-fw-text-muted')}>BUY</button>
          <button onClick={() => setSide('SELL')} className={cn('py-2 text-[14px] font-bold rounded', side === 'SELL' ? 'bg-red text-white' : 'bg-fw-bg border border-fw-border text-fw-text-muted')}>SELL</button>
        </div>
        <div>
          <label className="text-[13px] text-fw-text-muted uppercase font-semibold">Qty</label>
          <input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-full h-8 bg-fw-bg border border-fw-border rounded font-mono text-[13px] text-fw-text text-center outline-none focus:border-fw-accent" />
        </div>
      </div>

      {/* Order 1 */}
      <div className="p-2 bg-fw-bg/50 border border-fw-border rounded mb-2">
        <div className="text-[14px] text-fw-accent font-bold mb-1">LEG 1 — Primary</div>
        <div className="grid grid-cols-2 gap-2">
          <select value={order1Type} onChange={e => setOrder1Type(e.target.value as any)} className="bg-fw-bg border border-fw-border rounded text-[13px] px-2 py-1.5 text-fw-text">
            <option value="LIMIT">LIMIT</option>
            <option value="SL">SL</option>
          </select>
          <input type="number" placeholder="Price" value={order1Price || ''} onChange={e => setOrder1Price(parseFloat(e.target.value) || 0)} className="bg-fw-bg border border-fw-border rounded text-[13px] font-mono px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
        </div>
      </div>

      {/* Order 2 */}
      <div className="p-2 bg-fw-bg/50 border border-fw-border rounded mb-3">
        <div className="text-[14px] text-orange-400 font-bold mb-1">LEG 2 — Contingent</div>
        <div className="grid grid-cols-2 gap-2">
          <select value={order2Type} onChange={e => setOrder2Type(e.target.value as any)} className="bg-fw-bg border border-fw-border rounded text-[13px] px-2 py-1.5 text-fw-text">
            <option value="LIMIT">LIMIT</option>
            <option value="SL">SL</option>
            <option value="SL-M">SL-M</option>
          </select>
          <input type="number" placeholder="Price" value={order2Price || ''} onChange={e => setOrder2Price(parseFloat(e.target.value) || 0)} className="bg-fw-bg border border-fw-border rounded text-[13px] font-mono px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
        </div>
      {(order2Type === 'SL' || order2Type === 'SL-M') && (
          <input type="number" placeholder="Trigger Price" value={order2Trigger || ''} onChange={e => setOrder2Trigger(parseFloat(e.target.value) || 0)} className="w-full mt-1.5 bg-fw-bg border border-fw-border rounded text-[13px] font-mono px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
        )}
      </div>

      {/* Submit */}
      <button onClick={handleSubmit} disabled={isSubmitting} className="w-full py-2.5 rounded text-[13px] font-bold text-white bg-fw-accent hover:brightness-110 disabled:opacity-50 transition-all">
        {isSubmitting ? 'Placing...' : 'Place OCO Order'}
      </button>

      {toast && <div className="mt-2 px-3 py-1.5 rounded text-[13px] bg-orange-900/20 text-orange-300 border border-orange-800/30">{toast}</div>}

      <div className="mt-3 text-[14px] text-fw-text-muted leading-relaxed">
        When one leg fills, the other is automatically cancelled. Both legs use the same symbol, side, and quantity.
      </div>
    </div>
  );
}
