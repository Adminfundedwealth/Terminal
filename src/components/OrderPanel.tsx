import { useState } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { placeOrder, exitPosition } from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import { orderSuccessMessage, exitSuccessMessage } from '@/utils/orderMessages';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { OrderSide, OrderType, ProductType } from '@/types';
import SymbolLogo from '@/components/SymbolLogo';

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'MARKET', label: 'MKT' },
  { value: 'LIMIT', label: 'LMT' },
  { value: 'SL', label: 'SL' },
  { value: 'SL-M', label: 'SL-M' },
];

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: 'MIS', label: 'MIS' },
  { value: 'NRML', label: 'NRML' },
  { value: 'CNC', label: 'CNC' },
];

export function OrderPanel() {
  const { orderForm, setOrderForm } = useTradingStore();
  const account = useTradingStore((s) => s.account);
  const selectedContract = useTradingStore((s) => s.selectedContract);
  const { activeSymbol } = useAppStore();
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slPrice, setSlPrice] = useState<number>(0);
  const [tpPrice, setTpPrice] = useState<number>(0);
  const [confirmOrder, setConfirmOrder] = useState<{ side: OrderSide } | null>(null);

  const symbol = orderForm.symbol || activeSymbol?.symbol || '';
  const token = orderForm.token || activeSymbol?.token || '';

  // Find open position for the current symbol (for EXIT button)
  const openPosition = useTradingStore.getState().positions.find(
    (p) => p.symbol === symbol && p.qty !== 0
  );

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // Client-side validation before order submission
  function validateOrder(side: OrderSide): string | null {
    if (!symbol || !token) return 'No symbol selected';
    if (!orderForm.qty || orderForm.qty <= 0) return 'Quantity must be greater than 0';
    if ((orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (!orderForm.price || orderForm.price <= 0)) {
      return 'Price must be greater than 0 for Limit orders';
    }
    if ((orderForm.orderType === 'SL' || orderForm.orderType === 'SL-M') && (!orderForm.triggerPrice || orderForm.triggerPrice <= 0)) {
      return 'Trigger price must be greater than 0 for Stop Loss orders';
    }
    return null;
  }

  const handleSubmitRequest = (side: OrderSide) => {
    const err = validateOrder(side);
    if (err) { showToast(err); return; }
    // Show confirmation dialog before placing
    setConfirmOrder({ side });
  };

  const handleConfirmSubmit = async () => {
    if (!confirmOrder) return;
    const { side } = confirmOrder;
    setConfirmOrder(null);
    if (!symbol || !token) return;
    setIsSubmitting(true);
    try {
      await placeOrder({ symbol, token, segment: activeSymbol?.segment || 'NSE', side, orderType: orderForm.orderType, productType: orderForm.productType, qty: orderForm.qty, price: orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL' ? orderForm.price : undefined, triggerPrice: orderForm.orderType === 'SL' || orderForm.orderType === 'SL-M' ? orderForm.triggerPrice : undefined, validity: orderForm.validity === 'GTD' ? 'GTC' : orderForm.validity, isAmo: orderForm.isAmo });
      showToast(orderSuccessMessage({ side, qty: orderForm.qty, symbol }));
    } catch (err: any) { showToast(err.message || 'Order failed — check risk rules'); }
    finally { setIsSubmitting(false); }
  };

  if (!symbol && !activeSymbol) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-3 py-4 bg-fw-surface">
        <p className="text-base text-fw-text-secondary">Select a symbol</p>
        <p className="text-xs text-fw-text-secondary">Ctrl+K to search</p>
      </div>
    );
  }

  const lotSize = activeSymbol?.lotSize || 1;

  return (
    <div className="relative flex flex-col h-full bg-fw-surface overflow-y-auto scrollbar-none">
      {/* Order Confirmation Dialog */}
      {confirmOrder && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-fw-surface border border-fw-border rounded-xl shadow-2xl p-5 w-[240px] mx-3 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className={confirmOrder.side === 'BUY' ? 'text-green' : 'text-red'} />
              <span className="text-[13px] font-black text-fw-text">Confirm Order</span>
            </div>
            <div className="text-[12px] text-fw-text-secondary leading-relaxed">
              <span className={cn('font-black', confirmOrder.side === 'BUY' ? 'text-green' : 'text-red')}>{confirmOrder.side}</span>
              {' '}{orderForm.qty} × <span className="font-bold text-fw-text">{symbol}</span>
              <br />
              <span className="text-fw-text-muted">{orderForm.orderType} · {orderForm.productType}</span>
              {(orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (
                <><br /><span className="text-fw-text-muted">Price: </span><span className="font-mono font-bold text-fw-text">₹{formatPrice(orderForm.price)}</span></>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmOrder(null)}
                className="py-2 rounded-md text-[12px] font-bold bg-fw-bg border border-fw-border text-fw-text-secondary hover:text-fw-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSubmit}
                className={cn(
                  'py-2 rounded-md text-[12px] font-black text-white transition-all active:scale-[0.98]',
                  confirmOrder.side === 'BUY' ? 'bg-[var(--fw-green)]' : 'bg-[var(--fw-red)]'
                )}
              >
                {confirmOrder.side}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Compact Header with Symbol + LTP */}
      <div className="px-3 py-2.5 border-b border-fw-border bg-gradient-to-r from-fw-surface to-fw-surface-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <SymbolLogo symbol={symbol} size={20} />
          <span className="text-title font-black text-fw-text">{symbol}</span>
          {activeSymbol?.segment && (
            <span className="text-xs font-bold text-fw-text-secondary bg-fw-bg px-1.5 py-0.5 rounded border border-fw-border/50">{activeSymbol.segment}</span>
          )}
          {activeSymbol?.lotSize && activeSymbol.lotSize > 1 && (
            <span className="text-xs font-mono text-fw-accent bg-fw-accent/8 px-1 py-0.5 rounded">Lot {activeSymbol.lotSize}</span>
          )}
        </div>
        {quote && (
          <div className="flex items-center gap-1.5">
            <span className={cn('text-price-lg font-mono font-black tabular-nums', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
              {formatPrice(quote.ltp)}
            </span>
            <span className={cn('text-xs font-mono tabular-nums px-1 py-0.5 rounded font-bold', (quote.changePercent || 0) >= 0 ? 'text-green bg-green-dim' : 'text-red bg-red-dim')}>
              {(quote.changePercent || 0) >= 0 ? '+' : ''}{(quote.changePercent || 0).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Selected Option Contract Context */}
      {selectedContract && activeSymbol?.segment === 'NFO' && (
        <div className="px-3 py-1.5 border-b border-fw-accent/20 bg-fw-accent/[0.03] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-fw-accent uppercase">Option</span>
            <span className="text-sm font-bold text-fw-text">{selectedContract.underlying}</span>
            <span className="text-sm font-mono font-bold text-fw-text">{selectedContract.strike}</span>
            <span className={cn('text-xs font-black px-1.5 py-0.5 rounded', selectedContract.optionType === 'CE' ? 'bg-green-900/20 text-green' : 'bg-red-900/20 text-red')}>
              {selectedContract.optionType}
            </span>
            <span className="text-xs text-fw-text-secondary font-mono">{selectedContract.expiry}</span>
          </div>
          <span className="text-xs text-fw-text-secondary">Lot: {selectedContract.lotSize}</span>
        </div>
      )}

      {/* BUY / SELL Toggle — Prominent at top */}
      <div className="grid grid-cols-2 flex-shrink-0">
        <button
          onClick={() => setOrderForm({ side: 'BUY' })}
          className={cn(
            'py-3 text-button font-black tracking-wide transition-all relative',
            orderForm.side === 'BUY'
              ? 'bg-gradient-to-b from-[var(--fw-green)] to-[#1a9d50] text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.2)]'
              : 'bg-fw-surface text-fw-text-secondary hover:text-green hover:bg-fw-hover'
          )}
        >
          BUY
          {orderForm.side === 'BUY' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/20" />}
        </button>
        <button
          onClick={() => setOrderForm({ side: 'SELL' })}
          className={cn(
            'py-3 text-button font-black tracking-wide transition-all relative',
            orderForm.side === 'SELL'
              ? 'bg-gradient-to-b from-[var(--fw-red)] to-[#c0292e] text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.2)]'
              : 'bg-fw-surface text-fw-text-secondary hover:text-red hover:bg-fw-hover'
          )}
        >
          SELL
          {orderForm.side === 'SELL' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/20" />}
        </button>
      </div>

      {/* Order Type Pills — Compact */}
      <div className="px-3 py-2 flex-shrink-0">
        <div className="flex gap-1">
          {ORDER_TYPES.map((ot) => (
            <button
              key={ot.value}
              onClick={() => setOrderForm({ orderType: ot.value })}
              className={cn(
                'flex-1 py-1.5 text-sm font-bold rounded-md transition-all',
                orderForm.orderType === ot.value
                  ? 'bg-fw-accent text-white shadow-sm'
                  : 'bg-fw-surface-2 text-fw-text-secondary border border-fw-border/60 hover:text-fw-text hover:border-fw-text-secondary'
              )}
            >
              {ot.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Type Pills — Compact */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="flex gap-1">
          {PRODUCT_TYPES.map((pt) => (
            <button
              key={pt.value}
              onClick={() => setOrderForm({ productType: pt.value })}
              className={cn(
                'flex-1 py-1.5 text-sm font-bold rounded-md transition-all',
                orderForm.productType === pt.value
                  ? 'bg-fw-surface-2 text-fw-text border border-fw-accent/40'
                  : 'bg-fw-surface-2 text-fw-text-secondary border border-fw-border/40 hover:text-fw-text'
              )}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quantity — Larger, more prominent */}
      <div className="px-3 pb-2 flex-shrink-0">
        <label className="text-xs text-fw-text-secondary uppercase font-semibold tracking-wider mb-1 block">
          Qty {lotSize > 1 && <span className="text-fw-accent">× {lotSize} lot</span>}
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOrderForm({ qty: Math.max(1, orderForm.qty - (lotSize > 1 ? lotSize : 1)) })}
            className="w-10 h-10 flex items-center justify-center bg-fw-surface-2 border border-fw-border rounded-md text-fw-text text-button font-bold hover:bg-fw-hover hover:border-fw-text-secondary transition-colors"
          >
            −
          </button>
          <input
            type="number"
            value={orderForm.qty}
            onChange={(e) => setOrderForm({ qty: Math.max(1, parseInt(e.target.value) || 1) })}
            className="flex-1 h-10 bg-fw-surface-2 border border-fw-border rounded-md text-center font-mono text-lg font-bold text-fw-text outline-none focus:border-fw-accent tabular-nums"
            min={1}
          />
          <button
            onClick={() => setOrderForm({ qty: orderForm.qty + (lotSize > 1 ? lotSize : 1) })}
            className="w-10 h-10 flex items-center justify-center bg-fw-surface-2 border border-fw-border rounded-md text-fw-text text-button font-bold hover:bg-fw-hover hover:border-fw-text-secondary transition-colors"
          >
            +
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1 mt-1.5">
          {[1, 5, 10, 25, 50, 100].map((q) => (
            <button
              key={q}
              onClick={() => setOrderForm({ qty: q * (lotSize > 1 ? lotSize : 1) })}
              className={cn(
                'py-1 text-xs rounded-md font-bold tabular-nums transition-colors',
                orderForm.qty === q * (lotSize > 1 ? lotSize : 1)
                  ? 'bg-fw-accent/20 text-fw-accent border border-fw-accent/30'
                  : 'bg-fw-surface-2 border border-fw-border/40 text-fw-text-secondary hover:text-fw-text'
              )}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Price fields — only when needed */}
      {(orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (
        <div className="px-3 pb-2 flex-shrink-0">
          <label className="text-xs text-fw-text-secondary uppercase font-semibold tracking-wider mb-1 block">Price</label>
          <input
            type="number"
            value={orderForm.price || ''}
            onChange={(e) => setOrderForm({ price: parseFloat(e.target.value) || 0 })}
            placeholder={quote ? formatPrice(quote.ltp) : '0.00'}
            className="w-full h-9 bg-fw-surface-2 border border-fw-border rounded-md font-mono text-base font-semibold text-fw-text px-3 outline-none focus:border-fw-accent tabular-nums"
          />
        </div>
      )}
      {(orderForm.orderType === 'SL' || orderForm.orderType === 'SL-M') && (
        <div className="px-3 pb-2 flex-shrink-0">
          <label className="text-xs text-fw-text-secondary uppercase font-semibold tracking-wider mb-1 block">Trigger Price</label>
          <input
            type="number"
            value={orderForm.triggerPrice || ''}
            onChange={(e) => setOrderForm({ triggerPrice: parseFloat(e.target.value) || 0 })}
            className="w-full h-9 bg-fw-surface-2 border border-fw-border rounded-md font-mono text-base font-semibold text-fw-text px-3 outline-none focus:border-fw-accent tabular-nums"
          />
        </div>
      )}

      {/* Inline SL/TP — Advanced toggle */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-fw-text-secondary hover:text-fw-text transition-colors"
        >
          {showAdvanced ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          <span className="font-semibold uppercase tracking-wider">SL / Target</span>
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            <div>
              <label className="text-xs text-red font-bold uppercase">Stop Loss</label>
              <input
                type="number"
                value={slPrice || ''}
                onChange={(e) => setSlPrice(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full h-8 bg-fw-surface-2 border border-red-900/30 rounded-md font-mono text-base text-fw-text px-2 outline-none focus:border-red tabular-nums mt-0.5"
              />
            </div>
            <div>
              <label className="text-xs text-green font-bold uppercase">Target</label>
              <input
                type="number"
                value={tpPrice || ''}
                onChange={(e) => setTpPrice(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full h-8 bg-fw-surface-2 border border-green-900/30 rounded-md font-mono text-base text-fw-text px-2 outline-none focus:border-green tabular-nums mt-0.5"
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick Action Buttons */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="grid grid-cols-4 gap-1">
          <ActionBtn label="GTT" onClick={() => {
            setOrderForm({ validity: 'GTC' });
            showToast('GTT mode — order valid till triggered');
          }} className={orderForm.validity === 'GTC' ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/30' : ''} />
          <ActionBtn label="AMO" onClick={() => {
            setOrderForm({ isAmo: !orderForm.isAmo });
            showToast(orderForm.isAmo ? 'AMO disabled' : 'AMO enabled — order placed after market hours');
          }} className={orderForm.isAmo ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/30' : ''} />
          <ActionBtn label="IOC" onClick={() => {
            setOrderForm({ validity: orderForm.validity === 'IOC' ? 'DAY' : 'IOC' });
            showToast(orderForm.validity === 'IOC' ? 'Validity: DAY' : 'IOC — Immediate or Cancel');
          }} className={orderForm.validity === 'IOC' ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/30' : ''} />
          <ActionBtn label="EXIT" onClick={async () => {
            const pos = useTradingStore.getState().positions.find((p) => p.symbol === symbol && p.qty !== 0);
            if (!pos) { showToast('No open position to exit'); return; }
            setIsSubmitting(true);
            try {
              await exitPosition(pos.id);
              showToast(exitSuccessMessage({ side: pos.qty > 0 ? 'LONG' : 'SHORT', qty: Math.abs(pos.qty), symbol }));
            } catch (err: any) { showToast(err.message || 'Exit failed'); }
            finally { setIsSubmitting(false); }
          }} className={cn('hover:text-red hover:border-red-800/40', !openPosition && 'opacity-40 cursor-not-allowed')} />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Toast */}
      {toast && (
        <div className="mx-3 mb-2 px-3 py-1.5 rounded-md text-sm font-medium bg-orange-900/20 text-orange-300 border border-orange-800/30 animate-slide-up">
          {toast}
        </div>
      )}

      {/* Margin / Risk Context */}
      <div className="px-3 py-2 border-t border-fw-border/30 bg-fw-surface flex-shrink-0">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-fw-text-secondary">Est. Margin</span>
            <span className="font-mono text-fw-text-secondary tabular-nums">₹{quote ? formatPrice(quote.ltp * orderForm.qty * 0.15) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fw-text-secondary">Max Loss</span>
            <span className="font-mono text-red-400 tabular-nums">{slPrice > 0 ? `₹${formatPrice(Math.abs(quote?.ltp || 0 - slPrice) * orderForm.qty)}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fw-text-secondary">Order Value</span>
            <span className="font-mono text-fw-text-secondary tabular-nums">₹{quote ? formatPrice(quote.ltp * orderForm.qty) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fw-text-secondary">Risk %</span>
            <span className="font-mono text-orange-400 tabular-nums">{slPrice > 0 && quote ? `${((Math.abs(quote.ltp - slPrice) * orderForm.qty) / (account?.balance || 1000000) * 100).toFixed(2)}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Submit Buttons — Always visible at bottom */}
      <div className="px-3 py-3 border-t border-fw-border bg-fw-surface flex-shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleSubmitRequest('BUY')}
            disabled={isSubmitting || !symbol}
            className="py-3 rounded-md text-md font-black text-white bg-[var(--fw-green)] hover:brightness-110 disabled:opacity-40 shadow-[0_2px_12px_rgba(34,197,94,0.25)] transition-all active:scale-[0.98]"
          >
            BUY
          </button>
          <button
            onClick={() => handleSubmitRequest('SELL')}
            disabled={isSubmitting || !symbol}
            className="py-3 rounded-md text-md font-black text-white bg-[var(--fw-red)] hover:brightness-110 disabled:opacity-40 shadow-[0_2px_12px_rgba(239,68,68,0.25)] transition-all active:scale-[0.98]"
          >
            SELL
          </button>
        </div>
        {/* Keyboard hint */}
        <div className="flex items-center justify-center gap-3 mt-1.5">
          <span className="text-xs text-fw-text-secondary"><kbd className="px-1 py-0.5 bg-fw-bg border border-fw-border rounded text-xxs font-mono">B</kbd> Buy</span>
          <span className="text-xs text-fw-text-secondary"><kbd className="px-1 py-0.5 bg-fw-bg border border-fw-border rounded text-xxs font-mono">S</kbd> Sell</span>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'py-1.5 rounded-md text-xs font-bold bg-fw-surface-2 border border-fw-border/50 text-fw-text-secondary hover:text-fw-text transition-colors cursor-pointer',
        className
      )}
    >
      {label}
    </button>
  );
}
