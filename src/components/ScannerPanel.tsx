import { useState, useEffect, useRef } from 'react';
import { Search, Filter, TrendingUp, TrendingDown, Zap, BarChart3 } from 'lucide-react';
import { apiService } from '@/services/api';
import { useAppStore } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';

interface ScanResult {
  token: string;
  symbol: string;
  ltp: number;
  change: number;
  changePct: number;
  volume: number;
  signal: string;
}

type ScanType = 'top_gainers' | 'top_losers' | 'volume_spike' | 'high_oi_change' | 'near_52w_high' | 'near_52w_low' | 'bullish_crossover' | 'bearish_crossover';

const SCANS: { id: ScanType; label: string; icon: any; color: string }[] = [
  { id: 'top_gainers', label: 'Top Gainers', icon: TrendingUp, color: 'text-green' },
  { id: 'top_losers', label: 'Top Losers', icon: TrendingDown, color: 'text-red' },
  { id: 'volume_spike', label: 'Volume Spike', icon: BarChart3, color: 'text-fw-cyan' },
  { id: 'high_oi_change', label: 'High OI Change', icon: Zap, color: 'text-fw-yellow' },
  { id: 'near_52w_high', label: 'Near 52W High', icon: TrendingUp, color: 'text-fw-purple' },
  { id: 'near_52w_low', label: 'Near 52W Low', icon: TrendingDown, color: 'text-fw-orange' },
  { id: 'bullish_crossover', label: 'Bullish Crossover', icon: TrendingUp, color: 'text-green' },
  { id: 'bearish_crossover', label: 'Bearish Crossover', icon: TrendingDown, color: 'text-red' },
];

export function ScannerPanel() {
  const [activeScan, setActiveScan] = useState<ScanType>('top_gainers');
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [segment, setSegment] = useState<string>('NSE');
  const { setActiveSymbol } = useAppStore();
  const workerRef = useRef<Worker | null>(null);
  const quotes = useMarketStore((s) => s.quotes);

  // Initialize scanner worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL('../workers/scannerWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'results') {
          setResults(e.data.results || []);
          setLoading(false);
        } else if (e.data.type === 'error') {
          // Worker failed — fall back to API
          runScanViaAPI();
        }
      };
    } catch {
      workerRef.current = null;
    }
    return () => { workerRef.current?.terminate(); };
  }, []);

  useEffect(() => {
    runScan();
  }, [activeScan, segment]);

  async function runScan() {
    setLoading(true);

    // If worker is available and we have local quote data, use worker for speed
    const quoteEntries = Object.values(quotes);
    if (workerRef.current && quoteEntries.length > 10) {
      const instruments = quoteEntries.map((q: any) => ({
        token: q.token || '',
        symbol: q.symbol || '',
        ltp: q.ltp || 0,
        open: q.open || 0,
        high: q.high || 0,
        low: q.low || 0,
        close: q.close || 0,
        volume: q.volume || 0,
        change: q.change || 0,
        changePct: q.changePercent || 0,
        oi: q.oi || 0,
        oiChange: q.oiChange || 0,
        timestamp: q.timestamp || Date.now(),
      }));

      workerRef.current.postMessage({
        type: 'scan',
        instruments,
        conditions: [],
        scanType: activeScan,
        limit: 30,
      });
      return; // Worker will set results via onmessage
    }

    // Fallback: API-based scan
    await runScanViaAPI();
  }

  async function runScanViaAPI() {
    setLoading(true);
    try {
      const res = await apiService.get<ScanResult[]>(`/market/scanner?type=${activeScan}&segment=${segment}`);
      setResults(res || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function selectSymbol(r: ScanResult) {
    (setActiveSymbol as any)({ token: r.token, symbol: r.symbol, segment: segment as any });
  }

  return (
    <div className="flex flex-col h-full bg-fw-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-fw-accent" />
          <span className="text-xs font-bold text-fw-text uppercase tracking-wide">Scanner</span>
        </div>
        <div className="flex items-center gap-1">
          {['NSE', 'NFO', 'MCX'].map(s => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`text-[14px] px-2 py-0.5 rounded ${segment === s ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Scan Type Selector */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-fw-border">
        {SCANS.map(scan => {
          const Icon = scan.icon;
          return (
            <button
              key={scan.id}
              onClick={() => setActiveScan(scan.id)}
              className={`flex items-center gap-1 text-[14px] px-2 py-1 rounded border transition-all
                ${activeScan === scan.id
                  ? 'border-fw-accent bg-fw-accent/10 text-fw-accent'
                  : 'border-fw-border text-fw-text-secondary hover:border-fw-text-muted'}`}
            >
              <Icon className={`w-3 h-3 ${activeScan === scan.id ? 'text-fw-accent' : scan.color}`} />
              {scan.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-20 text-fw-text-muted text-xs">
            Scanning...
          </div>
        )}
        {!loading && results.length === 0 && (
          <div className="flex items-center justify-center h-20 text-fw-text-muted text-xs">
            No results for this scan
          </div>
        )}
        {!loading && results.length > 0 && (
          <table className="fw-table w-full">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="text-right">LTP</th>
                <th className="text-right">Change</th>
                <th className="text-right">Volume</th>
                <th className="text-right">Signal</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.token} className="cursor-pointer" onClick={() => selectSymbol(r)}>
                  <td className="font-bold text-fw-text">{r.symbol}</td>
                  <td className="text-right font-mono">{r.ltp.toFixed(2)}</td>
                  <td className={`text-right font-mono ${r.changePct >= 0 ? 'text-green' : 'text-red'}`}>
                    {r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(2)}%
                  </td>
                  <td className="text-right font-mono text-fw-text-secondary">
                    {r.volume > 100000 ? (r.volume / 100000).toFixed(1) + 'L' : r.volume.toLocaleString('en-IN')}
                  </td>
                  <td className="text-right text-fw-text-muted">{r.signal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-fw-border text-[14px] text-fw-text-muted flex items-center justify-between">
        <span>{results.length} results</span>
        <button onClick={runScan} className="hover:text-fw-accent">↻ Refresh</button>
      </div>
    </div>
  );
}
