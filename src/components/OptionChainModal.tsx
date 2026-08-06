import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getOptionChain, getExpiries } from '@/services/api';
import { cn, formatPrice, formatNumber } from '@/utils/helpers';
import { useTradingStore } from '@/store/tradingStore';
import type { OptionChainEntry } from '@/types';

const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];
const INDEX_TOKENS: Record<string, string> = {
  NIFTY: '99926000', BANKNIFTY: '99926009', FINNIFTY: '99926037',
  MIDCPNIFTY: '99926074', SENSEX: '99919000',
};
const LOT_SIZES: Record<string, number> = {
  NIFTY: 50, BANKNIFTY: 15, FINNIFTY: 25, MIDCPNIFTY: 75, SENSEX: 10,
};
const STRIKES_AROUND_ATM = 20;

// Max retries before giving up and showing manual retry button
const MAX_AUTO_RETRIES = 8;
// Retry delay schedule: 1s, 2s, 3s, 4s, 5s, 5s, 5s, 5s
const retryDelay = (attempt: number) => Math.min(attempt * 1000, 5000);

export function OptionChainModal() {
  const { activeSymbol, setActiveSymbol } = useAppStore();
  const { setOrderForm, setSelectedContract, selectedContract } = useTradingStore();
  const quotes = useMarketStore((s) => s.quotes);

  const [symbol, setSymbol] = useState('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [fatalError, setFatalError] = useState<string | null>(null); // only shown after MAX_AUTO_RETRIES

  const isMountedRef = useRef(true);
  const loadingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLoadKeyRef = useRef(''); // symbol:expiry — detect stale loads

  // ── Symbol auto-sync from active symbol ──────────────────────────────────
  useEffect(() => {
    if (!activeSymbol) return;
    const sym = activeSymbol.symbol.replace(/\s.*/, '').toUpperCase();
    if (INDEX_SYMBOLS.includes(sym) && sym !== symbol) setSymbol(sym);
  }, [activeSymbol?.symbol]);

  // ── Spot price ─────────────────────────────────────────────────────────────
  const spotPrice = useMemo(() => {
    const q = quotes[INDEX_TOKENS[symbol]];
    return q?.ltp || 0;
  }, [symbol, quotes]);

  // ── ATM-filtered chain ─────────────────────────────────────────────────────
  const filteredChain = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return chain;
    let atmIdx = 0, minDiff = Infinity;
    for (let i = 0; i < chain.length; i++) {
      const d = Math.abs(chain[i].strike - spotPrice);
      if (d < minDiff) { minDiff = d; atmIdx = i; }
    }
    const s = Math.max(0, atmIdx - STRIKES_AROUND_ATM);
    const e = Math.min(chain.length, atmIdx + STRIKES_AROUND_ATM + 1);
    return chain.slice(s, e);
  }, [chain, spotPrice]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // ── Cancel any pending retry when symbol changes ───────────────────────────
  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    loadingRef.current = false;
  }, []);

  // ── Load expiries when symbol changes ──────────────────────────────────────
  useEffect(() => {
    cancelRetry();
    setChain([]);
    setFatalError(null);
    setRetryCount(0);
    loadExpiriesAndChain(symbol);
  }, [symbol]);

  // ── Reload chain when expiry manually changed ─────────────────────────────
  useEffect(() => {
    if (!selectedExpiry) return;
    cancelRetry();
    setChain([]);
    setFatalError(null);
    setRetryCount(0);
    scheduleLoad(symbol, selectedExpiry, 0);
  }, [selectedExpiry]);

  // ── Load expiries then immediately load chain ──────────────────────────────
  const loadExpiriesAndChain = useCallback(async (sym: string) => {
    let expiryList: string[] = [];

    try {
      const data = await getExpiries(sym);
      if (!isMountedRef.current) return;
      if (data && data.length > 0) {
        expiryList = data;
        setExpiries(data);
        setSelectedExpiry(data[0]);
        // Chain load triggered via selectedExpiry useEffect above
        return;
      }
    } catch {
      // fall through to hardcoded fallback
    }

    if (!isMountedRef.current) return;

    // Hardcoded fallback expiries — always provides something to try
    const dayMap: Record<string, number> = {
      NIFTY: 2, BANKNIFTY: 3, FINNIFTY: 2, MIDCPNIFTY: 1, SENSEX: 5,
    };
    const day = dayMap[sym] ?? 4;
    const now = new Date();
    const fallback: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now);
      const daysUntil = (day - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil + i * 7);
      fallback.push(d.toISOString().split('T')[0]);
    }
    setExpiries(fallback);
    setSelectedExpiry(fallback[0]);
    expiryList = fallback;
    // Chain load triggered via selectedExpiry useEffect above
  }, []);

  // ── Schedule a chain load with auto-retry ─────────────────────────────────
  const scheduleLoad = useCallback((sym: string, expiry: string, attempt: number) => {
    if (!isMountedRef.current) return;
    const loadKey = `${sym}:${expiry}`;
    currentLoadKeyRef.current = loadKey;

    const run = async () => {
      if (!isMountedRef.current) return;
      if (currentLoadKeyRef.current !== loadKey) return; // stale
      if (loadingRef.current) return;

      loadingRef.current = true;
      setIsLoading(true);
      setRetryCount(attempt);

      try {
        const data = await getOptionChain(sym, expiry);
        if (!isMountedRef.current) return;
        if (currentLoadKeyRef.current !== loadKey) return; // symbol/expiry changed while loading

        if (data && data.length > 0) {
          setChain(data);
          setFatalError(null);
          setIsLoading(false);
          loadingRef.current = false;
          return;
        }

        // Empty result or retryable error — retry
        throw new Error('empty');
      } catch (err: any) {
        if (!isMountedRef.current) return;
        if (currentLoadKeyRef.current !== loadKey) return;

        loadingRef.current = false;
        setIsLoading(false);

        // 503 / 429 / network errors are always retryable — never show error screen for these
        const isRetryable = err?.retryable === true || err?.status === 503 || err?.status === 429
          || err?.status >= 500 || err?.message === 'empty' || err?.message === 'Failed to fetch';

        if (attempt >= MAX_AUTO_RETRIES && !isRetryable) {
          setFatalError('Could not load option chain. Please check your connection.');
          return;
        }

        if (attempt >= MAX_AUTO_RETRIES) {
          // Even after max retries on a retryable, show a manual retry but keep auto-retrying slowly
          setFatalError('Waiting for market data service…');
          retryTimerRef.current = setTimeout(() => {
            if (isMountedRef.current && currentLoadKeyRef.current === loadKey) {
              setFatalError(null);
              scheduleLoad(sym, expiry, 0); // reset attempt counter on slow retry
            }
          }, 10000);
          return;
        }

        // Auto-retry silently
        const delay = retryDelay(attempt + 1);
        retryTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && currentLoadKeyRef.current === loadKey) {
            scheduleLoad(sym, expiry, attempt + 1);
          }
        }, delay);
      }
    };

    run();
  }, []);

  const handleManualRetry = () => {
    setFatalError(null);
    setRetryCount(0);
    cancelRetry();
    scheduleLoad(symbol, selectedExpiry, 0);
  };

  const handleSymbolChange = (sym: string) => {
    cancelRetry();
    setChain([]);
    setFatalError(null);
    setRetryCount(0);
    setSymbol(sym);
  };

  const handleExpiryChange = (expiry: string) => {
    cancelRetry();
    setChain([]);
    setFatalError(null);
    setRetryCount(0);
    setSelectedExpiry(expiry);
  };

  const handleStrikeClick = (strike: number, type: 'CE' | 'PE', ltp?: number) => {
    const lotSize = LOT_SIZES[symbol] ?? 50;
    setActiveSymbol({
      token: `${symbol}_${strike}_${type}`,
      symbol: `${symbol} ${strike} ${type}`,
      name: `${symbol} ${selectedExpiry} ${strike} ${type}`,
      segment: 'NFO',
      instrumentType: type,
      exchange: symbol === 'SENSEX' ? 'BSE' : 'NSE',
      lotSize,
      tickSize: 0.05,
      expiry: selectedExpiry,
      strike,
      optionType: type,
    });
    setSelectedContract({
      symbol: `${symbol} ${strike} ${type}`,
      token: `${symbol}_${strike}_${type}`,
      underlying: symbol,
      strike,
      optionType: type,
      expiry: selectedExpiry,
      lotSize,
      ltp: ltp || undefined,
    });
    if (ltp && ltp > 0) setOrderForm({ price: ltp, orderType: 'LIMIT', qty: lotSize });
    else setOrderForm({ qty: lotSize });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-fw-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-fw-border flex-wrap">
        <span className="text-[13px] font-bold text-fw-text">OPTION CHAIN</span>
        <div className="flex items-center gap-0.5">
          {INDEX_SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => handleSymbolChange(s)}
              className={cn(
                'px-1.5 py-0.5 text-[12px] rounded font-semibold transition-colors',
                s === symbol ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:text-fw-text',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={selectedExpiry}
          onChange={(e) => handleExpiryChange(e.target.value)}
          className="ml-auto bg-fw-bg text-fw-text text-[12px] border border-fw-border rounded px-1.5 py-0.5 font-mono"
        >
          {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {spotPrice > 0 && (
          <span className="text-[12px] font-mono font-bold text-fw-accent tabular-nums">
            Spot: {formatPrice(spotPrice)}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto text-[12px]">
        {/* Loading / retrying — always show spinner, never an error screen unless truly fatal */}
        {(isLoading || (chain.length === 0 && !fatalError)) ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-fw-text-secondary font-medium text-[13px]">
              {isLoading ? `Loading ${symbol} · ${selectedExpiry}` : `Connecting…`}
            </p>
            {retryCount > 0 && (
              <p className="text-fw-text-muted text-[11px]">Retrying ({retryCount}/{MAX_AUTO_RETRIES})</p>
            )}
          </div>
        ) : fatalError ? (
          /* Only shown after MAX_AUTO_RETRIES — user can still retry manually */
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span className="text-[28px]">⛓</span>
            <p className="text-[13px] text-fw-text-secondary font-semibold">Option Chain Unavailable</p>
            <p className="text-[12px] text-fw-text-muted max-w-[260px]">{fatalError}</p>
            <button
              onClick={handleManualRetry}
              className="px-4 py-1.5 text-[12px] font-semibold bg-fw-accent text-white rounded hover:brightness-110 transition-all"
            >
              Retry Now
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-fw-surface z-10">
              <tr className="border-b border-fw-border text-[11px] text-fw-text-secondary uppercase">
                <th className="px-1 py-1 text-center">B/S</th>
                <th className="px-1 py-1 text-right">OI</th>
                <th className="px-1 py-1 text-right">Vol</th>
                <th className="px-1 py-1 text-right">LTP</th>
                <th className="px-1.5 py-1 text-center bg-fw-bg font-bold text-fw-text border-x border-fw-border">STRIKE</th>
                <th className="px-1 py-1 text-left">LTP</th>
                <th className="px-1 py-1 text-left">Vol</th>
                <th className="px-1 py-1 text-left">OI</th>
                <th className="px-1 py-1 text-center">B/S</th>
              </tr>
            </thead>
            <tbody>
              {filteredChain.map((e) => {
                const isAtm = spotPrice > 0 && Math.abs(e.strike - spotPrice) <= 50;
                const isSelCE = selectedContract?.strike === e.strike && selectedContract?.optionType === 'CE';
                const isSelPE = selectedContract?.strike === e.strike && selectedContract?.optionType === 'PE';
                return (
                  <tr
                    key={e.strike}
                    className={cn(
                      'border-b border-fw-border/20 hover:bg-fw-hover/40',
                      isAtm && 'bg-fw-accent/[0.04]',
                      (isSelCE || isSelPE) && 'bg-fw-accent/[0.10] border-l-2 border-l-fw-accent',
                    )}
                  >
                    {/* CALL B/S */}
                    <td className="px-0.5 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', e.callLtp); setOrderForm({ side: 'BUY' }); }} className="text-[9px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', e.callLtp); setOrderForm({ side: 'SELL' }); }} className="text-[9px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
                    </td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.callOi || 0)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.callVolume || 0)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-green-400 cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'CE', e.callLtp)}>
                      {e.callLtp > 0 ? formatPrice(e.callLtp) : '—'}
                    </td>
                    {/* STRIKE */}
                    <td className={cn('px-1.5 py-[3px] text-center font-mono font-bold bg-fw-bg border-x border-fw-border tabular-nums text-[11px]', isAtm ? 'text-fw-accent' : 'text-fw-text')}>
                      {e.strike}
                    </td>
                    {/* PUT */}
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-red-400 cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'PE', e.putLtp)}>
                      {e.putLtp > 0 ? formatPrice(e.putLtp) : '—'}
                    </td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.putVolume || 0)}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.putOi || 0)}</td>
                    {/* PUT B/S */}
                    <td className="px-0.5 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', e.putLtp); setOrderForm({ side: 'BUY' }); }} className="text-[9px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', e.putLtp); setOrderForm({ side: 'SELL' }); }} className="text-[9px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
