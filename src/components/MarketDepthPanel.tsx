import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { wsService } from '@/services/websocket';
import { cn, formatPrice } from '@/utils/helpers';
import type { MarketDepthLevel } from '@/types';

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtQty(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000)    return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000)      return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

// ─── types ───────────────────────────────────────────────────────────────────
interface DepthLevel extends MarketDepthLevel {
  cumQty?: number;
}

interface TapeEntry {
  id: number;
  time: number;
  price: number;
  qty: number;
  side: 'buy' | 'sell';
}

interface LiqWall {
  side: 'bid' | 'ask';
  price: number;
  qty: number;
}

// ─── iceberg tracker ─────────────────────────────────────────────────────────
const MAX_TAPE = 120;
const WALL_MULTIPLIER = 4; // level is a "wall" if qty > 4× avg

// ─── sub-components ──────────────────────────────────────────────────────────

/** Animated liquidity bar — green (bid) or red (ask) */
function LiqBar({ pct, side, isTop, isWall }: { pct: number; side: 'bid' | 'ask'; isTop: boolean; isWall: boolean }) {
  const base = side === 'bid'
    ? isTop ? 'rgba(34,197,94,0.55)' : 'rgba(34,197,94,0.22)'
    : isTop ? 'rgba(239,68,68,0.55)'  : 'rgba(239,68,68,0.22)';
  const glow = side === 'bid'
    ? 'rgba(34,197,94,0.08)'
    : 'rgba(239,68,68,0.08)';
  const dir  = side === 'bid' ? 'to left' : 'to right';

  return (
    <div
      className="absolute inset-y-[1px] pointer-events-none transition-all"
      style={{
        [side === 'bid' ? 'right' : 'left']: 0,
        width: `${pct}%`,
        background: `linear-gradient(${dir}, ${base}, ${glow})`,
        borderRadius: side === 'bid' ? '3px 0 0 3px' : '0 3px 3px 0',
        boxShadow: isWall ? (side === 'bid' ? '0 0 8px rgba(34,197,94,0.4)' : '0 0 8px rgba(239,68,68,0.4)') : 'none',
      }}
    />
  );
}

/** Single price row in the price ladder */
function PriceRow({
  bidLevel, askLevel, maxQty, isMidAbove,
  onBidClick, onAskClick,
  lastFlash, wallQty,
}: {
  bidLevel?: DepthLevel | null;
  askLevel?: DepthLevel | null;
  maxQty: number;
  isMidAbove: boolean;
  onBidClick: (price: number) => void;
  onAskClick: (price: number) => void;
  lastFlash: boolean;
  wallQty: number;
}) {
  const bidPct   = bidLevel ? Math.min(100, (bidLevel.qty / maxQty) * 100) : 0;
  const askPct   = askLevel ? Math.min(100, (askLevel.qty / maxQty) * 100) : 0;
  const bidWall  = bidLevel ? bidLevel.qty >= wallQty : false;
  const askWall  = askLevel ? askLevel.qty >= wallQty : false;
  const bidTop   = bidPct > 60;
  const askTop   = askPct > 60;
  const price    = bidLevel?.price ?? askLevel?.price ?? 0;

  return (
    <div
      className={cn(
        'relative grid items-center h-[26px] border-b border-fw-border/[0.06] group select-none',
        'grid-cols-[72px_1fr_72px_1fr]',
        lastFlash && 'animate-[ltpFlash_0.3s_ease-out]',
      )}
    >
      {/* BID bar (right-anchored) */}
      {bidLevel && (
        <LiqBar pct={bidPct} side="bid" isTop={bidTop} isWall={bidWall} />
      )}
      {/* ASK bar (left-anchored, offset to right half) */}
      {askLevel && (
        <div className="absolute inset-y-0 left-1/2 right-0 pointer-events-none">
          <LiqBar pct={askPct} side="ask" isTop={askTop} isWall={askWall} />
        </div>
      )}

      {/* BID QTY */}
      <div
        className={cn(
          'relative z-10 text-right pr-2 font-mono tabular-nums text-[12px] font-semibold cursor-pointer transition-colors',
          bidLevel ? (bidWall ? 'text-green font-black' : 'text-green/75 hover:text-green') : 'text-transparent'
        )}
        onClick={() => bidLevel && onBidClick(bidLevel.price)}
      >
        {bidLevel ? fmtQty(bidLevel.qty) : ''}
        {bidWall && <span className="ml-0.5 text-[8px] text-green/60">⬛</span>}
      </div>

      {/* BID PRICE */}
      <div
        className={cn(
          'relative z-10 text-center font-mono tabular-nums text-[12px] font-bold cursor-pointer transition-colors',
          bidLevel ? 'text-green/90 hover:text-green' : 'text-fw-text-muted/20'
        )}
        onClick={() => bidLevel && onBidClick(bidLevel.price)}
      >
        {bidLevel ? formatPrice(bidLevel.price) : ''}
      </div>

      {/* ASK PRICE */}
      <div
        className={cn(
          'relative z-10 text-center font-mono tabular-nums text-[12px] font-bold cursor-pointer transition-colors',
          askLevel ? 'text-red/90 hover:text-red' : 'text-fw-text-muted/20'
        )}
        onClick={() => askLevel && onAskClick(askLevel.price)}
      >
        {askLevel ? formatPrice(askLevel.price) : ''}
      </div>

      {/* ASK QTY */}
      <div
        className={cn(
          'relative z-10 text-left pl-2 font-mono tabular-nums text-[12px] font-semibold cursor-pointer transition-colors',
          askLevel ? (askWall ? 'text-red font-black' : 'text-red/75 hover:text-red') : 'text-transparent'
        )}
        onClick={() => askLevel && onAskClick(askLevel.price)}
      >
        {askLevel ? fmtQty(askLevel.qty) : ''}
        {askWall && <span className="mr-0.5 text-[8px] text-red/60">⬛</span>}
      </div>
    </div>
  );
}

// ─── Tape entry ───────────────────────────────────────────────────────────────
function TapeRow({ entry }: { entry: TapeEntry }) {
  return (
    <div className={cn(
      'flex items-center justify-between px-2 py-[2px] border-b border-fw-border/[0.06] text-[11px] font-mono tabular-nums',
      entry.side === 'buy' ? 'bg-green/[0.04]' : 'bg-red/[0.04]',
    )}>
      <span className={entry.side === 'buy' ? 'text-green font-bold' : 'text-red font-bold'}>
        {entry.side === 'buy' ? 'B' : 'S'}
      </span>
      <span className="text-fw-text font-bold">{formatPrice(entry.price)}</span>
      <span className="text-fw-text-muted">{fmtQty(entry.qty)}</span>
      <span className="text-fw-text-muted/50">{fmtTime(entry.time)}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function MarketDepthPanel() {
  const { activeSymbol } = useAppStore();
  const quote     = useMarketStore((s) => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const { setOrderForm } = useTradingStore();

  // ── depth state (updated via WebSocket depth messages) ───────────────────
  const [bids, setBids] = useState<DepthLevel[]>([]);
  const [asks, setAsks] = useState<DepthLevel[]>([]);
  const [tape, setTape]   = useState<TapeEntry[]>([]);
  const [lastFlashPrice, setLastFlashPrice] = useState<number | null>(null);
  const [showTape, setShowTape] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);

  const tapeIdRef   = useRef(0);
  const lastLtp     = useRef<number>(0);
  const ladderRef   = useRef<HTMLDivElement>(null);

  // ── subscribe to depth via WebSocket ─────────────────────────────────────
  useEffect(() => {
    if (!activeSymbol?.token) return;
    setBids([]); setAsks([]); setTape([]);
    lastLtp.current = 0;

    // Request depth subscription
    wsService.send({ type: 'subscribe_depth', tokens: [activeSymbol.token] });

    // Also poll REST as initial fill + fallback every 2s
    let active = true;
    const fetchDepth = async () => {
      try {
        const r = await fetch(`/api/market/depth?token=${activeSymbol.token}`, { credentials: 'include' });
        if (!r.ok || !active) return;
        const d = await r.json();
        if (d?.bids?.length || d?.asks?.length) {
          setBids(addCumulative(d.bids || []));
          setAsks(addCumulative(d.asks || []));
        }
      } catch {}
    };
    fetchDepth();
    const poll = setInterval(fetchDepth, 2000);

    // WebSocket depth handler
    const depthHandler = (msg: any) => {
      if (msg.token !== activeSymbol.token) return;
      const data = msg.data || msg;
      if (data.bids || data.asks) {
        if (data.bids) setBids(addCumulative(data.bids));
        if (data.asks) setAsks(addCumulative(data.asks));
      }
    };
    wsService.on('depth', depthHandler);

    // WebSocket quote → tape + LTP flash
    const quoteHandler = (msg: any) => {
      if (msg.token !== activeSymbol.token) return;
      const ltp = msg.data?.ltp ?? msg.ltp;
      if (!ltp) return;
      const prev = lastLtp.current;
      if (prev > 0 && ltp !== prev) {
        const entry: TapeEntry = {
          id: ++tapeIdRef.current,
          time: Date.now(),
          price: ltp,
          qty: msg.data?.lastTradeQty ?? msg.lastTradeQty ?? 1,
          side: ltp >= prev ? 'buy' : 'sell',
        };
        setTape(t => [entry, ...t].slice(0, MAX_TAPE));
        setLastFlashPrice(ltp);
        setTimeout(() => setLastFlashPrice(null), 320);
      }
      lastLtp.current = ltp;
    };
    wsService.on('quote', quoteHandler);

    return () => {
      clearInterval(poll);
      wsService.off('depth', depthHandler);
      wsService.off('quote', quoteHandler);
      wsService.send({ type: 'unsubscribe_depth', tokens: [activeSymbol.token] });
    };
  }, [activeSymbol?.token]);

  // ── derived values ─────────────────────────────────────────────────────────
  const maxQty = useMemo(() => Math.max(
    ...bids.map(b => b.qty),
    ...asks.map(a => a.qty),
    1,
  ), [bids, asks]);

  const totalBid = useMemo(() => bids.reduce((s, b) => s + b.qty, 0), [bids]);
  const totalAsk = useMemo(() => asks.reduce((s, a) => s + a.qty, 0), [asks]);
  const grandTotal = totalBid + totalAsk || 1;
  const bidPct  = (totalBid / grandTotal) * 100;

  const bestBid   = bids[0];
  const bestAsk   = asks[0];
  const spread    = bestBid && bestAsk ? bestAsk.price - bestBid.price : 0;
  const midPrice  = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : 0;
  const spreadColor = spread === 0 ? 'text-fw-text-muted'
    : spread <= 0.1 ? 'text-green' : spread <= 0.5 ? 'text-orange-400' : 'text-red';

  // Liquidity walls
  const avgBidQty = bids.length ? totalBid / bids.length : 0;
  const avgAskQty = asks.length ? totalAsk / asks.length : 0;
  const wallQty   = Math.max(avgBidQty, avgAskQty) * WALL_MULTIPLIER;
  const walls     = useMemo((): LiqWall[] => {
    const w: LiqWall[] = [];
    const topBid = bids.find(b => b.qty >= wallQty);
    const topAsk = asks.find(a => a.qty >= wallQty);
    if (topBid) w.push({ side: 'bid', price: topBid.price, qty: topBid.qty });
    if (topAsk) w.push({ side: 'ask', price: topAsk.price, qty: topAsk.qty });
    return w;
  }, [bids, asks, wallQty]);

  const hasData = bids.length > 0 || asks.length > 0;

  // ── callbacks ──────────────────────────────────────────────────────────────
  const onBidClick = useCallback((price: number) => {
    setOrderForm({ price, side: 'BUY', orderType: 'LIMIT' });
  }, [setOrderForm]);

  const onAskClick = useCallback((price: number) => {
    setOrderForm({ price, side: 'SELL', orderType: 'LIMIT' });
  }, [setOrderForm]);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#090b10] select-none text-fw-text overflow-hidden">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-fw-border bg-[#0e1018] flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-black text-fw-text uppercase tracking-widest">DOM</span>
          {activeSymbol && (
            <span className="text-[11px] font-bold text-fw-accent truncate">{activeSymbol.symbol}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Tape toggle */}
          <button
            onClick={() => setShowTape(v => !v)}
            className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors',
              showTape ? 'border-fw-accent text-fw-accent bg-fw-accent/10' : 'border-fw-border/40 text-fw-text-muted hover:border-fw-accent/40'
            )}
          >T&amp;S</button>
          {/* Cumulative toggle */}
          <button
            onClick={() => setShowCumulative(v => !v)}
            className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors',
              showCumulative ? 'border-fw-accent text-fw-accent bg-fw-accent/10' : 'border-fw-border/40 text-fw-text-muted hover:border-fw-accent/40'
            )}
          >CUM</button>
          {quote && (
            <span className={cn('font-mono font-black text-[13px] tabular-nums ml-1',
              (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red'
            )}>
              {formatPrice(quote.ltp)}
            </span>
          )}
        </div>
      </div>

      {/* ── BEST BID / ASK STRIP ── */}
      <div className="grid grid-cols-2 gap-px border-b border-fw-border/30 flex-shrink-0">
        <div
          className="flex flex-col items-center py-1.5 bg-green/[0.05] border-r border-fw-border/30 cursor-pointer hover:bg-green/[0.10] transition-colors"
          onClick={() => bestBid && onBidClick(bestBid.price)}
          style={{ boxShadow: 'inset 0 -2px 0 rgba(34,197,94,0.4)' }}
        >
          <span className="text-[8px] text-green/60 font-bold uppercase tracking-wider">Best Bid</span>
          <span className="text-[14px] font-black font-mono text-green tabular-nums" style={{ textShadow: '0 0 12px rgba(34,197,94,0.5)' }}>
            {bestBid ? formatPrice(bestBid.price) : '—'}
          </span>
          <span className="text-[9px] text-green/50 font-mono">{bestBid ? fmtQty(bestBid.qty) : ''}</span>
        </div>
        <div
          className="flex flex-col items-center py-1.5 bg-red/[0.05] cursor-pointer hover:bg-red/[0.10] transition-colors"
          onClick={() => bestAsk && onAskClick(bestAsk.price)}
          style={{ boxShadow: 'inset 0 -2px 0 rgba(239,68,68,0.4)' }}
        >
          <span className="text-[8px] text-red/60 font-bold uppercase tracking-wider">Best Ask</span>
          <span className="text-[14px] font-black font-mono text-red tabular-nums" style={{ textShadow: '0 0 12px rgba(239,68,68,0.5)' }}>
            {bestAsk ? formatPrice(bestAsk.price) : '—'}
          </span>
          <span className="text-[9px] text-red/50 font-mono">{bestAsk ? fmtQty(bestAsk.qty) : ''}</span>
        </div>
      </div>

      {/* ── MID PRICE + SPREAD ── */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-fw-border/20 bg-[#0b0d14] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] text-fw-text-muted uppercase tracking-wider">Mid</span>
          <span className="text-[12px] font-mono font-bold text-fw-text tabular-nums">
            {midPrice > 0 ? formatPrice(midPrice) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-fw-text-muted uppercase tracking-wider">Spread</span>
          <span className={cn('text-[11px] font-mono font-bold tabular-nums', spreadColor)}>
            {spread > 0 ? `₹${formatPrice(spread)}` : '—'}
          </span>
        </div>
      </div>

      {/* ── COLUMN HEADERS ── */}
      <div className="grid grid-cols-[72px_1fr_72px_1fr] px-0 py-[3px] border-b border-fw-border/30 bg-[#090b10] flex-shrink-0">
        <span className="text-[8px] text-green/60 font-bold text-right pr-2 uppercase">Bid Qty</span>
        <span className="text-[8px] text-green/60 font-bold text-center uppercase">Bid</span>
        <span className="text-[8px] text-red/60 font-bold text-center uppercase">Ask</span>
        <span className="text-[8px] text-red/60 font-bold text-left pl-2 uppercase">Ask Qty</span>
      </div>

      {/* ── PRICE LADDER ── */}
      <div ref={ladderRef} className="flex-1 overflow-y-auto min-h-0 scrollbar-none">
        {!hasData ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40">
            <div className="w-8 h-8 rounded-full border-2 border-fw-border/40 flex items-center justify-center">
              <span className="text-fw-text-muted text-lg">≡</span>
            </div>
            <span className="text-[12px] text-fw-text-muted">Waiting for depth data</span>
            <span className="text-[11px] text-fw-text-muted/60">Click price to set order</span>
          </div>
        ) : (
          <>
            {/* ASK levels (reversed — highest ask at top, best ask at bottom near mid) */}
            {[...asks].reverse().map((ask, i) => {
              const idx = asks.length - 1 - i;
              return (
                <PriceRow
                  key={`ask-${idx}`}
                  askLevel={showCumulative ? { ...ask, qty: ask.cumQty ?? ask.qty } : ask}
                  maxQty={maxQty}
                  isMidAbove={false}
                  onBidClick={onBidClick}
                  onAskClick={onAskClick}
                  lastFlash={lastFlashPrice === ask.price}
                  wallQty={wallQty}
                />
              );
            })}

            {/* ── MID PRICE DIVIDER ── */}
            <div className="flex items-center gap-2 px-2 py-1 bg-[#0e1018]/80 border-y border-fw-accent/20 sticky z-10" style={{ top: 0 }}>
              <div className="flex-1 h-px bg-fw-accent/20" />
              <span className="text-[9px] font-black text-fw-accent/70 uppercase tracking-widest whitespace-nowrap">
                {midPrice > 0 ? formatPrice(midPrice) : 'MID'}
              </span>
              {spread > 0 && (
                <span className={cn('text-[9px] font-mono', spreadColor)}>
                  Δ{formatPrice(spread)}
                </span>
              )}
              <div className="flex-1 h-px bg-fw-accent/20" />
            </div>

            {/* BID levels (best bid at top, descending) */}
            {bids.map((bid, idx) => (
              <PriceRow
                key={`bid-${idx}`}
                bidLevel={showCumulative ? { ...bid, qty: bid.cumQty ?? bid.qty } : bid}
                maxQty={maxQty}
                isMidAbove={true}
                onBidClick={onBidClick}
                onAskClick={onAskClick}
                lastFlash={lastFlashPrice === bid.price}
                wallQty={wallQty}
              />
            ))}
          </>
        )}
      </div>

      {/* ── LIQUIDITY WALLS ── */}
      {walls.length > 0 && (
        <div className="flex gap-1 px-2 py-1 border-t border-fw-border/20 bg-[#0b0d14] flex-shrink-0 flex-wrap">
          {walls.map((w, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border',
                w.side === 'bid'
                  ? 'bg-green/10 border-green/30 text-green'
                  : 'bg-red/10 border-red/30 text-red'
              )}
              style={{ boxShadow: w.side === 'bid' ? '0 0 6px rgba(34,197,94,0.2)' : '0 0 6px rgba(239,68,68,0.2)' }}
            >
              <span>{w.side === 'bid' ? '🟢' : '🔴'} {w.side === 'bid' ? 'BUY' : 'SELL'} WALL</span>
              <span className="font-mono">{formatPrice(w.price)}</span>
              <span className="opacity-70">{fmtQty(w.qty)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ORDER IMBALANCE METER ── */}
      <div className="px-3 py-1.5 border-t border-fw-border/20 bg-[#0b0d14] flex-shrink-0">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="font-bold text-green">
            BUY {bidPct.toFixed(0)}%
            <span className="ml-1 font-mono text-green/60">{fmtQty(totalBid)}</span>
          </span>
          <span className="text-fw-text-muted/60 text-[8px] uppercase tracking-wider">Imbalance</span>
          <span className="font-bold text-red">
            <span className="mr-1 font-mono text-red/60">{fmtQty(totalAsk)}</span>
            SELL {(100 - bidPct).toFixed(0)}%
          </span>
        </div>
        <div className="h-[6px] rounded-full overflow-hidden bg-fw-border/20 flex">
          <div
            className="h-full rounded-l-full transition-all duration-500"
            style={{ width: `${bidPct}%`, background: 'linear-gradient(to right, #16a34a, #22c55e)' }}
          />
          <div
            className="h-full flex-1 rounded-r-full"
            style={{ background: 'linear-gradient(to right, #ef4444, #dc2626)' }}
          />
        </div>
        {/* Pressure label */}
        <div className="flex justify-center mt-0.5">
          <span className={cn('text-[8px] font-bold uppercase tracking-widest',
            bidPct >= 60 ? 'text-green' : bidPct <= 40 ? 'text-red' : 'text-orange-400'
          )}>
            {bidPct >= 60 ? '▲ Buy Pressure' : bidPct <= 40 ? '▼ Sell Pressure' : '⬡ Balanced'}
          </span>
        </div>
      </div>

      {/* ── TIME & SALES TAPE (collapsible) ── */}
      {showTape && (
        <div className="border-t border-fw-border/30 flex-shrink-0" style={{ maxHeight: 140 }}>
          <div className="flex items-center justify-between px-2 py-[3px] bg-[#0d0f18] border-b border-fw-border/20">
            <span className="text-[8px] font-bold text-fw-text-muted uppercase tracking-wider">Time &amp; Sales</span>
            <span className="text-[8px] text-fw-text-muted/50">{tape.length} ticks</span>
          </div>
          <div className="overflow-y-auto scrollbar-none" style={{ maxHeight: 115 }}>
            {tape.length === 0 ? (
              <div className="text-center text-[10px] text-fw-text-muted/40 py-3">Waiting for trades…</div>
            ) : (
              tape.map(entry => <TapeRow key={entry.id} entry={entry} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── utility: add cumulative qty to depth levels ─────────────────────────────
function addCumulative(levels: MarketDepthLevel[]): DepthLevel[] {
  let cum = 0;
  return levels.map(l => {
    cum += l.qty;
    return { ...l, cumQty: cum };
  });
}
