import { useMemo, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';
import { computeBlackScholesGreeks, impliedVolatility, type BlackScholesGreeks } from '@/utils/blackScholes';

type Greeks = BlackScholesGreeks;

/**
 * Full Greeks Panel
 * Computes Delta, Gamma, Theta, Vega, Rho for active option position.
 * Uses Black-Scholes model for computation.
 */

export function GreeksPanel() {
  const { activeSymbol, watchlists } = useAppStore();
  const selectedContract = useTradingStore((state) => state.selectedContract);
  const quotes = useMarketStore((state) => state.quotes);
  const quote = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const workerRef = useRef<Worker | null>(null);
  const [workerGreeks, setWorkerGreeks] = useState<Greeks | null>(null);

  // Initialize options worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL('../workers/optionsWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'greeks-result' && e.data.results?.length > 0) {
          const r = e.data.results[0];
          setWorkerGreeks({
            delta: r.delta,
            gamma: r.gamma,
            theta: r.theta,
            vega: r.vega,
            rho: r.rho,
            iv: r.iv,
            theoreticalPrice: r.theoreticalPrice,
          });
        }
      };
    } catch {
      // Worker initialization failed — fallback to main thread
      workerRef.current = null;
    }
    return () => { workerRef.current?.terminate(); };
  }, []);

  // Default parameters (user can modify)
  const underlyingInstrument = selectedContract
    ? watchlists.flatMap((watchlist) => watchlist.items).find((item) => item.symbol.replace(/\s+50$/, '').toUpperCase() === selectedContract.underlying.toUpperCase())
    : undefined;
  const underlyingQuote = underlyingInstrument ? quotes[underlyingInstrument.token] : undefined;
  const spotPrice = underlyingQuote?.ltp || 0;
  const strikePrice = selectedContract?.strike || activeSymbol?.strike || 0;
  const daysToExpiry = selectedContract?.expiry ? Math.max((new Date(selectedContract.expiry).getTime() - Date.now()) / 86_400_000, 0) : 0;
  const riskFreeRate = 0.065; // 6.5% India 10Y
  const isCall = activeSymbol?.instrumentType === 'CE';
  const impliedVol = quote?.ltp && spotPrice > 0 && strikePrice > 0 && daysToExpiry > 0
    ? impliedVolatility(spotPrice, strikePrice, daysToExpiry / 365, riskFreeRate, quote.ltp, isCall)
    : Number.NaN;

  // Send computation to worker when inputs change
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'greeks',
        strikes: [{ strike: strikePrice, type: isCall ? 'CE' : 'PE', ltp: quote?.ltp || 0 }],
        spot: spotPrice,
        riskFreeRate,
        daysToExpiry,
      });
    }
  }, [spotPrice, strikePrice, daysToExpiry, riskFreeRate, isCall, quote?.ltp]);

  // Fallback: main-thread computation (used if worker not available or as initial value)
  const mainThreadGreeks = useMemo<BlackScholesGreeks>(() => {
    return computeBlackScholesGreeks(spotPrice, strikePrice, daysToExpiry / 365, riskFreeRate, impliedVol, isCall);
  }, [spotPrice, strikePrice, daysToExpiry, riskFreeRate, impliedVol, isCall]);

  // Use worker result if available, otherwise main thread
  const greeks = workerGreeks && Object.values(workerGreeks).every(Number.isFinite) ? workerGreeks : mainThreadGreeks;

  return (
    <div className="h-full flex flex-col bg-fw-bg overflow-y-auto">
      <div className="px-3 py-2 border-b border-fw-border bg-fw-surface-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-bold text-fw-text">Option Greeks</span>
          <span className="text-[14px] text-fw-text-muted">{activeSymbol?.symbol || 'NIFTY'} {strikePrice} {isCall ? 'CE' : 'PE'}</span>
        </div>
      </div>

      {/* Parameters */}
      <div className="px-3 py-2 border-b border-fw-border/30 flex-shrink-0">
        <div className="grid grid-cols-4 gap-2 text-[14px]">
          <div>
            <span className="text-fw-text-muted block">Spot</span>
            <span className="text-fw-text font-mono font-bold">₹{spotPrice.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-fw-text-muted block">Strike</span>
            <span className="text-fw-text font-mono font-bold">₹{strikePrice.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-fw-text-muted block">DTE</span>
            <span className="text-fw-text font-mono font-bold">{daysToExpiry}d</span>
          </div>
          <div>
            <span className="text-fw-text-muted block">IV</span>
            <span className="text-fw-accent font-mono font-bold">{Number.isFinite(greeks.iv) ? `${greeks.iv.toFixed(1)}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Greeks Display */}
      <div className="px-3 py-3 space-y-3">
        <GreekRow label="Delta (Δ)" value={greeks.delta} format={v => v.toFixed(4)} description="Price sensitivity" color={greeks.delta >= 0 ? 'green' : 'red'} max={1} />
        <GreekRow label="Gamma (Γ)" value={greeks.gamma} format={v => v.toFixed(6)} description="Delta acceleration" color="blue" max={0.01} />
        <GreekRow label="Theta (Θ)" value={greeks.theta} format={v => `₹${v.toFixed(2)}/day`} description="Time decay" color="red" max={Math.abs(greeks.theta) * 2 || 1} />
        <GreekRow label="Vega (ν)" value={greeks.vega} format={v => `₹${v.toFixed(2)}/1%IV`} description="Volatility sensitivity" color="purple" max={greeks.vega * 2 || 1} />
        <GreekRow label="Rho (ρ)" value={greeks.rho} format={v => `₹${v.toFixed(4)}/1%r`} description="Interest rate sensitivity" color="yellow" max={Math.abs(greeks.rho) * 2 || 1} />

        {/* Theoretical Price */}
        <div className="mt-4 p-3 bg-fw-bg border border-fw-border rounded">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-fw-text-secondary">Theoretical Price (B-S)</span>
            <span className="text-[16px] font-mono font-bold text-fw-accent">₹{greeks.theoreticalPrice.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GreekRow({ label, value, format, description, color, max }: {
  label: string; value: number; format: (v: number) => string; description: string; color: string; max: number;
}) {
  const pct = Math.min(Math.abs(value) / (max || 1) * 100, 100);
  const barColor = color === 'green' ? 'bg-green' : color === 'red' ? 'bg-red' : color === 'blue' ? 'bg-blue-500' : color === 'purple' ? 'bg-purple-500' : 'bg-yellow-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div>
          <span className="text-[13px] font-bold text-fw-text">{label}</span>
          <span className="text-[13px] text-fw-text-muted ml-1.5">{description}</span>
        </div>
        <span className="text-[14px] font-mono font-bold text-fw-text tabular-nums">{format(value)}</span>
      </div>
      <div className="h-1.5 bg-fw-border/20 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
