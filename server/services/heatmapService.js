/**
 * HEATMAP SERVICE
 * 
 * Provides heatmap data for NIFTY 50, BANKNIFTY, sectoral indices.
 * Returns change% per stock for grid visualization.
 */

// NIFTY 50 constituent tokens (Angel One SmartAPI tokens)
const NIFTY50_TOKENS = [
  { token: '2885', symbol: 'RELIANCE' }, { token: '3045', symbol: 'SBIN' },
  { token: '1333', symbol: 'HDFCBANK' }, { token: '11536', symbol: 'TCS' },
  { token: '1594', symbol: 'INFY' }, { token: '881', symbol: 'DRREDDY' },
  { token: '3456', symbol: 'SUNPHARMA' }, { token: '317', symbol: 'BAJFINANCE' },
  { token: '5633', symbol: 'MARUTI' }, { token: '11483', symbol: 'NTPC' },
  { token: '3787', symbol: 'TECHM' }, { token: '2031', symbol: 'KOTAKBANK' },
  { token: '1660', symbol: 'ITC' }, { token: '10999', symbol: 'WIPRO' },
  { token: '236', symbol: 'ASIANPAINT' }, { token: '16669', symbol: 'BAJAJFINSV' },
  { token: '1363', symbol: 'HINDUNILVR' }, { token: '3506', symbol: 'TATAMOTORS' },
  { token: '3499', symbol: 'TATASTEEL' }, { token: '5900', symbol: 'ADANIENT' },
  { token: '1232', symbol: 'GRASIM' }, { token: '11630', symbol: 'TITAN' },
  { token: '694', symbol: 'COALINDIA' }, { token: '10940', symbol: 'BPCL' },
  { token: '3351', symbol: 'SBILIFE' }, { token: '547', symbol: 'BRITANNIA' },
  { token: '11532', symbol: 'ULTRACEMCO' }, { token: '2475', symbol: 'ONGC' },
  { token: '1348', symbol: 'HEROMOTOCO' }, { token: '910', symbol: 'EICHERMOT' },
  { token: '14977', symbol: 'POWERGRID' }, { token: '467', symbol: 'BHARTIARTL' },
  { token: '1394', symbol: 'HINDZINC' }, { token: '3432', symbol: 'TATACONSUM' },
  { token: '2181', symbol: 'M&M' }, { token: '15083', symbol: 'ADANIPORTS' },
  { token: '11723', symbol: 'HCLTECH' }, { token: '526', symbol: 'NESTLEIND' },
  { token: '14418', symbol: 'JSWSTEEL' }, { token: '17818', symbol: 'LTIM' },
  { token: '4306', symbol: 'SHRIRAMFIN' }, { token: '6191', symbol: 'CIPLA' },
  { token: '4963', symbol: 'IOC' }, { token: '1922', symbol: 'ICICIBANK' },
  { token: '288', symbol: 'AXISBANK' }, { token: '2303', symbol: 'LT' },
  { token: '11184', symbol: 'HAL' }, { token: '3150', symbol: 'DIVISLAB' },
  { token: '1270', symbol: 'HDFCLIFE' }, { token: '4717', symbol: 'APOLLOHOSP' },
];

export class HeatmapService {
  constructor(marketDataEngine) {
    this.mde = marketDataEngine;
  }

  async getHeatmap(view = 'nifty50') {
    const quotes = this.mde.getAllQuotes();
    let tokenList;

    switch (view) {
      case 'nifty50': tokenList = NIFTY50_TOKENS; break;
      case 'banknifty': tokenList = NIFTY50_TOKENS.filter(t =>
        ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE'].includes(t.symbol)
      ); break;
      case 'midcap': tokenList = NIFTY50_TOKENS.slice(25); break;
      default: tokenList = NIFTY50_TOKENS;
    }

    const results = [];
    for (const item of tokenList) {
      const quote = quotes.get(item.token);
      results.push({
        token: item.token,
        symbol: item.symbol,
        changePct: quote?.changePercent || 0,
        ltp: quote?.ltp || 0,
        volume: quote?.volume || 0,
      });
    }

    // Sort by absolute change for visual impact
    results.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return results;
  }
}
