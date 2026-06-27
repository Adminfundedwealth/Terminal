/**
 * SCANNER SERVICE
 * 
 * Provides market scanning capabilities.
 * Scan types: top_gainers, top_losers, volume_spike, high_oi_change,
 *             near_52w_high, near_52w_low, bullish_crossover, bearish_crossover
 */

export class ScannerService {
  constructor(marketDataEngine, instrumentService) {
    this.mde = marketDataEngine;
    this.instruments = instrumentService;
  }

  async scan(type, segment = 'NSE', limit = 30) {
    const quotes = this.mde.getAllQuotes();
    if (!quotes || quotes.size === 0) return [];

    let results = [];

    for (const [token, quote] of quotes) {
      if (segment && quote.exchange !== segment && quote.segment !== segment) continue;
      if (!quote.ltp || quote.ltp === 0) continue;

      results.push({
        token,
        symbol: quote.symbol || token,
        ltp: quote.ltp,
        change: quote.change || 0,
        changePct: quote.changePercent || 0,
        volume: quote.volume || 0,
        oi: quote.oi || 0,
        oiChange: quote.oiChange || 0,
        high: quote.high || 0,
        low: quote.low || 0,
        open: quote.open || 0,
        close: quote.close || 0,
      });
    }

    switch (type) {
      case 'top_gainers':
        results.sort((a, b) => b.changePct - a.changePct);
        results = results.filter(r => r.changePct > 0);
        break;

      case 'top_losers':
        results.sort((a, b) => a.changePct - b.changePct);
        results = results.filter(r => r.changePct < 0);
        break;

      case 'volume_spike':
        results.sort((a, b) => b.volume - a.volume);
        results = results.filter(r => r.volume > 0);
        break;

      case 'high_oi_change':
        results.sort((a, b) => Math.abs(b.oiChange) - Math.abs(a.oiChange));
        results = results.filter(r => r.oiChange !== 0);
        break;

      case 'near_52w_high':
        results = results.filter(r => r.high > 0 && r.ltp >= r.high * 0.95);
        results.sort((a, b) => (b.ltp / b.high) - (a.ltp / a.high));
        break;

      case 'near_52w_low':
        results = results.filter(r => r.low > 0 && r.ltp <= r.low * 1.05);
        results.sort((a, b) => (a.ltp / a.low) - (b.ltp / b.low));
        break;

      case 'bullish_crossover':
        results = results.filter(r => r.changePct > 1 && r.volume > 100000);
        results.sort((a, b) => b.changePct - a.changePct);
        break;

      case 'bearish_crossover':
        results = results.filter(r => r.changePct < -1 && r.volume > 100000);
        results.sort((a, b) => a.changePct - b.changePct);
        break;

      default:
        results.sort((a, b) => b.volume - a.volume);
    }

    return results.slice(0, limit).map(r => ({
      token: r.token,
      symbol: r.symbol,
      ltp: r.ltp,
      change: r.change,
      changePct: r.changePct,
      volume: r.volume,
      signal: this._getSignal(type, r),
    }));
  }

  _getSignal(type, r) {
    switch (type) {
      case 'top_gainers': return `+${r.changePct.toFixed(1)}%`;
      case 'top_losers': return `${r.changePct.toFixed(1)}%`;
      case 'volume_spike': return `Vol: ${(r.volume / 100000).toFixed(1)}L`;
      case 'high_oi_change': return `OI: ${r.oiChange > 0 ? '+' : ''}${(r.oiChange / 1000).toFixed(0)}K`;
      case 'near_52w_high': return `${((r.ltp / r.high) * 100).toFixed(1)}% of high`;
      case 'near_52w_low': return `${((r.ltp / r.low) * 100).toFixed(1)}% of low`;
      case 'bullish_crossover': return 'Bullish';
      case 'bearish_crossover': return 'Bearish';
      default: return '';
    }
  }
}
