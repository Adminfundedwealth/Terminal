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

// Retry schedule: 2s, 3s, 4s, 5s, 5s, 5s … capped at 5s
const MAX_AUTO_RETRIES = 6;
const retryDelay = (attempt: number) => Math.min((attempt + 1) * 1500, 5000);

// Hard wall-clock timeout: if no data after this many ms, stop spinner and show error
const LOAD_TIMEOUT_MS = 30_000;

// ── Fallback IST-aware expiry calculation ──────────────────────────────────
// Uses IST offset (+5:30) for day-of-week calculation so the result is
// always the correct local date, regardless of the server's timezone.
function buildFallbackExpiries(sym: string): string[] {
  const dayMap: Record<string, number> = {
    NIFTY: 2, BANKNIFTY: 3, FINNIFTY: 2, MIDCPNIFTY: 1, SENSEX: 5,
  };
  const targetDay = dayMap[sym] ?? 4;

  // IST = UTC + 5:30
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);

  const fallback: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(nowIST);
    const daysUntil = (targetDay - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysUntil + i * 7);
    const iso = d.toISOString().split('T')[0]; // YYYY-MM-DD in IST
    fallback.push(iso);
  }
  return fallback;
}

export function OptionChainModal() {
  const { activeSymbol, setActiveSymbol } = useAppStore();
  const { setOrderForm, setSelectedContract, selectedContract } = useTradingStore();
  const quotes = useMarketStore((s) => s.quotes);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [symbol, setSymbol] = useState('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [status, setStatus] = useState<
    | { type: 'idle' }
    | { type: 'loading'; label: string; attempt: number }
    | { type: 'error'; message: string }
    | { type: 'ready' }
  >({ type: 'idle' });

  // ── Internal control refs (never cause re-render) ─────────────────────────
  const isMountedRef     = useRef(true);
  // Monotonically-increasing "session" counter. Incremented on every
  // symbol change. Any async operation that captures an older session
  // number is stale and must discard its result.
  const sessionRef       = useRef(0);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether a fetch is in flight for the current session.
  const fetchInFlightRef = useRef(false);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPendingTimers();
    };
  }, []);

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

  // ── Timer helpers ──────────────────────────────────────────────────────────
  const clearPendingTimers = useCallback(() => {
    if (retryTimerRef.current)   { clearTimeout(retryTimerRef.current);   retryTimerRef.current   = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
    fetchInFlightRef.current = false;
  }, []);

  // ── Core chain loader — takes sym + expiry explicitly, no closure capture ──
  //
  // `session` is the value of sessionRef.current at call time.
  // Any state update is guarded by:  session === sessionRef.current
  // This guarantees a NIFTY response cannot overwrite a BANKNIFTY state.
  //
  const loadChain = useCallback(async (
    sym: string,
    expiry: string,
    attempt: number,
    session: number,
  ) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return; // stale session
    if (fetchInFlightRef.current) return;       // already fetching

    fetchInFlightRef.current = true;
    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt });

    // Hard timeout — clears itself on success/error
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      fetchInFlightRef.current = false;
      setStatus({ type: 'error', message: 'Option chain data unavailable. Market may be closed or data service is starting up.' });
    }, LOAD_TIMEOUT_MS);

    try {
      const data = await getOptionChain(sym, expiry);

      // Clear hard timeout — we got a response
      if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
      fetchInFlightRef.current = false;

      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return; // symbol changed while fetching

      if (data && data.length > 0) {
        setChain(data);
        setStatus({ type: 'ready' });
        return;
      }

      // Empty response — treat as retryable
      scheduleRetry(sym, expiry, attempt, session, 'empty');
    } catch (err: any) {
      if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
      fetchInFlightRef.current = false;

      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;

      scheduleRetry(sym, expiry, attempt, session, err);
    }
  }, []);

  const scheduleRetry = useCallback((
    sym: string,
    expiry: string,
    attempt: number,
    session: number,
    reason: any,
  ) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;

    const isRetryable =
      reason === 'empty' ||
      reason?.message === 'empty' ||
      reason?.message === 'Failed to fetch' ||
      reason?.retryable === true ||
      reason?.status === 503 ||
      reason?.status === 429 ||
      (reason?.status >= 500);

    if (attempt >= MAX_AUTO_RETRIES) {
      const msg503 = typeof reason?.message === 'string' && reason.message.toLowerCase().includes('market');
      const message = msg503
        ? 'Option chain data unavailable. Market may be closed.'
        : isRetryable
          ? 'Option chain data unavailable. Market may be closed or data service is starting up.'
          : 'Could not load option chain. Please check your connection.';
      setStatus({ type: 'error', message });
      return;
    }

    const delay = retryDelay(attempt);
    retryTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      loadChain(sym, expiry, attempt + 1, session);
    }, delay);

    // Keep spinner visible during retry wait — update attempt counter
    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt: attempt + 1 });
  }, [loadChain]);

  // ── Expiry + chain loader — called when symbol changes ────────────────────
  const startSymbolLoad = useCallback(async (sym: string, session: number) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;

    let expiryList: string[] = [];

    try {
      const data = await getExpiries(sym);
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;

      if (data && data.length > 0) {
        expiryList = data;
      }
    } catch {
      // fall through to fallback
    }

    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;

    if (expiryList.length === 0) {
      expiryList = buildFallbackExpiries(sym);
    }

    setExpiries(expiryList);
    const firstExpiry = expiryList[0];
    setSelectedExpiry(firstExpiry);

    // Load chain directly — no useEffect dependency on selectedExpiry.
    // Passing sym and expiry explicitly eliminates all stale closure risk.
    loadChain(sym, firstExpiry, 0, session);
  }, [loadChain]);

  // ── Trigger: symbol changes ───────────────────────────────────────────────
  useEffect(() => {
    const session = ++sessionRef.current;
    clearPendingTimers();
    setChain([]);
    setExpiries([]);
    setSelectedExpiry('');
    setStatus({ type: 'loading', label: symbol, attempt: 0 });
    startSymbolLoad(symbol, session);
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── User-initiated: change expiry from dropdown ───────────────────────────
  const handleExpiryChange = useCallback((expiry: string) => {
    const session = ++sessionRef.current;
    clearPendingTimers();
    setChain([]);
    setSelectedExpiry(expiry);
    setStatus({ type: 'loading', label: `${symbol} · ${expiry}`, attempt: 0 });
    loadChain(symbol, expiry, 0, session);
  }, [symbol, clearPendingTimers, loadChain]);

  // ── User-initiated: change symbol from header buttons ────────────────────
  const handleSymbolChange = useCallback((sym: string) => {
    if (sym === symbol) return;
    setSymbol(sym);
  }, [symbol]);

  // ── User-initiated: manual retry ──────────────────────────────────────────
  const handleManualRetry = useCallback(() => {
    const sym    = symbol;
    const expiry = selectedExpiry;
    const session = ++sessionRef.current;
    clearPendingTimers();
    setChain([]);
    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt: 0 });
    if (expiry) {
      loadChain(sym, expiry, 0, session);
    } else {
      startSymbolLoad(sym, session);
    }
  }, [symbol, selectedExpiry, clearPendingTimers, loadChain, startSymbolLoad]);

  // ── Strike click ──────────────────────────────────────────────────────────
  const handleStrikeClick = useCallback((strike: number, type: 'CE' | 'PE', ltp?: number) => {
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
  }, [symbol, selectedExpiry, setActiveSymbol, setSelectedContract, setOrderForm]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const isLoading = status.type === 'loading' || status.type === 'idle';
  const errorMessage = status.type === 'error' ? status.message : null;
  const attemptDisplay = status.type === 'loading' && status.attempt > 0
    ? ` (${status.attempt}/${MAX_AUTO_RETRIES})`
    : '';

  // ── Render ────────────────────────────────────────────────────────────────
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
        {isLoading ? (
          /* Loading — bounded by LOAD_TIMEOUT_MS hard timeout */
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-fw-text-secondary font-medium text-[13px]">
              {status.type === 'loading' && status.label
                ? `Loading ${status.label}`
                : `Loading ${symbol}…`}
            </p>
            {status.type === 'loading' && status.attempt > 0 && (
              <p className="text-fw-text-muted text-[11px]">
                Retrying{attemptDisplay}
              </p>
            )}
          </div>
        ) : errorMessage ? (
          /* Error — always shows Retry Now */
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span className="text-[28px]">⛓</span>
            <p className="text-[13px] text-fw-text-secondary font-semibold">Option Chain Unavailable</p>
            <p className="text-[12px] text-fw-text-muted max-w-[260px]">{errorMessage}</p>
            <button
              onClick={handleManualRetry}
              className="px-4 py-1.5 text-[12px] font-semibold bg-fw-accent text-white rounded hover:brightness-110 transition-all"
            >
              Retry Now
            </button>
          </div>
        ) : (
          /* Data table */
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
