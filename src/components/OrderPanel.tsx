import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getInstrumentCapabilities } from '@/utils/instrumentCapabilities';
import { placeOrder, placeBracketOrder, exitPosition, getMarginQuote, type MarginQuote } from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import { orderSuccessMessage, exitSuccessMessage } from '@/utils/orderMessages';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { OrderSide, OrderType, ProductType } from '@/types';
import { SymbolLogo } from '@/components/SymbolLogo';

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

export function validateOrderQty(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return 'Invalid quantity';
  return null;
}

export function isDerivativeOrderInstrument(opts: {
  segment?: string;
  instrumentType?: string;
}): boolean {
  const segment = String(opts.segment || '').toUpperCase();
  const instrumentType = String(opts.instrumentType || '').toUpperCase();
  return ['NFO', 'BFO', 'MCX', 'CDS'].includes(segment) || ['FUT', 'CE', 'PE'].includes(instrumentType);
}

export function getDefaultOrderQuantity(opts: {
  segment?: string;
  instrumentType?: string;
  lotSize?: number;
}): number {
  return isDerivativeOrderInstrument(opts) ? Math.max(1, opts.lotSize || 1) : 1;
}

export function validateOrderLotMultiple(value: number, lotSize: number): string | null {
  if (lotSize > 1 && value % lotSize !== 0) {
    const lots = Math.round(value / lotSize);
    return `Quantity must be a multiple of lot size (${lotSize}). Enter ${lots} lot${lots !== 1 ? 's' : ''} = ${lots * lotSize} qty`;
  }
  return null;
}

// Spot indices (NIFTY 50, BANKNIFTY, SENSEX, …) are calculated values — NOT
// tradeable contracts. They belong to the INDEX tab for charting only. Trading
// happens through their futures (FUT) or options (CE/PE). This mirrors the
// backend RiskEngine.checkTradeableInstrument guard so the UI blocks the order
// before it is ever sent.
const SPOT_INDEX_NAMES = new Set([
  'NIFTY', 'NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNEXT50',
  'SENSEX', 'BANKEX', 'INDIAVIX', 'NIFTYIT', 'NIFTYPHARMA', 'NIFTYAUTO',
  'NIFTYMETAL', 'NIFTYPSE', 'NIFTYREALTY', 'NIFTYFMCG', 'NIFTYENERGY',
  'NIFTYINFRA', 'NIFTYSMALLCAP', 'NIFTYMIDCAP',
]);

export function isSpotIndexInstrument(opts: {
  symbol?: string;
  segment?: string;
  instrumentType?: string;
}): boolean {
  const segment = String(opts.segment || '').toUpperCase();
  const instrumentType = String(opts.instrumentType || '').toUpperCase();
  const sym = String(opts.symbol || '').toUpperCase().trim();

  if (['IDX_I', 'INDEX', 'MCX_INDEX', 'IDX'].includes(segment)) return true;
  if (['INDEX', 'IDX', 'SPOT_INDEX'].includes(instrumentType)) return true;

  const isDerivative =
    segment === 'NFO' || segment === 'BFO' ||
    /\bFUT\b|FUT$/.test(sym) || /\d*(CE|PE)$/.test(sym) ||
    ['FUT', 'CE', 'PE'].includes(instrumentType);
  if (isDerivative) return false;

  return SPOT_INDEX_NAMES.has(sym.replace(/\s+/g, ''));
}

export function OrderPanel() {
  const { orderForm, setOrderForm } = useTradingStore();
  const account = useTradingStore((s) => s.account);
  const selectedContract = useTradingStore((s) => s.selectedContract);
  const { activeSymbol, activeWorkspace, setActiveWorkspace } = useAppStore();
  const selectedToken = selectedContract?.token || orderForm.token || activeSymbol?.token || '';
  const quote = useMarketStore((s) => selectedToken ? s.quotes[selectedToken] : undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slPrice, setSlPrice] = useState<number>(0);
  const [tpPrice, setTpPrice] = useState<number>(0);
  const [gttEnabled, setGttEnabled] = useState(false);
  const [gttTriggerPrice, setGttTriggerPrice] = useState<number>(0);
  const [confirmOrder, setConfirmOrder] = useState<{ side: OrderSide } | null>(null);
  const [marginQuote, setMarginQuote] = useState<MarginQuote | null>(null);

  useEffect(() => {
    if (!activeSymbol || !isDerivativeOrderInstrument(activeSymbol)) return;
    setOrderForm({ qty: getDefaultOrderQuantity(activeSymbol) });
  }, [activeSymbol?.token, activeSymbol?.segment, activeSymbol?.instrumentType, activeSymbol?.lotSize, setOrderForm]);

  // Listen for real order status events pushed via WebSocket → CustomEvent.
  // These fire when the backend async execution completes (FILLED / REJECTED).
  // Using window events avoids a direct dependency on wsService here.
  useEffect(() => {
    const onRejected = (e: Event) => {
      const ev = e as CustomEvent;
      const sym = orderForm.symbol || activeSymbol?.symbol || '';
      // Only show if this order is for the currently displayed symbol
      if (!ev.detail?.symbol || ev.detail.symbol === sym) {
        showToast(`ORDER REJECTED: ${ev.detail?.reason || 'Risk rule or broker rejection'}`, 6000);
      }
    };
    const onFilled = (e: Event) => {
      const ev = e as CustomEvent;
      const sym = orderForm.symbol || activeSymbol?.symbol || '';
      if (!ev.detail?.symbol || ev.detail.symbol === sym) {
        showToast(`Filled: ${ev.detail?.side || ''} ${ev.detail?.qty || ''} ${ev.detail?.symbol || sym} @ ₹${ev.detail?.avgPrice ? parseFloat(ev.detail.avgPrice).toFixed(2) : '—'}`);
      }
    };
    window.addEventListener('fw:order:rejected', onRejected);
    window.addEventListener('fw:order:filled', onFilled);
    return () => {
      window.removeEventListener('fw:order:rejected', onRejected);
      window.removeEventListener('fw:order:filled', onFilled);
    };
  }, [orderForm.symbol, activeSymbol?.symbol]);

  const symbol = selectedContract?.symbol || orderForm.symbol || activeSymbol?.symbol || '';
  const token = selectedContract?.token || orderForm.token || activeSymbol?.token || '';
  const tradeSegment = selectedContract ? 'NFO' : activeSymbol?.segment;
  const tradeInstrumentType = selectedContract ? selectedContract.optionType : activeSymbol?.instrumentType;
  const tradeExchange = selectedContract ? 'NSE' : activeSymbol?.exchange;
  const tradeExpiry = selectedContract?.expiry || activeSymbol?.expiry;
  const tradeStrike = selectedContract?.strike || activeSymbol?.strike;
  const tradeLotSize = selectedContract?.lotSize || activeSymbol?.lotSize || 1;
  const capabilities = selectedContract
    ? { canViewChart: true, canTrade: true }
    : activeSymbol
      ? getInstrumentCapabilities(activeSymbol)
      : { canViewChart: true, canTrade: false };

  if (activeWorkspace === 'options' && !selectedContract) {
    return (
      <div className="flex h-full items-center justify-center bg-fw-bg px-4 text-center">
        <p className="text-[14px] text-fw-text-secondary">Select a Call or Put contract to trade</p>
      </div>
    );
  }

  // Is the current instrument a non-tradeable spot index?
  const isSpotIndex = Boolean(activeSymbol && !selectedContract && !capabilities.canTrade);
  const canTrade = capabilities.canTrade;

  // ── Fetch the authoritative margin quote from the backend ────────────────
  // This is the SINGLE SOURCE OF TRUTH. The number shown here is exactly what
  // the risk engine validates against — no more hardcoded percentages.
  useEffect(() => {
    if (!symbol || !token || !orderForm.qty || orderForm.qty <= 0 || isSpotIndex) {
      setMarginQuote(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      getMarginQuote({
        symbol, token,
        segment: tradeSegment || 'NSE',
        productType: orderForm.productType,
        instrumentType: tradeInstrumentType,
        qty: orderForm.qty,
        price: orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL' ? orderForm.price : undefined,
      })
        .then((q) => { if (!cancelled) setMarginQuote(q); })
        .catch(() => { if (!cancelled) setMarginQuote(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [symbol, token, tradeSegment, tradeInstrumentType, orderForm.qty, orderForm.productType, orderForm.orderType, orderForm.price, isSpotIndex]);

  // Find open position for the current symbol (for EXIT button)
  const openPosition = useTradingStore.getState().positions.find(
    (p) => p.symbol === symbol && p.qty !== 0
  );

  const showToast = (msg: string, duration = 4000) => { setToast(msg); setTimeout(() => setToast(null), duration); };

  // Client-side validation before order submission
  function validateOrder(side: OrderSide): string | null {
    if (!symbol || !token) return 'No symbol selected';
    if (isSpotIndex) {
      const base = symbol.replace(/\s*50$/, '').trim() || symbol;
      return `${symbol} is a spot index — not tradeable. Open ${base} in the FUTURES or OPTIONS tab to trade it.`;
    }
    const qtyError = validateOrderQty(orderForm.qty);
    if (qtyError) return qtyError;
    // Lot-size multiple validation for derivative instruments
    const lotError = validateOrderLotMultiple(orderForm.qty, tradeLotSize);
    if (lotError) return lotError;
    if (gttEnabled && (!gttTriggerPrice || gttTriggerPrice <= 0)) return 'Enter a GTT trigger price';
    if ((slPrice > 0) !== (tpPrice > 0)) return 'Enter both Stop Loss and Target prices for a bracket order';
    if ((orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (!orderForm.price || orderForm.price <= 0)) {
      return 'Price must be greater than 0 for LIMIT orders — enter a price or switch to MARKET';
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
      const orderParams = {
        symbol, token,
        segment: tradeSegment || 'NSE',
        exchange: tradeExchange,
        instrumentType: tradeInstrumentType,
        expiry: tradeExpiry,
        strike: tradeStrike,
        optionType: selectedContract?.optionType || activeSymbol?.optionType,
        lotSize: tradeLotSize,
        side,
        orderType: orderForm.orderType,
        productType: orderForm.productType,
        qty: orderForm.qty,
        price: orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL' ? orderForm.price : undefined,
        validity: orderForm.validity === 'GTD' ? 'GTC' : orderForm.validity,
        isAmo: orderForm.isAmo,
        isGtt: gttEnabled,
        triggerPrice: gttEnabled && gttTriggerPrice > 0 ? gttTriggerPrice : (orderForm.orderType === 'SL' || orderForm.orderType === 'SL-M' ? orderForm.triggerPrice : undefined),
        slPrice: slPrice > 0 ? slPrice : undefined,
        tpPrice: tpPrice > 0 ? tpPrice : undefined,
      };
      const result = slPrice > 0 && tpPrice > 0
        ? await placeBracketOrder({ ...orderParams, slPrice, tpPrice })
        : await placeOrder(orderParams);
      // The backend returns the initial status synchronously.
      // MARKET orders in paper mode return FILLED immediately.
      // LIMIT/SL orders return OPEN/PENDING — final status arrives via WS push.
      // Live MARKET orders via Dhan may also return PENDING initially.
      const brokerStatus = (result as any)?.status || 'PENDING';
      if (brokerStatus === 'REJECTED') {
        const rejectReason = (result as any)?.message || 'Order rejected — check risk rules';
        showToast(`ORDER REJECTED: ${rejectReason}`, 6000);
      } else if (brokerStatus === 'FILLED') {
        // Paper mode MARKET fill — immediate
        showToast(orderSuccessMessage({ side, qty: orderForm.qty, symbol }));
        setSlPrice(0);
        setTpPrice(0);
      } else {
        // PENDING / OPEN — accepted by engine, final status via WS
        const typeLabel = orderForm.orderType === 'MARKET' ? 'Market' : orderForm.orderType;
        showToast(`${typeLabel} order placed — awaiting fill`);
        setSlPrice(0);
        setTpPrice(0);
      }
    } catch (err: any) {
      // HTTP-level error (422 = risk rejected, 504 = timeout, 5xx = server error)
      const errMsg = err.message || 'Order failed — check risk rules';
      showToast(errMsg);
    }
    finally { setIsSubmitting(false); }
  };

  if (!symbol && !activeSymbol) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-3 py-4 bg-fw-bg">
        <p className="text-[14px] text-fw-text-secondary">Select a symbol</p>
        <p className="text-[14px] text-fw-text-muted">Ctrl+K to search</p>
      </div>
    );
  }

  if (!canTrade && activeSymbol) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-fw-bg px-4 text-center">
        <div>
          <p className="text-[14px] font-semibold text-fw-text">{symbol} Spot Index</p>
          <p className="mt-1 text-[12px] leading-relaxed text-fw-text-muted">
            Chart and market data only. Trade {symbol.replace(/\s*50$/, '').trim() || symbol} Futures or Options from the relevant tab.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveWorkspace('futures')}
            className="rounded border border-fw-border px-3 py-1.5 text-[11px] font-semibold text-fw-text-secondary hover:border-fw-accent/50 hover:text-fw-text"
          >
            View Futures
          </button>
          <button
            type="button"
            onClick={() => setActiveWorkspace('options')}
            className="rounded border border-fw-border px-3 py-1.5 text-[11px] font-semibold text-fw-text-secondary hover:border-fw-accent/50 hover:text-fw-text"
          >
            View Options
          </button>
        </div>
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
            <div className="text-[14px] text-fw-text-secondary leading-relaxed">
              <span className={cn('font-black', confirmOrder.side === 'BUY' ? 'text-green' : 'text-red')}>{confirmOrder.side}</span>
              {' '}
              {/* Show lot count for derivatives, raw qty for equity */}
              {(activeSymbol?.lotSize || 1) > 1 ? (
                <>
                  <span className="font-bold text-fw-text">{orderForm.qty / (activeSymbol?.lotSize || 1)} lot{orderForm.qty / (activeSymbol?.lotSize || 1) !== 1 ? 's' : ''}</span>
                  <span className="text-fw-text-muted text-[12px]"> ({orderForm.qty} qty)</span>
                </>
              ) : (
                <span className="font-bold text-fw-text">{orderForm.qty}</span>
              )}
              {' '}<span className="font-bold text-fw-text">{symbol}</span>
              <br />
              <span className="text-fw-text-muted">{orderForm.orderType} · {orderForm.productType}</span>
              {(orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (
                <><br /><span className="text-fw-text-muted">Price: </span><span className="font-mono font-bold text-fw-text">₹{formatPrice(orderForm.price)}</span></>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmOrder(null)}
                className="py-2 rounded-md text-[14px] font-bold bg-fw-bg border border-fw-border text-fw-text-secondary hover:text-fw-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSubmit}
                className={cn(
                  'py-2 rounded-md text-[14px] font-black text-white transition-all active:scale-[0.98]',
                  confirmOrder.side === 'BUY' ? 'bg-[var(--fw-green)]' : 'bg-[var(--fw-red)]'
                )}
              >
                {confirmOrder.side}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Compact Header with Symbol + LTP — L3 symbol, L1 price */}
      <div className="px-3 py-2.5 border-b border-fw-border bg-fw-surface-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <SymbolLogo symbol={symbol} size={22} className="flex-shrink-0" />
          <span className="tv-symbol-lg">{symbol}</span>
          {tradeSegment && (
            <span className="tv-support bg-fw-surface-2 px-1.5 py-0.5 rounded border border-fw-border/50">{tradeSegment}</span>
          )}
          {tradeLotSize > 1 && (
            <span className="tv-support text-fw-accent bg-fw-accent/8 px-1 py-0.5 rounded">Lot {tradeLotSize}</span>
          )}
        </div>
        {/* L1 — Current price: must be instantly readable */}
        {quote && (
          <div className="flex flex-col items-end gap-0.5">
            <span className={cn('op-price tv-smooth-value', (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red')}>
              {formatPrice(quote.ltp)}
            </span>
            <span className={cn('tv-change-pill', (quote.changePercent || 0) >= 0 ? 'tv-change-pill-up' : 'tv-change-pill-down')}>
              {(quote.changePercent || 0) >= 0 ? '+' : ''}{(quote.changePercent || 0).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Selected Option Contract Context */}
      {selectedContract && (tradeSegment === 'NFO' || tradeSegment === 'BFO') && (
        <div className="px-3 py-1.5 border-b border-fw-accent/20 bg-fw-accent/[0.03] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-fw-accent uppercase">Option</span>
            <span className="text-[13px] font-bold text-fw-text">{selectedContract.underlying}</span>
            <span className="text-[13px] font-mono font-bold text-fw-text">{selectedContract.strike}</span>
            <span className={cn('text-[13px] font-black px-1.5 py-0.5 rounded', selectedContract.optionType === 'CE' ? 'bg-green-900/20 text-green' : 'bg-red-900/20 text-red')}>
              {selectedContract.optionType}
            </span>
            <span className="text-[13px] text-fw-text-muted font-mono">{selectedContract.expiry}</span>
          </div>
          <span className="text-[13px] text-fw-text-muted">Lot: {selectedContract.lotSize}</span>
        </div>
      )}


      {/* Order Type Pills */}
      <div className="px-3 py-2 flex-shrink-0">
        <div className="flex gap-1">
          {ORDER_TYPES.map((ot) => (
            <button
              key={ot.value}
              onClick={() => setOrderForm({ orderType: ot.value })}
              className={cn(
                'flex-1 py-1.5 text-[12px] font-bold rounded-md transition-all tracking-wide',
                orderForm.orderType === ot.value
                  ? 'bg-fw-accent text-white shadow-sm'
                  : 'bg-fw-surface-2 text-fw-text-secondary border border-fw-border/60 hover:text-fw-text hover:border-fw-text-muted'
              )}
            >
              {ot.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Type Pills — visible for derivative instruments (NFO/FUT need NRML for overnight) */}
      {tradeSegment && (tradeSegment === 'NFO' || tradeSegment === 'BFO' ||
        tradeInstrumentType === 'FUT' || tradeInstrumentType === 'CE' || tradeInstrumentType === 'PE') && (
        <div className="px-3 pb-2 flex-shrink-0">
          <label className="tv-label uppercase tracking-wider mb-1 block">Product</label>
          <div className="flex gap-1">
            {(['MIS', 'NRML'] as ProductType[]).map((pt) => (
              <button
                key={pt}
                onClick={() => setOrderForm({ productType: pt })}
                className={cn(
                  'flex-1 py-1.5 text-[12px] font-bold rounded-md transition-all tracking-wide',
                  orderForm.productType === pt
                    ? 'bg-fw-accent text-white shadow-sm'
                    : 'bg-fw-surface-2 text-fw-text-secondary border border-fw-border/60 hover:text-fw-text hover:border-fw-text-muted'
                )}
                title={pt === 'MIS' ? 'Intraday — auto-square off before market close' : 'Carry forward — hold overnight'}
              >
                {pt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantity — L2 value, L4 label */}
      <div className="px-3 pb-2 flex-shrink-0">
        <label className="tv-label uppercase tracking-wider mb-1.5 block">
          Qty {lotSize > 1 && <span className="text-fw-accent font-semibold">× {lotSize} lot</span>}
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOrderForm({ qty: Math.max(1, orderForm.qty - (lotSize > 1 ? lotSize : 1)) })}
            className="w-10 h-10 flex items-center justify-center bg-fw-surface-2 border border-fw-border rounded-md text-fw-text text-[20px] font-bold hover:bg-fw-hover hover:border-fw-text-muted transition-colors"
          >
            −
          </button>
          <input
            type="number"
            value={orderForm.qty}
            onChange={(e) => {
              const rawValue = e.target.value;
              if (rawValue === '') {
                setOrderForm({ qty: 0 });
                return;
              }
              const parsed = Number(rawValue);
              if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
                setOrderForm({ qty: 0 });
                return;
              }
              if (parsed <= 0) {
                setOrderForm({ qty: parsed });
                return;
              }
              const ls = activeSymbol?.lotSize || 1;
              const snapped = ls > 1 ? Math.max(ls, Math.round(parsed / ls) * ls) : Math.max(1, parsed);
              setOrderForm({ qty: snapped });
            }}
            className="flex-1 h-10 bg-fw-surface-2 border border-fw-border rounded-md text-center op-qty text-fw-text outline-none focus:border-fw-accent"
            min={1}
          />
          <button
            onClick={() => setOrderForm({ qty: orderForm.qty + (lotSize > 1 ? lotSize : 1) })}
            className="w-10 h-10 flex items-center justify-center bg-fw-surface-2 border border-fw-border rounded-md text-fw-text text-[20px] font-bold hover:bg-fw-hover hover:border-fw-text-muted transition-colors"
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
                'py-1 text-[12px] rounded-md font-bold tabular-nums transition-colors',
                orderForm.qty === q * (lotSize > 1 ? lotSize : 1)
                  ? 'bg-fw-accent/20 text-fw-accent border border-fw-accent/30'
                  : 'bg-fw-surface-2 border border-fw-border/40 text-fw-text-muted hover:text-fw-text'
              )}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Price fields */}
      {(orderForm.orderType === 'LIMIT' || orderForm.orderType === 'SL') && (
        <div className="px-3 pb-2 flex-shrink-0">
          <label className="tv-label uppercase tracking-wider mb-1.5 block">Price</label>
          <input
            type="number"
            value={orderForm.price || ''}
            onChange={(e) => setOrderForm({ price: parseFloat(e.target.value) || 0 })}
            placeholder={quote ? formatPrice(quote.ltp) : '0.00'}
            className="w-full h-10 bg-fw-surface-2 border border-fw-border rounded-md font-mono text-[15px] font-semibold text-fw-text px-3 outline-none focus:border-fw-accent tabular-nums"
          />
        </div>
      )}
      {(orderForm.orderType === 'SL' || orderForm.orderType === 'SL-M') && (
        <div className="px-3 pb-2 flex-shrink-0">
          <label className="tv-label uppercase tracking-wider mb-1.5 block">Trigger Price</label>
          <input
            type="number"
            value={orderForm.triggerPrice || ''}
            onChange={(e) => setOrderForm({ triggerPrice: parseFloat(e.target.value) || 0 })}
            className="w-full h-10 bg-fw-surface-2 border border-fw-border rounded-md font-mono text-[15px] font-semibold text-fw-text px-3 outline-none focus:border-fw-accent tabular-nums"
          />
        </div>
      )}

      {/* SL / Target toggle */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 tv-label hover:text-fw-text-secondary transition-colors"
        >
          {showAdvanced ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          <span className="uppercase tracking-wider">SL / Target</span>
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            <div>
              <label className="tv-label-sm text-red font-bold uppercase tracking-wider block mb-1">Stop Loss</label>
              <input
                type="number"
                value={slPrice || ''}
                onChange={(e) => setSlPrice(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full h-9 bg-fw-surface-2 border border-red-900/30 rounded-md font-mono text-[14px] text-fw-text px-2 outline-none focus:border-red tabular-nums"
              />
            </div>
            <div>
              <label className="tv-label-sm text-green font-bold uppercase tracking-wider block mb-1">Target</label>
              <input
                type="number"
                value={tpPrice || ''}
                onChange={(e) => setTpPrice(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full h-9 bg-fw-surface-2 border border-green-900/30 rounded-md font-mono text-[14px] text-fw-text px-2 outline-none focus:border-green tabular-nums"
              />
            </div>
          </div>
        )}
      </div>

      {/* Order validity controls */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="grid grid-cols-4 gap-1">
          <ActionBtn label="GTT" onClick={() => {
            setGttEnabled(!gttEnabled);
            setOrderForm({ validity: 'GTC' });
          }} className={gttEnabled ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/30' : ''} />
          <ActionBtn label="AMO" onClick={() => {
            setOrderForm({ isAmo: !orderForm.isAmo });
          }} className={orderForm.isAmo ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/30' : ''} />
          <ActionBtn label="IOC" onClick={() => {
            setOrderForm({ validity: orderForm.validity === 'IOC' ? 'DAY' : 'IOC' });
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
        {gttEnabled && <input type="number" aria-label="GTT trigger price" value={gttTriggerPrice || ''} onChange={(event) => setGttTriggerPrice(Number(event.target.value) || 0)} placeholder="GTT trigger price" className="w-full h-8 mt-1.5 bg-fw-surface-2 border border-fw-accent/30 rounded-md font-mono text-[12px] text-fw-text px-2 outline-none focus:border-fw-accent" />}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Toast */}
      {toast && (
        <div className="mx-3 mb-2 px-3 py-1.5 rounded-md text-[13px] font-medium bg-orange-900/20 text-orange-300 border border-orange-800/30 animate-slide-up">
          {toast}
        </div>
      )}

      {/* Margin / Risk Context — L4 labels, L5 values */}
      <div className="px-3 py-2 border-t border-fw-border/30 bg-fw-surface-2 flex-shrink-0">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div className="flex items-center justify-between">
            <span className="tv-label">Est. Margin</span>
            <span className={cn(
              'font-mono text-[12px] font-semibold tabular-nums',
              marginQuote && marginQuote.sufficient === false ? 'text-red-400' : 'text-fw-text-secondary'
            )}>
              {isSpotIndex
                ? 'N/A'
                : marginQuote?.tradeable
                  ? `₹${formatPrice(marginQuote.requiredMargin)}`
                  : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="tv-label">Max Loss</span>
            <span className="font-mono text-[12px] font-semibold text-red-400 tabular-nums">{slPrice > 0 ? `₹${formatPrice(Math.abs(quote?.ltp || 0 - slPrice) * orderForm.qty)}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="tv-label">Order Value</span>
            <span className="font-mono text-[12px] font-semibold text-fw-text-secondary tabular-nums">₹{quote ? formatPrice(quote.ltp * orderForm.qty) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="tv-label">Risk %</span>
            <span className="font-mono text-[12px] font-semibold text-orange-400 tabular-nums">{slPrice > 0 && quote ? `${((Math.abs(quote.ltp - slPrice) * orderForm.qty) / (account?.balance || 1000000) * 100).toFixed(2)}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Submit Buttons — Premium institutional BUY/SELL */}
      <div className="relative z-20 px-3 py-3 border-t border-fw-border bg-fw-surface flex-shrink-0">
        {isSpotIndex && (
          <div className="mb-2 rounded border border-orange-800/40 bg-orange-900/20 px-2 py-1.5 text-[12px] text-orange-300">
            {symbol} is a spot index — not tradable. Open {symbol.replace(/\s*50$/, '').trim() || symbol} in the FUTURES or OPTIONS tab to trade it.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {/* BUY */}
          <button
            onClick={() => handleSubmitRequest('BUY')}
            disabled={isSubmitting || !symbol || isSpotIndex}
            className={cn(
              'relative overflow-hidden group',
              'h-[50px] rounded-xl',
              'flex items-center justify-center gap-1.5',
              'font-bold text-[15px] tracking-[0.3px] text-white',
              'transition-all duration-[180ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
              'active:scale-[0.97] active:duration-[120ms]',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
              !isSubmitting && symbol ? 'hover:scale-[1.02] hover:shadow-[0_4px_20px_rgba(34,197,94,0.35)]' : '',
            )}
            style={{
              background: isSubmitting ? 'linear-gradient(180deg, #166534 0%, #15803d 100%)' :
                'linear-gradient(180deg, #166534 0%, #16a34a 50%, #15803d 100%)',
              boxShadow: '0 2px 10px rgba(22,163,74,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            {/* Shimmer overlay on hover */}
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-[180ms]"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)' }} />
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                <span className="text-[14px] font-semibold text-white/90">Executing...</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-90">
                  <path d="M6 1L11 10H1L6 1Z" fill="white"/>
                </svg>
                <span>BUY</span>
              </>
            )}
          </button>

          {/* SELL */}
          <button
            onClick={() => handleSubmitRequest('SELL')}
            disabled={isSubmitting || !symbol || isSpotIndex}
            className={cn(
              'relative overflow-hidden group',
              'h-[50px] rounded-xl',
              'flex items-center justify-center gap-1.5',
              'font-bold text-[15px] tracking-[0.3px] text-white',
              'transition-all duration-[180ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
              'active:scale-[0.97] active:duration-[120ms]',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
              !isSubmitting && symbol ? 'hover:scale-[1.02] hover:shadow-[0_4px_20px_rgba(239,68,68,0.35)]' : '',
            )}
            style={{
              background: isSubmitting ? 'linear-gradient(180deg, #7f1d1d 0%, #991b1b 100%)' :
                'linear-gradient(180deg, #7f1d1d 0%, #dc2626 50%, #b91c1c 100%)',
              boxShadow: '0 2px 10px rgba(220,38,38,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-[180ms]"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)' }} />
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                <span className="text-[14px] font-semibold text-white/90">Executing...</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-90">
                  <path d="M6 11L1 2H11L6 11Z" fill="white"/>
                </svg>
                <span>SELL</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-center gap-3 mt-1.5">
          <span className="tv-support text-fw-text-muted"><kbd className="px-1 py-0.5 bg-fw-bg border border-fw-border rounded text-[8px] font-mono">B</kbd> Buy</span>
          <span className="tv-support text-fw-text-muted"><kbd className="px-1 py-0.5 bg-fw-bg border border-fw-border rounded text-[8px] font-mono">S</kbd> Sell</span>
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
        'py-1.5 rounded-md text-[14px] font-bold bg-fw-surface-2 border border-fw-border/50 text-fw-text-secondary hover:text-fw-text transition-colors cursor-pointer',
        className
      )}
    >
      {label}
    </button>
  );
}
