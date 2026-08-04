import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getOptionChain, getExpiries } from '@/services/api';
import { cn, formatPrice, formatNumber } from '@/utils/helpers';
import { useTradingStore } from '@/store/tradingStore';
import type { OptionChainEntry } from '@/types';

const INDEX_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];
const INDEX_TOKENS: Record<string, string> = {
  NIFTY: '99926000', BANKNIFTY: '99926009', FINNIFTY: '99926037', MIDCPNIFTY: '99926074', SENSEX: '99919000',
};
const STRIKES_AROUND_ATM = 20;
const MAX_AUTO_RETRIES = 3;

export function OptionChainModal() {
  const { activeSymbol, setActiveSymbol } = useAppStore();
  const { setOrderForm, setSelectedContract, selectedContract } = useTradingStore();
  const quotes = useMarketStore((s) => s.quotes);

  const [symbol, setSymbol] = useState('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use ref for retry count — avoids stale-closure issues in setTimeout callbacks
  const retryCountRef = useRef(0);
  const [retryDisplay, setRetryDisplay] = useState(0); // mirror for UI only
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const rateLimitedUntilRef = useRef<number>(0);

  // ── Symbol auto-sync from active chart symbol ──────────────────────────────
  useEffect(() => {
    if (!activeSymbol) return;
    const sym = activeSymbol.symbol.replace(/\s.*/, '').toUpperCase();
    if (INDEX_SYMBOLS.includes(sym) && sym !== symbol) setSymbol(sym);
  }, [activeSymbol?.symbol]);

  // ── Spot price for ATM detection ───────────────────────────────────────────
  const spotPrice = useMemo(() => {
    const token = INDEX_TOKENS[symbol];
    const q = token ? quotes[token] : null;
    return q?.ltp || 0;
  }, [symbol, quotes]);

  // ── ATM-filtered chain ─────────────────────────────────────────────────────
  const filteredChain = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return chain;
    let atmIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chain.length; i++) {
      const diff = Math.abs(chain[i].strike - spotPrice);
      if (diff < minDiff) { minDiff = diff; atmIdx = i; }
    }
    const start = Math.max(0, atmIdx - STRIKES_AROUND_ATM);
    const end   = Math.min(chain.length, atmIdx + STRIKES_AROUND_ATM + 1);
    return chain.slice(start, end);
  }, [chain, spotPrice]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (retryTimerRef.current)   clearTimeout(retryTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // ── Load expiries when symbol changes ─────────────────────────────────────
  useEffect(() => { loadExpiries(); }, [symbol]);

  // ── Debounced chain load on symbol / expiry change ─────────────────────────
  useEffect(() => {
    if (!selectedExpiry) return;
    // Cancel previous pending load
    if (retryTimerRef.current)    clearTimeout(retryTimerRef.current);
    if (debounceTimerRef.current)  clearTimeout(debounceTimerRef.current);
    retryCountRef.current = 0;
    setRetryDisplay(0);
    // 400 ms debounce — avoids firing while user clicks through pairs quickly
    debounceTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) doLoadChain(0);
    }, 400);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [symbol, selectedExpiry]);

  // ── Core load function (retryAttempt avoids stale closure) ────────────────
  const doLoadChain = async (attempt: number) => {
    if (!isMountedRef.current || !selectedExpiry) return;

    // Rate-limit guard
    const now = Date.now();
    if (rateLimitedUntilRef.current > now) {
      const secsLeft = Math.ceil((rateLimitedUntilRef.current - now) / 1000);
      setError(`Rate limited — wait ${secsLeft}s before loading another pair.`);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getOptionChain(symbol, selectedExpiry);
      if (!isMountedRef.current) return;

      if (data && data.length > 0) {
        setChain(data);
        retryCountRef.current = 0;
        setRetryDisplay(0);
      } else {
        setChain([]);
        if (attempt < MAX_AUTO_RETRIES) {
          const nextAttempt = attempt + 1;
          retryCountRef.current = nextAttempt;
          setRetryDisplay(nextAttempt);
          const delay = nextAttempt * 5000; // 5s, 10s, 15s
          retryTimerRef.current = setTimeout(() => doLoadChain(nextAttempt), delay);
        } else {
          setError('No option chain data. Market may be closed or feed not ready.');
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setChain([]);

      const isRateLimit =
        err?.status === 429 ||
        (typeof err?.message === 'string' &&
         (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')));

      if (isRateLimit) {
        rateLimitedUntilRef.current = Date.now() + 30_000;
        setError('Too many requests — wait ~30s before switching pairs again.');
        setIsLoading(false);
        return;
      }

      if (attempt < MAX_AUTO_RETRIES) {
        const nextAttempt = attempt + 1;
        retryCountRef.current = nextAttempt;
        setRetryDisplay(nextAttempt);
        const delay = nextAttempt * 5000;
        retryTimerRef.current = setTimeout(() => doLoadChain(nextAttempt), delay);
      } else {
        setError(err.message || 'Failed to load option chain.');
      }
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  const loadExpiries = async () => {
    try {
      const data = await getExpiries(symbol);
      if (!isMountedRef.current) return;
      setExpiries(data);
      if (data.length > 0) setSelectedExpiry(data[0]);
    } catch {
      if (!isMountedRef.current) return;
      const expiryDayMap: Record<string, number> = {
        NIFTY: 2, BANKNIFTY: 3, FINNIFTY: 2, MIDCPNIFTY: 1, SENSEX: 5,
      };
      const expiryDay = expiryDayMap[symbol] ?? 2;
      const now = new Date();
      const fallback: string[] = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + ((expiryDay - d.getDay() + 7) % 7) + i * 7);
        if (d > now) fallback.push(d.toISOString().split('T')[0]);
      }
      setExpiries(fallback);
      if (fallback.length > 0 && !selectedExpiry) setSelectedExpiry(fallback[0]);
    }
  };

  const handleManualRetry = () => {
    if (retryTimerRef.current)    clearTimeout(retryTimerRef.current);
    if (debounceTimerRef.current)  clearTimeout(debounceTimerRef.current);
    rateLimitedUntilRef.current = 0;
    retryCountRef.current = 0;
    setRetryDisplay(0);
    setError(null);
    doLoadChain(0);
  };

  const handleStrikeClick = (strike: number, type: 'CE' | 'PE', ltp?: number) => {
    const lotSize =
      symbol === 'BANKNIFTY'   ? 15  :
      symbol === 'FINNIFTY'    ? 25  :
      symbol === 'MIDCPNIFTY'  ? 75  :
      symbol === 'SENSEX'      ? 10  : 50;

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
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-fw-border">
        <span className="text-[14px] font-bold text-fw-text">OPTION CHAIN</span>
        <div className="flex items-center gap-0.5">
          {INDEX_SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={cn(
                'px-1.5 py-0.5 text-[13px] rounded font-semibold transition-colors',
                s === symbol ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:text-fw-text',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={selectedExpiry}
          onChange={(e) => setSelectedExpiry(e.target.value)}
          className="ml-auto bg-fw-bg text-fw-text text-[13px] border border-fw-border rounded px-1.5 py-0.5 font-mono"
        >
          {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {spotPrice > 0 && (
          <span className="ml-2 text-[13px] font-mono font-bold text-fw-accent tabular-nums">
            Spot: {formatPrice(spotPrice)}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto text-[13px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-[13px] text-fw-text-secondary font-medium">Loading option chain...</p>
            <p className="text-[13px] text-fw-text-muted">{symbol} · {selectedExpiry}</p>
          </div>
        ) : chain.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-xl bg-fw-bg border border-fw-border flex items-center justify-center">
              {retryDisplay > 0 && retryDisplay <= MAX_AUTO_RETRIES && !error
                ? <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
                : <span className="text-[24px] text-fw-text-muted/60">⛓</span>
              }
            </div>
            <div className="text-center">
              <p className="text-[14px] text-fw-text-secondary font-semibold">
                {error
                  ? 'Option Chain Unavailable'
                  : retryDisplay > 0
                    ? 'Fetching Option Chain...'
                    : 'No Data Yet'}
              </p>
              <p className="text-[14px] text-fw-text-muted mt-1 max-w-[280px]">
                {error
                  ? error
                  : retryDisplay > 0
                    ? `Retrying (${retryDisplay}/${MAX_AUTO_RETRIES}) — connecting to market feed...`
                    : `Click Retry Now to load ${symbol} option chain`}
              </p>
            </div>
            <button
              onClick={handleManualRetry}
              className="px-3 py-1 text-[13px] font-semibold bg-fw-accent text-white rounded hover:brightness-110 transition-all"
            >
              Retry Now
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-fw-surface z-10">
              <tr className="border-b border-fw-border text-[13px] text-fw-text-secondary uppercase">
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
                      isAtm && 'bg-fw-accent/[0.03]',
                      (isSelCE || isSelPE) && 'bg-fw-accent/[0.08] border-l-2 border-l-fw-accent',
                    )}
                  >
                    <td className="px-1 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', e.callLtp); setOrderForm({ side: 'BUY' }); }} className="text-[8px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', e.callLtp); setOrderForm({ side: 'SELL' }); }} className="text-[8px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
                    </td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.callOi || 0)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.callVolume || 0)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-green-400 cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'CE', e.callLtp)}>{e.callLtp > 0 ? formatPrice(e.callLtp) : '—'}</td>
                    <td className={cn('px-1.5 py-[3px] text-center font-mono font-bold bg-fw-bg border-x border-fw-border tabular-nums', isAtm ? 'text-fw-accent' : 'text-fw-text')}>{e.strike}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-red-400 cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'PE', e.putLtp)}>{e.putLtp > 0 ? formatPrice(e.putLtp) : '—'}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.putVolume || 0)}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(e.putOi || 0)}</td>
                    <td className="px-1 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', e.putLtp); setOrderForm({ side: 'BUY' }); }} className="text-[8px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', e.putLtp); setOrderForm({ side: 'SELL' }); }} className="text-[8px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
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
