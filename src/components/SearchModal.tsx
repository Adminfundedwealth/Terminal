import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { searchInstruments } from '@/services/api';
import { cn, debounce } from '@/utils/helpers';
import type { Instrument } from '@/types';

const SEGMENTS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'NSE', label: 'NSE' },
  { value: 'NFO', label: 'F&O' },
  { value: 'MCX', label: 'MCX' },
  { value: 'CDS', label: 'Currency' },
  { value: 'BSE', label: 'BSE' },
];

export function SearchModal() {
  const { searchOpen, setSearchOpen, setActiveSymbol, addToWatchlist, activeWorkspace } = useAppStore();
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [usingDemo, setUsingDemo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setUsingDemo(false);
    }
  }, [searchOpen]);

  const doSearch = useCallback(
    debounce(async (q: string, seg: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const data = await searchInstruments(q, seg || undefined);
        setResults(data);
        setUsingDemo(false);
      } catch {
        // Server unavailable — show error state
        setResults([]);
        setUsingDemo(true);
      } finally {
        setIsLoading(false);
      }
    }, 200),
    []
  );

  useEffect(() => {
    doSearch(query, segment);
  }, [query, segment]);

  const handleSelect = (instrument: Instrument) => {
    setActiveSymbol(instrument);
    setSearchOpen(false);
  };

  const handleAddToWatchlist = (e: React.MouseEvent, instrument: Instrument) => {
    e.stopPropagation();
    addToWatchlist(activeWorkspace, {
      token: instrument.token,
      symbol: instrument.symbol,
      segment: instrument.segment,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setSearchOpen(false)} />

      {/* Modal */}
      <div className="relative w-[580px] max-h-[70vh] bg-fw-surface border border-fw-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b border-fw-border">
          <Search size={16} className="text-fw-text-secondary mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search stocks, futures, options, commodities..."
            className="flex-1 bg-transparent text-fw-text text-[14px] outline-none placeholder-fw-text-secondary"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 text-fw-text-secondary hover:text-fw-text">
              <X size={14} />
            </button>
          )}
          <kbd className="ml-2 text-[10px] bg-fw-bg px-1.5 py-0.5 rounded border border-fw-border text-fw-text-secondary">
            ESC
          </kbd>
        </div>

        {/* Segment Filters */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-fw-border bg-fw-bg/30">
          {SEGMENTS.map((seg) => (
            <button
              key={seg.value}
              onClick={() => { setSegment(seg.value); setSelectedIndex(0); }}
              className={cn(
                'px-3 py-1 text-[12px] rounded-md font-medium transition-all',
                segment === seg.value
                  ? 'bg-fw-accent text-white shadow-sm'
                  : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover'
              )}
            >
              {seg.label}
            </button>
          ))}
        </div>

        {/* Server unavailable notice */}
        {usingDemo && (
          <div className="px-4 py-1.5 bg-red-900/20 border-b border-red-800/30 flex items-center gap-2">
            <span className="text-[10px] text-red-400">⚠ Server unavailable — search requires a live connection to the backend</span>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-fw-text-secondary text-sm">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-fw-text-secondary text-sm gap-1">
              {query ? (
                <>
                  <span>No instruments found for "{query}"</span>
                  {usingDemo && <span className="text-[11px] text-fw-text-muted">Connect to backend to enable search</span>}
                </>
              ) : (
                <>
                  <Search size={20} className="text-fw-border mb-1" />
                  <span>Type to search instruments</span>
                  <span className="text-[11px] text-fw-text-muted">Search by symbol name or instrument</span>
                </>
              )}
            </div>
          ) : (
            results.map((instrument, idx) => (
              <div
                key={instrument.token}
                onClick={() => handleSelect(instrument)}
                className={cn(
                  'flex items-center px-4 py-3 cursor-pointer transition-all group',
                  idx === selectedIndex ? 'bg-fw-hover border-l-2 border-l-fw-accent' : 'hover:bg-fw-hover border-l-2 border-l-transparent'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-fw-text">{instrument.symbol}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-fw-bg text-fw-text-secondary border border-fw-border font-medium">
                      {instrument.segment}
                    </span>
                    {instrument.instrumentType !== 'EQ' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-fw-accent/10 text-fw-accent font-medium">
                        {instrument.instrumentType}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-fw-text-secondary mt-0.5 truncate">{instrument.name}</p>
                </div>
                {instrument.expiry && (
                  <span className="text-[10px] text-fw-text-secondary mr-3">{instrument.expiry}</span>
                )}
                <button
                  onClick={(e) => handleAddToWatchlist(e, instrument)}
                  className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-fw-accent/20 text-fw-accent transition-all"
                  title="Add to watchlist"
                >
                  <Plus size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-fw-border flex items-center gap-4 text-[10px] text-fw-text-secondary">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}
