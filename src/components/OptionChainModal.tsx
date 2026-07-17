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
const STRIKES_AROUND_ATM = 20; // Show 20 strikes above + 20 below ATM

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
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Auto-sync symbol from activeSymbol if it's an index
  useEffect(() => {
    if (activeSymbol) {
      const sym = activeSymbol.symbol.replace(/\s.*/,'').toUpperCase();
      if (INDEX_SYMBOLS.includes(sym) && sym !== symbol) {
        setSymbol(sym);
      }
    }
  }, [activeSymbol?.symbol]);

  // Get spot price for ATM determination
  const spotPrice = useMemo(() => {
    const token = INDEX_TOKENS[symbol];
    if (!token) return 0;
    const q = quotes[token];
    return q?.ltp || 0;
  }, [symbol, quotes]);

  // Filter chain around ATM
  const filteredChain = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return chain;
    
    // Find ATM strike (closest to spot)
    let atmIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chain.length; i++) {
      const diff = Math.abs(chain[i].strike - spotPrice);
      if (diff < minDiff) { minDiff = diff; atmIdx = i; }
    }
    
    const start = Math.max(0, atmIdx - STRIKES_AROUND_ATM);
    const end = Math.min(chain.length, atmIdx + STRIKES_AROUND_ATM + 1);
    return chain.slice(start, end);
  }, [chain, spotPrice]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  useEffect(() => { loadExpiries(); }, [symbol]);
  useEffect(() => { if (selectedExpiry) loadChain(); }, [symbol, selectedExpiry]);

  const loadChain = async () => {
    if (!selectedExpiry) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getOptionChain(symbol, selectedExpiry);
      if (!isMountedRef.current) return;
      if (data && data.length > 0) {
        setChain(data);
        setRetryCount(0);
      } else {
        // Empty response — might be market closed, invalid expiry, or feed not ready.
        // Auto-retry up to 3 times with backoff.
        setChain([]);
        if (retryCount < 3) {
          const delay = (retryCount + 1) * 5000; // 5s, 10s, 15s
          retryTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              setRetryCount((c) => c + 1);
              loadChain();
            }
          }, delay);
          // Set a soft message so user knows it's retrying, not stuck
          setError(null);
        } else {
          setError('No option chain data returned. Market may be closed or the expiry has no contracts.');
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setChain([]);
      setError(err.message || 'Failed to load option chain');
      // Auto-retry on error with backoff
      if (retryCount < 3) {
        const delay = (retryCount + 1) * 5000;
        retryTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setRetryCount((c) => c + 1);
            loadChain();
          }
        }, delay);
      }
    } finally { if (isMountedRef.current) setIsLoading(false); }
  };

  const loadExpiries = async () => {
    try {
      const data = await getExpiries(symbol);
      if (!isMountedRef.current) return;
      setExpiries(data);
      if (data.length > 0) setSelectedExpiry(data[0]);
    } catch {
      if (!isMountedRef.current) return;
      // Fallback: generate nearest TUESDAY expiry for NIFTY/FINNIFTY indices
      // (NIFTY/FINNIFTY = Tuesday, BANKNIFTY = Wednesday, MIDCPNIFTY = Monday, SENSEX = Friday)
      const expiryDayMap: Record<string, number> = { NIFTY: 2, BANKNIFTY: 3, FINNIFTY: 2, MIDCPNIFTY: 1, SENSEX: 5 };
      const expiryDay = expiryDayMap[symbol] || 2;
      const now = new Date();
      const fallbackExpiries: string[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + ((expiryDay - date.getDay() + 7) % 7) + i * 7);
        if (date > now) fallbackExpiries.push(date.toISOString().split('T')[0]);
      }
      setExpiries(fallbackExpiries);
      if (fallbackExpiries.length > 0 && !selectedExpiry) setSelectedExpiry(fallbackExpiries[0]);
    }
  };

  const handleManualRetry = () => {
    setRetryCount(0);
    setError(null);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    loadChain();
  };

  const handleStrikeClick = (strike: number, type: 'CE' | 'PE', ltp?: number) => {
    const lotSize = symbol === 'BANKNIFTY' ? 15 : symbol === 'MIDCPNIFTY' ? 75 : 50;
    setActiveSymbol({
      token: `${symbol}_${strike}_${type}`,
      symbol: `${symbol} ${strike} ${type}`,
      name: `${symbol} ${selectedExpiry} ${strike} ${type}`,
      segment: 'NFO',
      instrumentType: type,
      exchange: 'NSE',
      lotSize,
      tickSize: 0.05,
      expiry: selectedExpiry,
      strike,
      optionType: type,
    });
    // Set selected contract state
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
    // Prefill order with lot size and price
    if (ltp && ltp > 0) {
      setOrderForm({ price: ltp, orderType: 'LIMIT', qty: lotSize });
    } else {
      setOrderForm({ qty: lotSize });
    }
  };

  return (
    <div className="flex flex-col h-full bg-fw-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-fw-border">
        <span className="text-[14px] font-bold text-fw-text">OPTION CHAIN</span>
        <div className="flex items-center gap-0.5">
          {INDEX_SYMBOLS.map((s) => (
            <button key={s} onClick={() => setSymbol(s)}
              className={cn('px-1.5 py-0.5 text-[13px] rounded font-semibold', symbol === s ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:text-fw-text')}>
              {s}
            </button>
          ))}
        </div>
        <select value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)}
          className="ml-auto bg-fw-bg text-fw-text text-[13px] border border-fw-border rounded px-1.5 py-0.5 font-mono">
          {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {spotPrice > 0 && (
          <span className="ml-2 text-[13px] font-mono font-bold text-fw-accent tabular-nums">
            Spot: {formatPrice(spotPrice)}
          </span>
        )}
      </div>

      {/* Table */}
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
              {retryCount > 0 && retryCount < 3 && !error
                ? <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
                : <span className="text-[24px] text-fw-text-muted/60">⛓</span>
              }
            </div>
            <div className="text-center">
              <p className="text-[14px] text-fw-text-secondary font-semibold">
                {error ? 'Option Chain Unavailable' : retryCount > 0 ? 'Fetching Option Chain...' : 'No Data Yet'}
              </p>
              <p className="text-[14px] text-fw-text-muted mt-1 max-w-[280px]">
                {error
                  ? error
                  : retryCount > 0
                    ? `Retrying (${retryCount}/3) — connecting to market feed...`
                    : `Click Retry Now to load ${symbol} option chain for ${selectedExpiry}`
                }
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handleManualRetry}
                className="px-3 py-1 text-[13px] font-semibold bg-fw-accent text-white rounded hover:brightness-110 transition-all"
              >
                Retry Now
              </button>
            </div>
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
                const isSelectedCE = selectedContract?.strike === e.strike && selectedContract?.optionType === 'CE';
                const isSelectedPE = selectedContract?.strike === e.strike && selectedContract?.optionType === 'PE';
                const callOi = e.callOi || 0;
                const callVol = e.callVolume || 0;
                const callLtp = e.callLtp || 0;
                const putOi = e.putOi || 0;
                const putVol = e.putVolume || 0;
                const putLtp = e.putLtp || 0;
                return (
                  <tr key={e.strike} className={cn('border-b border-fw-border/20 hover:bg-fw-hover/40', isAtm && 'bg-fw-accent/[0.03]', (isSelectedCE || isSelectedPE) && 'bg-fw-accent/[0.08] border-l-2 border-l-fw-accent')}>
                    <td className="px-1 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', callLtp); setOrderForm({ side: 'BUY' }); }} className="text-[8px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'CE', callLtp); setOrderForm({ side: 'SELL' }); }} className="text-[8px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
                    </td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(callOi)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-fw-text-secondary">{formatNumber(callVol)}</td>
                    <td className="px-1 py-[3px] text-right font-mono tabular-nums text-green cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'CE', callLtp)}>{callLtp > 0 ? formatPrice(callLtp) : '—'}</td>
                    <td className={cn('px-1.5 py-[3px] text-center font-mono font-bold bg-fw-bg border-x border-fw-border tabular-nums', isAtm ? 'text-fw-accent' : 'text-fw-text')}>{e.strike}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-red cursor-pointer hover:underline" onClick={() => handleStrikeClick(e.strike, 'PE', putLtp)}>{putLtp > 0 ? formatPrice(putLtp) : '—'}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(putVol)}</td>
                    <td className="px-1 py-[3px] text-left font-mono tabular-nums text-fw-text-secondary">{formatNumber(putOi)}</td>
                    <td className="px-1 py-[3px] text-center">
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', putLtp); setOrderForm({ side: 'BUY' }); }} className="text-[8px] text-green-400 font-bold hover:bg-green-900/30 px-1 rounded">B</button>
                      <button onClick={() => { handleStrikeClick(e.strike, 'PE', putLtp); setOrderForm({ side: 'SELL' }); }} className="text-[8px] text-red-400 font-bold hover:bg-red-900/30 px-1 rounded">S</button>
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
