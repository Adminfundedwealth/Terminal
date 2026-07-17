import { useMemo, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { cn } from '@/utils/helpers';

/**
 * Full Greeks Panel
 * Computes Delta, Gamma, Theta, Vega, Rho for active option position.
 * Uses Black-Scholes model for computation.
 */

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  theoreticalPrice: number;
}

function computeGreeks(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, iv: sigma * 100, theoreticalPrice: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  let delta: number, theta: number, rho: number, price: number;

  if (isCall) {
    delta = normalCDF(d1);
    price = S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
    theta = (-(S * normalPDF(d1) * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
    rho = K * T * Math.exp(-r * T) * normalCDF(d2) / 100;
  } else {
    delta = normalCDF(d1) - 1;
    price = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    theta = (-(S * normalPDF(d1) * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
    rho = -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;
  }

  const gamma = normalPDF(d1) / (S * sigma * sqrtT);
  const vega = S * normalPDF(d1) * sqrtT / 100;

  return { delta, gamma, theta, vega, rho, iv: sigma * 100, theoreticalPrice: price };
}

export function GreeksPanel() {
  const { activeSymbol } = useAppStore();
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
  const spotPrice = quote?.ltp || 22000;
  const strikePrice = Math.round(spotPrice / 100) * 100; // ATM strike
  const daysToExpiry = 7;
  const riskFreeRate = 0.065; // 6.5% India 10Y
  const impliedVol = 0.15; // 15% default IV
  const isCall = activeSymbol?.instrumentType === 'CE';

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
  const mainThreadGreeks = useMemo(() => {
    const T = daysToExpiry / 365;
    return computeGreeks(spotPrice, strikePrice, T, riskFreeRate, impliedVol, isCall);
  }, [spotPrice, strikePrice, daysToExpiry, riskFreeRate, impliedVol, isCall]);

  // Use worker result if available, otherwise main thread
  const greeks = workerGreeks || mainThreadGreeks;

  return (
    <div className="h-full flex flex-col bg-[#0c0e14] overflow-y-auto">
      <div className="px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
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
            <span className="text-fw-accent font-mono font-bold">{greeks.iv.toFixed(1)}%</span>
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
