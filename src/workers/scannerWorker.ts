/**
 * SCANNER WEB WORKER
 * 
 * Offloads heavy scanner computation (filtering 500+ instruments against conditions)
 * from the main thread to prevent UI jank.
 * 
 * Message Protocol:
 *   IN:  { type: 'scan', instruments: QuoteData[], conditions: ScanCondition[], scanType: string }
 *   OUT: { type: 'results', results: ScanResult[], duration: number }
 *   OUT: { type: 'error', message: string }
 */

export interface WorkerQuote {
  token: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
  oi: number;
  oiChange: number;
  timestamp: number;
}

export interface ScanCondition {
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: number;
}

export interface ScanResult {
  token: string;
  symbol: string;
  ltp: number;
  change: number;
  changePct: number;
  volume: number;
  signal: string;
  relevanceScore: number;
}

// Worker message handler
self.onmessage = (event: MessageEvent) => {
  const { type, instruments, conditions, scanType, limit = 30 } = event.data;

  if (type !== 'scan') return;

  try {
    const start = performance.now();
    const results = runScan(instruments, conditions, scanType, limit);
    const duration = performance.now() - start;

    self.postMessage({ type: 'results', results, duration });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Scanner worker error' });
  }
};

function runScan(instruments: WorkerQuote[], conditions: ScanCondition[], scanType: string, limit: number): ScanResult[] {
  const now = Date.now();
  const STALE_THRESHOLD = 5000; // 5 seconds

  // Filter out stale data
  let results = instruments.filter(q => {
    if (!q.ltp || q.ltp === 0) return false;
    if (q.timestamp && (now - q.timestamp) > STALE_THRESHOLD) return false;
    return true;
  });

  // Apply custom conditions (AND logic)
  if (conditions && conditions.length > 0) {
    results = results.filter(q => {
      return conditions.every(cond => {
        const fieldVal = getFieldValue(q, cond.field);
        if (fieldVal === null || fieldVal === undefined) return false;
        return evaluateCondition(fieldVal, cond.operator, cond.value);
      });
    });
  }

  // Apply scan type sorting/filtering
  let scored: (WorkerQuote & { relevanceScore: number; signal: string })[] = results.map(r => ({ ...r, relevanceScore: 0, signal: '' }));

  switch (scanType) {
    case 'top_gainers':
      scored = scored.filter(r => r.changePct > 0);
      scored.sort((a, b) => b.changePct - a.changePct);
      scored.forEach(r => { r.relevanceScore = r.changePct; r.signal = `+${r.changePct.toFixed(1)}%`; });
      break;

    case 'top_losers':
      scored = scored.filter(r => r.changePct < 0);
      scored.sort((a, b) => a.changePct - b.changePct);
      scored.forEach(r => { r.relevanceScore = Math.abs(r.changePct); r.signal = `${r.changePct.toFixed(1)}%`; });
      break;

    case 'volume_spike':
      scored = scored.filter(r => r.volume > 0);
      scored.sort((a, b) => b.volume - a.volume);
      scored.forEach(r => { r.relevanceScore = r.volume / 100000; r.signal = `Vol: ${(r.volume / 100000).toFixed(1)}L`; });
      break;

    case 'high_oi_change':
      scored = scored.filter(r => r.oiChange !== 0);
      scored.sort((a, b) => Math.abs(b.oiChange) - Math.abs(a.oiChange));
      scored.forEach(r => { r.relevanceScore = Math.abs(r.oiChange); r.signal = `OI: ${r.oiChange > 0 ? '+' : ''}${(r.oiChange / 1000).toFixed(0)}K`; });
      break;

    case 'near_52w_high':
      scored = scored.filter(r => r.high > 0 && r.ltp >= r.high * 0.95);
      scored.sort((a, b) => (b.ltp / b.high) - (a.ltp / a.high));
      scored.forEach(r => { r.relevanceScore = r.ltp / r.high; r.signal = `${((r.ltp / r.high) * 100).toFixed(1)}% of high`; });
      break;

    case 'near_52w_low':
      scored = scored.filter(r => r.low > 0 && r.ltp <= r.low * 1.05);
      scored.sort((a, b) => (a.ltp / a.low) - (b.ltp / b.low));
      scored.forEach(r => { r.relevanceScore = 1 - (r.ltp / r.low); r.signal = `${((r.ltp / r.low) * 100).toFixed(1)}% of low`; });
      break;

    case 'bullish_crossover':
      scored = scored.filter(r => r.changePct > 1 && r.volume > 100000);
      scored.sort((a, b) => b.changePct - a.changePct);
      scored.forEach(r => { r.relevanceScore = r.changePct + r.volume / 1000000; r.signal = 'Bullish'; });
      break;

    case 'bearish_crossover':
      scored = scored.filter(r => r.changePct < -1 && r.volume > 100000);
      scored.sort((a, b) => a.changePct - b.changePct);
      scored.forEach(r => { r.relevanceScore = Math.abs(r.changePct) + r.volume / 1000000; r.signal = 'Bearish'; });
      break;

    default:
      // Custom conditions only — sort by aggregate relevance
      if (conditions.length > 0) {
        scored.forEach(r => {
          r.relevanceScore = conditions.reduce((score, cond) => {
            const val = getFieldValue(r, cond.field);
            if (val === null) return score;
            return score + Math.abs(val - cond.value) / Math.max(1, Math.abs(cond.value));
          }, 0);
          r.signal = 'Match';
        });
        scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
      } else {
        scored.sort((a, b) => b.volume - a.volume);
        scored.forEach(r => { r.signal = ''; });
      }
  }

  return scored.slice(0, limit).map(r => ({
    token: r.token,
    symbol: r.symbol,
    ltp: r.ltp,
    change: r.change,
    changePct: r.changePct,
    volume: r.volume,
    signal: r.signal,
    relevanceScore: r.relevanceScore,
  }));
}

function getFieldValue(quote: WorkerQuote, field: string): number | null {
  switch (field) {
    case 'ltp': case 'price': return quote.ltp;
    case 'volume': return quote.volume;
    case 'change': return quote.change;
    case 'changePct': case 'changePercent': return quote.changePct;
    case 'oi': return quote.oi;
    case 'oiChange': return quote.oiChange;
    case 'high': return quote.high;
    case 'low': return quote.low;
    case 'open': return quote.open;
    case 'close': return quote.close;
    default: return null;
  }
}

function evaluateCondition(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return Math.abs(value - threshold) < 0.001;
    default: return false;
  }
}

export {};
