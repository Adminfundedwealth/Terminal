/**
 * StrategyBuilder.tsx — FundedWealth Trading Terminal (P6.2 / P6.3)
 *
 * Professional multi-leg option strategy builder with real payoff & risk
 * analytics. Universal: works for any options-capable underlying via the
 * existing option-chain API, security-id/segment resolution and the universal
 * lot-size resolver. Nothing is hardcoded (no fixed strikes / lots / tokens /
 * expiries / segments).
 *
 * Execution reuses the EXISTING verified pipeline: each leg is submitted via
 * placeOrder() → server risk validation → paper/live execution → fill → trade
 * → position → P&L. No second execution path is created. In paper mode (the
 * production default) these are simulated fills.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getOptionChain, getExpiries, getLotSize, placeOrder } from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import { Plus, Trash2, Play, X } from 'lucide-react';
import type { OptionChainEntry, OrderSide, ProductType } from '@/types';
import {
  STRATEGY_PRESETS,
  computePayoff,
  type PresetId,
  type StrategyLeg,
} from '@/utils/strategyPayoff';

// A concrete, executable leg bound to a real contract.
interface BuilderLeg {
  id: string;
  optionType: 'CE' | 'PE';
  side: OrderSide;
  strike: number;
  token: string;        // real Dhan securityId
  premium: number;      // per-unit LTP
  lots: number;         // number of lots
}

function deriveUnderlying(sym: string): string {
  return sym.replace(/\s+\d+.*$/, '').replace(/\s+FUT.*$/i, '').trim().toUpperCase();
}
function deriveOptionExchange(segment: string): string {
  // BSE indices (SENSEX/BANKEX) route to BFO; everything else NFO. Segment is
  // authoritative; no symbol hardcoding.
  return segment === 'BSE' ? 'BFO' : 'NFO';
}

export function StrategyBuilder() {
  const { activeSymbol } = useAppStore();
  const quotes = useMarketStore((s) => s.quotes);

  const underlying = activeSymbol ? deriveUnderlying(activeSymbol.symbol) : '';
  const optExchange = activeSymbol ? deriveOptionExchange(activeSymbol.segment) : 'NFO';
  const spot = activeSymbol ? (quotes[activeSymbol.token]?.ltp || 0) : 0;

  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('');
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [lotSize, setLotSize] = useState<number>(1);
  const [presetId, setPresetId] = useState<PresetId>('straddle');
  const [legs, setLegs] = useState<BuilderLeg[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<{ label: string; status: string }[]>([]);
  const sessionRef = useRef(0);

  // ── Load expiries + lot size when underlying changes ───────────────────────
  useEffect(() => {
    if (!underlying) { setStatus('idle'); return; }
    const session = ++sessionRef.current;
    setStatus('loading');
    setLegs([]);
    setResults([]);
    Promise.all([
      getExpiries(underlying).catch(() => [] as string[]),
      getLotSize(underlying).then((r) => r.lotSize).catch(() => 1),
    ]).then(([exps, ls]) => {
      if (session !== sessionRef.current) return;
      setExpiries(exps);
      setExpiry(exps[0] || '');
      setLotSize(ls > 0 ? ls : 1);
    });
  }, [underlying]);

  // ── Load chain when expiry changes ─────────────────────────────────────────
  useEffect(() => {
    if (!underlying || !expiry) return;
    const session = ++sessionRef.current;
    setStatus('loading');
    getOptionChain(underlying, expiry)
      .then((data) => {
        if (session !== sessionRef.current) return;
        setChain(Array.isArray(data) ? data : []);
        setStatus(Array.isArray(data) && data.length > 0 ? 'ready' : 'error');
      })
      .catch(() => { if (session === sessionRef.current) setStatus('error'); });
  }, [underlying, expiry]);

  // ── ATM + strike ladder (from ACTUAL chain data, no fixed interval) ─────────
  const atmStrike = useMemo(() => {
    if (chain.length === 0 || spot <= 0) return chain[Math.floor(chain.length / 2)]?.strike || 0;
    let closest = chain[0].strike, min = Infinity;
    for (const e of chain) {
      const d = Math.abs(e.strike - spot);
      if (d < min) { min = d; closest = e.strike; }
    }
    return closest;
  }, [chain, spot]);

  // Chosen strikes for the preset (lower/atm/upper). Default to ATM and the
  // adjacent strikes actually present in the chain.
  const [chosenStrikes, setChosenStrikes] = useState<{ lower?: number; atm?: number; upper?: number }>({});

  useEffect(() => {
    if (chain.length === 0 || atmStrike === 0) return;
    const idx = chain.findIndex((e) => e.strike === atmStrike);
    const lower = chain[Math.max(0, idx - 2)]?.strike ?? atmStrike;
    const upper = chain[Math.min(chain.length - 1, idx + 2)]?.strike ?? atmStrike;
    setChosenStrikes({ lower, atm: atmStrike, upper });
  }, [chain, atmStrike]);

  const findEntry = useCallback((strike: number) => chain.find((e) => e.strike === strike), [chain]);

  // ── Build legs from the selected preset + chosen strikes (real contracts) ──
  const applyPreset = useCallback((id: PresetId) => {
    setPresetId(id);
    setResults([]);
    const preset = STRATEGY_PRESETS.find((p) => p.id === id);
    if (!preset || preset.id === 'custom') { setLegs([]); return; }
    const roleStrike = (role: 'lower' | 'atm' | 'upper') =>
      role === 'lower' ? (chosenStrikes.lower ?? atmStrike)
      : role === 'upper' ? (chosenStrikes.upper ?? atmStrike)
      : (chosenStrikes.atm ?? atmStrike);

    const built: BuilderLeg[] = [];
    for (const spec of preset.legs) {
      const strike = roleStrike(spec.strikeRole);
      const e = findEntry(strike);
      if (!e) continue;
      const token = spec.optionType === 'CE' ? (e.callToken || '') : (e.putToken || '');
      const premium = spec.optionType === 'CE' ? (e.callLtp || 0) : (e.putLtp || 0);
      built.push({
        id: crypto.randomUUID(),
        optionType: spec.optionType,
        side: spec.side,
        strike,
        token,
        premium,
        lots: 1,
      });
    }
    setLegs(built);
  }, [chosenStrikes, atmStrike, findEntry]);

  // Re-apply preset when strikes resolve (so presets reflect real premiums).
  useEffect(() => {
    if (presetId !== 'custom' && chain.length > 0 && chosenStrikes.atm) {
      applyPreset(presetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenStrikes.atm, chosenStrikes.lower, chosenStrikes.upper, chain.length]);

  const addCustomLeg = () => {
    const e = findEntry(atmStrike);
    setLegs((ls) => [...ls, {
      id: crypto.randomUUID(),
      optionType: 'CE', side: 'BUY', strike: atmStrike,
      token: e?.callToken || '', premium: e?.callLtp || 0, lots: 1,
    }]);
    setPresetId('custom');
  };

  const updateLeg = (id: string, patch: Partial<BuilderLeg>) => {
    setLegs((ls) => ls.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      // Re-bind token+premium when strike or optionType changes.
      if (patch.strike !== undefined || patch.optionType !== undefined) {
        const e = findEntry(next.strike);
        if (e) {
          next.token = next.optionType === 'CE' ? (e.callToken || '') : (e.putToken || '');
          next.premium = next.optionType === 'CE' ? (e.callLtp || 0) : (e.putLtp || 0);
        }
      }
      return next;
    }));
  };
  const removeLeg = (id: string) => setLegs((ls) => ls.filter((l) => l.id !== id));

  // ── Payoff analytics (from actual legs; qty = lots × lotSize) ──────────────
  const payoff = useMemo(() => {
    const strat: StrategyLeg[] = legs
      .filter((l) => l.token && l.premium > 0)
      .map((l) => ({ optionType: l.optionType, side: l.side, strike: l.strike, premium: l.premium, qty: l.lots * lotSize }));
    return computePayoff(strat, spot);
  }, [legs, lotSize, spot]);

  const strikeChoices = useMemo(() => chain.map((e) => e.strike), [chain]);

  // ── Execute all legs via the EXISTING order pipeline (paper by default) ────
  const executeStrategy = async () => {
    const valid = legs.filter((l) => l.token);
    if (valid.length === 0) return;
    setIsExecuting(true);
    setResults([]);
    const out: { label: string; status: string }[] = [];
    for (const leg of valid) {
      const label = `${leg.side} ${leg.strike}${leg.optionType} ×${leg.lots}`;
      try {
        const res = await placeOrder({
          symbol: `${underlying} ${leg.strike} ${leg.optionType}`,
          token: leg.token,
          segment: optExchange,
          side: leg.side,
          orderType: 'MARKET',
          productType: 'NRML',
          qty: leg.lots * lotSize,
        });
        out.push({ label, status: (res as any)?.status || 'PLACED' });
      } catch (e: any) {
        out.push({ label, status: 'FAIL: ' + (e?.message || 'error') });
      }
    }
    setResults(out);
    setIsExecuting(false);
  };

  const fmtMoney = (v: number) =>
    v === Infinity ? 'Unlimited' : v === -Infinity ? 'Unlimited' : `₹${Math.round(v).toLocaleString('en-IN')}`;

  if (!activeSymbol) {
    return <div className="flex items-center justify-center h-full text-[13px] text-fw-text-muted">Select an underlying to build a strategy</div>;
  }

  return (
    <div className="h-full flex flex-col bg-fw-bg overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-fw-surface flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-fw-text">Strategy Builder</span>
          <span className="text-[12px] font-bold text-fw-accent">{underlying}</span>
          <span className="text-[10px] text-fw-text-muted">{optExchange}</span>
          {spot > 0 && <span className="text-[11px] font-mono text-emerald-400">{formatPrice(spot)}</span>}
          <span className="text-[10px] text-fw-text-muted">Lot {lotSize}</span>
        </div>
        {expiries.length > 0 && (
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}
            className="bg-fw-bg text-fw-text text-[11px] border border-fw-border rounded px-1.5 py-0.5 font-mono cursor-pointer">
            {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}
      </div>

      {/* Preset selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-fw-border/50 flex-wrap">
        {STRATEGY_PRESETS.map((p) => (
          <button key={p.id} onClick={() => applyPreset(p.id)} title={p.description}
            className={cn('px-2 py-0.5 text-[10px] font-bold uppercase rounded border transition-colors',
              presetId === p.id ? 'bg-fw-accent/20 text-fw-accent border-fw-accent/40' : 'text-fw-text-muted border-fw-border/50 hover:text-fw-text')}>
            {p.label}
          </button>
        ))}
        <button onClick={addCustomLeg} className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded bg-fw-accent text-white hover:brightness-110">
          <Plus size={10} /> Leg
        </button>
      </div>

      {status === 'loading' && <div className="px-3 py-4 text-[12px] text-fw-text-muted">Loading chain…</div>}
      {status === 'error' && <div className="px-3 py-4 text-[12px] text-red-400">Option chain unavailable for {underlying} {expiry}.</div>}

      {/* Legs */}
      <div className="px-3 py-2 space-y-1.5">
        {legs.length === 0 && status === 'ready' && (
          <div className="text-[12px] text-fw-text-muted py-3 text-center">Pick a strategy preset above, or add a custom leg.</div>
        )}
        {legs.map((leg, i) => (
          <div key={leg.id} className="p-2 bg-fw-bg border border-fw-border rounded">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-fw-text-secondary">Leg {i + 1}</span>
              <button onClick={() => removeLeg(leg.id)} className="text-red-400 hover:text-red-300"><Trash2 size={11} /></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <select value={leg.side} onChange={(e) => updateLeg(leg.id, { side: e.target.value as OrderSide })}
                className={cn('rounded text-[11px] font-bold px-1 py-1 border', leg.side === 'BUY' ? 'bg-emerald-900/20 text-emerald-400 border-emerald-800/30' : 'bg-red-900/20 text-red-400 border-red-800/30')}>
                <option value="BUY">BUY</option><option value="SELL">SELL</option>
              </select>
              <select value={leg.optionType} onChange={(e) => updateLeg(leg.id, { optionType: e.target.value as 'CE' | 'PE' })}
                className="bg-fw-surface-2 border border-fw-border rounded text-[11px] px-1 py-1 text-fw-text">
                <option value="CE">CE</option><option value="PE">PE</option>
              </select>
              <select value={leg.strike} onChange={(e) => updateLeg(leg.id, { strike: Number(e.target.value) })}
                className="bg-fw-surface-2 border border-fw-border rounded text-[11px] px-1 py-1 text-fw-text font-mono">
                {strikeChoices.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="number" min={1} value={leg.lots} onChange={(e) => updateLeg(leg.id, { lots: Math.max(1, parseInt(e.target.value) || 1) })}
                className="bg-fw-surface-2 border border-fw-border rounded text-[11px] font-mono px-1 py-1 text-fw-text text-center outline-none" title="Lots" />
            </div>
            <div className="mt-1 text-[10px] font-mono text-fw-text-muted flex justify-between">
              <span>{leg.token ? `#${leg.token}` : 'no contract'}</span>
              <span>LTP {leg.premium > 0 ? formatPrice(leg.premium) : '—'} · {leg.lots * lotSize} qty</span>
            </div>
          </div>
        ))}
      </div>

      {/* Payoff analytics */}
      {payoff.valid && (
        <div className="px-3 py-2 border-t border-fw-border/50">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
            <div className="flex justify-between"><span className="text-fw-text-muted">Net Premium</span>
              <span className={payoff.netPremium >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {payoff.netPremium >= 0 ? '+' : ''}{fmtMoney(payoff.netPremium)} {payoff.netPremium >= 0 ? '(credit)' : '(debit)'}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-fw-text-muted">Max Profit</span>
              <span className="text-emerald-400">{fmtMoney(payoff.maxProfit)}</span></div>
            <div className="flex justify-between"><span className="text-fw-text-muted">Max Loss</span>
              <span className="text-red-400">{fmtMoney(payoff.maxLoss)}</span></div>
            <div className="flex justify-between"><span className="text-fw-text-muted">Breakeven</span>
              <span className="text-fw-text">{payoff.breakevens.length ? payoff.breakevens.map((b) => Math.round(b)).join(', ') : '—'}</span></div>
          </div>
          <PayoffChart curve={payoff.curve} spot={spot} breakevens={payoff.breakevens} />
        </div>
      )}

      {/* Execute */}
      <div className="px-3 py-2 border-t border-fw-border flex-shrink-0">
        <button onClick={executeStrategy} disabled={isExecuting || legs.filter((l) => l.token).length === 0}
          className="w-full py-2 rounded text-[12px] font-bold text-white bg-fw-accent hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Play size={12} /> {isExecuting ? 'Placing…' : `Execute ${legs.filter((l) => l.token).length}-leg strategy`}
        </button>
        {results.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-fw-text-secondary">{r.label}</span>
                <span className={cn('font-bold', r.status.startsWith('FAIL') ? 'text-red-400' : 'text-emerald-400')}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Payoff curve (lightweight inline SVG; no external chart lib) ────────────
function PayoffChart({ curve, spot, breakevens }: { curve: { price: number; pnl: number }[]; spot: number; breakevens: number[] }) {
  if (curve.length < 2) return null;
  const W = 280, H = 90, pad = 4;
  const prices = curve.map((c) => c.price);
  const pnls = curve.map((c) => c.pnl);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minPnl = Math.min(...pnls), maxPnl = Math.max(...pnls);
  const x = (p: number) => pad + ((p - minP) / (maxP - minP || 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - minPnl) / (maxPnl - minPnl || 1)) * (H - 2 * pad);
  const zeroY = y(0);
  const path = curve.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(c.price).toFixed(1)},${y(c.pnl).toFixed(1)}`).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="mt-2 block" preserveAspectRatio="none" role="img" aria-label="Strategy payoff at expiry">
      {/* Zero P&L line */}
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="currentColor" strokeWidth="0.5" className="text-fw-border" strokeDasharray="2,2" />
      {/* Spot marker */}
      {spot > 0 && spot >= minP && spot <= maxP && (
        <line x1={x(spot)} y1={pad} x2={x(spot)} y2={H - pad} stroke="currentColor" strokeWidth="0.5" className="text-fw-accent/60" strokeDasharray="2,2" />
      )}
      {/* Breakeven markers */}
      {breakevens.filter((b) => b >= minP && b <= maxP).map((b, i) => (
        <line key={i} x1={x(b)} y1={pad} x2={x(b)} y2={H - pad} stroke="currentColor" strokeWidth="0.4" className="text-amber-400/50" />
      ))}
      {/* Payoff line */}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" className="text-fw-accent" />
    </svg>
  );
}
