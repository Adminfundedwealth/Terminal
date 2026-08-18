const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../server/index.js');
let content = fs.readFileSync(file, 'utf8');

// 1. Rename "async function connectAngelFeed()" to "async function connectAngelFeedForBroker()"
const oldFnDecl = 'async function connectAngelFeed()';
const newFnDecl = 'async function connectAngelFeedForBroker()';

if (!content.includes(oldFnDecl)) {
  console.log('connectAngelFeed function declaration not found');
  process.exit(1);
}

content = content.replace(oldFnDecl, newFnDecl);
console.log('1. Renamed connectAngelFeed -> connectAngelFeedForBroker');

// 2. Remove "marketDataEngine.connectAdapter('angelone-smartstream');" from the renamed function
const adapterLine = "    marketDataEngine.connectAdapter('angelone-smartstream');";
if (content.includes(adapterLine)) {
  content = content.replace(adapterLine, '    // NOTE: Dhan feed is the primary adapter now — Angel used for broker only');
  console.log('2. Removed marketDataEngine.connectAdapter(angelone) from broker-only function');
}

// 3. Insert the new connectDhanFeed() function BEFORE the renamed function
const dhanFeedFn = `
/**
 * Connect Dhan WebSocket Feed as PRIMARY real-time market data source.
 * Pipes all tick data directly into MarketDataEngine.
 */
async function connectDhanFeed() {
  const dhanAdapter = dataProviderSwitch.getDhanAdapter();
  if (!dhanAdapter || !dhanAdapter.auth || !dhanAdapter.auth.isTokenValid) {
    console.warn('[DhanFeed] Dhan adapter not ready — cannot connect WebSocket feed');
    console.warn('[DhanFeed] Historical/REST data still available via DataProviderSwitch');
    return;
  }

  try {
    dhanFeed = new DhanWebSocketFeed(dhanAdapter.auth);
    await dhanFeed.connect();
    marketDataEngine.connectAdapter('dhan-websocket');
    console.log('[DhanFeed] ✓ Connected — PRIMARY real-time feed active');

    // Pipe tick events into MarketDataEngine
    dhanFeed.on('tick', (tick) => {
      if (tick.token && tick.ltp > 0) {
        const existing = marketDataEngine.getQuote(tick.token);
        marketDataEngine.pushQuote(tick.token, {
          ltp: tick.ltp,
          open: tick.open || existing?.open,
          high: tick.high || existing?.high,
          low: tick.low || existing?.low,
          close: tick.close || existing?.close,
          volume: tick.volume || existing?.volume,
          timestamp: Date.now(),
          symbol: existing?.symbol,
          exchange: existing?.exchange,
          segment: existing?.segment,
        });
      }
    });

    // Pipe depth events
    dhanFeed.on('depth', (depth) => {
      if (depth.token) {
        marketDataEngine.pushDepth(depth.token, depth);
      }
    });

    // Handle disconnection — mark feed as stale
    dhanFeed.on('disconnected', () => {
      console.warn('[DhanFeed] WebSocket disconnected — feed stale');
      marketDataEngine.setFeedStale(true);
    });

    dhanFeed.on('connected', () => {
      marketDataEngine.setFeedStale(false);
    });

    // Default token subscriptions
    const defaultTokens = [
      // Indices (IDX_I)
      { securityId: '13', segment: 'IDX_I', symbol: 'NIFTY 50' },
      { securityId: '25', segment: 'IDX_I', symbol: 'BANKNIFTY' },
      { securityId: '27', segment: 'IDX_I', symbol: 'FINNIFTY' },
      { securityId: '442', segment: 'IDX_I', symbol: 'MIDCPNIFTY' },
      { securityId: '51', segment: 'IDX_I', symbol: 'SENSEX' },
      // NIFTY 50 constituents (NSE_EQ)
      { securityId: '2885', segment: 'NSE_EQ', symbol: 'RELIANCE' },
      { securityId: '3045', segment: 'NSE_EQ', symbol: 'SBIN' },
      { securityId: '1333', segment: 'NSE_EQ', symbol: 'HDFCBANK' },
      { securityId: '11536', segment: 'NSE_EQ', symbol: 'TCS' },
      { securityId: '1594', segment: 'NSE_EQ', symbol: 'INFY' },
      { securityId: '317', segment: 'NSE_EQ', symbol: 'BAJFINANCE' },
      { securityId: '5633', segment: 'NSE_EQ', symbol: 'MARUTI' },
      { securityId: '11483', segment: 'NSE_EQ', symbol: 'NTPC' },
      { securityId: '3787', segment: 'NSE_EQ', symbol: 'TECHM' },
      { securityId: '2031', segment: 'NSE_EQ', symbol: 'KOTAKBANK' },
      { securityId: '1660', segment: 'NSE_EQ', symbol: 'ITC' },
      { securityId: '10999', segment: 'NSE_EQ', symbol: 'WIPRO' },
      { securityId: '236', segment: 'NSE_EQ', symbol: 'ASIANPAINT' },
      { securityId: '16669', segment: 'NSE_EQ', symbol: 'BAJAJFINSV' },
      { securityId: '1363', segment: 'NSE_EQ', symbol: 'HINDUNILVR' },
      { securityId: '3506', segment: 'NSE_EQ', symbol: 'TATAMOTORS' },
      { securityId: '3499', segment: 'NSE_EQ', symbol: 'TATASTEEL' },
      { securityId: '5900', segment: 'NSE_EQ', symbol: 'ADANIENT' },
      { securityId: '11630', segment: 'NSE_EQ', symbol: 'TITAN' },
      { securityId: '694', segment: 'NSE_EQ', symbol: 'COALINDIA' },
      { securityId: '547', segment: 'NSE_EQ', symbol: 'BRITANNIA' },
      { securityId: '11532', segment: 'NSE_EQ', symbol: 'ULTRACEMCO' },
      { securityId: '2475', segment: 'NSE_EQ', symbol: 'ONGC' },
      { securityId: '20374', segment: 'NSE_EQ', symbol: 'BHARTIARTL' },
      { securityId: '3432', segment: 'NSE_EQ', symbol: 'TATACONSUM' },
      { securityId: '2181', segment: 'NSE_EQ', symbol: 'M&M' },
      { securityId: '15083', segment: 'NSE_EQ', symbol: 'ADANIPORTS' },
      { securityId: '11723', segment: 'NSE_EQ', symbol: 'HCLTECH' },
      { securityId: '14418', segment: 'NSE_EQ', symbol: 'JSWSTEEL' },
      { securityId: '4963', segment: 'NSE_EQ', symbol: 'IOC' },
      { securityId: '1922', segment: 'NSE_EQ', symbol: 'ICICIBANK' },
      { securityId: '288', segment: 'NSE_EQ', symbol: 'AXISBANK' },
      { securityId: '2303', segment: 'NSE_EQ', symbol: 'LT' },
      { securityId: '881', segment: 'NSE_EQ', symbol: 'DRREDDY' },
      { securityId: '3456', segment: 'NSE_EQ', symbol: 'SUNPHARMA' },
      { securityId: '6191', segment: 'NSE_EQ', symbol: 'CIPLA' },
      { securityId: '4717', segment: 'NSE_EQ', symbol: 'APOLLOHOSP' },
      { securityId: '910', segment: 'NSE_EQ', symbol: 'EICHERMOT' },
      { securityId: '14977', segment: 'NSE_EQ', symbol: 'POWERGRID' },
    ];

    // MCX commodity tokens
    const mcxTokens = [
      { securityId: '429604', segment: 'MCX_COMM', symbol: 'GOLD' },
      { securityId: '429638', segment: 'MCX_COMM', symbol: 'SILVER' },
      { securityId: '425475', segment: 'MCX_COMM', symbol: 'CRUDEOIL' },
      { securityId: '431765', segment: 'MCX_COMM', symbol: 'NATURALGAS' },
      { securityId: '430596', segment: 'MCX_COMM', symbol: 'COPPER' },
      { securityId: '438629', segment: 'MCX_COMM', symbol: 'ALUMINIUM' },
      { securityId: '437561', segment: 'MCX_COMM', symbol: 'ZINC' },
      { securityId: '431659', segment: 'MCX_COMM', symbol: 'LEAD' },
      { securityId: '432468', segment: 'MCX_COMM', symbol: 'NICKEL' },
    ];

    // CDS currency tokens
    const cdsTokens = [
      { securityId: '11091', segment: 'CUR', symbol: 'USDINR' },
      { securityId: '11363', segment: 'CUR', symbol: 'EURINR' },
      { securityId: '11096', segment: 'CUR', symbol: 'GBPINR' },
      { securityId: '11098', segment: 'CUR', symbol: 'JPYINR' },
    ];

    const allTokens = [...defaultTokens, ...mcxTokens, ...cdsTokens];

    // Seed symbol names into MarketDataEngine
    allTokens.forEach(t => {
      const exchange = t.segment === 'MCX_COMM' ? 'MCX' : t.segment === 'CUR' ? 'CDS' : t.segment === 'IDX_I' ? 'NSE' : 'NSE';
      marketDataEngine.pushQuote(t.securityId, { symbol: t.symbol, exchange, segment: t.segment });
      candleService.registerTokenExchange(t.securityId, exchange);
    });

    // Subscribe all in Quote mode (17) for OHLC + volume
    dhanFeed.subscribe(allTokens.map(t => ({ securityId: t.securityId, segment: t.segment })), 17);
    console.log('[DhanFeed] Subscribed ' + allTokens.length + ' instruments (mode 17 Quote)');

    // Hook live ticks into candle aggregation
    dhanFeed.on('tick', (tick) => {
      if (tick.ltp > 0) {
        candleService.processLiveTick(tick.token, tick.ltp, tick.volume, Date.now());
      }
    });

  } catch (err) {
    console.error('[DhanFeed] Connection failed:', err.message);
    console.error('[DhanFeed]   Live ticks unavailable — historical/REST still works via DataProviderSwitch');
  }
}

`;

const insertPoint = content.indexOf(newFnDecl);
if (insertPoint === -1) {
  console.log('Could not find insertion point');
  process.exit(1);
}

content = content.slice(0, insertPoint) + dhanFeedFn + content.slice(insertPoint);
console.log('3. Inserted connectDhanFeed() function');

fs.writeFileSync(file, content);
console.log('DONE - all changes applied to server/index.js');
