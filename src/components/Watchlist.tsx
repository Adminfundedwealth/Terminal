import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, X, Search, Star, Upload } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useTradingStore } from '@/store/tradingStore';
import { cn, formatPrice, getChangeColor } from '@/utils/helpers';
import type { WatchlistItem } from '@/types';

export function Watchlist() {
  const {
    watchlists, activeWorkspace, removeFromWatchlist, setActiveSymbol, setSearchOpen, activeSymbol, setWatchlists,
    pinnedTokens, togglePinToken, activeWatchlistTab, setActiveWatchlistTab,
  } = useAppStore();
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  const currentWlId = activeWatchlistTab || activeWorkspace;
  const activeWatchlist = watchlists.find((wl) => wl.id === currentWlId);

  const filteredItems = useMemo(() => {
    if (!activeWatchlist) return [];
    let items = [...activeWatchlist.items];
    if (filter) {
      items = items.filter((item) =>
        item.symbol.toLowerCase().includes(filter.toLowerCase())
      );
    }
    items.sort((a, b) => {
      const aPinned = pinnedTokens.includes(a.token) ? 0 : 1;
      const bPinned = pinnedTokens.includes(b.token) ? 0 : 1;
      return aPinned - bPinned;
    });
    return items;
  }, [activeWatchlist, filter, pinnedTokens]);

  const handleSelectItem = (item: WatchlistItem) => {
    // Clear selected option contract when switching to a stock/index
    useTradingStore.getState().setSelectedContract(null);
    setActiveSymbol({
      token: item.token,
      symbol: item.symbol,
      name: item.symbol,
      segment: item.segment,
      instrumentType: item.segment === 'NFO' || item.segment === 'MCX' || item.segment === 'CDS' ? 'FUT' : 'EQ',
      exchange: item.segment === 'MCX' ? 'MCX' : item.segment === 'BSE' ? 'BSE' : 'NSE',
      lotSize: 1,
      tickSize: 0.05,
    });
  };

  const handleImport = () => {
    if (!importText.trim() || !activeWatchlist) return;
    const symbols = importText.split(/[,\n;]+/).map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
    const existingSymbols = new Set(activeWatchlist.items.map((i) => i.symbol));
    const newItems: WatchlistItem[] = symbols
      .filter((s) => !existingSymbols.has(s))
      .map((s) => ({ token: s + '_IMP_' + Date.now(), symbol: s, segment: 'NSE' as const }));
    if (newItems.length > 0) {
      const updated = watchlists.map((wl) => wl.id === currentWlId ? { ...wl, items: [...wl.items, ...newItems] } : wl);
      setWatchlists(updated);
    }
    setImportText('');
    setShowImport(false);
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0d0f15] to-[#0b0d12] overflow-hidden">
      {/* Header — Professional */}
      <div className="px-3 py-2.5 border-b border-fw-border flex items-center justify-between flex-shrink-0 bg-gradient-to-r from-[#10121a] to-[#0e1018]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black text-fw-text uppercase tracking-wider">Watchlist</span>
          <span className="text-[9px] text-fw-text-muted font-mono">{filteredItems.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowImport(!showImport)} className="p-1.5 text-fw-text-secondary hover:text-fw-text rounded hover:bg-fw-hover transition-colors" title="Import">
            <Upload size={11} />
          </button>
          <button onClick={() => setSearchOpen(true)} className="p-1.5 text-fw-text-secondary hover:text-fw-accent rounded hover:bg-fw-hover transition-colors" title="Add (Ctrl+K)">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Multi-watchlist tabs — Premium */}
      <div className="flex items-center border-b border-fw-border overflow-x-auto flex-shrink-0 scrollbar-none bg-[#090b10] px-1">
        {watchlists.map((wl) => (
          <button
            key={wl.id}
            onClick={() => setActiveWatchlistTab(wl.id)}
            className={cn(
              'px-3 py-1.5 text-[9px] font-black whitespace-nowrap border-b-2 transition-all flex-shrink-0 uppercase tracking-wider',
              currentWlId === wl.id
                ? 'text-fw-text border-current bg-white/[0.02]'
                : 'text-fw-text-muted border-transparent hover:text-fw-text-secondary hover:bg-fw-hover/20'
            )}
            style={currentWlId === wl.id ? { color: wl.color, borderColor: wl.color } : undefined}
          >
            {wl.name}
          </button>
        ))}
      </div>

      {/* Inline Search Filter */}
      <div className="px-2 py-1.5 border-b border-fw-border/50 flex-shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fw-text-muted" />
          <input
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-[#141720] border border-fw-border/50 rounded-md text-[11px] text-fw-text pl-7 pr-2 py-1.5 outline-none focus:border-fw-accent/60 placeholder:text-fw-text-muted"
          />
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="px-2 py-1.5 border-b border-fw-border bg-fw-bg/50 space-y-1 flex-shrink-0">
          <textarea
            placeholder="RELIANCE, TCS, INFY..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={2}
            className="w-full bg-[#141720] border border-fw-border rounded-md text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent resize-none"
          />
          <div className="flex gap-1">
            <button onClick={handleImport} className="px-2.5 py-1 text-[10px] bg-fw-accent text-white rounded-md font-semibold">Import</button>
            <button onClick={() => setShowImport(false)} className="px-2.5 py-1 text-[10px] text-fw-text-secondary border border-fw-border rounded-md">Cancel</button>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_72px_56px] px-3 py-[5px] border-b border-fw-border/30 flex-shrink-0 bg-[#090b10]">
        <span className="text-[8px] text-fw-text-muted font-bold uppercase tracking-wider">Symbol</span>
        <span className="text-[8px] text-fw-text-muted font-bold uppercase text-right tracking-wider">LTP</span>
        <span className="text-[8px] text-fw-text-muted font-bold uppercase text-right tracking-wider">Chg%</span>
      </div>

      {/* Items — Dense rows */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-none">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-fw-text-muted">
            <p className="text-[11px]">No symbols</p>
            <button onClick={() => setSearchOpen(true)} className="mt-1 text-[10px] text-fw-accent hover:underline">+ Add Symbol</button>
          </div>
        ) : (
          filteredItems.map((item) => (
            <WatchlistRow
              key={item.token}
              item={item}
              isSelected={activeSymbol?.token === item.token}
              isPinned={pinnedTokens.includes(item.token)}
              onSelect={() => handleSelectItem(item)}
              onRemove={() => removeFromWatchlist(currentWlId, item.token)}
              onPin={() => togglePinToken(item.token)}
            />
          ))
        )}
      </div>

      {/* Bottom Add Button */}
      <div className="px-2 py-1.5 border-t border-fw-border flex-shrink-0">
        <button
          onClick={() => setSearchOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-fw-text-muted hover:text-fw-accent rounded-md hover:bg-fw-hover/50 transition-colors font-medium"
        >
          <Plus size={11} /> Add Symbol
        </button>
      </div>
    </div>
  );
}

function WatchlistRow({ item, isSelected, isPinned, onSelect, onRemove, onPin }: {
  item: WatchlistItem;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onPin: () => void;
}) {
  const quote = useMarketStore((s) => s.quotes[item.token]);
  const prevLtpRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);

  // Tick flash effect
  useEffect(() => {
    if (!quote?.ltp || prevLtpRef.current === null) {
      prevLtpRef.current = quote?.ltp || null;
      return;
    }
    if (quote.ltp > prevLtpRef.current) {
      setFlash('green');
    } else if (quote.ltp < prevLtpRef.current) {
      setFlash('red');
    }
    prevLtpRef.current = quote.ltp;
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [quote?.ltp]);

  return (
    <div
      className={cn(
        'group relative grid grid-cols-[1fr_72px_56px] items-center px-3 h-[36px] cursor-pointer border-b border-fw-border/[0.06] transition-all',
        isSelected
          ? 'bg-fw-accent/[0.06] border-l-[3px] border-l-fw-accent'
          : 'hover:bg-fw-hover/40 border-l-[3px] border-l-transparent'
      )}
      onClick={onSelect}
    >
      {/* Symbol */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isPinned && <Star size={8} className="text-fw-accent flex-shrink-0 fill-fw-accent" />}
        <div className="flex flex-col min-w-0">
          <span className={cn('text-[11px] font-bold truncate leading-tight', isSelected ? 'text-fw-text' : 'text-fw-text/90')}>
            {item.symbol}
          </span>
          <span className="text-[8px] text-fw-text-muted/50 uppercase leading-tight">{item.segment}</span>
        </div>
      </div>

      {/* LTP */}
      <span className={cn(
        'text-[12px] font-mono tabular-nums text-right font-bold transition-colors duration-300',
        quote ? getChangeColor(quote.changePercent) : 'text-fw-text-secondary',
        flash === 'green' && 'animate-[priceFlashGreen_0.6s_ease-out]',
        flash === 'red' && 'animate-[priceFlashRed_0.6s_ease-out]'
      )}>
        {quote ? formatPrice(quote.ltp) : '—'}
      </span>

      {/* Change % */}
      <div className="text-right">
        {quote ? (
          <span className={cn(
            'text-[9px] font-mono tabular-nums px-1.5 py-[3px] rounded font-bold inline-block min-w-[44px] text-center',
            (quote.changePercent || 0) >= 0 ? 'text-green bg-green/[0.08]' : 'text-red bg-red/[0.08]'
          )}>
            {(quote.changePercent || 0) >= 0 ? '+' : ''}{(quote.changePercent || 0).toFixed(2)}%
          </span>
        ) : (
          <span className="text-[9px] text-fw-text-muted/40">—</span>
        )}
      </div>

      {/* Hover actions — overlaid */}
      <div className="col-span-3 absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-[#0c0e14]/90 backdrop-blur-sm rounded px-1 py-0.5">
        <button onClick={(e) => { e.stopPropagation(); onPin(); }} className="p-0.5 text-fw-text-muted hover:text-fw-accent transition-colors" title={isPinned ? 'Unpin' : 'Pin'}>
          <Star size={10} className={isPinned ? 'fill-fw-accent text-fw-accent' : ''} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-0.5 text-fw-text-muted hover:text-red transition-colors" title="Remove">
          <X size={10} />
        </button>
      </div>
    </div>
  );
}
