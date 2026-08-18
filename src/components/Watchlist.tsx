/**
 * Watchlist.tsx � FundedWealth Trading Terminal
 * TradeLocker-inspired Markets / Watchlist / News panel.
 * Reuses all existing state, APIs, and Indian instrument data.
 * NO new DB tables. NO new backend routes. NO foreign instruments.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown, RefreshCw, Newspaper, Search, ChevronDown, Star,
  MoreVertical, X, ArrowUpRight, Upload, Plus,
  Info, Newspaper as NewsIcon, ExternalLink,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { wsService } from '@/services/websocket';
import { cn, formatPrice, getChangeColor, debounce } from '@/utils/helpers';
import { searchInstruments, getInstruments } from '@/services/api';
import { SymbolLogo } from '@/components/SymbolLogo';
import type { WatchlistItem, Instrument } from '@/types';

// --- Types --------------------------------------------------------------------

/** Panel mode: watchlist, instrument browser, news feed, or favourites */
type PanelMode = 'watchlist' | 'browser' | 'news' | 'favorites';

/** Segment filter options matching existing Indian market segments */
type SegmentFilter = 'ALL' | 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'CDS';

/**
 * NewsItem � clean interface for future news provider integration.
 * Replace DEV_NEWS_ITEMS with a real API call when a news provider is approved.
 */
export interface NewsItem {
  id: string;
  headline: string;
  /** Symbol this item is tagged to, e.g. "NIFTY 50" */
  symbol?: string;
  /** ISO timestamp string */
  publishedAt: string;
  sentiment?: 'Positive' | 'Negative' | 'Neutral';
  source: string;
  url?: string;
}

// --- Dev-only news placeholder ------------------------------------------------
// These items are shown ONLY when no live news provider is connected.
// They are clearly labelled as development placeholders in the UI.
// Replace this constant with a real API call when approved.
const IS_NEWS_CONNECTED = false; // flip to true when wired to real provider

const DEV_NEWS_ITEMS: NewsItem[] = [
  { id: 'dev-1', headline: 'Nifty 50 opens flat amid mixed global cues; banking stocks in focus', symbol: 'NIFTY 50', publishedAt: new Date(Date.now() - 12 * 60000).toISOString(), sentiment: 'Neutral', source: 'Dev Placeholder' },
  { id: 'dev-2', headline: 'Bank Nifty futures suggest cautious open; RBI policy awaited', symbol: 'BANKNIFTY', publishedAt: new Date(Date.now() - 28 * 60000).toISOString(), sentiment: 'Neutral', source: 'Dev Placeholder' },
  { id: 'dev-3', headline: 'Reliance Industries Q1 results beat estimates on Jio growth', symbol: 'RELIANCE', publishedAt: new Date(Date.now() - 45 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
  { id: 'dev-4', headline: 'HDFC Bank sees strong deposit growth; analyst upgrades', symbol: 'HDFCBANK', publishedAt: new Date(Date.now() - 62 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
  { id: 'dev-5', headline: 'MCX Gold rises 0.4% tracking international prices', symbol: 'GOLD', publishedAt: new Date(Date.now() - 80 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
  { id: 'dev-6', headline: 'USDINR steady ahead of US CPI data; range-bound expected', symbol: 'USDINR FUT', publishedAt: new Date(Date.now() - 95 * 60000).toISOString(), sentiment: 'Neutral', source: 'Dev Placeholder' },
  { id: 'dev-7', headline: 'Sensex gains 150 points; IT and auto stocks lead rally', symbol: 'SENSEX', publishedAt: new Date(Date.now() - 110 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
  { id: 'dev-8', headline: 'SBIN drops on NPA concerns; Q1 credit cost rises', symbol: 'SBIN', publishedAt: new Date(Date.now() - 125 * 60000).toISOString(), sentiment: 'Negative', source: 'Dev Placeholder' },
  { id: 'dev-9', headline: 'TCS wins $500M deal; stock climbs 2% in early trade', symbol: 'TCS', publishedAt: new Date(Date.now() - 140 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
  { id: 'dev-10', headline: 'Crude oil dips on demand concerns; MCX crude watches $80 level', symbol: 'CRUDEOIL', publishedAt: new Date(Date.now() - 155 * 60000).toISOString(), sentiment: 'Negative', source: 'Dev Placeholder' },
  { id: 'dev-11', headline: 'FinnNifty weekly options expiry today; put writing seen at 23000', symbol: 'FINNIFTY', publishedAt: new Date(Date.now() - 170 * 60000).toISOString(), sentiment: 'Neutral', source: 'Dev Placeholder' },
  { id: 'dev-12', headline: 'INFY raises FY27 guidance; margins improve on automation', symbol: 'INFY', publishedAt: new Date(Date.now() - 185 * 60000).toISOString(), sentiment: 'Positive', source: 'Dev Placeholder' },
];

// --- Segment filter config ----------------------------------------------------
const SEGMENT_FILTERS: { value: SegmentFilter; label: string }[] = [
  { value: 'ALL',  label: 'All'      },
  { value: 'NSE',  label: 'Index / Equity' },
  { value: 'BSE',  label: 'BSE'      },
  { value: 'NFO',  label: 'F&O'      },
  { value: 'MCX',  label: 'MCX'      },
  { value: 'CDS',  label: 'Currency' },
];

// --- Helpers ------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Resolve exchange + instrumentType from a WatchlistItem � preserves the
 * exact logic from the original Watchlist.tsx handleSelectItem.
 */
function resolveInstrumentFields(item: WatchlistItem): { exchange: string; instrumentType: 'EQ' | 'FUT' | 'CE' | 'PE' } {
  switch (item.segment) {
    case 'NFO':
      return {
        exchange: 'NFO',
        instrumentType: item.symbol.includes('FUT') ? 'FUT' : item.symbol.endsWith('CE') ? 'CE' : 'PE',
      };
    case 'MCX': return { exchange: 'MCX', instrumentType: 'FUT' };
    case 'CDS': return { exchange: 'CDS', instrumentType: 'FUT' };
    case 'BSE':
    case 'BFO': return { exchange: item.segment, instrumentType: 'EQ' };
    default:    return { exchange: 'NSE', instrumentType: 'EQ' };
  }
}

// --- Portal floating UI helpers -----------------------------------------------

/**
 * useFloatingPosition � calculates the best (x, y) for a floating element
 * that is anchored to a button. Opens below by default; flips above when
 * insufficient space below. Prevents viewport overflow on all sides.
 */
function useFloatingPosition(
  anchorRef: React.RefObject<HTMLDivElement>,
  floatWidth: number,
  floatHeight: number,
  open: boolean,
): { top: number; left: number } {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prefer right-aligned to anchor right edge, clamp inside viewport
    let left = anchor.right - floatWidth;
    if (left < 4) left = 4;
    if (left + floatWidth > vw - 4) left = vw - floatWidth - 4;

    // Vertical: open below if enough room, otherwise above
    const spaceBelow = vh - anchor.bottom;
    const spaceAbove = anchor.top;
    let top: number;
    if (spaceBelow >= floatHeight + 4 || spaceBelow >= spaceAbove) {
      top = anchor.bottom + 2;
    } else {
      top = anchor.top - floatHeight - 2;
    }
    // Clamp
    if (top < 4) top = 4;
    if (top + floatHeight > vh - 4) top = vh - floatHeight - 4;

    setPos({ top, left });
  }, [open, anchorRef, floatWidth, floatHeight]);

  return pos;
}

// --- InstrumentDetails popup � portal version ---------------------------------

interface InstrumentDetailsProps {
  instrument: Instrument | WatchlistItem;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement>;
}

const DETAILS_WIDTH = 224;  // w-56
const DETAILS_HEIGHT = 228; // ~9 rows � ~24px + header

function InstrumentDetails({ instrument, onClose, anchorRef }: InstrumentDetailsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useFloatingPosition(anchorRef, DETAILS_WIDTH, DETAILS_HEIGHT, true);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, anchorRef]);

  const name      = (instrument as Instrument).name      || '�';
  const exchange  = (instrument as Instrument).exchange  || instrument.segment || '�';
  const lotSize   = (instrument as Instrument).lotSize;
  const tickSize  = (instrument as Instrument).tickSize;
  const expiry    = (instrument as Instrument).expiry    || '�';
  const instrType = (instrument as Instrument).instrumentType || '�';

  const rows: { label: string; value: string | number }[] = [
    { label: 'Symbol',    value: instrument.symbol },
    { label: 'Name',      value: name },
    { label: 'Exchange',  value: exchange },
    { label: 'Segment',   value: instrument.segment },
    { label: 'Type',      value: instrType },
    { label: 'Token',     value: instrument.token },
    { label: 'Lot Size',  value: lotSize != null ? lotSize : '�' },
    { label: 'Tick Size', value: tickSize != null ? tickSize : '�' },
    { label: 'Expiry',    value: expiry },
  ];

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: DETAILS_WIDTH,
        zIndex: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      }}
      className="bg-fw-surface border border-fw-border rounded-lg overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-fw-border flex items-center justify-between">
        <span className="text-[11px] font-bold text-fw-text uppercase tracking-widest">Instrument Details</span>
        <button onClick={onClose} className="text-fw-text-muted hover:text-fw-text">
          <X size={11} />
        </button>
      </div>
      <div className="py-1">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid grid-cols-[80px_1fr] px-3 py-[3px]">
            <span className="text-[11px] text-fw-text-muted">{label}</span>
            <span className="text-[11px] text-fw-text font-medium truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// --- ContextMenu � portal version ---------------------------------------------

interface ContextMenuProps {
  item: WatchlistItem;
  isPinned: boolean;
  anchorRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  onOpen: () => void;
  onDetails: () => void;
  onToggleFavorite: () => void;
  onInstrumentNews: () => void;
}

const MENU_WIDTH  = 208; // w-52
const MENU_HEIGHT = 148; // header ~40px + 4 items ~26px each

function ContextMenu({
  item, isPinned, anchorRef,
  onClose, onOpen, onDetails, onToggleFavorite, onInstrumentNews,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = useFloatingPosition(anchorRef, MENU_WIDTH, MENU_HEIGHT, true);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, anchorRef]);

  const menuItems = [
    {
      icon: <ArrowUpRight size={13} />,
      label: 'Open Instrument',
      onClick: () => { onOpen(); onClose(); },
    },
    {
      icon: <Info size={13} />,
      label: 'View Details',
      onClick: () => { onDetails(); onClose(); },
    },
    {
      icon: <Star size={13} className={isPinned ? 'fill-fw-accent text-fw-accent' : ''} />,
      label: isPinned ? 'Remove from Watchlist' : 'Add to Watchlist',
      onClick: () => { onToggleFavorite(); onClose(); },
    },
    {
      icon: <NewsIcon size={13} />,
      label: 'Instrument News',
      onClick: () => { onInstrumentNews(); onClose(); },
    },
  ];

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: MENU_WIDTH,
        zIndex: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      }}
      className="bg-fw-surface border border-fw-border rounded-lg overflow-hidden"
    >
      {/* Header — instrument name */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border/60">
        <SymbolLogo symbol={item.symbol} size={18} />
        <span className="text-[12px] font-bold text-fw-text truncate">{item.symbol}</span>
        <span className="ml-auto text-[10px] text-fw-text-muted bg-fw-border/40 px-1.5 py-0.5 rounded flex-shrink-0">
          {item.segment}
        </span>
      </div>
      {/* Actions */}
      <div className="py-1">
        {menuItems.map((mi) => (
          <button
            key={mi.label}
            onClick={mi.onClick}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover/50 transition-colors text-left"
          >
            <span className="text-fw-text-muted flex-shrink-0">{mi.icon}</span>
            {mi.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// --- WatchlistRow -------------------------------------------------------------

interface WatchlistRowProps {
  item: WatchlistItem;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onPin: () => void;
  onOpenNews: (symbol: string) => void;
}

function WatchlistRow({ item, isSelected, isPinned, onSelect, onRemove, onPin, onOpenNews }: WatchlistRowProps) {
  const quote = useMarketStore((s) => s.quotes[item.token]);
  const prevLtpRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  // Tick flash
  useEffect(() => {
    if (!quote?.ltp || prevLtpRef.current === null) {
      prevLtpRef.current = quote?.ltp ?? null;
      return;
    }
    if (quote.ltp !== prevLtpRef.current) {
      setFlash(quote.ltp > prevLtpRef.current ? 'green' : 'red');
    }
    prevLtpRef.current = quote.ltp;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [quote?.ltp]);

  // Close menu when another row opens � handled via global open state in parent.
  // We rely on the pointer-outside listener in ContextMenu itself.

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((v) => !v);
    setDetailsOpen(false);
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  };

  return (
    <div
      className={cn(
        'group relative flex items-center px-2 h-[42px] cursor-pointer border-b border-fw-border/[0.08] transition-colors',
        isSelected
          ? 'bg-fw-accent/[0.07] border-l-2 border-l-fw-accent'
          : 'hover:bg-fw-hover/30 border-l-2 border-l-transparent'
      )}
      onClick={onSelect}
    >
      {/* Symbol + logo column */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <SymbolLogo symbol={item.symbol} size={22} className="flex-shrink-0" />
        <div className="flex flex-col min-w-0 leading-none gap-[2px]">
          <span className={cn('text-[13px] font-semibold truncate', isSelected ? 'text-fw-text' : 'text-fw-text/90')}>
            {item.symbol}
          </span>
          <span className="text-[11px] text-fw-text-muted">{item.segment}</span>
        </div>
      </div>

      {/* LTP */}
      <span className={cn(
        'text-[13px] font-semibold tabular-nums w-[72px] text-right flex-shrink-0',
        quote ? getChangeColor(quote.changePercent) : 'text-fw-text-secondary',
        flash === 'green' && 'animate-[priceFlashGreen_0.6s_ease-out]',
        flash === 'red'   && 'animate-[priceFlashRed_0.6s_ease-out]',
      )}>
        {quote ? formatPrice(quote.ltp) : '�'}
      </span>

      {/* Change pill */}
      <div className="w-[52px] flex-shrink-0 flex justify-end">
        {quote ? (
          <span className={cn(
            'text-[10px] font-semibold px-1 py-0.5 rounded tabular-nums',
            (quote.changePercent || 0) >= 0 ? 'text-green bg-green/10' : 'text-red bg-red/10',
          )}>
            {(quote.changePercent || 0) >= 0 ? '+' : ''}{(quote.changePercent || 0).toFixed(2)}%
          </span>
        ) : (
          <span className="text-[10px] text-fw-text-muted/40">�</span>
        )}
      </div>

      {/* -- Always-visible star -- 32�32 hit area, 16px icon */}
      <button
        aria-label={isPinned ? 'Remove from watchlist' : 'Add to watchlist'}
        onClick={handlePin}
        className={cn(
          'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded transition-colors',
          isPinned
            ? 'text-fw-accent'
            : 'text-fw-text-muted/40 hover:text-fw-text-muted',
        )}
      >
        <Star size={15} className={isPinned ? 'fill-fw-accent' : ''} />
      </button>

      {/* -- ? menu button -- */}
      <div ref={menuAnchorRef} className="relative flex-shrink-0">
        <button
          aria-label="More actions"
          onClick={handleMenuToggle}
          className="flex items-center justify-center w-6 h-8 text-fw-text-muted/40 hover:text-fw-text-secondary rounded transition-colors"
        >
          <MoreVertical size={13} />
        </button>

        {menuOpen && (
          <ContextMenu
            item={item}
            isPinned={isPinned}
            anchorRef={menuAnchorRef}
            onClose={() => setMenuOpen(false)}
            onOpen={() => { onSelect(); }}
            onDetails={() => setDetailsOpen(true)}
            onToggleFavorite={() => onPin()}
            onInstrumentNews={() => onOpenNews(item.symbol)}
          />
        )}

        {detailsOpen && (
          <InstrumentDetails
            instrument={item}
            anchorRef={menuAnchorRef}
            onClose={() => setDetailsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// --- BrowserRow � used in the Instrument Browser (? mode) -------------------

interface BrowserRowProps {
  instrument: Instrument;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onPin: () => void;
  onOpenNews: (symbol: string) => void;
  currentWlId: string;
}

function BrowserRow({ instrument, isSelected, isPinned, onSelect, onPin, onOpenNews, currentWlId }: BrowserRowProps) {
  const { addToWatchlist } = useAppStore();
  const quote = useMarketStore((s) => s.quotes[instrument.token]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  const asWlItem: WatchlistItem = { token: instrument.token, symbol: instrument.symbol, segment: instrument.segment };

  const handleAddToWl = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToWatchlist(currentWlId, asWlItem);
    const hints = instrument.segment !== 'NSE' ? { [instrument.token]: instrument.segment } : undefined;
    wsService.subscribe([instrument.token], hints);
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  };

  return (
    <div
      className={cn(
        'group relative flex items-center px-2 h-[42px] cursor-pointer border-b border-fw-border/[0.08] transition-colors',
        isSelected
          ? 'bg-fw-accent/[0.07] border-l-2 border-l-fw-accent'
          : 'hover:bg-fw-hover/30 border-l-2 border-l-transparent'
      )}
      onClick={onSelect}
    >
      {/* Symbol */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <SymbolLogo symbol={instrument.symbol} size={22} className="flex-shrink-0" />
        <div className="flex flex-col min-w-0 leading-none gap-[2px]">
          <span className={cn('text-[12px] font-semibold truncate', isSelected ? 'text-fw-text' : 'text-fw-text/90')}>
            {instrument.symbol}
          </span>
          <span className="text-[10px] text-fw-text-muted">{instrument.segment}</span>
        </div>
      </div>

      {/* LTP (may be unavailable if not subscribed) */}
      <span className={cn('text-[13px] font-semibold tabular-nums w-[72px] text-right flex-shrink-0', quote ? getChangeColor(quote.changePercent) : 'text-fw-text-secondary')}>
        {quote ? formatPrice(quote.ltp) : '�'}
      </span>

      {/* Star */}
      <button
        aria-label={isPinned ? 'Remove from watchlist' : 'Add to watchlist'}
        onClick={handlePin}
        className={cn(
          'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded transition-colors',
          isPinned ? 'text-fw-accent' : 'text-fw-text-muted/40 hover:text-fw-text-muted',
        )}
      >
        <Star size={15} className={isPinned ? 'fill-fw-accent' : ''} />
      </button>

      {/* + add to current watchlist (quick action, visible on hover) */}
      <button
        title="Add to current watchlist"
        onClick={handleAddToWl}
        className="flex-shrink-0 flex items-center justify-center w-6 h-8 text-fw-text-muted/30 hover:text-fw-accent rounded transition-colors opacity-0 group-hover:opacity-100"
      >
        <Plus size={12} />
      </button>

      {/* ? */}
      <div ref={menuAnchorRef} className="relative flex-shrink-0">
        <button
          aria-label="More actions"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); setDetailsOpen(false); }}
          className="flex items-center justify-center w-6 h-8 text-fw-text-muted/40 hover:text-fw-text-secondary rounded transition-colors"
        >
          <MoreVertical size={13} />
        </button>
        {menuOpen && (
          <ContextMenu
            item={asWlItem}
            isPinned={isPinned}
            anchorRef={menuAnchorRef}
            onClose={() => setMenuOpen(false)}
            onOpen={() => { onSelect(); }}
            onDetails={() => setDetailsOpen(true)}
            onToggleFavorite={() => onPin()}
            onInstrumentNews={() => onOpenNews(instrument.symbol)}
          />
        )}
        {detailsOpen && (
          <InstrumentDetails
            instrument={instrument}
            anchorRef={menuAnchorRef}
            onClose={() => setDetailsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// --- NewsPanel ----------------------------------------------------------------

type NewsMode = 'all' | 'favorites' | 'instrument';

interface NewsPanelProps {
  /** Symbol to show when newsMode === 'instrument' */
  instrumentSymbol?: string;
  pinnedTokens: string[];
  watchlists: import('@/types').Watchlist[];
  onBack: () => void;
}

function NewsPanel({ instrumentSymbol, pinnedTokens, watchlists, onBack }: NewsPanelProps) {
  const [newsMode, setNewsMode] = useState<NewsMode>(instrumentSymbol ? 'instrument' : 'all');

  // When instrumentSymbol changes (e.g. opened from ? menu), switch to instrument mode
  useEffect(() => {
    if (instrumentSymbol) setNewsMode('instrument');
  }, [instrumentSymbol]);

  // Build filtered news list
  const newsItems = useMemo<NewsItem[]>(() => {
    const source = IS_NEWS_CONNECTED ? [] /* replace with live fetch */ : DEV_NEWS_ITEMS;
    if (newsMode === 'all') return source;

    if (newsMode === 'instrument' && instrumentSymbol) {
      const sym = instrumentSymbol.toUpperCase();
      return source.filter(n => n.symbol && n.symbol.toUpperCase().includes(sym));
    }

    if (newsMode === 'favorites') {
      // Gather symbols of all pinned items across all watchlists
      const pinnedSymbols = new Set<string>();
      watchlists.forEach(wl => {
        wl.items.forEach(item => {
          if (pinnedTokens.includes(item.token)) pinnedSymbols.add(item.symbol.toUpperCase());
        });
      });
      if (pinnedSymbols.size === 0) return source; // fall back to all if nothing pinned
      return source.filter(n => n.symbol && pinnedSymbols.has(n.symbol.toUpperCase()));
    }

    return source;
  }, [newsMode, instrumentSymbol, pinnedTokens, watchlists]);

  const tabs: { mode: NewsMode; label: string }[] = [
    { mode: 'all',        label: 'All News' },
    { mode: 'favorites',  label: 'Watchlist' },
    ...(instrumentSymbol ? [{ mode: 'instrument' as NewsMode, label: instrumentSymbol }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* News sub-toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-fw-border flex-shrink-0 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button
            key={t.mode}
            onClick={() => setNewsMode(t.mode)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-semibold rounded whitespace-nowrap transition-colors',
              newsMode === t.mode
                ? 'bg-fw-accent/15 text-fw-accent'
                : 'text-fw-text-muted hover:text-fw-text-secondary hover:bg-fw-hover/30',
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={onBack}
          className="ml-auto flex-shrink-0 flex items-center justify-center w-6 h-6 text-fw-text-muted hover:text-fw-text rounded transition-colors"
          title="Back to instruments"
        >
          <X size={12} />
        </button>
      </div>

      {/* Dev notice when not connected */}
      {!IS_NEWS_CONNECTED && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/20 border-b border-amber-800/30 flex-shrink-0">
          <span className="text-[10px] text-amber-400/80 leading-tight">
            Dev mode � connect a news provider to show live data
          </span>
        </div>
      )}

      {/* News items */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-fw-border scrollbar-track-transparent">
        {newsItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-fw-text-muted gap-1">
            <Newspaper size={20} className="opacity-30" />
            <p className="text-[11px]">No news available</p>
            {newsMode === 'favorites' && (
              <p className="text-[10px] text-fw-text-muted/60">Star instruments to see their news here</p>
            )}
          </div>
        ) : (
          <div className="py-1 px-2 space-y-1.5">
            {newsItems.map(item => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const sentimentColor =
    item.sentiment === 'Positive' ? 'text-green border-l-green' :
    item.sentiment === 'Negative' ? 'text-red border-l-red' :
    'text-fw-text-muted border-l-fw-border';

  return (
    <div className={cn('border-l-2 pl-2.5 py-1.5 rounded-r bg-fw-border/5', sentimentColor)}>
      <div className="flex items-start gap-1">
        <p className="flex-1 text-[11px] text-fw-text leading-snug font-medium">{item.headline}</p>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex-shrink-0 mt-0.5 text-fw-text-muted hover:text-fw-accent transition-colors"
          >
            <ExternalLink size={11} />
          </a>
        ) : (
          <ExternalLink size={11} className="flex-shrink-0 mt-0.5 text-fw-text-muted/20" />
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {item.symbol && (
          <span className="text-[10px] text-fw-text-muted font-medium">{item.symbol}</span>
        )}
        <span className="text-[10px] text-fw-text-muted/60">�</span>
        <span className="text-[10px] text-fw-text-muted/70">{formatRelativeTime(item.publishedAt)}</span>
        {item.sentiment && (
          <>
            <span className="text-[10px] text-fw-text-muted/60">�</span>
            <span className={cn('text-[10px] font-semibold', sentimentColor.split(' ')[0])}>
              {item.sentiment}
            </span>
          </>
        )}
        <span className="text-[10px] text-fw-text-muted/60">�</span>
        <span className="text-[10px] text-fw-text-muted/60">{item.source}</span>
      </div>
    </div>
  );
}

// --- InstrumentBrowser � ? mode ----------------------------------------------

interface InstrumentBrowserProps {
  onOpenNews: (symbol: string) => void;
  currentWlId: string;
  activeSymbol: Instrument | null;
  pinnedTokens: string[];
  onSelectInstrument: (inst: Instrument) => void;
}

function InstrumentBrowser({ onOpenNews, currentWlId, activeSymbol, pinnedTokens, onSelectInstrument }: InstrumentBrowserProps) {
  const { togglePinToken } = useAppStore();
  const [query, setQuery] = useState('');
  const [segFilter, setSegFilter] = useState<SegmentFilter>('ALL');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [results, setResults] = useState<Instrument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close filter dropdown on outside click
  useEffect(() => {
    function handler(e: PointerEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  // Debounced search using existing API
  const doSearch = useCallback(
    debounce(async (q: string, seg: SegmentFilter) => {
      setIsLoading(true);
      try {
        let data: Instrument[];
        if (q.trim()) {
          data = await searchInstruments(q, seg === 'ALL' ? undefined : seg);
        } else {
          // No query � show all instruments for the selected segment
          data = await getInstruments(seg === 'ALL' ? 'NSE' : seg);
          // If ALL, merge a couple of segments for a good default list
          if (seg === 'ALL') {
            const extra = await Promise.all([
              getInstruments('NFO'),
              getInstruments('MCX'),
              getInstruments('CDS'),
            ]);
            data = [...data, ...extra.flat()];
          }
        }
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 250),
    [],
  );

  // Initial load + re-fetch on filter/query change
  useEffect(() => {
    doSearch(query, segFilter);
  }, [query, segFilter]);

  const activeSegLabel = SEGMENT_FILTERS.find(s => s.value === segFilter)?.label ?? 'All';

  return (
    <div className="flex flex-col h-full">
      {/* Search row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-fw-border flex-shrink-0">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-fw-text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search instruments..."
            className="w-full bg-fw-surface-2 border border-fw-border/50 rounded text-[12px] text-fw-text pl-6 pr-6 py-1 outline-none focus:border-fw-accent/60 placeholder:text-fw-text-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fw-text-muted hover:text-fw-text">
              <X size={10} />
            </button>
          )}
        </div>

        {/* Segment filter dropdown */}
        <div ref={filterMenuRef} className="relative flex-shrink-0">
          <button
            onClick={() => setShowFilterMenu(v => !v)}
            className="flex items-center gap-1 px-2 py-1 bg-fw-surface-2 border border-fw-border/50 rounded text-[11px] text-fw-text-secondary hover:text-fw-text hover:border-fw-border transition-colors whitespace-nowrap"
          >
            <span>{activeSegLabel}</span>
            <ChevronDown size={10} className={cn('transition-transform', showFilterMenu && 'rotate-180')} />
          </button>
          {showFilterMenu && (
            <div className="absolute right-0 top-full mt-0.5 z-[200] w-40 bg-fw-surface border border-fw-border rounded-lg shadow-2xl overflow-hidden py-1"
                 style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              {SEGMENT_FILTERS.map(sf => (
                <button
                  key={sf.value}
                  onClick={() => { setSegFilter(sf.value); setShowFilterMenu(false); }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors text-left',
                    segFilter === sf.value
                      ? 'text-fw-accent bg-fw-accent/10'
                      : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover/50',
                  )}
                >
                  {sf.label}
                  {segFilter === sf.value && <span className="text-fw-accent">?</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_72px] px-3 py-[3px] border-b border-fw-border/30 flex-shrink-0 bg-fw-surface">
        <span className="text-[11px] text-fw-text-secondary uppercase tracking-widest">Instrument</span>
        <span className="text-[11px] text-fw-text-secondary uppercase tracking-widest text-right">LTP</span>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-fw-border scrollbar-track-transparent">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-fw-text-muted text-[11px]">
            <RefreshCw size={13} className="animate-spin mr-2" /> Loading...
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-fw-text-muted gap-1">
            <Search size={18} className="opacity-30" />
            <p className="text-[11px]">{query ? `No results for "${query}"` : 'No instruments found'}</p>
          </div>
        ) : (
          results.map(inst => (
            <BrowserRow
              key={inst.token}
              instrument={inst}
              isSelected={activeSymbol?.token === inst.token}
              isPinned={pinnedTokens.includes(inst.token)}
              onSelect={() => onSelectInstrument(inst)}
              onPin={() => togglePinToken(inst.token)}
              onOpenNews={onOpenNews}
              currentWlId={currentWlId}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --- FavoritesView ------------------------------------------------------------

interface FavoritesViewProps {
  pinnedTokens: string[];
  watchlists: import('@/types').Watchlist[];
  activeSymbol: Instrument | null;
  onSelect: (item: WatchlistItem) => void;
  onPin: (token: string) => void;
  onOpenNews: (symbol: string) => void;
  currentWlId: string;
}

function FavoritesView({ pinnedTokens, watchlists, activeSymbol, onSelect, onPin, onOpenNews, currentWlId }: FavoritesViewProps) {
  // Collect unique pinned items across all watchlists, preserving order of first occurrence
  const favItems = useMemo<WatchlistItem[]>(() => {
    const seen = new Set<string>();
    const items: WatchlistItem[] = [];
    watchlists.forEach(wl => {
      wl.items.forEach(item => {
        if (pinnedTokens.includes(item.token) && !seen.has(item.token)) {
          seen.add(item.token);
          items.push(item);
        }
      });
    });
    return items;
  }, [pinnedTokens, watchlists]);

  return (
    <div className="flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-center px-3 py-1.5 border-b border-fw-border flex-shrink-0">
        <Star size={12} className="fill-fw-accent text-fw-accent mr-1.5" />
        <span className="text-[11px] font-bold text-fw-text uppercase tracking-widest">Favourites</span>
        <span className="ml-2 text-[10px] text-fw-text-muted bg-fw-border/30 px-1.5 py-0.5 rounded font-mono">{favItems.length}</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_68px_52px] px-3 py-[3px] border-b border-fw-border/30 flex-shrink-0 bg-fw-surface">
        <span className="text-[10px] text-fw-text-muted uppercase tracking-widest">Symbol</span>
        <span className="text-[10px] text-fw-text-muted uppercase tracking-widest text-right">LTP</span>
        <span className="text-[10px] text-fw-text-muted uppercase tracking-widest text-right">Chg%</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-fw-border scrollbar-track-transparent">
        {favItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-fw-text-muted gap-1.5">
            <Star size={20} className="opacity-20" />
            <p className="text-[11px]">No starred instruments</p>
            <p className="text-[10px] text-fw-text-muted/60 text-center px-4">
              Click ? on any instrument to add it here
            </p>
          </div>
        ) : (
          favItems.map(item => (
            <WatchlistRow
              key={item.token}
              item={item}
              isSelected={activeSymbol?.token === item.token}
              isPinned={true}
              onSelect={() => onSelect(item)}
              onRemove={() => {}} // removal handled via star in this view
              onPin={() => onPin(item.token)}
              onOpenNews={onOpenNews}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --- ImportPanel --------------------------------------------------------------

interface ImportPanelProps {
  onClose: () => void;
  activeWatchlist: import('@/types').Watchlist | undefined;
  watchlists: import('@/types').Watchlist[];
  currentWlId: string;
  setWatchlists: (wl: import('@/types').Watchlist[]) => void;
}

function ImportPanel({ onClose, activeWatchlist, watchlists, currentWlId, setWatchlists }: ImportPanelProps) {
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!importText.trim() || !activeWatchlist) return;
    const symbols = importText.split(/[,\n;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
    const existing = new Set(activeWatchlist.items.map(i => i.symbol));
    const toResolve = symbols.filter(s => !existing.has(s));

    if (toResolve.length === 0) { setImportStatus('All symbols already in watchlist.'); return; }

    setImporting(true);
    setImportStatus(`Resolving ${toResolve.length} symbol(s)...`);
    const added: string[] = [];
    const notFound: string[] = [];
    const newItems: WatchlistItem[] = [];

    for (const sym of toResolve) {
      try {
        const results = await searchInstruments(sym);
        const match = results.find(r => r.symbol === sym) || results.find(r => r.symbol.startsWith(sym));
        if (match) {
          newItems.push({ token: match.token, symbol: match.symbol, segment: match.segment });
          added.push(match.symbol);
        } else { notFound.push(sym); }
      } catch { notFound.push(sym); }
    }

    if (newItems.length > 0) {
      const updated = watchlists.map(wl =>
        wl.id === currentWlId ? { ...wl, items: [...wl.items, ...newItems] } : wl
      );
      setWatchlists(updated);
      const hints: Record<string, string> = {};
      newItems.forEach(item => { if (item.segment !== 'NSE') hints[item.token] = item.segment; });
      wsService.subscribe(newItems.map(i => i.token), Object.keys(hints).length > 0 ? hints : undefined);
    }

    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (notFound.length > 0) parts.push(`${notFound.length} not found: ${notFound.join(', ')}`);
    setImportStatus(parts.join(' � '));
    setImporting(false);
    setImportText('');
  };

  return (
    <div className="px-2 py-2 border-b border-fw-border bg-fw-surface space-y-1.5 flex-shrink-0">
      <textarea
        placeholder="RELIANCE, TCS, INFY, NIFTY..."
        value={importText}
        onChange={e => { setImportText(e.target.value); setImportStatus(null); }}
        rows={2}
        className="w-full bg-fw-surface-2 border border-fw-border rounded text-[12px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent resize-none"
      />
      {importStatus && (
        <p className={cn('text-[11px] font-medium', importStatus.includes('not found') ? 'text-orange-400' : 'text-emerald-400')}>
          {importStatus}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={handleImport}
          disabled={importing || !importText.trim()}
          className="px-3 py-1 text-[11px] bg-fw-accent text-white rounded font-semibold disabled:opacity-50"
        >
          {importing ? 'Resolving�' : 'Import'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1 text-[11px] text-fw-text-secondary border border-fw-border rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Main Watchlist Component -------------------------------------------------

export function Watchlist() {
  const {
    watchlists, activeWorkspace, removeFromWatchlist, setActiveSymbol,
    activeSymbol, setWatchlists, pinnedTokens, togglePinToken,
    activeWatchlistTab, setActiveWatchlistTab,
  } = useAppStore();

  const [panelMode, setPanelMode] = useState<PanelMode>('watchlist');
  const [newsInstrumentSymbol, setNewsInstrumentSymbol] = useState<string | undefined>(undefined);
  const [showImport, setShowImport] = useState(false);
  const [inlineQuery, setInlineQuery] = useState('');
  const [inlineResults, setInlineResults] = useState<Instrument[]>([]);
  const [inlineLoading, setInlineLoading] = useState(false);
  const [showSegFilter, setShowSegFilter] = useState(false);
  const [segFilter, setSegFilter] = useState<SegmentFilter>('ALL');
  const segFilterRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const currentWlId = activeWatchlistTab || activeWorkspace;
  const activeWatchlist = watchlists.find(wl => wl.id === currentWlId || wl.name.toLowerCase() === currentWlId);

  // Close seg-filter dropdown on outside click
  useEffect(() => {
    function handler(e: PointerEvent) {
      if (segFilterRef.current && !segFilterRef.current.contains(e.target as Node)) {
        setShowSegFilter(false);
      }
    }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  // Debounced inline search for watchlist mode
  const doInlineSearch = useCallback(
    debounce(async (q: string, seg: SegmentFilter) => {
      if (!q.trim()) { setInlineResults([]); return; }
      setInlineLoading(true);
      try {
        const data = await searchInstruments(q, seg === 'ALL' ? undefined : seg);
        setInlineResults(data);
      } catch { setInlineResults([]); }
      finally { setInlineLoading(false); }
    }, 250),
    [],
  );

  useEffect(() => {
    doInlineSearch(inlineQuery, segFilter);
  }, [inlineQuery, segFilter]);

  // Filtered items for watchlist view
  const filteredItems = useMemo(() => {
    if (!activeWatchlist) return [];
    let items = [...activeWatchlist.items];

    // Apply inline filter
    if (inlineQuery.trim()) {
      const q = inlineQuery.toLowerCase();
      items = items.filter(item => item.symbol.toLowerCase().includes(q));
    }

    // Apply segment filter
    if (segFilter !== 'ALL') {
      items = items.filter(item => item.segment === segFilter);
    }

    // Pinned items sort to top
    items.sort((a, b) => {
      const aP = pinnedTokens.includes(a.token) ? 0 : 1;
      const bP = pinnedTokens.includes(b.token) ? 0 : 1;
      return aP - bP;
    });
    return items;
  }, [activeWatchlist, inlineQuery, segFilter, pinnedTokens]);

  // handleSelectItem — enhanced with dynamic option linking
  const handleSelectItem = useCallback((item: WatchlistItem) => {
    useTradingStore.getState().setSelectedContract(null);
    const { exchange, instrumentType } = resolveInstrumentFields(item);
    const instrument: Instrument = {
      token: item.token,
      symbol: item.symbol,
      name: item.symbol,
      segment: item.segment,
      instrumentType,
      exchange,
      lotSize: 1,
      tickSize: 0.05,
    };
    setActiveSymbol(instrument);

    // Dynamic option linking: when a stock is clicked in the STOCKS tab,
    // update activeSymbol so switching to OPTIONS tab immediately fetches
    // that stock's option chain (OPTIONS workspace uses activeSymbol as underlying)
    const currentTab = activeWatchlistTab || activeWorkspace;
    if (currentTab === 'stocks' && item.segment === 'NSE') {
      // activeSymbol is already set — OPTIONS tab/workspace reads it as underlying
      // No additional action needed; the option chain component uses activeSymbol
    }
  }, [setActiveSymbol, activeWatchlistTab, activeWorkspace]);

  // Select instrument from browser (has full data)
  const handleSelectFromBrowser = useCallback((inst: Instrument) => {
    useTradingStore.getState().setSelectedContract(null);
    setActiveSymbol(inst);
  }, [setActiveSymbol]);

  // Open news panel for a specific instrument
  const openInstrumentNews = useCallback((symbol: string) => {
    setNewsInstrumentSymbol(symbol);
    setPanelMode('news');
  }, []);

  const activeSegLabel = SEGMENT_FILTERS.find(s => s.value === segFilter)?.label ?? 'All';

  // -- Render -----------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-fw-bg overflow-hidden">

      {/* -- TOP TOOLBAR: [ ? ] [ ? ] [ Search... ] [ All ? ] [ ? ] --------- */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-fw-border flex-shrink-0 bg-fw-surface-2">

        {/* ? Instrument Browser toggle */}
        <button
          aria-label="Instrument browser"
          title="Instrument browser"
          onClick={() => setPanelMode(m => m === 'browser' ? 'watchlist' : 'browser')}
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-7 h-7 rounded transition-colors',
            panelMode === 'browser'
              ? 'bg-fw-accent/20 text-fw-accent'
              : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/50',
          )}
        >
          <ArrowUpDown size={13} />
        </button>

        {/* ? News toggle */}
        <button
          aria-label="News"
          title="Market news"
          onClick={() => {
            if (panelMode === 'news') { setPanelMode('watchlist'); }
            else { setNewsInstrumentSymbol(undefined); setPanelMode('news'); }
          }}
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-7 h-7 rounded transition-colors',
            panelMode === 'news'
              ? 'bg-fw-accent/20 text-fw-accent'
              : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/50',
          )}
        >
          <Newspaper size={13} />
        </button>

        {/* Inline search input � flex-1 */}
        <div className="relative flex-1 min-w-0">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-fw-text-muted pointer-events-none" />
          <input
            ref={inlineInputRef}
            type="text"
            placeholder="Search..."
            value={inlineQuery}
            onChange={e => setInlineQuery(e.target.value)}
            className="w-full bg-fw-surface-2 border border-fw-border/50 rounded text-[11px] text-fw-text pl-5.5 pr-5 py-1 outline-none focus:border-fw-accent/60 placeholder:text-fw-text-muted/60"
            style={{ paddingLeft: '1.4rem', paddingRight: inlineQuery ? '1.2rem' : '0.4rem' }}
          />
          {inlineQuery && (
            <button onClick={() => setInlineQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fw-text-muted hover:text-fw-text">
              <X size={9} />
            </button>
          )}
        </div>

        {/* All ? segment filter (only shown in watchlist/browser mode) */}
        {panelMode !== 'news' && (
          <div ref={segFilterRef} className="relative flex-shrink-0">
            <button
              onClick={() => setShowSegFilter(v => !v)}
              className="flex items-center gap-0.5 px-1.5 py-1 bg-fw-surface-2 border border-fw-border/50 rounded text-[10px] text-fw-text-secondary hover:text-fw-text hover:border-fw-border transition-colors whitespace-nowrap"
            >
              <span className="max-w-[40px] truncate">{activeSegLabel === 'Index / Equity' ? 'NSE' : activeSegLabel}</span>
              <ChevronDown size={9} className={cn('transition-transform', showSegFilter && 'rotate-180')} />
            </button>
            {showSegFilter && (
              <div className="absolute right-0 top-full mt-0.5 z-[200] w-36 bg-fw-surface border border-fw-border rounded-lg shadow-2xl overflow-hidden py-1"
                   style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                {SEGMENT_FILTERS.map(sf => (
                  <button
                    key={sf.value}
                    onClick={() => { setSegFilter(sf.value); setShowSegFilter(false); }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors text-left',
                      segFilter === sf.value
                        ? 'text-fw-accent bg-fw-accent/10'
                        : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover/50',
                    )}
                  >
                    {sf.label}
                    {segFilter === sf.value && <span className="text-fw-accent text-[10px]">?</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ? Favourites toggle */}
        <button
          aria-label="Favourites"
          title="Starred instruments"
          onClick={() => setPanelMode(m => m === 'favorites' ? 'watchlist' : 'favorites')}
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-7 h-7 rounded transition-colors',
            panelMode === 'favorites'
              ? 'text-fw-accent'
              : 'text-fw-text-muted/60 hover:text-fw-text-secondary',
          )}
        >
          <Star size={14} className={panelMode === 'favorites' ? 'fill-fw-accent' : ''} />
        </button>
      </div>

      {/* -- WATCHLIST TABS � preserved exactly, shown only in watchlist mode -- */}
      {(panelMode === 'watchlist') && (
        <div className="flex items-center border-b border-fw-border overflow-x-auto flex-shrink-0 scrollbar-none bg-fw-surface px-1">
          {watchlists.map(wl => {
            const wlKey = wl.name.toLowerCase();
            const isActive = currentWlId === wl.id || currentWlId === wlKey;
            return (
            <button
              key={wl.id}
              onClick={() => {
                setActiveWatchlistTab(wlKey);
                // Sync workspace if this tab matches a chart workspace
                const chartWorkspaces = ['index', 'stocks', 'futures', 'options', 'etf', 'mcx', 'cds'];
                if (chartWorkspaces.includes(wlKey) && activeWorkspace !== wlKey) {
                  useAppStore.getState().setActiveWorkspace(wlKey as any);
                }
              }}
              className={cn(
                'px-2.5 py-1.5 text-[10px] font-bold whitespace-nowrap border-b-2 transition-all flex-shrink-0 uppercase tracking-widest',
                isActive
                  ? 'text-fw-text border-current bg-white/[0.02]'
                  : 'text-fw-text-muted border-transparent hover:text-fw-text-secondary hover:bg-fw-hover/20',
              )}
              style={isActive ? { color: wl.color, borderColor: wl.color } : undefined}
            >
              {wl.name}
            </button>
            );
          })}
          {/* Import + Add buttons */}
          <div className="ml-auto flex items-center gap-0.5 flex-shrink-0 pr-1">
            <button
              onClick={() => setShowImport(v => !v)}
              title="Bulk import"
              className="p-1 text-fw-text-muted hover:text-fw-text rounded hover:bg-fw-hover/40 transition-colors"
            >
              <Upload size={10} />
            </button>
            <button
              onClick={() => {
                // Open browser mode for adding � or trigger search in browser
                setPanelMode('browser');
              }}
              title="Browse instruments"
              className="p-1 text-fw-text-muted hover:text-fw-accent rounded hover:bg-fw-hover/40 transition-colors"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      )}

      {/* -- IMPORT PANEL ------------------------------------------------------- */}
      {showImport && panelMode === 'watchlist' && (
        <ImportPanel
          onClose={() => setShowImport(false)}
          activeWatchlist={activeWatchlist}
          watchlists={watchlists}
          currentWlId={currentWlId}
          setWatchlists={setWatchlists}
        />
      )}

      {/* -- COLUMN HEADERS (watchlist mode only) ------------------------------- */}
      {panelMode === 'watchlist' && (
        <div className="grid grid-cols-[1fr_68px_52px_28px_22px] px-2 py-[3px] border-b border-fw-border/30 flex-shrink-0 bg-fw-surface">
          <span className="text-[10px] text-fw-text-muted uppercase tracking-widest">Symbol</span>
          <span className="text-[10px] text-fw-text-muted uppercase tracking-widest text-right">LTP</span>
          <span className="text-[10px] text-fw-text-muted uppercase tracking-widest text-right">Chg%</span>
          <span className="text-[10px] text-fw-text-muted text-center">?</span>
          <span className="text-[10px] text-fw-text-muted/30 text-center">?</span>
        </div>
      )}

      {/* -- PANEL BODY --------------------------------------------------------- */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* -- NEWS MODE -------------------------------------------------------- */}
        {panelMode === 'news' && (
          <NewsPanel
            instrumentSymbol={newsInstrumentSymbol}
            pinnedTokens={pinnedTokens}
            watchlists={watchlists}
            onBack={() => { setPanelMode('watchlist'); setNewsInstrumentSymbol(undefined); }}
          />
        )}

        {/* -- INSTRUMENT BROWSER MODE --------------------------------------- */}
        {panelMode === 'browser' && (
          <InstrumentBrowser
            onOpenNews={openInstrumentNews}
            currentWlId={currentWlId}
            activeSymbol={activeSymbol}
            pinnedTokens={pinnedTokens}
            onSelectInstrument={handleSelectFromBrowser}
          />
        )}

        {/* -- FAVOURITES MODE ------------------------------------------------- */}
        {panelMode === 'favorites' && (
          <FavoritesView
            pinnedTokens={pinnedTokens}
            watchlists={watchlists}
            activeSymbol={activeSymbol}
            onSelect={handleSelectItem}
            onPin={togglePinToken}
            onOpenNews={openInstrumentNews}
            currentWlId={currentWlId}
          />
        )}

        {/* -- WATCHLIST MODE -------------------------------------------------- */}
        {panelMode === 'watchlist' && (
          <>
            {/* Inline search results overlay */}
            {inlineQuery.trim() && (
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-fw-border scrollbar-track-transparent">
                {inlineLoading ? (
                  <div className="flex items-center justify-center py-4 text-fw-text-muted text-[11px]">
                    <RefreshCw size={11} className="animate-spin mr-1.5" /> Searching...
                  </div>
                ) : inlineResults.length === 0 ? (
                  <div className="flex items-center justify-center py-6 text-fw-text-muted text-[11px]">
                    No results for "{inlineQuery}"
                  </div>
                ) : (
                  inlineResults.map(inst => (
                    <BrowserRow
                      key={inst.token}
                      instrument={inst}
                      isSelected={activeSymbol?.token === inst.token}
                      isPinned={pinnedTokens.includes(inst.token)}
                      onSelect={() => handleSelectFromBrowser(inst)}
                      onPin={() => togglePinToken(inst.token)}
                      onOpenNews={openInstrumentNews}
                      currentWlId={currentWlId}
                    />
                  ))
                )}
              </div>
            )}

            {/* Normal watchlist item list */}
            {!inlineQuery.trim() && (
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-fw-border scrollbar-track-transparent">
                {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-20 text-fw-text-muted gap-1">
                    <p className="text-[11px]">No symbols</p>
                    <button
                      onClick={() => setPanelMode('browser')}
                      className="text-[11px] text-fw-accent hover:underline"
                    >
                      + Browse Instruments
                    </button>
                  </div>
                ) : (
                  filteredItems.map(item => (
                    <WatchlistRow
                      key={item.token}
                      item={item}
                      isSelected={activeSymbol?.token === item.token}
                      isPinned={pinnedTokens.includes(item.token)}
                      onSelect={() => handleSelectItem(item)}
                      onRemove={() => removeFromWatchlist(currentWlId, item.token)}
                      onPin={() => togglePinToken(item.token)}
                      onOpenNews={openInstrumentNews}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* -- BOTTOM ADD BUTTON � watchlist mode only ------------------------- */}
      {panelMode === 'watchlist' && (
        <div className="px-2 py-1.5 border-t border-fw-border flex-shrink-0">
          <button
            onClick={() => setPanelMode('browser')}
            className="w-full flex items-center justify-center gap-1.5 py-1 text-[11px] text-fw-text-muted hover:text-fw-accent rounded hover:bg-fw-hover/40 transition-colors font-medium"
          >
            <Plus size={10} /> Add Symbol
          </button>
        </div>
      )}
    </div>
  );
}
