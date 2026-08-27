/**
 * OptionChainModal.tsx — FundedWealth Trading Terminal
 *
 * Dynamic option chain panel.
 * - Works for ANY underlying that has real NFO/BFO option contracts.
 * - Capability is proven by the chain response itself, not by a hardcoded
 *   symbol list.  Instruments whose segment is MCX or CDS receive an instant
 *   "not available" state without making a backend request.
 * - 15-second wall-clock budget: one timer from first attempt to success/error.
 *   Retries run inside the budget; Retry Now starts a fresh budget.
 * - Module-level caches reduce repeat latency without persisting stale data.
 */
import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { getOptionChain, getExpiries, getLotSize } from '@/services/api';
import { cn, formatPrice, formatNumber } from '@/utils/helpers';
import { useTradingStore } from '@/store/tradingStore';
import { wsService } from '@/services/websocket';
import type { OptionChainEntry, Instrument } from '@/types';
import { SymbolLogo } from '@/components/SymbolLogo';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRIKES_AROUND_ATM = 20;

// Retry schedule within the 15-second budget
const MAX_AUTO_RETRIES = 6;
const retryDelay = (attempt: number) => ([500, 1000, 2000, 3000, 4000, 5000][attempt] ?? 5000);

// Hard wall-clock budget from first load attempt to success/error.
// Retries do NOT reset this clock.  Retry Now starts a NEW budget.
// 25s gives all 6 retries room even when Angel One JWT is warming up on fresh deploy.
const TOTAL_BUDGET_MS = 25_000;

// ─── Module-level caches (survive symbol switches, cleared on page reload) ───

interface ExpiryCache { expiries: string[]; cachedAt: number }
interface ChainCache  { chain: OptionChainEntry[]; cachedAt: number }

const _expiryCache = new Map<string, ExpiryCache>();
const _chainCache  = new Map<string, ChainCache>();
const EXPIRY_CACHE_TTL = 5 * 60 * 1000;  // 5 minutes
const CHAIN_CACHE_TTL  = 20 * 1000;      // 20 seconds (matches backend 30s TTL)

// ─── Segments that are known NOT to have option chains via current backend ────
// MCX options and CDS options require different exchange parameters that are
// not implemented in the current services.  Show instant unavailable.
// NOTE: SENSEX is NOT blocked here — Dhan supports it (IDX_I, scrip 51).
const UNSUPPORTED_SEGMENTS = new Set(['MCX', 'CDS']);

// ─── Underlying derivation ────────────────────────────────────────────────────
/**
 * Derive the canonical underlying symbol from any instrument.
 * Uses instrument metadata first; falls back to symbol string parsing.
 *
 * Examples:
 *   RELIANCE FUT Jun 2026  →  RELIANCE
 *   NIFTY 24500 CE         →  NIFTY
 *   BANKNIFTY FUT JUL      →  BANKNIFTY
 *   NIFTY 50               →  NIFTY      (index with trailing number)
 *   NIFTY                  →  NIFTY
 *   SENSEX 30              →  SENSEX
 *   RELIANCE               →  RELIANCE
 */
function deriveUnderlying(instrument: Instrument): string {
  const sym = instrument.symbol;

  // If instrument master provides explicit underlying via optionType, it IS
  // already an option contract — strip strike and type
  if (instrument.optionType === 'CE' || instrument.optionType === 'PE'
      || instrument.instrumentType === 'CE' || instrument.instrumentType === 'PE') {
    // e.g. "NIFTY 24500 CE" → strip strike + CE/PE
    return sym.replace(/\s+\d+(?:\.\d+)?\s+(CE|PE)\s*$/i, '').trim().toUpperCase();
  }

  // Futures: strip " FUT" and anything after (month/expiry label)
  if (instrument.instrumentType === 'FUT' || sym.includes(' FUT')) {
    return sym.replace(/\s+FUT.*$/i, '').trim().toUpperCase();
  }

  // Index symbols can have a trailing number suffix that is not part of the
  // Angel One searchScrip name:  "NIFTY 50" → "NIFTY", "SENSEX 30" → "SENSEX"
  // Strip a trailing space + pure-number word (e.g. " 50", " 30", " 100").
  return sym.replace(/\s+\d+$/, '').trim().toUpperCase();
}

/**
 * Lot size for option orders — from the instrument master, never hardcoded.
 * For FUT instruments: the futures lot size equals the options lot size.
 * For EQ instruments: lotSize may be 1 (stock) or 50/15/25 etc (index).
 */
function deriveLotSize(instrument: Instrument): number {
  return instrument.lotSize || 1;
}

/**
 * Option exchange for strike order routing.
 * BSE segment (SENSEX) → options trade on BFO.
 * Everything else (NSE, NFO, etc.) → NSE/NFO.
 */
function deriveOptionExchange(instrument: Instrument): string {
  return (instrument.segment === 'BSE' || instrument.exchange === 'BSE') ? 'BSE' : 'NSE';
}

// ─── IST-aware fallback expiry generator ─────────────────────────────────────
/**
 * Generic fallback expiry calculation when the backend returns nothing.
 * Uses UTC+5:30 for correct IST day-of-week.
 * For indices (lotSize > 1): weekly expiries starting next Thursday.
 * For stocks (lotSize === 1): monthly last-Thursday (3 months).
 * This is a last-resort fallback — real expiries come from getExpiries().
 */
function buildFallbackExpiries(underlying: string, lotSize: number): string[] {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  const fallback: string[] = [];

  if (lotSize > 1) {
    // Index-style: weekly — use Thursday as generic fallback (real day from backend)
    for (let i = 0; i < 6; i++) {
      const d = new Date(nowIST);
      const daysUntil = (4 - d.getUTCDay() + 7) % 7 || 7; // 4 = Thursday
      d.setUTCDate(d.getUTCDate() + daysUntil + i * 7);
      fallback.push(d.toISOString().split('T')[0]);
    }
  } else {
    // Stock-style: monthly last Thursday
    for (let i = 0; i < 3; i++) {
      // Last day of month i+1 ahead (IST-based)
      const y = nowIST.getUTCFullYear();
      const m = nowIST.getUTCMonth() + i + 1; // +1 for next month
      const lastDay = new Date(Date.UTC(y, m + 1, 0)); // day 0 of month+2 = last of month+1
      while (lastDay.getUTCDay() !== 4) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
      fallback.push(lastDay.toISOString().split('T')[0]);
    }
  }
  return fallback;
}

// ─── Memoized strike row ──────────────────────────────────────────────────────
/**
 * Extracted from the inline .map() so React.memo can bail out of re-renders.
 *
 * Re-renders only when one of its specific props changes:
 *   - The chain entry itself changes (new chain load or expiry switch)
 *   - Its ATM / ITM status changes (spot price crosses a strike band boundary)
 *   - The selected contract changes to/from this strike
 *   - The OI/Volume bar percentages change (maxOi / maxVol shift)
 *   - viewMode changes (BOTH / CE / PE toggle)
 *
 * Spot price ticks that don't cross a strike boundary, and ticks for unrelated
 * tokens, will NOT cause any StrikeRow to re-render.
 */
interface StrikeRowProps {
  e: OptionChainEntry;
  isAtm: boolean;
  isItmCall: boolean;
  isItmPut: boolean;
  isSelCE: boolean;
  isSelPE: boolean;
  callOiPct: number;
  putOiPct: number;
  callVolPct: number;
  putVolPct: number;
  viewMode: 'both' | 'ce' | 'pe';
  onStrikeClick: (strike: number, type: 'CE' | 'PE', ltp?: number, token?: string) => void;
  setOrderForm: (form: { side: 'BUY' | 'SELL' }) => void;
  // IV from optionsWorker (0 = not yet computed or unavailable)
  callIv: number;
  putIv: number;
  // P5.3: tick direction for LTP flash (1 = up, -1 = down, 0 = unchanged)
  callTickDir: number;
  putTickDir: number;
}

// ─── P5.3 formatting helpers (module-level, pure) ───────────────────────────
/** Format a signed change value with sign; '—' when unavailable. */
function formatChange(value: number, has: boolean | undefined): string {
  if (!has) return '—';
  const s = value > 0 ? '+' : '';
  return `${s}${value.toFixed(2)}`;
}
/** Format a signed change percentage; '—' when unavailable. */
function formatChangePct(value: number, has: boolean | undefined): string {
  if (!has) return '—';
  const s = value > 0 ? '+' : '';
  return `${s}${value.toFixed(2)}%`;
}
/** Bid/Ask display — '—' when not a positive number (never fabricated). */
function formatQuote(value: number | undefined): string {
  return value && value > 0 ? formatPrice(value) : '—';
}
/** Spread display — only when hasSpread; else '—'. */
function formatSpread(value: number | undefined, has: boolean | undefined): string {
  return has && value && value > 0 ? value.toFixed(2) : '—';
}

/**
 * P5.3 — Compute tick direction for a strike's CE/PE LTP vs the previous render.
 * Returns 1 (up), -1 (down), or 0 (unchanged / no prior value). Only a genuine
 * change from a positive previous value produces a nonzero direction, so the
 * first render and market-closed static data do not flash.
 */
function computeTickDirs(
  e: OptionChainEntry,
  prev: Map<string, { c: number; p: number }>,
): { callTickDir: number; putTickDir: number } {
  const key = String(e.strike);
  const prevVals = prev.get(key);
  let callTickDir = 0;
  let putTickDir = 0;
  if (prevVals) {
    if (prevVals.c > 0 && e.callLtp > 0 && e.callLtp !== prevVals.c) {
      callTickDir = e.callLtp > prevVals.c ? 1 : -1;
    }
    if (prevVals.p > 0 && e.putLtp > 0 && e.putLtp !== prevVals.p) {
      putTickDir = e.putLtp > prevVals.p ? 1 : -1;
    }
  }
  return { callTickDir, putTickDir };
}

const StrikeRow = memo(function StrikeRow({
  e,
  isAtm,
  isItmCall,
  isItmPut,
  isSelCE,
  isSelPE,
  callOiPct,
  putOiPct,
  callVolPct,
  putVolPct,
  viewMode,
  onStrikeClick,
  setOrderForm,
  callIv,
  putIv,
  callTickDir,
  putTickDir,
}: StrikeRowProps) {
  const callOiChg = e.callOiChange || 0;
  const putOiChg  = e.putOiChange  || 0;

  // Prefer server-supplied IV (Dhan); fall back to worker-computed IV
  const displayCallIv = e.callIv > 0 ? e.callIv : callIv;
  const displayPutIv  = e.putIv  > 0 ? e.putIv  : putIv;

  // P5.3: LTP flash class — brief bg tint on tick up/down. The `key`-less
  // approach relies on callTickDir changing; reduced-motion users get the
  // static color only (animation is defined with motion-safe in index.css).
  const callFlash = callTickDir > 0 ? 'fw-tick-up' : callTickDir < 0 ? 'fw-tick-down' : '';
  const putFlash  = putTickDir  > 0 ? 'fw-tick-up' : putTickDir  < 0 ? 'fw-tick-down' : '';

  return (
    <tr
      className={cn(
        'border-b border-fw-border/20 transition-colors group',
        isAtm
          ? 'bg-fw-accent/[0.08] border-y-2 border-fw-accent/50'
          : isItmCall && viewMode !== 'pe'
            ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'
            : isItmPut && viewMode !== 'ce'
              ? 'bg-red-500/[0.04] hover:bg-red-500/[0.07]'
              : 'hover:bg-fw-hover/30',
      )}
    >
      {/* ── CALL SIDE ── */}
      {viewMode !== 'pe' && (
        <>
          {/* B/S */}
          <td className="px-1 py-1 text-center">
            <div className="flex gap-0.5 justify-center">
              <button
                onClick={() => { onStrikeClick(e.strike, 'CE', e.callLtp, e.callToken); setOrderForm({ side: 'BUY' }); }}
                className="text-[9px] text-emerald-300 font-bold bg-emerald-700/30 hover:bg-emerald-600/50 px-1 py-0.5 rounded transition-colors leading-none"
              >B</button>
              <button
                onClick={() => { onStrikeClick(e.strike, 'CE', e.callLtp, e.callToken); setOrderForm({ side: 'SELL' }); }}
                className="text-[9px] text-red-300 font-bold bg-red-700/30 hover:bg-red-600/50 px-1 py-0.5 rounded transition-colors leading-none"
              >S</button>
            </div>
          </td>
          {/* OI with bar — green gradient */}
          <td
            className="px-1 py-1 text-right font-mono tabular-nums relative overflow-hidden"
            style={{
              background: callOiPct > 0
                ? `linear-gradient(to right, transparent ${100 - callOiPct}%, rgba(0,220,150,0.22) ${100 - callOiPct}%)`
                : undefined,
            }}
          >
            <span className={cn('relative z-10 block', isSelCE ? 'text-fw-accent' : 'text-fw-text')}>{formatNumber(e.callOi || 0)}</span>
          </td>
          {/* OI Change */}
          <td className="px-1 py-1 text-right font-mono tabular-nums">
            <span className={cn('font-semibold block', callOiChg > 0 ? 'text-emerald-400' : callOiChg < 0 ? 'text-red-400' : 'text-fw-text-muted')}>
              {callOiChg !== 0 ? (callOiChg > 0 ? '+' : '') + callOiChg.toFixed(1) + '%' : '—'}
            </span>
          </td>
          {/* Volume — green bar */}
          <td
            className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary"
            style={{
              background: callVolPct > 0
                ? `linear-gradient(to right, transparent ${100 - callVolPct}%, rgba(0,220,150,0.13) ${100 - callVolPct}%)`
                : undefined,
            }}
          >
            {formatNumber(e.callVolume || 0)}
          </td>
          {/* CALL IV */}
          <td className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary">
            {displayCallIv > 0 ? displayCallIv.toFixed(1) + '%' : '—'}
          </td>
          {/* CALL BID / ASK (qty + spread in tooltip) */}
          <td
            className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary leading-tight"
            title={`Bid ${formatQuote(e.callBidPrice)} (qty ${formatNumber(e.callBidQty || 0)}) · Ask ${formatQuote(e.callAskPrice)} (qty ${formatNumber(e.callAskQty || 0)}) · Spread ${formatSpread(e.callSpread, e.callHasSpread)}`}
          >
            <span className="block text-emerald-400/80">{formatQuote(e.callBidPrice)}</span>
            <span className="block text-red-400/80">{formatQuote(e.callAskPrice)}</span>
          </td>
          {/* CALL LTP + change% */}
          <td
            className={cn(
              'px-1 py-1 text-right font-mono tabular-nums font-bold cursor-pointer hover:underline leading-tight',
              callFlash,
              isSelCE ? 'text-fw-accent' : e.callLtp > 0 ? 'text-emerald-400' : 'text-fw-text-muted',
            )}
            onClick={() => onStrikeClick(e.strike, 'CE', e.callLtp, e.callToken)}
            title={e.callHasChange ? `Change: ${formatChange(e.callChange || 0, e.callHasChange)}` : undefined}
          >
            <span className="block">{e.callLtp > 0 ? formatPrice(e.callLtp) : '—'}</span>
            <span className={cn(
              'block text-[8px] font-semibold',
              !e.callHasChange ? 'text-fw-text-muted' : (e.callChangePct || 0) > 0 ? 'text-emerald-400/80' : (e.callChangePct || 0) < 0 ? 'text-red-400/80' : 'text-fw-text-muted',
            )}>
              {formatChangePct(e.callChangePct || 0, e.callHasChange)}
            </span>
          </td>
        </>
      )}

      {/* ── STRIKE CENTER ── */}
      <td className={cn(
        'px-1 py-1 text-center font-mono font-bold tabular-nums border-x border-fw-border/40 bg-fw-surface-2 whitespace-nowrap overflow-hidden',
        isAtm ? 'text-fw-accent text-[11px]' : 'text-fw-text text-[10px]',
      )}>
        {isAtm && (
          <div className="text-[7px] font-extrabold tracking-widest text-fw-accent/80 uppercase leading-none mb-[2px]">ATM</div>
        )}
        {formatPrice(e.strike)}
      </td>

      {/* ── PUT SIDE ── */}
      {viewMode !== 'ce' && (
        <>
          {/* PUT LTP + change% */}
          <td
            className={cn(
              'px-1 py-1 text-left font-mono tabular-nums font-bold cursor-pointer hover:underline leading-tight',
              putFlash,
              isSelPE ? 'text-fw-accent' : e.putLtp > 0 ? 'text-red-400' : 'text-fw-text-muted',
            )}
            onClick={() => onStrikeClick(e.strike, 'PE', e.putLtp, e.putToken)}
            title={e.putHasChange ? `Change: ${formatChange(e.putChange || 0, e.putHasChange)}` : undefined}
          >
            <span className="block">{e.putLtp > 0 ? formatPrice(e.putLtp) : '—'}</span>
            <span className={cn(
              'block text-[8px] font-semibold',
              !e.putHasChange ? 'text-fw-text-muted' : (e.putChangePct || 0) > 0 ? 'text-emerald-400/80' : (e.putChangePct || 0) < 0 ? 'text-red-400/80' : 'text-fw-text-muted',
            )}>
              {formatChangePct(e.putChangePct || 0, e.putHasChange)}
            </span>
          </td>
          {/* PUT BID / ASK (qty + spread in tooltip) */}
          <td
            className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary leading-tight"
            title={`Bid ${formatQuote(e.putBidPrice)} (qty ${formatNumber(e.putBidQty || 0)}) · Ask ${formatQuote(e.putAskPrice)} (qty ${formatNumber(e.putAskQty || 0)}) · Spread ${formatSpread(e.putSpread, e.putHasSpread)}`}
          >
            <span className="block text-emerald-400/80">{formatQuote(e.putBidPrice)}</span>
            <span className="block text-red-400/80">{formatQuote(e.putAskPrice)}</span>
          </td>
          {/* PUT IV */}
          <td className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary">
            {displayPutIv > 0 ? displayPutIv.toFixed(1) + '%' : '—'}
          </td>
          {/* Volume — red bar */}
          <td
            className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary"
            style={{
              background: putVolPct > 0
                ? `linear-gradient(to left, transparent ${100 - putVolPct}%, rgba(255,70,90,0.13) ${100 - putVolPct}%)`
                : undefined,
            }}
          >
            {formatNumber(e.putVolume || 0)}
          </td>
          {/* OI Change */}
          <td className="px-1 py-1 text-left font-mono tabular-nums">
            <span className={cn('font-semibold block', putOiChg > 0 ? 'text-emerald-400' : putOiChg < 0 ? 'text-red-400' : 'text-fw-text-muted')}>
              {putOiChg !== 0 ? (putOiChg > 0 ? '+' : '') + putOiChg.toFixed(1) + '%' : '—'}
            </span>
          </td>
          {/* OI with bar — red gradient */}
          <td
            className="px-1 py-1 text-left font-mono tabular-nums relative overflow-hidden"
            style={{
              background: putOiPct > 0
                ? `linear-gradient(to left, transparent ${100 - putOiPct}%, rgba(255,70,90,0.22) ${100 - putOiPct}%)`
                : undefined,
            }}
          >
            <span className={cn('relative z-10 block', isSelPE ? 'text-fw-accent' : 'text-fw-text')}>{formatNumber(e.putOi || 0)}</span>
          </td>
          {/* B/S */}
          <td className="px-1 py-1 text-center">
            <div className="flex gap-0.5 justify-center">
              <button
                onClick={() => { onStrikeClick(e.strike, 'PE', e.putLtp, e.putToken); setOrderForm({ side: 'BUY' }); }}
                className="text-[9px] text-emerald-300 font-bold bg-emerald-700/30 hover:bg-emerald-600/50 px-1 py-0.5 rounded transition-colors leading-none"
              >B</button>
              <button
                onClick={() => { onStrikeClick(e.strike, 'PE', e.putLtp, e.putToken); setOrderForm({ side: 'SELL' }); }}
                className="text-[9px] text-red-300 font-bold bg-red-700/30 hover:bg-red-600/50 px-1 py-0.5 rounded transition-colors leading-none"
              >S</button>
            </div>
          </td>
        </>
      )}
    </tr>
  );
});

// ─── Component ────────────────────────────────────────────────────────────────

export function OptionChainModal() {
  const { activeSymbol, setActiveSymbol } = useAppStore();
  const { setOrderForm, setSelectedContract, selectedContract } = useTradingStore();
  const quotes = useMarketStore((s) => s.quotes);

  // ── Derived from activeSymbol — recalculated on every render, no stale state
  const underlying = useMemo(() =>
    activeSymbol ? deriveUnderlying(activeSymbol) : '', [activeSymbol]);
  // effectiveLotSize: use the scrip-master value when available; fall back to
  // the instrument-master value (correct for indices) while the API call is in flight.
  const baseLotSize = useMemo(() =>
    activeSymbol ? deriveLotSize(activeSymbol) : 1, [activeSymbol]);
  // Resolved lot size from the Dhan scrip master — overrides the activeSymbol default
  // (which can be 1 for stock watchlist entries). Updated each time the underlying changes.
  const [resolvedLotSize, setResolvedLotSize] = useState<number>(0); // 0 = not yet fetched
  const lotSize = resolvedLotSize > 1 ? resolvedLotSize : baseLotSize;
  const optExchange = useMemo(() =>
    activeSymbol ? deriveOptionExchange(activeSymbol) : 'NSE', [activeSymbol]);

  // Is this instrument segment known to be unsupported?
  const segmentUnsupported = useMemo(() =>
    activeSymbol ? UNSUPPORTED_SEGMENTS.has(activeSymbol.segment) : false,
  [activeSymbol]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [status, setStatus] = useState<
    | { type: 'idle' }
    | { type: 'loading'; label: string; attempt: number }
    | { type: 'error'; message: string }
    | { type: 'unsupported'; instrument: string }
    | { type: 'ready' }
  >({ type: 'idle' });

  // ── Control refs ──────────────────────────────────────────────────────────
  const isMountedRef     = useRef(true);
  // Monotonic session counter — incremented on every underlying change.
  // Every async callback checks session === sessionRef.current before touching state.
  const sessionRef       = useRef(0);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Budget timer: one wall-clock deadline per load attempt cycle.
  // NOT reset by retries.  Reset only by Retry Now or symbol change.
  const budgetTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether a fetch is in flight (prevents simultaneous requests).
  const fetchInFlightRef = useRef(false);
  // Records wall-clock start of the current budget period.
  const budgetStartRef   = useRef(0);

  // ── Options worker ────────────────────────────────────────────────────────
  // Worker computes BS greeks + max pain off the main thread.
  // IV result: map keyed "strike:CE" / "strike:PE" → IV percentage
  const workerRef = useRef<Worker | null>(null);
  const [workerIv, setWorkerIv] = useState<Map<string, number>>(new Map());
  const [maxPainStrike, setMaxPainStrike] = useState<number>(0);

  // Track the currently WS-subscribed option token so we can unsubscribe
  // when the trader picks a different strike (prevents subscription leaks).
  const activeOptionTokenRef = useRef<string | null>(null);

  // P5.3: previous LTP per strike (keyed by strike string) for tick-direction
  // flash. A ref (not state) so updating it never causes a re-render.
  const prevLtpRef = useRef<Map<string, { c: number; p: number }>>(new Map());

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    // Instantiate the options worker once on mount
    try {
      const w = new Worker(
        new URL('../workers/optionsWorker.ts', import.meta.url),
        { type: 'module' },
      );
      w.onmessage = (evt) => {
        if (!isMountedRef.current) return;
        const { type } = evt.data;
        if (type === 'greeks-result') {
          const map = new Map<string, number>();
          for (const r of evt.data.results as Array<{ strike: number; type: 'CE' | 'PE'; iv: number }>) {
            map.set(`${r.strike}:${r.type}`, r.iv);
          }
          setWorkerIv(map);
        } else if (type === 'maxpain-result') {
          setMaxPainStrike(evt.data.strike as number);
        }
      };
      workerRef.current = w;
    } catch {
      // Web Worker unavailable in this environment (e.g. SSR) — silently skip
    }

    return () => {
      isMountedRef.current = false;
      clearAll();
      workerRef.current?.terminate();
      workerRef.current = null;
      // Unsubscribe any active option token subscription on unmount
      if (activeOptionTokenRef.current) {
        wsService.unsubscribe([activeOptionTokenRef.current]);
        activeOptionTokenRef.current = null;
      }
    };
  }, []);

  // ── Spot price — use active symbol's token directly ───────────────────────
  const spotPrice = useMemo(() => {
    if (!activeSymbol) return 0;
    const q = quotes[activeSymbol.token];
    return q?.ltp || 0;
  }, [activeSymbol?.token, quotes]);

  // ── ATM-filtered chain ────────────────────────────────────────────────────
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

  // ── Timer management ──────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    if (retryTimerRef.current)  { clearTimeout(retryTimerRef.current);  retryTimerRef.current  = null; }
    if (budgetTimerRef.current) { clearTimeout(budgetTimerRef.current); budgetTimerRef.current = null; }
    fetchInFlightRef.current = false;
  }, []);

  const startBudget = useCallback((session: number) => {
    if (budgetTimerRef.current) clearTimeout(budgetTimerRef.current);
    budgetStartRef.current = Date.now();
    budgetTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      fetchInFlightRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setStatus({ type: 'error', message: 'Option chain data unavailable. Market may be closed or data service is starting up.' });
    }, TOTAL_BUDGET_MS);
  }, []);

  const budgetExpired = useCallback(() =>
    Date.now() - budgetStartRef.current >= TOTAL_BUDGET_MS, []);

  // ── Core chain loader ─────────────────────────────────────────────────────
  const loadChain = useCallback(async (
    sym: string,
    expiry: string,
    attempt: number,
    session: number,
  ) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;
    if (fetchInFlightRef.current) return;
    if (budgetExpired()) return; // budget already gone

    // Check module-level chain cache
    const ck = `${sym}:${expiry}`;
    const cc = _chainCache.get(ck);
    if (cc && (Date.now() - cc.cachedAt) < CHAIN_CACHE_TTL) {
      setChain(cc.chain);
      setStatus({ type: 'ready' });
      if (budgetTimerRef.current) { clearTimeout(budgetTimerRef.current); budgetTimerRef.current = null; }
      return;
    }

    fetchInFlightRef.current = true;
    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt });

    try {
      const data = await getOptionChain(sym, expiry);

      fetchInFlightRef.current = false;
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      if (budgetExpired()) return;

      if (data && data.length > 0) {
        _chainCache.set(ck, { chain: data, cachedAt: Date.now() });
        setChain(data);
        setStatus({ type: 'ready' });
        if (budgetTimerRef.current) { clearTimeout(budgetTimerRef.current); budgetTimerRef.current = null; }

        // Dispatch greeks + max pain to worker.
        // Worker uses LTP-based Newton-Raphson IV when chain data has no IV (Angel path).
        // When Dhan supplies IV the worker result is used as fallback only (server IV takes priority).
        if (workerRef.current && spotPrice > 0 && selectedExpiry) {
          const msToExpiry = new Date(selectedExpiry).getTime() - Date.now();
          const daysToExpiry = Math.max(msToExpiry / 86_400_000, 0.001);
          const strikes = data.flatMap((e) => [
            { strike: e.strike, type: 'CE' as const, ltp: e.callLtp, iv: e.callIv || undefined },
            { strike: e.strike, type: 'PE' as const, ltp: e.putLtp,  iv: e.putIv  || undefined },
          ]).filter((s) => s.ltp > 0);
          workerRef.current.postMessage({
            type: 'greeks',
            strikes,
            spot: spotPrice,
            riskFreeRate: 0.065, // RBI repo rate approximation
            daysToExpiry,
          });
          workerRef.current.postMessage({
            type: 'maxpain',
            chain: data.map((e) => ({ strike: e.strike, callOi: e.callOi, putOi: e.putOi })),
          });
        }
        return;
      }

      // Empty → retryable (503 is handled via error path; empty means chain not yet ready)
      scheduleRetry(sym, expiry, attempt, session);
    } catch (err: any) {
      fetchInFlightRef.current = false;
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      if (budgetExpired()) return;
      scheduleRetry(sym, expiry, attempt, session);
    }
  }, [budgetExpired]);

  const scheduleRetry = useCallback((
    sym: string,
    expiry: string,
    attempt: number,
    session: number,
  ) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;
    if (budgetExpired()) return; // let the budget timer handle the error state

    if (attempt >= MAX_AUTO_RETRIES) {
      // Out of retries within budget — show error (budget timer may fire first anyway)
      setStatus({ type: 'error', message: 'Option chain data unavailable. Market may be closed or data service is starting up.' });
      if (budgetTimerRef.current) { clearTimeout(budgetTimerRef.current); budgetTimerRef.current = null; }
      return;
    }

    const delay = retryDelay(attempt);
    retryTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      if (budgetExpired()) return;
      loadChain(sym, expiry, attempt + 1, session);
    }, delay);

    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt: attempt + 1 });
  }, [budgetExpired, loadChain]);

  // ── Expiry discovery + chain kick-off ─────────────────────────────────────
  const startLoad = useCallback(async (sym: string, session: number) => {
    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;

    // Start the wall-clock budget NOW — everything must fit inside it
    startBudget(session);

    let expiryList: string[] = [];

    // Check module-level expiry cache first
    const ec = _expiryCache.get(sym);
    if (ec && (Date.now() - ec.cachedAt) < EXPIRY_CACHE_TTL) {
      expiryList = ec.expiries;
    } else {
      try {
        const data = await getExpiries(sym);
        if (!isMountedRef.current) return;
        if (session !== sessionRef.current) return;

        // The /market/expiries endpoint ALWAYS returns something (fallback in api.js).
        // The optionChainService expiries come from real searchScrip discovery —
        // those are the real ones.  The instrumentService fallback also returns dates.
        // We use whatever comes back; capability is proven by getOptionChain result.
        if (data && data.length > 0) {
          expiryList = data;
          _expiryCache.set(sym, { expiries: data, cachedAt: Date.now() });
        }
      } catch {
        // fall through to client-side fallback
      }
    }

    if (!isMountedRef.current) return;
    if (session !== sessionRef.current) return;
    if (budgetExpired()) return;

    if (expiryList.length === 0) {
      // Last-resort fallback using IST-aware calculation
      expiryList = buildFallbackExpiries(sym, lotSize);
    }

    setExpiries(expiryList);
    const firstExpiry = expiryList[0];

    // ── Lot size from scrip master (fire-and-forget, non-blocking) ────────
    // Fetched after expiries so we don't delay the chain load. The resolved
    // lot size will be available by the time the trader clicks a strike.
    // Falls back silently to the instrument-master value if the API fails.
    getLotSize(sym).then((res) => {
      if (!isMountedRef.current) return;
      if (session !== sessionRef.current) return;
      if (res?.lotSize && res.lotSize > 1) {
        setResolvedLotSize(res.lotSize);
      }
    }).catch(() => { /* non-blocking — instrument master value is the fallback */ });
    setSelectedExpiry(firstExpiry);

    // Load chain — passes sym + expiry explicitly, no closure-captured stale values
    loadChain(sym, firstExpiry, 0, session);
  }, [startBudget, budgetExpired, loadChain, lotSize]);

  // ── Trigger: underlying changes ───────────────────────────────────────────
  useEffect(() => {
    if (!activeSymbol) return;

    const session = ++sessionRef.current;
    clearAll();
    setChain([]);
    setExpiries([]);
    setSelectedExpiry('');
    setWorkerIv(new Map());
    setMaxPainStrike(0);
    setResolvedLotSize(0); // will be refetched below
    prevLtpRef.current.clear(); // P5.3: reset tick baseline on underlying change

    // Unsubscribe previous option token when underlying changes
    if (activeOptionTokenRef.current) {
      wsService.unsubscribe([activeOptionTokenRef.current]);
      activeOptionTokenRef.current = null;
    }

    if (segmentUnsupported) {
      setStatus({ type: 'unsupported', instrument: activeSymbol.symbol });
      return;
    }

    setStatus({ type: 'loading', label: underlying, attempt: 0 });
    startLoad(underlying, session);
  }, [underlying, segmentUnsupported]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-refresh: refresh chain every 30s during market hours ───────────
  // Fires only when a chain is already showing (status === ready).
  // Uses the existing loadChain path — the 20s frontend cache absorbs extra calls
  // so no extra API requests happen unless the cache has expired.
  // Clears on underlying change, expiry change, unmount.
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (status.type !== 'ready' || !underlying || !selectedExpiry) return;

    autoRefreshRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      if (!isMarketOpen()) return; // no-op outside trading hours
      if (fetchInFlightRef.current) return; // another request already running
      const session = sessionRef.current;
      // Expire the cache entry so loadChain fetches fresh data
      const ck = `${underlying}:${selectedExpiry}`;
      _chainCache.delete(ck);
      loadChain(underlying, selectedExpiry, 0, session);
    }, 30_000); // every 30 seconds

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [status.type, underlying, selectedExpiry, loadChain]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── P5.3: snapshot LTPs after each chain update for next-render tick flash ──
  // Runs after the DOM commits, so StrikeRow rendered with the OLD baseline
  // (the flash) and the NEXT chain update compares against these fresh values.
  useEffect(() => {
    if (chain.length === 0) return;
    const next = new Map<string, { c: number; p: number }>();
    for (const e of chain) {
      next.set(String(e.strike), { c: e.callLtp || 0, p: e.putLtp || 0 });
    }
    prevLtpRef.current = next;
  }, [chain]);

  // ── User actions ──────────────────────────────────────────────────────────
  const handleExpiryChange = useCallback((expiry: string) => {
    if (!activeSymbol || segmentUnsupported) return;
    const session = ++sessionRef.current;
    clearAll();
    setChain([]);
    setSelectedExpiry(expiry);
    setWorkerIv(new Map());
    setMaxPainStrike(0);
    prevLtpRef.current.clear(); // P5.3: reset tick baseline on expiry change
    setStatus({ type: 'loading', label: `${underlying} · ${expiry}`, attempt: 0 });
    startBudget(session);
    loadChain(underlying, expiry, 0, session);
  }, [underlying, activeSymbol, segmentUnsupported, clearAll, startBudget, loadChain]);

  const handleManualRetry = useCallback(() => {
    if (!activeSymbol) return;
    const sym    = underlying;
    const expiry = selectedExpiry;
    const session = ++sessionRef.current;
    clearAll();
    setChain([]);
    setStatus({ type: 'loading', label: `${sym} · ${expiry}`, attempt: 0 });
    if (expiry) {
      startBudget(session);
      loadChain(sym, expiry, 0, session);
    } else {
      startLoad(sym, session);
    }
  }, [underlying, selectedExpiry, activeSymbol, clearAll, startBudget, loadChain, startLoad]);

  const handleStrikeClick = useCallback((strike: number, type: 'CE' | 'PE', ltp?: number, realToken?: string) => {
    if (!activeSymbol) return;
    // Use real broker token from chain data if available; fall back to synthetic placeholder
    const token = realToken || `${underlying}_${strike}_${type}`;

    // Seed the market store with the option chain LTP so the UI shows a price immediately
    // (before live WebSocket ticks arrive). Prevents "0.00" display in order panel.
    if (ltp && ltp > 0) {
      useMarketStore.getState().updateQuote(token, {
        ltp,
        symbol: `${underlying} ${strike} ${type}`,
        exchange: optExchange,
        timestamp: Date.now(),
      });
    }

    // ── Subscribe the selected option token to the live WS feed ─────────
    // The Dhan LTP poller picks up ALL subscribed tokens every 3s.
    // Pass segment hint 'NFO' (or 'BFO' for BSE-based SENSEX options) so the
    // server routes the subscription to the correct Dhan segment (NSE_FNO / BSE_FNO).
    if (realToken && /^\d+$/.test(realToken)) {
      const prevToken = activeOptionTokenRef.current;
      if (prevToken && prevToken !== realToken) {
        // Unsubscribe previous option token to prevent unbounded subscription growth.
        wsService.unsubscribe([prevToken]);
      }
      const segHint = optExchange === 'BSE' ? 'BFO' : 'NFO';
      wsService.subscribe([realToken], { [realToken]: segHint });
      activeOptionTokenRef.current = realToken;
    }

    setActiveSymbol({
      token,
      symbol: `${underlying} ${strike} ${type}`,
      name: `${underlying} ${selectedExpiry} ${strike} ${type}`,
      // Use the correct F&O segment for each exchange:
      //   NSE underlyings (NIFTY, BANKNIFTY, stocks) → NFO
      //   BSE underlyings (SENSEX) → BFO
      // optExchange is already derived from the underlying's activeSymbol.segment/exchange.
      segment: optExchange === 'BSE' ? 'BFO' : 'NFO',
      instrumentType: type,
      exchange: optExchange,
      lotSize,
      tickSize: 0.05,
      expiry: selectedExpiry,
      strike,
      optionType: type,
    });
    setSelectedContract({
      symbol: `${underlying} ${strike} ${type}`,
      token,
      underlying,
      strike,
      optionType: type,
      expiry: selectedExpiry,
      lotSize,
      ltp: ltp || undefined,
    });
    if (ltp && ltp > 0) setOrderForm({ price: ltp, orderType: 'LIMIT', qty: lotSize, productType: 'NRML', symbol: `${underlying} ${strike} ${type}`, token });
    else setOrderForm({ qty: lotSize, price: 0, productType: 'NRML', symbol: `${underlying} ${strike} ${type}`, token });
  }, [underlying, selectedExpiry, lotSize, optExchange, activeSymbol, setActiveSymbol, setSelectedContract, setOrderForm]);

  // ── Auto-refresh interval ref ────────────────────────────────────────────
  // Refreshes the chain every 30s while it is visible and market is open.
  // Does NOT reset the session — uses the current underlying/expiry.
  // Respects the existing cache TTL: if cache is still fresh it returns instantly.
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** IST market-hours check — true between 09:15 and 15:35 on weekdays */
  const isMarketOpen = (): boolean => {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const now = new Date(Date.now() + IST_OFFSET_MS);
    const day = now.getUTCDay();   // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    return mins >= 555 && mins <= 935; // 09:15 – 15:35 IST
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const isLoading = status.type === 'loading' || status.type === 'idle';
  const errorMessage = status.type === 'error' ? status.message : null;
  const attemptLabel = status.type === 'loading' && status.attempt > 0
    ? ` (${status.attempt}/${MAX_AUTO_RETRIES})`
    : '';

  // View mode: CE only, PE only, or both
  const [viewMode, setViewMode] = useState<'both' | 'ce' | 'pe'>('both');

  // OI + Volume max for proportional bars
  const { maxOi, maxVol } = useMemo(() => {
    let maxOi = 0, maxVol = 0;
    for (const e of filteredChain) {
      if (e.callOi > maxOi) maxOi = e.callOi;
      if (e.putOi > maxOi) maxOi = e.putOi;
      if (e.callVolume > maxVol) maxVol = e.callVolume;
      if (e.putVolume > maxVol) maxVol = e.putVolume;
    }
    return { maxOi: maxOi || 1, maxVol: maxVol || 1 };
  }, [filteredChain]);

  // ATM strike value
  const atmStrike = useMemo(() => {
    if (filteredChain.length === 0 || spotPrice === 0) return 0;
    let closest = filteredChain[0]?.strike || 0;
    let minDiff = Infinity;
    for (const e of filteredChain) {
      const d = Math.abs(e.strike - spotPrice);
      if (d < minDiff) { minDiff = d; closest = e.strike; }
    }
    return closest;
  }, [filteredChain, spotPrice]);

  // Format expiry date for display
  const formatExpiry = (exp: string) => {
    try {
      const d = new Date(exp);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase();
    } catch { return exp; }
  };

  // ── Data-state pill ───────────────────────────────────────────────────────
  // Derives the canonical feed state to display in the header.
  // Rules:
  //   LOADING        — chain is being fetched (initial or retry)
  //   LIVE           — chain loaded AND spotPrice is fresh (< 5s old)
  //   STALE          — chain loaded BUT spotPrice is 0 or last quote > 5s ago
  //   ERROR          — chain fetch failed after budget expired
  //   DISCONNECTED   — WS is not connected AND no spot price
  //   UNSUPPORTED    — segment cannot have option chain (MCX/CDS)
  //   AUTH_REQUIRED  — placeholder: set when backend explicitly returns 401
  const feedStatePill = useMemo((): {
    label: string;
    color: string;
    dot?: string;
  } => {
    if (status.type === 'unsupported') return { label: 'N/A', color: 'text-fw-text-muted', dot: 'bg-fw-border' };
    if (status.type === 'loading' || status.type === 'idle') return { label: 'LOADING', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
    if (status.type === 'error') {
      const msg = (status as any).message || '';
      if (msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('401')) {
        return { label: 'AUTH ERROR', color: 'text-red-400', dot: 'bg-red-400' };
      }
      return { label: 'ERROR', color: 'text-red-400', dot: 'bg-red-400' };
    }
    if (status.type === 'ready') {
      if (spotPrice > 0) {
        const q = quotes[activeSymbol?.token || ''];
        const ageMs = q?.timestamp ? Date.now() - q.timestamp : Infinity;
        if (ageMs < 5000) return { label: 'LIVE', color: 'text-emerald-400', dot: 'bg-emerald-400' };
        return { label: 'STALE', color: 'text-amber-400', dot: 'bg-amber-400' };
      }
      // Chain loaded but no spot — could be market closed or WS not connected
      return { label: 'STALE', color: 'text-amber-400', dot: 'bg-amber-400' };
    }
    return { label: 'DISCONNECTED', color: 'text-fw-text-muted', dot: 'bg-fw-border' };
  }, [status, spotPrice, quotes, activeSymbol?.token]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-fw-bg overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border flex-shrink-0 bg-fw-surface">
        <span className="text-[13px] font-bold text-fw-text tracking-wide flex-shrink-0">OPT CHAIN</span>
        {underlying && (
          <>
            <SymbolLogo symbol={underlying} size={18} className="flex-shrink-0" />
            <span className="text-[13px] font-bold text-fw-accent">{underlying}</span>
          </>
        )}
        {expiries.length > 0 && (
          <select
            value={selectedExpiry}
            onChange={(e) => handleExpiryChange(e.target.value)}
            className="bg-fw-bg text-fw-text text-[11px] border border-fw-border rounded px-1.5 py-0.5 font-mono cursor-pointer hover:border-fw-accent/50 transition-colors"
          >
            {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}

        {/* ── Data-state pill ── */}
        {activeSymbol && (
          <div className="flex items-center gap-1 ml-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${feedStatePill.dot || 'bg-fw-border'}`} />
            <span className={`text-[9px] font-bold uppercase tracking-widest ${feedStatePill.color}`}>
              {feedStatePill.label}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Spot price */}
        {spotPrice > 0 && (
          <span className="text-[12px] font-mono font-bold text-emerald-400 tabular-nums flex-shrink-0">
            {formatPrice(spotPrice)}
          </span>
        )}

        {/* Manual refresh button — always visible when chain is loaded */}
        {(status.type === 'ready' || status.type === 'error') && (
          <button
            onClick={handleManualRetry}
            className="p-1 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors flex-shrink-0"
            title="Refresh option chain"
          >
            {/* Reload icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Expiry tabs ── */}
      {expiries.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-fw-border/50 overflow-x-auto scrollbar-none flex-shrink-0 bg-fw-bg">
          {expiries.map((exp) => (
            <button
              key={exp}
              onClick={() => handleExpiryChange(exp)}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap transition-all',
                selectedExpiry === exp
                  ? 'bg-fw-accent text-white'
                  : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/40'
              )}
            >
              {formatExpiry(exp)}
            </button>
          ))}
        </div>
      )}

      {/* ── Controls ── */}
      {status.type === 'ready' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-fw-border/30 flex-shrink-0">
          <div className="flex items-center rounded overflow-hidden border border-fw-border/50">
            {(['both', 'ce', 'pe'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'px-3 py-0.5 text-[11px] font-bold uppercase transition-colors',
                  viewMode === m
                    ? 'bg-fw-accent text-white'
                    : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/30'
                )}
              >
                {m === 'both' ? 'BOTH' : m.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-fw-text-muted ml-2">
            {filteredChain.length} strikes
          </span>
          {atmStrike > 0 && (
            <span className="text-[11px] text-fw-accent font-mono ml-auto">
              ATM: {atmStrike}
            </span>
          )}
          {maxPainStrike > 0 && (
            <span className="text-[11px] text-amber-400 font-mono font-bold" title="Max Pain: strike where option buyers lose the most at expiry">
              MaxPain: {maxPainStrike}
            </span>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">

        {/* No active symbol */}
        {!activeSymbol ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-fw-text-muted">
            <span className="text-[22px]">📊</span>
            <p className="text-[13px]">Select an instrument</p>
            <p className="text-[11px] text-fw-text-muted/60">Click any instrument in the watchlist</p>
          </div>

        ) : status.type === 'unsupported' ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span className="text-[28px]">🔒</span>
            <p className="text-[13px] text-fw-text-secondary font-semibold">Option Chain Not Available</p>
            <p className="text-[12px] text-fw-text-muted max-w-[240px]">
              {activeSymbol?.segment === 'MCX'
                ? 'MCX commodity option chains are not currently supported.'
                : activeSymbol?.segment === 'CDS'
                  ? 'Currency derivative option chains are not currently supported.'
                  : `Option chains are not available for ${status.instrument}.`}
            </p>
          </div>

        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-5 h-5 border-2 border-fw-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-fw-text-secondary font-medium text-[13px]">
              {status.type === 'loading' && status.label ? `Loading ${status.label}` : `Loading ${underlying}…`}
            </p>
            {status.type === 'loading' && status.attempt > 0 && (
              <p className="text-fw-text-muted text-[11px]">Retrying{attemptLabel}</p>
            )}
          </div>

        ) : errorMessage ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span className="text-[28px]">⛓</span>
            <p className="text-[13px] text-fw-text-secondary font-semibold">Option Chain Unavailable</p>
            <p className="text-[12px] text-fw-text-muted max-w-[260px]">{errorMessage}</p>
            <button onClick={handleManualRetry} className="px-4 py-1.5 text-[12px] font-semibold bg-fw-accent text-white rounded hover:brightness-110 transition-all">Retry Now</button>
          </div>

        ) : (
          /* ── Professional Option Chain Table ── */
          <table className="w-full border-collapse table-fixed" style={{ fontSize: '10px' }}>
            <colgroup>
              {viewMode !== 'pe' && (
                <>
                  <col style={{ width: '5%' }} />   {/* B/S */}
                  <col style={{ width: '8%' }} />   {/* OI */}
                  <col style={{ width: '7%' }} />   {/* OI Chg */}
                  <col style={{ width: '7%' }} />   {/* Vol */}
                  <col style={{ width: '6%' }} />   {/* IV */}
                  <col style={{ width: '8%' }} />   {/* Bid/Ask */}
                  <col style={{ width: '9%' }} />   {/* LTP + chg% */}
                </>
              )}
              <col style={{ width: '10%' }} />       {/* STRIKE */}
              {viewMode !== 'ce' && (
                <>
                  <col style={{ width: '9%' }} />   {/* LTP + chg% */}
                  <col style={{ width: '8%' }} />   {/* Bid/Ask */}
                  <col style={{ width: '6%' }} />   {/* IV */}
                  <col style={{ width: '7%' }} />   {/* Vol */}
                  <col style={{ width: '7%' }} />   {/* OI Chg */}
                  <col style={{ width: '8%' }} />   {/* OI */}
                  <col style={{ width: '5%' }} />   {/* B/S */}
                </>
              )}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-fw-surface">
                {viewMode !== 'pe' && (
                  <th colSpan={7} className="py-2 text-center text-[11px] font-bold text-emerald-400 uppercase tracking-widest border-b border-emerald-500/20 bg-emerald-500/[0.04]">
                    CALLS
                  </th>
                )}
                <th className="py-2 text-center text-[12px] font-bold text-fw-text uppercase tracking-widest border-b border-fw-border bg-fw-surface-2 border-x border-fw-border/60">
                  STRIKE
                </th>
                {viewMode !== 'ce' && (
                  <th colSpan={7} className="py-2 text-center text-[11px] font-bold text-red-400 uppercase tracking-widest border-b border-red-500/20 bg-red-500/[0.04]">
                    PUTS
                  </th>
                )}
              </tr>
              <tr className="bg-fw-bg border-b-2 border-fw-border text-[10px] text-fw-text-secondary uppercase font-semibold">
                {viewMode !== 'pe' && (
                  <>
                    <th className="px-1 py-1 text-center">B/S</th>
                    <th className="px-1 py-1 text-right">OI</th>
                    <th className="px-1 py-1 text-right">OI Chg</th>
                    <th className="px-1 py-1 text-right">Vol</th>
                    <th className="px-1 py-1 text-right">IV</th>
                    <th className="px-1 py-1 text-right" title="Bid (top) / Ask (bottom)">Bid/Ask</th>
                    <th className="px-1 py-1 text-right" title="LTP (top) / Change % (bottom)">LTP</th>
                  </>
                )}
                <th className="px-1 py-1 text-center bg-fw-surface-2 border-x border-fw-border/60 text-fw-text">Strike</th>
                {viewMode !== 'ce' && (
                  <>
                    <th className="px-1 py-1 text-left" title="LTP (top) / Change % (bottom)">LTP</th>
                    <th className="px-1 py-1 text-left" title="Bid (top) / Ask (bottom)">Bid/Ask</th>
                    <th className="px-1 py-1 text-left">IV</th>
                    <th className="px-1 py-1 text-left">Vol</th>
                    <th className="px-1 py-1 text-left">OI Chg</th>
                    <th className="px-1 py-1 text-left">OI</th>
                    <th className="px-1 py-1 text-center">B/S</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredChain.map((e) => {
                const isAtm     = e.strike === atmStrike;
                const isItmCall = spotPrice > 0 && e.strike < spotPrice;
                const isItmPut  = spotPrice > 0 && e.strike > spotPrice;
                const isSelCE   = selectedContract?.strike === e.strike && selectedContract?.optionType === 'CE';
                const isSelPE   = selectedContract?.strike === e.strike && selectedContract?.optionType === 'PE';
                const callOiPct  = maxOi  > 0 ? (e.callOi     / maxOi)  * 100 : 0;
                const putOiPct   = maxOi  > 0 ? (e.putOi      / maxOi)  * 100 : 0;
                const callVolPct = maxVol > 0 ? (e.callVolume / maxVol) * 100 : 0;
                const putVolPct  = maxVol > 0 ? (e.putVolume  / maxVol) * 100 : 0;
                // P5.3: tick direction vs the previously rendered LTP for this strike.
                // Computed from a ref map so it never triggers extra renders; only
                // meaningful ticks (nonzero prev + prev !== current) produce a flash.
                const { callTickDir, putTickDir } = computeTickDirs(e, prevLtpRef.current);
                return (
                  <StrikeRow
                    key={e.strike}
                    e={e}
                    isAtm={isAtm}
                    isItmCall={isItmCall}
                    isItmPut={isItmPut}
                    isSelCE={isSelCE}
                    isSelPE={isSelPE}
                    callOiPct={callOiPct}
                    putOiPct={putOiPct}
                    callVolPct={callVolPct}
                    putVolPct={putVolPct}
                    viewMode={viewMode}
                    onStrikeClick={handleStrikeClick}
                    setOrderForm={setOrderForm}
                    callIv={workerIv.get(`${e.strike}:CE`) ?? 0}
                    putIv={workerIv.get(`${e.strike}:PE`) ?? 0}
                    callTickDir={callTickDir}
                    putTickDir={putTickDir}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
