import { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { apiService } from '@/services/api';

interface OIData {
  strike: number;
  callOi: number;
  putOi: number;
  callOiChange: number;
  putOiChange: number;
  pcr: number;
}

interface OISummary {
  totalCallOi: number;
  totalPutOi: number;
  pcr: number;
  maxPainStrike: number;
  highestCallOiStrike: number;
  highestPutOiStrike: number;
  callOiChange: number;
  putOiChange: number;
}

export function OIAnalyticsPanel() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [data, setData] = useState<OIData[]>([]);
  const [summary, setSummary] = useState<OISummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await apiService.get<{ strikes: OIData[]; summary: OISummary | null }>(`/market/oi-analytics?symbol=${symbol}`);
        setData(res?.strikes || []);
        setSummary(res?.summary || null);
      } catch {
        setData([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [symbol]);

  const maxOi = Math.max(...data.map(d => Math.max(d.callOi, d.putOi)), 1);

  return (
    <div className="flex flex-col h-full bg-fw-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-fw-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-fw-accent" />
          <span className="text-xs font-bold text-fw-text uppercase tracking-wide">OI Analytics</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {symbols.map(s => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={`text-[10px] px-2 py-0.5 rounded ${symbol === s ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 border border-fw-border rounded">
            <button onClick={() => setViewMode('chart')} className={`text-[10px] px-2 py-0.5 ${viewMode === 'chart' ? 'bg-fw-accent text-white rounded' : 'text-fw-text-secondary'}`}>Chart</button>
            <button onClick={() => setViewMode('table')} className={`text-[10px] px-2 py-0.5 ${viewMode === 'table' ? 'bg-fw-accent text-white rounded' : 'text-fw-text-secondary'}`}>Table</button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-fw-border">
          <div className="kpi-card !p-2">
            <div className="text-[9px] text-fw-text-muted uppercase">PCR</div>
            <div className={`text-sm font-mono font-bold ${summary.pcr > 1 ? 'text-green' : 'text-red'}`}>{summary.pcr.toFixed(2)}</div>
          </div>
          <div className="kpi-card !p-2">
            <div className="text-[9px] text-fw-text-muted uppercase">Max Pain</div>
            <div className="text-sm font-mono font-bold text-fw-text">{summary.maxPainStrike}</div>
          </div>
          <div className="kpi-card !p-2">
            <div className="text-[9px] text-fw-text-muted uppercase">Highest Call OI</div>
            <div className="text-sm font-mono font-bold text-red">{summary.highestCallOiStrike}</div>
          </div>
          <div className="kpi-card !p-2">
            <div className="text-[9px] text-fw-text-muted uppercase">Highest Put OI</div>
            <div className="text-sm font-mono font-bold text-green">{summary.highestPutOiStrike}</div>
          </div>
        </div>
      )}

      {/* OI Visualization */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && <div className="flex items-center justify-center h-20 text-fw-text-muted text-xs">Loading OI data...</div>}

        {!loading && viewMode === 'chart' && data.length > 0 && (
          <div className="space-y-1">
            {data.map(d => (
              <div key={d.strike} className="flex items-center gap-1 h-5">
                <div className="flex-1 flex justify-end">
                  <div className="h-4 bg-red-500/40 rounded-l transition-all" style={{ width: `${(d.callOi / maxOi) * 100}%` }} />
                </div>
                <div className="w-14 text-center text-[10px] font-mono font-bold text-fw-text flex-shrink-0">{d.strike}</div>
                <div className="flex-1">
                  <div className="h-4 bg-green-500/40 rounded-r transition-all" style={{ width: `${(d.putOi / maxOi) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && viewMode === 'table' && data.length > 0 && (
          <table className="fw-table">
            <thead>
              <tr>
                <th>Call OI</th>
                <th>Call Chg</th>
                <th className="text-center">Strike</th>
                <th>Put Chg</th>
                <th>Put OI</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.strike}>
                  <td className="font-mono text-red">{(d.callOi / 1000).toFixed(0)}K</td>
                  <td className={`font-mono ${d.callOiChange > 0 ? 'text-red' : 'text-green'}`}>{d.callOiChange > 0 ? '+' : ''}{(d.callOiChange / 1000).toFixed(0)}K</td>
                  <td className="text-center font-mono font-bold">{d.strike}</td>
                  <td className={`font-mono ${d.putOiChange > 0 ? 'text-green' : 'text-red'}`}>{d.putOiChange > 0 ? '+' : ''}{(d.putOiChange / 1000).toFixed(0)}K</td>
                  <td className="font-mono text-green">{(d.putOi / 1000).toFixed(0)}K</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && data.length === 0 && (
          <div className="flex items-center justify-center h-20 text-fw-text-muted text-xs">No OI data available</div>
        )}
      </div>
    </div>
  );
}
