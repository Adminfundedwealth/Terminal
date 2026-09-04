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
import { isCompleteOptionChain } from '@/utils/optionChainValidation';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRIKES_AROUND_ATM = 20;

export type ColumnKey = 'callOi' | 'callOiChange' | 'callVolume' | 'callIv' | 'callLtp' | 'callBid' | 'callAsk' | 'callDelta'
  | 'putDelta' | 'putLtp' | 'putBid' | 'putAsk' | 'putIv' | 'putVolume' | 'putOiChange' | 'putOi';

export const COLUMN_PRESETS: Record<string, ColumnKey[]> = {
  Basic: ['callOi', 'callIv', 'callLtp', 'callBid', 'callAsk', 'callDelta', 'putDelta', 'putBid', 'putAsk', 'putLtp', 'putIv', 'putOi'],
  Trader: ['callOi', 'callOiChange', 'callVolume', 'callIv', 'callLtp', 'callBid', 'callAsk', 'callDelta', 'putDelta', 'putBid', 'putAsk', 'putLtp', 'putIv', 'putVolume', 'putOiChange', 'putOi'],
  Greeks: ['callIv', 'callDelta', 'callLtp', 'putLtp', 'putDelta', 'putIv'],
  'OI Analysis': ['callOi', 'callOiChange', 'callVolume', 'putVolume', 'putOiChange', 'putOi'],
  Full: ['callOi', 'callOiChange', 'callVolume', 'callIv', 'callLtp', 'callBid', 'callAsk', 'callDelta', 'putDelta', 'putBid', 'putAsk', 'putLtp', 'putIv', 'putVolume', 'putOiChange', 'putOi'],
};

const COLUMN_LABELS: Record<ColumnKey, string> = {
  callOi: 'Call OI', callOiChange: 'Call OI Chg', callVolume: 'Call Vol', callIv: 'Call IV', callLtp: 'Call LTP', callBid: 'Call Bid', callAsk: 'Call Ask', callDelta: 'Call Delta',
  putDelta: 'Put Delta', putLtp: 'Put LTP', putBid: 'Put Bid', putAsk: 'Put Ask', putIv: 'Put IV', putVolume: 'Put Vol', putOiChange: 'Put OI Chg', putOi: 'Put OI',
};

const ALL_COLUMN_KEYS = Object.keys(COLUMN_LABELS) as ColumnKey[];

function columnsFor(keys: ColumnKey[]): Record<ColumnKey, boolean> {
  return ALL_COLUMN_KEYS.reduce((result, key) => ({ ...result, [key]: keys.includes(key) }), {} as Record<ColumnKey, boolean>);
}

function uniqueChain(entries: OptionChainEntry[]): OptionChainEntry[] {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (!Number.isFinite(entry.strike) || entry.strike <= 0 || seen.has(entry.strike)) return false;
    seen.add(entry.strike);
    return true;
  }).sort((a, b) => a.strike - b.strike);
}

export function classifyOptionContract(strike: number, spot: number, side: 'CE' | 'PE'): 'ATM' | 'ITM' | 'OTM' | 'UNAVAILABLE' {
  if (!(strike > 0) || !(spot > 0)) return 'UNAVAILABLE';
  if (strike === spot) return 'ATM';
  return side === 'CE' ? (strike < spot ? 'ITM' : 'OTM') : (strike > spot ? 'ITM' : 'OTM');
}

export function centerChainAroundAtm<T extends { strike: number }>(entries: T[], spot: number, range: 5 | 10 | 20 | 'all'): T[] {
  if (range === 'all' || !(spot > 0)) return entries;
  let atmIndex = 0;
  let minDifference = Infinity;
  entries.forEach((entry, index) => {
    const difference = Math.abs(entry.strike - spot);
    if (difference < minDifference) { minDifference = difference; atmIndex = index; }
  });
  return entries.slice(Math.max(0, atmIndex - range), Math.min(entries.length, atmIndex + range + 1));
}

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
  visibleColumns: Record<ColumnKey, boolean>;
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
  visibleColumns,
}: StrikeRowProps) {
  const callOiChg = e.callOiChange || 0;
  const putOiChg  = e.putOiChange  || 0;

  // Prefer server-supplied IV (Dhan); fall back to worker-computed IV
  const displayCallIv = e.callIv > 0 ? e.callIv : callIv;
  const displayPutIv  = e.putIv  > 0 ? e.putIv  : putIv;

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
          {visibleColumns.callOi && <td
            className="px-1 py-1 text-right font-mono tabular-nums relative overflow-hidden"
            style={{
              background: callOiPct > 0
                ? `linear-gradient(to right, transparent ${100 - callOiPct}%, rgba(0,220,150,0.22) ${100 - callOiPct}%)`
                : undefined,
            }}
          >
            <span className={cn('relative z-10 block', isSelCE ? 'text-fw-accent' : 'text-fw-text')}>{formatNumber(e.callOi || 0)}</span>
          </td>}
          {/* OI Change */}
          {visibleColumns.callOiChange && <td className="px-1 py-1 text-right font-mono tabular-nums">
            <span className={cn('font-semibold block', callOiChg > 0 ? 'text-emerald-400' : callOiChg < 0 ? 'text-red-400' : 'text-fw-text-muted')}>
              {callOiChg !== 0 ? (callOiChg > 0 ? '+' : '') + callOiChg.toFixed(1) + '%' : '—'}
            </span>
          </td>}
          {/* Volume — green bar */}
          {visibleColumns.callVolume && <td
            className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary"
            style={{
              background: callVolPct > 0
                ? `linear-gradient(to right, transparent ${100 - callVolPct}%, rgba(0,220,150,0.13) ${100 - callVolPct}%)`
                : undefined,
            }}
          >
            {formatNumber(e.callVolume || 0)}
          </td>}
          {/* CALL IV */}
          {visibleColumns.callIv && <td className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary">
            {displayCallIv > 0 ? displayCallIv.toFixed(1) + '%' : '—'}
          </td>}
          {/* CALL LTP */}
          {visibleColumns.callLtp && <td
            className={cn(
              'px-1 py-1 text-right font-mono tabular-nums font-bold cursor-pointer hover:underline',
              isSelCE ? 'text-fw-accent' : e.callLtp > 0 ? 'text-emerald-400' : 'text-fw-text-muted',
            )}
            onClick={() => onStrikeClick(e.strike, 'CE', e.callLtp, e.callToken)}
          >
            {e.callLtp > 0 ? formatPrice(e.callLtp) : '—'}
          </td>}
          {visibleColumns.callBid && <td className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary">{e.callBidPrice ? formatPrice(e.callBidPrice) : '—'}</td>}
          {visibleColumns.callAsk && <td className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary">{e.callAskPrice ? formatPrice(e.callAskPrice) : '—'}</td>}
          {visibleColumns.callDelta && <td className="px-1 py-1 text-right font-mono tabular-nums text-fw-text-secondary">{Number.isFinite(e.callDelta) ? e.callDelta.toFixed(2) : '—'}</td>}
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
          {/* PUT LTP */}
          {visibleColumns.putLtp && <td
            className={cn(
              'px-1 py-1 text-left font-mono tabular-nums font-bold cursor-pointer hover:underline',
              isSelPE ? 'text-fw-accent' : e.putLtp > 0 ? 'text-red-400' : 'text-fw-text-muted',
            )}
            onClick={() => onStrikeClick(e.strike, 'PE', e.putLtp, e.putToken)}
          >
            {e.putLtp > 0 ? formatPrice(e.putLtp) : '—'}
          </td>}
          {/* PUT IV */}
          {visibleColumns.putIv && <td className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary">
            {displayPutIv > 0 ? displayPutIv.toFixed(1) + '%' : '—'}
          </td>}
          {/* Volume — red bar */}
          {visibleColumns.putVolume && <td
            className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary"
            style={{
              background: putVolPct > 0
                ? `linear-gradient(to left, transparent ${100 - putVolPct}%, rgba(255,70,90,0.13) ${100 - putVolPct}%)`
                : undefined,
            }}
          >
            {formatNumber(e.putVolume || 0)}
          </td>}
          {/* OI Change */}
          {visibleColumns.putOiChange && <td className="px-1 py-1 text-left font-mono tabular-nums">
            <span className={cn('font-semibold block', putOiChg > 0 ? 'text-emerald-400' : putOiChg < 0 ? 'text-red-400' : 'text-fw-text-muted')}>
              {putOiChg !== 0 ? (putOiChg > 0 ? '+' : '') + putOiChg.toFixed(1) + '%' : '—'}
            </span>
          </td>}
          {/* OI with bar — red gradient */}
          {visibleColumns.putOi && <td
            className="px-1 py-1 text-left font-mono tabular-nums relative overflow-hidden"
            style={{
              background: putOiPct > 0
                ? `linear-gradient(to left, transparent ${100 - putOiPct}%, rgba(255,70,90,0.22) ${100 - putOiPct}%)`
                : undefined,
            }}
          >
            <span className={cn('relative z-10 block', isSelPE ? 'text-fw-accent' : 'text-fw-text')}>{formatNumber(e.putOi || 0)}</span>
          </td>}
          {visibleColumns.putBid && <td className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary">{e.putBidPrice ? formatPrice(e.putBidPrice) : '—'}</td>}
          {visibleColumns.putAsk && <td className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary">{e.putAskPrice ? formatPrice(e.putAskPrice) : '—'}</td>}
          {visibleColumns.putDelta && <td className="px-1 py-1 text-left font-mono tabular-nums text-fw-text-secondary">{Number.isFinite(e.putDelta) ? e.putDelta.toFixed(2) : '—'}</td>}
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
  const { activeSymbol, setActiveSymbol, watchlists, setActiveWorkspace } = useAppStore();
  const { setOrderForm, setSelectedContract, selectedContract } = useTradingStore();
  const quotes = useMarketStore((s) => s.quotes);
  const marketStatus = useMarketStore((s) => s.marketStatus);

  // ── Derived from activeSymbol — recalculated on every render, no stale state
  const underlying = useMemo(() =>
    activeSymbol ? deriveUnderlying(activeSymbol) : '', [activeSymbol]);
  const underlyingOptions = useMemo(() => watchlists.find((watchlist) => watchlist.id === 'options')?.items || [], [watchlists]);
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
    | { type: 'stale'; message: string }
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

  const [strikeRange, setStrikeRange] = useState<5 | 10 | 20 | 'all'>(20);
  const [centerOnAtm, setCenterOnAtm] = useState(true);
  const [strikeFocusOffset, setStrikeFocusOffset] = useState(0);
  const [showColumns, setShowColumns] = useState(false);
  const [analyticsCollapsed, setAnalyticsCollapsed] = useState(() => {
    try { return localStorage.getItem('fw-option-chain-analytics-collapsed') === 'true'; } catch { return false; }
  });
  const [analyticsHeight, setAnalyticsHeight] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('fw-option-chain-analytics-height'));
      return stored >= 150 && stored <= 420 ? stored : 240;
    } catch { return 240; }
  });
  const [analyticsTab, setAnalyticsTab] = useState<'market' | 'oi' | 'pcr' | 'maxPain'>('market');
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem('fw-option-chain-columns');
      return stored ? { ...columnsFor(COLUMN_PRESETS.Basic), ...JSON.parse(stored) } : columnsFor(COLUMN_PRESETS.Basic);
    } catch { return columnsFor(COLUMN_PRESETS.Basic); }
  });

  const updateColumns = useCallback((next: Record<ColumnKey, boolean>) => {
    setVisibleColumns(next);
    try { localStorage.setItem('fw-option-chain-columns', JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, []);

  const toggleAnalytics = useCallback(() => {
    setAnalyticsCollapsed((collapsed) => {
      const next = !collapsed;
      try { localStorage.setItem('fw-option-chain-analytics-collapsed', String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const resizeAnalytics = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = analyticsHeight;
    let lastHeight = startHeight;
    const onMove = (moveEvent: MouseEvent) => {
      lastHeight = Math.max(150, Math.min(420, startHeight + startY - moveEvent.clientY));
      setAnalyticsHeight(lastHeight);
    };
    const onUp = () => {
      try { localStorage.setItem('fw-option-chain-analytics-height', String(lastHeight)); } catch { /* storage unavailable */ }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [analyticsHeight]);

  // ── ATM-filtered chain ────────────────────────────────────────────────────
  const filteredChain = useMemo(() => {
    if (chain.length === 0 || !centerOnAtm || spotPrice === 0 || strikeRange === 'all') return chain;
    const atmEntry = chain.reduce((closest, entry) => Math.abs(entry.strike - spotPrice) < Math.abs(closest.strike - spotPrice) ? entry : closest, chain[0]);
    const atmIndex = chain.indexOf(atmEntry);
    const focusIndex = Math.max(0, Math.min(chain.length - 1, atmIndex + strikeFocusOffset));
    return chain.slice(Math.max(0, focusIndex - strikeRange), Math.min(chain.length, focusIndex + strikeRange + 1));
  }, [chain, spotPrice, centerOnAtm, strikeRange, strikeFocusOffset]);

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

      if (data && isCompleteOptionChain(data)) {
        const cleanChain = uniqueChain(data);
        _chainCache.set(ck, { chain: cleanChain, cachedAt: Date.now() });
        setChain(cleanChain);
        setStatus({ type: 'ready' });
        if (budgetTimerRef.current) { clearTimeout(budgetTimerRef.current); budgetTimerRef.current = null; }

        // Dispatch greeks + max pain to worker.
        // Worker uses LTP-based Newton-Raphson IV when chain data has no IV (Angel path).
        // When Dhan supplies IV the worker result is used as fallback only (server IV takes priority).
        if (workerRef.current && spotPrice > 0 && selectedExpiry) {
          const msToExpiry = new Date(selectedExpiry).getTime() - Date.now();
          const daysToExpiry = msToExpiry / 86_400_000;
          if (daysToExpiry <= 0) return;
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

      // Never replace a valid chain with an incomplete broker snapshot.
      // Empty or incomplete → retryable (503 is handled via error path)
      scheduleRetry(sym, expiry, attempt, session);
      if (chain.length > 0) {
        setStatus({ type: 'stale', message: 'Live option data is incomplete. Showing the last valid chain.' });
      }
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
    setStrikeFocusOffset(0);

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

  // ── User actions ──────────────────────────────────────────────────────────
  const handleExpiryChange = useCallback((expiry: string) => {
    if (!activeSymbol || segmentUnsupported) return;
    const session = ++sessionRef.current;
    clearAll();
    setChain([]);
    setSelectedExpiry(expiry);
    setWorkerIv(new Map());
    setMaxPainStrike(0);
    setStrikeFocusOffset(0);
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
  // Keep the last valid rows visible while an incomplete refresh retries.
  const isLoading = (status.type === 'loading' && chain.length === 0) || status.type === 'idle';
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
    if (chain.length === 0 || spotPrice === 0) return 0;
    let closest = chain[0]?.strike || 0;
    let minDiff = Infinity;
    for (const e of chain) {
      const d = Math.abs(e.strike - spotPrice);
      if (d < minDiff) { minDiff = d; closest = e.strike; }
    }
    return closest;
  }, [chain, spotPrice]);

  const analytics = useMemo(() => {
    const callOi = chain.reduce((sum, entry) => sum + (Number.isFinite(entry.callOi) ? entry.callOi : 0), 0);
    const putOi = chain.reduce((sum, entry) => sum + (Number.isFinite(entry.putOi) ? entry.putOi : 0), 0);
    const callVolume = chain.reduce((sum, entry) => sum + (Number.isFinite(entry.callVolume) ? entry.callVolume : 0), 0);
    const putVolume = chain.reduce((sum, entry) => sum + (Number.isFinite(entry.putVolume) ? entry.putVolume : 0), 0);
    return {
      callOi, putOi,
      pcrOi: callOi > 0 ? putOi / callOi : null,
      pcrVolume: callVolume > 0 ? putVolume / callVolume : null,
    };
  }, [chain]);

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
    if (status.type === 'loading' || status.type === 'idle') {
      return chain.length > 0
        ? { label: 'STALE', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' }
        : { label: 'LOADING', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
    }
    if (status.type === 'error') {
      const msg = (status as any).message || '';
      if (msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('401')) {
        return { label: 'AUTH ERROR', color: 'text-red-400', dot: 'bg-red-400' };
      }
      return { label: 'ERROR', color: 'text-red-400', dot: 'bg-red-400' };
    }
    if (status.type === 'ready' || status.type === 'stale') {
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
  }, [status, spotPrice, quotes, activeSymbol?.token, chain.length]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-fw-bg overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border flex-shrink-0 bg-fw-surface">
        <button onClick={() => setActiveWorkspace('home')} className="text-[10px] text-fw-text-muted hover:text-fw-text whitespace-nowrap">← Back to Terminal</button>
        <span className="text-[13px] font-bold text-fw-text tracking-wide flex-shrink-0">OPT CHAIN</span>
        <select
          aria-label="Underlying"
          value={activeSymbol?.token || ''}
          onChange={(event) => {
            const item = underlyingOptions.find((option) => option.token === event.target.value);
            if (item) setActiveSymbol({ token: item.token, symbol: item.symbol, name: item.symbol, segment: item.segment, instrumentType: 'INDEX', exchange: item.segment === 'BSE' ? 'BSE' : 'NSE', lotSize: 1, tickSize: 0.05 });
          }}
          className="bg-fw-bg text-fw-text text-[11px] border border-fw-border rounded px-1.5 py-0.5 font-semibold"
        >
          {underlyingOptions.map((option) => <option key={option.token} value={option.token}>{option.symbol}</option>)}
        </select>
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
        {marketStatus !== 'OPEN' && (
          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5">MARKET {marketStatus === 'CLOSED' ? 'CLOSED' : marketStatus.replace('_', ' ')}</span>
        )}

        <div className="flex-1" />

        {/* Spot price */}
        {spotPrice > 0 && (
          <span className="text-[12px] font-mono font-bold text-emerald-400 tabular-nums flex-shrink-0">
            {formatPrice(spotPrice)}
          </span>
        )}

        {/* Manual refresh button — always visible when chain is loaded */}
        {(status.type === 'ready' || status.type === 'stale' || status.type === 'error') && (
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
      {(status.type === 'ready' || status.type === 'stale' || (status.type === 'loading' && chain.length > 0)) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-fw-border/30 flex-shrink-0">
          {(status.type === 'stale' || (status.type === 'loading' && chain.length > 0)) && (
            <span className="text-[10px] text-amber-400" title={status.type === 'stale' ? status.message : 'Live option data is refreshing'}>STALE DATA</span>
          )}
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
          <div className="flex items-center gap-1 border border-fw-border/50 rounded px-1 py-0.5">
            <span className="text-[10px] text-fw-text-muted">Range</span>
            {([5, 10, 20, 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setStrikeRange(range)}
                className={cn('px-1.5 text-[10px] font-semibold rounded', strikeRange === range ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text')}
              >{range === 'all' ? 'ALL' : range}</button>
            ))}
          </div>
          <button
            onClick={() => { setCenterOnAtm(true); setStrikeFocusOffset(0); }}
            className={cn('px-2 py-0.5 text-[10px] font-bold rounded border', centerOnAtm ? 'border-fw-accent/40 text-fw-accent' : 'border-fw-border text-fw-text-muted hover:text-fw-text')}
          >ATM</button>
          <button
            onClick={() => setStrikeFocusOffset((offset) => offset - 1)}
            disabled={!centerOnAtm || strikeRange === 'all'}
            className="px-2 py-0.5 text-[10px] font-bold rounded border border-fw-border text-fw-text-muted hover:text-fw-text disabled:opacity-40"
            title="Previous strike"
          >←</button>
          <button
            onClick={() => setStrikeFocusOffset((offset) => offset + 1)}
            disabled={!centerOnAtm || strikeRange === 'all'}
            className="px-2 py-0.5 text-[10px] font-bold rounded border border-fw-border text-fw-text-muted hover:text-fw-text disabled:opacity-40"
            title="Next strike"
          >→</button>
          <button
            onClick={() => setCenterOnAtm((value) => !value)}
            className="px-2 py-0.5 text-[10px] font-bold rounded border border-fw-border text-fw-text-muted hover:text-fw-text"
          >{centerOnAtm ? 'SHOW ALL' : 'CENTER ATM'}</button>
          <button
            onClick={() => setShowColumns((value) => !value)}
            aria-expanded={showColumns}
            className="px-2 py-0.5 text-[10px] font-bold rounded border border-fw-border text-fw-text-muted hover:text-fw-text"
          >Columns</button>
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

      {showColumns && (status.type === 'ready' || status.type === 'stale') && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-fw-border/30 bg-fw-surface text-[10px]">
          <span className="text-fw-text-muted font-semibold mr-1">Presets</span>
          {Object.keys(COLUMN_PRESETS).map((preset) => (
            <button key={preset} onClick={() => updateColumns(columnsFor(COLUMN_PRESETS[preset]))} className="px-2 py-1 rounded border border-fw-border text-fw-text-secondary hover:border-fw-accent/50 hover:text-fw-text">{preset}</button>
          ))}
          <span className="w-px h-4 bg-fw-border/50 mx-1" />
          {ALL_COLUMN_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1 text-fw-text-muted">
              <input
                type="checkbox"
                checked={visibleColumns[key]}
                onChange={(event) => updateColumns({ ...visibleColumns, [key]: event.target.checked })}
                className="accent-fw-accent"
              />
              {COLUMN_LABELS[key]}
            </label>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-auto">

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
          <table className="w-full min-w-[1100px] border-collapse table-fixed" style={{ fontSize: '12px' }}>
            <colgroup>
              {viewMode !== 'pe' && <><col style={{ width: '6%' }} />{ALL_COLUMN_KEYS.filter((key) => key.startsWith('call') && visibleColumns[key]).map((key) => <col key={key} style={{ width: '8%' }} />)}</>}
              <col style={{ width: '10%' }} />
              {viewMode !== 'ce' && <><>{ALL_COLUMN_KEYS.filter((key) => key.startsWith('put') && visibleColumns[key]).map((key) => <col key={key} style={{ width: '8%' }} />)}</><col style={{ width: '6%' }} /></>}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-fw-surface">
                {viewMode !== 'pe' && (
                  <th colSpan={1 + ALL_COLUMN_KEYS.filter((key) => key.startsWith('call') && visibleColumns[key]).length} className="py-2 text-center text-[11px] font-bold text-emerald-400 uppercase tracking-widest border-b border-emerald-500/20 bg-emerald-500/[0.04]">
                    CALLS
                  </th>
                )}
                <th className="py-2 text-center text-[12px] font-bold text-fw-text uppercase tracking-widest border-b border-fw-border bg-fw-surface-2 border-x border-fw-border/60">
                  STRIKE
                </th>
                {viewMode !== 'ce' && (
                  <th colSpan={1 + ALL_COLUMN_KEYS.filter((key) => key.startsWith('put') && visibleColumns[key]).length} className="py-2 text-center text-[11px] font-bold text-red-400 uppercase tracking-widest border-b border-red-500/20 bg-red-500/[0.04]">
                    PUTS
                  </th>
                )}
              </tr>
              <tr className="bg-fw-bg border-b-2 border-fw-border text-[10px] text-fw-text-secondary uppercase font-semibold">
                {viewMode !== 'pe' && <><th className="px-1 py-1 text-center">B/S</th>{ALL_COLUMN_KEYS.filter((key) => key.startsWith('call') && visibleColumns[key]).map((key) => <th key={key} className="px-1 py-1 text-right">{COLUMN_LABELS[key].replace('Call ', '')}</th>)}</>}
                <th className="px-1 py-1 text-center bg-fw-surface-2 border-x border-fw-border/60 text-fw-text">Strike</th>
                {viewMode !== 'ce' && <>{ALL_COLUMN_KEYS.filter((key) => key.startsWith('put') && visibleColumns[key]).map((key) => <th key={key} className="px-1 py-1 text-left">{COLUMN_LABELS[key].replace('Put ', '')}</th>)}<th className="px-1 py-1 text-center">B/S</th></>}
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
                    visibleColumns={visibleColumns}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <OptionAnalyticsPanel
        analytics={analytics}
        maxPainStrike={maxPainStrike}
        chain={chain}
        collapsed={analyticsCollapsed}
        height={analyticsHeight}
        activeTab={analyticsTab}
        onTabChange={setAnalyticsTab}
        onToggle={toggleAnalytics}
        onResize={resizeAnalytics}
      />
    </div>
  );
}

function OptionAnalyticsPanel({
  analytics,
  maxPainStrike,
  chain,
  collapsed,
  height,
  activeTab,
  onTabChange,
  onToggle,
  onResize,
}: {
  analytics: { callOi: number; putOi: number; pcrOi: number | null; pcrVolume: number | null };
  maxPainStrike: number;
  chain: OptionChainEntry[];
  collapsed: boolean;
  height: number;
  activeTab: 'market' | 'oi' | 'pcr' | 'maxPain';
  onTabChange: (tab: 'market' | 'oi' | 'pcr' | 'maxPain') => void;
  onToggle: () => void;
  onResize: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const maxChange = Math.max(1, ...chain.flatMap((entry) => [Math.abs(entry.callOiChange || 0), Math.abs(entry.putOiChange || 0)]));
  const tabs = [
    { id: 'market' as const, label: 'Market Analytics' },
    { id: 'oi' as const, label: 'OI Buildup' },
    { id: 'pcr' as const, label: 'PCR' },
    { id: 'maxPain' as const, label: 'Max Pain' },
  ];

  return (
    <section className="flex-shrink-0 border-t border-fw-border bg-fw-surface" style={collapsed ? undefined : { height }}>
      {!collapsed && <div onMouseDown={onResize} className="group h-2 cursor-row-resize border-b border-fw-border/60 bg-fw-border/20 hover:bg-fw-accent/20" title="Drag to resize analytics" />}
      <div className="flex h-9 items-center gap-1 border-b border-fw-border px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn('h-full border-b-2 px-2.5 text-[10px] font-bold uppercase tracking-wider', activeTab === tab.id ? 'border-fw-accent text-fw-accent' : 'border-transparent text-fw-text-muted hover:text-fw-text')}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={onToggle} className="px-2 text-[10px] font-bold text-fw-text-muted hover:text-fw-text" aria-label={collapsed ? 'Expand analytics' : 'Collapse analytics'}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div className="h-[calc(100%-44px)] overflow-auto p-3">
          {activeTab === 'market' && (
            <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-5">
              <Detail label="Total Call OI" value={analytics.callOi > 0 ? formatNumber(analytics.callOi) : 'Unavailable'} />
              <Detail label="Total Put OI" value={analytics.putOi > 0 ? formatNumber(analytics.putOi) : 'Unavailable'} />
              <Detail label="PCR (OI)" value={analytics.pcrOi !== null ? analytics.pcrOi.toFixed(2) : 'Unavailable'} />
              <Detail label="PCR (Volume)" value={analytics.pcrVolume !== null ? analytics.pcrVolume.toFixed(2) : 'Unavailable'} />
              <Detail label="Max Pain" value={maxPainStrike > 0 ? formatPrice(maxPainStrike) : 'Unavailable'} />
            </div>
          )}
          {activeTab === 'oi' && <AnalyticsBars title="Open interest buildup" chain={chain} maxChange={maxChange} />}
          {activeTab === 'pcr' && <PcrChart chain={chain} />}
          {activeTab === 'maxPain' && <Detail label="Max Pain Strike" value={maxPainStrike > 0 ? formatPrice(maxPainStrike) : 'Unavailable'} />}
        </div>
      )}
    </section>
  );
}

function PcrChart({ chain }: { chain: OptionChainEntry[] }) {
  return <div className="h-full min-h-[70px]"><p className="text-[10px] font-bold uppercase tracking-widest text-fw-text-muted">Put call ratio</p><div className="mt-2 flex h-[calc(100%-20px)] min-h-[50px] items-end gap-1 border-b border-fw-border/60">{chain.slice(-18).map((entry) => { const ratio = entry.callOi > 0 ? entry.putOi / entry.callOi : 0; return <div key={entry.strike} title={`${entry.strike}: ${ratio > 0 ? ratio.toFixed(2) : 'Unavailable'}`} className="flex-1 bg-fw-accent/60" style={{ height: `${Math.min(100, ratio * 55)}%` }} />; })}</div></div>;
}

function AnalyticsBars({ title, chain, maxChange }: { title: string; chain: OptionChainEntry[]; maxChange: number }) {
  return <div className="rounded border border-fw-border/70 bg-fw-bg p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-widest text-fw-text-muted">{title}</p><span className="text-[10px] text-fw-text-muted">Call / Put OI change</span></div><div className="mt-3 flex h-20 items-center gap-1 border-b border-fw-border/60">{chain.slice(-18).map((entry) => <div key={entry.strike} className="flex h-full flex-1 items-center justify-center gap-px" title={`${entry.strike}`}><div className="w-1/2 bg-emerald-400/70" style={{ height: `${Math.min(100, Math.abs(entry.callOiChange || 0) / maxChange * 100)}%` }} /><div className="w-1/2 bg-red-400/70" style={{ height: `${Math.min(100, Math.abs(entry.putOiChange || 0) / maxChange * 100)}%` }} /></div>)}</div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-fw-text-muted">{label}</span><span className="font-mono font-semibold text-fw-text">{value}</span></div>;
}
