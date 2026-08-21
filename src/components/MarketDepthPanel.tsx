import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { wsService } from '@/services/websocket';
import { cn, formatPrice } from '@/utils/helpers';
import type { MarketDepthLevel } from '@/types';
import { SymbolLogo } from '@/components/SymbolLogo';

// ─── constants ────────────────────────────────────────────────────────────────
const MAX_TAPE        = 150;
const WALL_MULTIPLIER = 4;      // qty > 4× avg = liquidity wall
const ROW_H           = 28;     // px — fixed row height for virtualization
const FLASH_MS        = 350;    // LTP flash duration

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtQty(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000)    return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000)      return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function fmtTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms3 = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms3}`;
}

/** Heatmap intensity: returns css rgba string based on qty vs maxQty */
function heatColor(qty: number, maxQty: number, side: 'bid' | 'ask'): string {
  const ratio = Math.min(1, qty / maxQty);
  if (side === 'bid') {
    // green channel: 22,197,94
    const a = ratio < 0.2 ? 0.03 : ratio < 0.5 ? 0.08 : ratio < 0.8 ? 0.15 : 0.28;
    return `rgba(34,197,94,${a})`;
  } else {
    // red channel: 239,68,68
    const a = ratio < 0.2 ? 0.03 : ratio < 0.5 ? 0.08 : ratio < 0.8 ? 0.15 : 0.28;
    return `rgba(239,68,68,${a})`;
  }
}

// ─── types ────────────────────────────────────────────────────────────────────
interface DepthLevel extends MarketDepthLevel {
  cumQty?: number;
}

interface TapeEntry {
  id:    number;
  time:  number;
  price: number;
  qty:   number;
  side:  'buy' | 'sell';
}

interface HoverInfo {
  price:    number;
  bidQty:   number;
  askQty:   number;
  cumQty:   number;
  distPct:  number; // distance from mid as %
}

// ─── LiqBar — animated width, GPU-composited (transform) ─────────────────────
const LiqBar = memo(function LiqBar({
  pct, side, isWall,
}: { pct: number; side: 'bid' | 'ask'; isWall: boolean }) {
  const color = side === 'bid'
    ? isWall ? 'rgba(34,197,94,0.65)' : 'rgba(34,197,94,0.28)'
    : isWall ? 'rgba(239,68,68,0.65)'  : 'rgba(239,68,68,0.28)';
  const glow  = side === 'bid' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)';
  const dir   = side === 'bid' ? 'to left' : 'to right';
  const wallShadow = isWall
    ? side === 'bid'
      ? '0 0 10px rgba(34,197,94,0.5), inset 0 0 6px rgba(34,197,94,0.15)'
      : '0 0 10px rgba(239,68,68,0.5), inset 0 0 6px rgba(239,68,68,0.15)'
    : 'none';

  return (
    <div
      className="absolute inset-y-0 pointer-events-none"
      style={{
        [side === 'bid' ? 'right' : 'left']: 0,
        width: `${pct}%`,
        background: `linear-gradient(${dir}, ${color}, ${glow})`,
        borderRadius: side === 'bid' ? '3px 0 0 3px' : '0 3px 3px 0',
        boxShadow: wallShadow,
        // Use transform for GPU compositing, not width
        transformOrigin: side === 'bid' ? 'right center' : 'left center',
        transition: 'width 120ms cubic-bezier(0.4,0,0.2,1)',
      }}
    />
  );
});

// ─── PriceRow — single ladder row (memo'd to prevent cascade re-renders) ─────
const PriceRow = memo(function PriceRow({
  price, bidQty, askQty, bidCum, askCum,
  maxQty, wallQty, showCumulative,
  isLtpFlash, isWallBid, isWallAsk,
  onBidClick, onAskClick,
  hovered, onHover, onLeave,
}: {
  price:          number;
  bidQty:         number;
  askQty:         number;
  bidCum:         number;
  askCum:         number;
  maxQty:         number;
  wallQty:        number;
  showCumulative: boolean;
  isLtpFlash:     boolean;
  isWallBid:      boolean;
  isWallAsk:      boolean;
  onBidClick:     (p: number) => void;
  onAskClick:     (p: number) => void;
  hovered:        boolean;
  onHover:        (p: number) => void;
  onLeave:        () => void;
}) {
  const bidDisplay = showCumulative ? bidCum : bidQty;
  const askDisplay = showCumulative ? askCum : askQty;
  const bidPct     = bidQty > 0 ? Math.min(100, (bidQty / maxQty) * 100) : 0;
  const askPct     = askQty > 0 ? Math.min(100, (askQty / maxQty) * 100) : 0;
  const hasBid     = bidQty > 0;
  const hasAsk     = askQty > 0;

  return (
    <div
      className={cn(
        'relative flex items-center select-none border-b border-fw-border/[0.05]',
        'transition-colors duration-75',
        hovered && 'bg-white/[0.025]',
        isLtpFlash && 'dom-ltp-flash',
      )}
      style={{
        height: ROW_H,
        background: hovered ? undefined : isLtpFlash ? undefined
          : hasBid && !hasAsk ? heatColor(bidQty, maxQty, 'bid')
          : hasAsk && !hasBid ? heatColor(askQty, maxQty, 'ask')
          : undefined,
      }}
      onMouseEnter={() => onHover(price)}
      onMouseLeave={onLeave}
    >
      {/* ── BID half (left 50%) ── */}
      <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
        {hasBid && <LiqBar pct={bidPct} side="bid" isWall={isWallBid} />}
      </div>
      {/* ── ASK half (right 50%) ── */}
      <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
        {hasAsk && <LiqBar pct={askPct} side="ask" isWall={isWallAsk} />}
      </div>

      {/* ── BID QTY ── */}
      <div
        className={cn(
          'relative z-10 w-[68px] text-right pr-2 shrink-0 cursor-pointer',
          'font-mono tabular-nums transition-colors duration-75',
          hasBid
            ? isWallBid
              ? 'text-green text-[12px] font-bold'
              : 'text-green/70 text-[11px] font-medium hover:text-green'
            : 'text-transparent text-[11px]',
        )}
        onClick={() => hasBid && onBidClick(price)}
      >
        {hasBid ? fmtQty(bidDisplay) : '·'}
        {isWallBid && <span className="ml-0.5 text-[7px] text-green/50">▲</span>}
      </div>

      {/* ── PRICE (center) ── */}
      <div className="relative z-10 flex-1 flex items-center justify-center">
        <span
          className={cn(
            'font-mono tabular-nums text-[12px] font-bold cursor-pointer px-1',
            'transition-colors duration-75',
            hasBid && !hasAsk  ? 'text-green hover:text-green/80'
            : hasAsk && !hasBid ? 'text-red hover:text-red/80'
            : 'text-fw-text-secondary hover:text-fw-text',
          )}
          onClick={() => hasBid ? onBidClick(price) : onAskClick(price)}
        >
          {formatPrice(price)}
        </span>
      </div>

      {/* ── ASK QTY ── */}
      <div
        className={cn(
          'relative z-10 w-[68px] text-left pl-2 shrink-0 cursor-pointer',
          'font-mono tabular-nums transition-colors duration-75',
          hasAsk
            ? isWallAsk
              ? 'text-red text-[12px] font-bold'
              : 'text-red/70 text-[11px] font-medium hover:text-red'
            : 'text-transparent text-[11px]',
        )}
        onClick={() => hasAsk && onAskClick(price)}
      >
        {hasAsk ? fmtQty(askDisplay) : '·'}
        {isWallAsk && <span className="ml-0.5 text-[7px] text-red/50">▼</span>}
      </div>
    </div>
  );
});

// ─── TapeRow — Time & Sales entry ─────────────────────────────────────────────
const TapeRow = memo(function TapeRow({ entry }: { entry: TapeEntry }) {
  const isBuy = entry.side === 'buy';
  return (
    <div className={cn(
      'grid items-center px-2 border-b border-fw-border/[0.05]',
      'grid-cols-[16px_1fr_56px_auto]',
      isBuy ? 'bg-green/[0.03]' : 'bg-red/[0.03]',
    )} style={{ height: 22 }}>
      {/* Direction indicator */}
      <span className={cn('text-[10px] font-black', isBuy ? 'text-green' : 'text-red')}>
        {isBuy ? '▲' : '▼'}
      </span>
      {/* Price */}
      <span className={cn(
        'font-mono tabular-nums text-[12px] font-semibold',
        isBuy ? 'text-green' : 'text-red',
      )}>
        {formatPrice(entry.price)}
      </span>
      {/* Qty */}
      <span className="font-mono tabular-nums text-[11px] text-fw-text-secondary text-right">
        {fmtQty(entry.qty)}
      </span>
      {/* Time — ms precision */}
      <span className="font-mono text-[9px] text-fw-text-muted/50 text-right pl-2">
        {fmtTimestamp(entry.time)}
      </span>
    </div>
  );
});

// ─── HoverTooltip — shows analytics on row hover ──────────────────────────────
function HoverTooltip({ info, midPrice }: { info: HoverInfo; midPrice: number }) {
  const dist = midPrice > 0 ? ((Math.abs(info.price - midPrice) / midPrice) * 100).toFixed(3) : '—';
  return (
    <div className={cn(
      'absolute right-full top-0 mr-2 z-50 w-[160px]',
      'bg-fw-surface border border-fw-border rounded-lg shadow-2xl',
      'p-2 pointer-events-none',
    )}>
      <div className="space-y-1">
        <Row label="Price"    value={formatPrice(info.price)} />
        <Row label="Bid Qty"  value={info.bidQty  > 0 ? fmtQty(info.bidQty)  : '—'} color="text-green" />
        <Row label="Ask Qty"  value={info.askQty  > 0 ? fmtQty(info.askQty)  : '—'} color="text-red" />
        <Row label="Cum Qty"  value={fmtQty(info.cumQty)} />
        <div className="border-t border-fw-border/30 my-1" />
        <Row label="Dist"     value={`${dist}%`} color="text-fw-text-muted" />
      </div>
    </div>
  );
}
function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] text-fw-text-muted uppercase tracking-wider">{label}</span>
      <span className={cn('text-[11px] font-mono font-semibold tabular-nums', color ?? 'text-fw-text')}>{value}</span>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function MarketDepthPanel() {
  const { activeSymbol }  = useAppStore();
  const quote             = useMarketStore(s => activeSymbol ? s.quotes[activeSymbol.token] : undefined);
  const { setOrderForm }  = useTradingStore();

  // ── state ──────────────────────────────────────────────────────────────────
  const [bids, setBids]               = useState<DepthLevel[]>([]);
  const [asks, setAsks]               = useState<DepthLevel[]>([]);
  const [tape, setTape]               = useState<TapeEntry[]>([]);
  const [ltpFlashPrices, setLtpFlash] = useState<Set<number>>(new Set());
  const [showTape, setShowTape]       = useState(false);
  const [showCumulative, setShowCum]  = useState(false);
  const [hoveredPrice, setHoveredPrice] = useState<number | null>(null);

  const tapeIdRef  = useRef(0);
  const lastLtp    = useRef<number>(0);
  const ladderRef  = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── WebSocket + REST subscription ─────────────────────────────────────────
  useEffect(() => {
    if (!activeSymbol?.token) return;
    setBids([]); setAsks([]); setTape([]);
    lastLtp.current = 0;

    // Derive the exchange hint for this instrument so the server routes the
    // depth subscription to the correct Dhan segment (NSE_FNO, MCX_COMM, etc.).
    // Without this hint the server falls back to the cached quote exchange field
    // which may not yet be set when the component first mounts, causing the depth
    // subscription to use the wrong segment (NSE_EQ) for futures instruments.
    const exchangeHint = activeSymbol.segment === 'MCX' ? 'MCX'
      : activeSymbol.segment === 'CDS'   ? 'CDS'
      : activeSymbol.segment === 'NFO'   ? 'NFO'
      : activeSymbol.segment === 'BFO'   ? 'BFO'
      : activeSymbol.exchange === 'NFO'  ? 'NFO'
      : activeSymbol.exchange === 'BFO'  ? 'BFO'
      : activeSymbol.exchange === 'MCX'  ? 'MCX'
      : activeSymbol.exchange === 'CDS'  ? 'CDS'
      : 'NSE';

    wsService.send({
      type: 'subscribe_depth',
      tokens: [activeSymbol.token],
      exchangeHints: { [activeSymbol.token]: exchangeHint },
    });

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
    // REST fallback poll — WS handles real-time, this is safety-net
    const poll = setInterval(fetchDepth, 2000);

    const depthHandler = (msg: any) => {
      if (msg.token !== activeSymbol.token) return;
      const data = msg.data || msg;
      if (data.bids) setBids(addCumulative(data.bids));
      if (data.asks) setAsks(addCumulative(data.asks));
    };
    wsService.on('depth', depthHandler);

    const quoteHandler = (msg: any) => {
      if (msg.token !== activeSymbol.token) return;
      const ltp = msg.data?.ltp ?? msg.ltp;
      if (!ltp) return;
      const prev = lastLtp.current;
      if (prev > 0 && ltp !== prev) {
        const entry: TapeEntry = {
          id:   ++tapeIdRef.current,
          time: Date.now(),
          price: ltp,
          qty:  msg.data?.lastTradeQty ?? msg.lastTradeQty ?? 1,
          side: ltp >= prev ? 'buy' : 'sell',
        };
        setTape(t => [entry, ...t].slice(0, MAX_TAPE));
        // Flash only the executed price level
        setLtpFlash(prev => new Set(prev).add(ltp));
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setLtpFlash(new Set()), FLASH_MS);
      }
      lastLtp.current = ltp;
    };
    wsService.on('quote', quoteHandler);

    return () => {
      active = false;
      clearInterval(poll);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      wsService.off('depth', depthHandler);
      wsService.off('quote', quoteHandler);
      wsService.send({ type: 'unsubscribe_depth', tokens: [activeSymbol.token] });
    };
  }, [activeSymbol?.token]);

  // ── derived values ─────────────────────────────────────────────────────────
  const maxQty = useMemo(() =>
    Math.max(...bids.map(b => b.qty), ...asks.map(a => a.qty), 1),
  [bids, asks]);

  const totalBid   = useMemo(() => bids.reduce((s, b) => s + b.qty, 0), [bids]);
  const totalAsk   = useMemo(() => asks.reduce((s, a) => s + a.qty, 0), [asks]);
  const grandTotal = totalBid + totalAsk || 1;
  const bidPct     = (totalBid / grandTotal) * 100;

  const bestBid  = bids[0];
  const bestAsk  = asks[0];
  const spread   = bestBid && bestAsk ? bestAsk.price - bestBid.price : 0;
  const midPrice = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : 0;

  const spreadStatus = spread === 0 ? { label: 'Zero', color: 'text-fw-text-muted' }
    : spread <= 0.05 ? { label: 'Tight',  color: 'text-green' }
    : spread <= 0.25 ? { label: 'Normal', color: 'text-orange-400' }
    :                  { label: 'Wide',   color: 'text-red' };

  // Liquidity walls
  const avgBidQty = bids.length ? totalBid / bids.length : 0;
  const avgAskQty = asks.length ? totalAsk / asks.length : 0;
  const wallQty   = Math.max(avgBidQty, avgAskQty) * WALL_MULTIPLIER;

  const wallBidPrices = useMemo(() =>
    new Set(bids.filter(b => b.qty >= wallQty).map(b => b.price)),
  [bids, wallQty]);
  const wallAskPrices = useMemo(() =>
    new Set(asks.filter(a => a.qty >= wallQty).map(a => a.price)),
  [asks, wallQty]);

  // Build unified price ladder: merge bids + asks by price
  const ladder = useMemo(() => {
    const map = new Map<number, { bidQty: number; askQty: number; bidCum: number; askCum: number }>();
    bids.forEach(b => map.set(b.price, { bidQty: b.qty, askQty: 0, bidCum: b.cumQty ?? 0, askCum: 0 }));
    asks.forEach(a => {
      const existing = map.get(a.price);
      if (existing) { existing.askQty = a.qty; existing.askCum = a.cumQty ?? 0; }
      else map.set(a.price, { bidQty: 0, askQty: a.qty, bidCum: 0, askCum: a.cumQty ?? 0 });
    });
    return Array.from(map.entries())
      .map(([price, v]) => ({ price, ...v }))
      .sort((a, b) => b.price - a.price); // descending — asks at top
  }, [bids, asks]);

  const hasData = bids.length > 0 || asks.length > 0;

  // Hover info
  const hoveredInfo = useMemo((): HoverInfo | null => {
    if (hoveredPrice === null) return null;
    const row = ladder.find(r => r.price === hoveredPrice);
    if (!row) return null;
    return {
      price:   hoveredPrice,
      bidQty:  row.bidQty,
      askQty:  row.askQty,
      cumQty:  Math.max(row.bidCum, row.askCum),
      distPct: midPrice > 0 ? (Math.abs(hoveredPrice - midPrice) / midPrice) * 100 : 0,
    };
  }, [hoveredPrice, ladder, midPrice]);

  // ── callbacks ──────────────────────────────────────────────────────────────
  const onBidClick  = useCallback((p: number) => setOrderForm({ price: p, side: 'BUY',  orderType: 'LIMIT' }), [setOrderForm]);
  const onAskClick  = useCallback((p: number) => setOrderForm({ price: p, side: 'SELL', orderType: 'LIMIT' }), [setOrderForm]);
  const onHover     = useCallback((p: number) => setHoveredPrice(p), []);
  const onLeave     = useCallback(() => setHoveredPrice(null), []);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-fw-bg select-none text-fw-text overflow-hidden">

      {/* ══ HEADER — compact single row ═════════════════════════════════════ */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-fw-border bg-fw-surface flex-shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="tv-heading text-fw-text-muted">DOM</span>
          {activeSymbol && (
            <>
              <SymbolLogo symbol={activeSymbol.symbol} size={16} className="flex-shrink-0" />
              <span className="text-[11px] font-bold text-fw-accent truncate">{activeSymbol.symbol}</span>
            </>
          )}
          {quote && (
            <span className={cn(
              'font-mono text-[12px] font-bold tabular-nums tv-smooth-value',
              (quote.changePercent || 0) >= 0 ? 'text-green' : 'text-red',
            )}>
              {formatPrice(quote.ltp)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowCum(v => !v)}
            className={cn(
              'text-[9px] font-bold px-1 py-0.5 rounded border transition-colors',
              showCumulative
                ? 'border-fw-accent text-fw-accent bg-fw-accent/10'
                : 'border-fw-border/40 text-fw-text-muted hover:border-fw-accent/40',
            )}
          >CUM</button>
          <button
            onClick={() => setShowTape(v => !v)}
            className={cn(
              'text-[9px] font-bold px-1 py-0.5 rounded border transition-colors',
              showTape
                ? 'border-fw-accent text-fw-accent bg-fw-accent/10'
                : 'border-fw-border/40 text-fw-text-muted hover:border-fw-accent/40',
            )}
          >T&amp;S</button>
        </div>
      </div>

      {/* ══ BEST BID / ASK + SPREAD — single compact row ════════════════════ */}
      <div className="flex items-center border-b border-fw-border/30 flex-shrink-0" style={{ minHeight: 36 }}>
        {/* Best Bid */}
        <div
          className="flex-1 flex flex-col items-center py-1 cursor-pointer hover:bg-green/[0.08] transition-colors"
          style={{ background: 'rgba(34,197,94,0.04)', boxShadow: 'inset 0 -2px 0 rgba(34,197,94,0.3)' }}
          onClick={() => bestBid && onBidClick(bestBid.price)}
        >
          <span className="text-[8px] text-green/50 uppercase tracking-widest font-semibold">Bid</span>
          <span className="font-mono text-[13px] font-bold tabular-nums text-green leading-none">
            {bestBid ? formatPrice(bestBid.price) : '—'}
          </span>
          <span className="font-mono text-[9px] text-green/40 tabular-nums">{bestBid ? fmtQty(bestBid.qty) : ''}</span>
        </div>
        {/* Spread center */}
        <div className="flex flex-col items-center px-2 flex-shrink-0">
          <span className={cn('font-mono text-[10px] font-bold tabular-nums', spreadStatus.color)}>
            {spread > 0 ? formatPrice(spread) : '—'}
          </span>
          <span className={cn('text-[8px] font-bold uppercase', spreadStatus.color, 'opacity-70')}>
            {spread > 0 ? spreadStatus.label : 'spread'}
          </span>
        </div>
        {/* Best Ask */}
        <div
          className="flex-1 flex flex-col items-center py-1 cursor-pointer hover:bg-red/[0.08] transition-colors"
          style={{ background: 'rgba(239,68,68,0.04)', boxShadow: 'inset 0 -2px 0 rgba(239,68,68,0.3)' }}
          onClick={() => bestAsk && onAskClick(bestAsk.price)}
        >
          <span className="text-[8px] text-red/50 uppercase tracking-widest font-semibold">Ask</span>
          <span className="font-mono text-[13px] font-bold tabular-nums text-red leading-none">
            {bestAsk ? formatPrice(bestAsk.price) : '—'}
          </span>
          <span className="font-mono text-[9px] text-red/40 tabular-nums">{bestAsk ? fmtQty(bestAsk.qty) : ''}</span>
        </div>
      </div>

      {/* ══ COLUMN HEADERS ══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-[60px_1fr_60px] py-[3px] border-b border-fw-border/20 bg-fw-surface flex-shrink-0">
        <span className="text-[8px] text-green/50 text-right pr-1.5 uppercase tracking-wider font-semibold">
          {showCumulative ? 'Cum' : 'Bid'}
        </span>
        <span className="text-[8px] text-fw-text-muted/40 text-center uppercase tracking-wider font-semibold">Price</span>
        <span className="text-[8px] text-red/50 text-left pl-1.5 uppercase tracking-wider font-semibold">
          {showCumulative ? 'Cum' : 'Ask'}
        </span>
      </div>

      {/* ══ PRICE LADDER ════════════════════════════════════════════════════ */}
      <div ref={ladderRef} className="flex-1 overflow-y-auto min-h-0 scrollbar-none relative">
        {!hasData ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-35">
            <div className="w-8 h-8 rounded-full border border-fw-border/30 flex items-center justify-center">
              <span className="text-fw-text-muted text-lg">≡</span>
            </div>
            <span className="text-[11px] text-fw-text-muted">Waiting for depth data</span>
            <span className="text-[9px] text-fw-text-muted/40">Click price to set order</span>
          </div>
        ) : (
          <>
            {/* ASK rows — highest price first, best ask nearest to mid divider */}
            {[...ladder].filter(r => r.askQty > 0).sort((a,b) => b.price - a.price).map(row => (
              <div key={`ask-${row.price}`} className="relative">
                <PriceRow
                  price={row.price}
                  bidQty={row.bidQty} askQty={row.askQty}
                  bidCum={row.bidCum} askCum={row.askCum}
                  maxQty={maxQty} wallQty={wallQty}
                  showCumulative={showCumulative}
                  isLtpFlash={ltpFlashPrices.has(row.price)}
                  isWallBid={wallBidPrices.has(row.price)}
                  isWallAsk={wallAskPrices.has(row.price)}
                  onBidClick={onBidClick} onAskClick={onAskClick}
                  hovered={hoveredPrice === row.price}
                  onHover={onHover} onLeave={onLeave}
                />
                {hoveredPrice === row.price && hoveredInfo && (
                  <div className="absolute top-0 right-full mr-1 z-50">
                    <HoverTooltip info={hoveredInfo} midPrice={midPrice} />
                  </div>
                )}
              </div>
            ))}

            {/* ── MID PRICE DIVIDER ── */}
            <div className="flex items-center gap-1.5 px-2 py-[4px] bg-fw-surface-2 border-y border-fw-accent/15">
              <div className="flex-1 h-px bg-fw-accent/15" />
              <span className="text-[9px] font-bold text-fw-accent/60 uppercase tracking-widest whitespace-nowrap">
                {midPrice > 0 ? formatPrice(midPrice) : 'MID'}
              </span>
              {spread > 0 && (
                <span className={cn('text-[8px] font-mono font-semibold', spreadStatus.color)}>
                  Δ{formatPrice(spread)}
                </span>
              )}
              <div className="flex-1 h-px bg-fw-accent/15" />
            </div>

            {/* BID rows — best bid nearest to mid, lower prices below */}
            {[...ladder].filter(r => r.bidQty > 0).sort((a,b) => b.price - a.price).map(row => (
              <div key={`bid-${row.price}`} className="relative">
                <PriceRow
                  price={row.price}
                  bidQty={row.bidQty} askQty={row.askQty}
                  bidCum={row.bidCum} askCum={row.askCum}
                  maxQty={maxQty} wallQty={wallQty}
                  showCumulative={showCumulative}
                  isLtpFlash={ltpFlashPrices.has(row.price)}
                  isWallBid={wallBidPrices.has(row.price)}
                  isWallAsk={wallAskPrices.has(row.price)}
                  onBidClick={onBidClick} onAskClick={onAskClick}
                  hovered={hoveredPrice === row.price}
                  onHover={onHover} onLeave={onLeave}
                />
                {hoveredPrice === row.price && hoveredInfo && (
                  <div className="absolute top-0 right-full mr-1 z-50">
                    <HoverTooltip info={hoveredInfo} midPrice={midPrice} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ══ LIQUIDITY WALLS ═════════════════════════════════════════════════ */}
      {(wallBidPrices.size > 0 || wallAskPrices.size > 0) && (
        <div className="flex gap-1.5 px-2 py-1.5 border-t border-fw-border/20 bg-fw-surface flex-shrink-0 flex-wrap">
          {[...wallBidPrices].map(price => {
            const lvl = bids.find(b => b.price === price);
            return lvl ? (
              <div key={`wb-${price}`} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-green/25 bg-green/[0.07]"
                style={{ boxShadow: '0 0 8px rgba(34,197,94,0.15)' }}>
                <span className="text-[9px] text-green font-bold uppercase tracking-widest">▲ Buy Wall</span>
                <span className="font-mono text-[11px] text-green font-semibold">{formatPrice(price)}</span>
                <span className="font-mono text-[10px] text-green/60">{fmtQty(lvl.qty)}</span>
              </div>
            ) : null;
          })}
          {[...wallAskPrices].map(price => {
            const lvl = asks.find(a => a.price === price);
            return lvl ? (
              <div key={`wa-${price}`} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-red/25 bg-red/[0.07]"
                style={{ boxShadow: '0 0 8px rgba(239,68,68,0.15)' }}>
                <span className="text-[9px] text-red font-bold uppercase tracking-widest">▼ Sell Wall</span>
                <span className="font-mono text-[11px] text-red font-semibold">{formatPrice(price)}</span>
                <span className="font-mono text-[10px] text-red/60">{fmtQty(lvl.qty)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}

      {/* ══ DOM PRESSURE METER ══════════════════════════════════════════════ */}
      <div className="px-3 py-2 border-t border-fw-border/20 bg-fw-surface flex-shrink-0">
        {/* Labels */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-green">BUY</span>
            <span className="font-mono text-[12px] font-black text-green tabular-nums">{bidPct.toFixed(0)}%</span>
            <span className="font-mono text-[10px] text-green/50 ml-1">{fmtQty(totalBid)}</span>
          </div>
          <span className="tv-label-sm uppercase tracking-widest text-fw-text-muted/50">Pressure</span>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-red/50 mr-1">{fmtQty(totalAsk)}</span>
            <span className="font-mono text-[12px] font-black text-red tabular-nums">{(100 - bidPct).toFixed(0)}%</span>
            <span className="text-[11px] font-bold text-red">SELL</span>
          </div>
        </div>
        {/* Animated pressure bar */}
        <div className="h-[6px] rounded-full overflow-hidden bg-fw-border/15 flex">
          <div
            className="h-full rounded-l-full"
            style={{
              width: `${bidPct}%`,
              background: bidPct >= 60
                ? 'linear-gradient(to right, #15803d, #22c55e)'
                : 'linear-gradient(to right, #166534, #16a34a)',
              transition: 'width 300ms cubic-bezier(0.4,0,0.2,1)',
            }}
          />
          <div
            className="h-full flex-1 rounded-r-full"
            style={{ background: 'linear-gradient(to right, #dc2626, #ef4444)' }}
          />
        </div>
        {/* Pressure label */}
        <div className="flex justify-center mt-1">
          <span className={cn(
            'text-[9px] font-bold uppercase tracking-widest',
            bidPct >= 65 ? 'text-green' : bidPct <= 35 ? 'text-red' : 'text-orange-400',
          )}>
            {bidPct >= 65 ? '▲ Strong Buy Pressure'
              : bidPct <= 35 ? '▼ Strong Sell Pressure'
              : bidPct >= 55 ? '▲ Mild Buy Pressure'
              : bidPct <= 45 ? '▼ Mild Sell Pressure'
              : '⬡ Balanced'}
          </span>
        </div>
      </div>

      {/* ══ TIME & SALES TAPE ═══════════════════════════════════════════════ */}
      {showTape && (
        <div className="border-t border-fw-border/30 flex-shrink-0 flex flex-col" style={{ maxHeight: 150 }}>
          <div className="flex items-center justify-between px-2 py-1 bg-fw-surface border-b border-fw-border/20 flex-shrink-0">
            <span className="tv-label-sm uppercase tracking-widest">Time &amp; Sales</span>
            <span className="tv-support text-fw-text-muted/40">{tape.length} ticks</span>
          </div>
          <div className="overflow-y-auto scrollbar-none flex-1">
            {tape.length === 0 ? (
              <div className="text-center tv-support text-fw-text-muted/35 py-3">Waiting for trades…</div>
            ) : (
              tape.map(e => <TapeRow key={e.id} entry={e} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── utility ─────────────────────────────────────────────────────────────────
function addCumulative(levels: MarketDepthLevel[]): DepthLevel[] {
  let cum = 0;
  return levels.map(l => { cum += l.qty; return { ...l, cumQty: cum }; });
}
