/**
 * FUNDEDWEALTH TERMINAL — Multi-Asset Pair Audit Script
 * 
 * Queries the running terminal backend to audit all registered instruments.
 * Reports: Symbol, Segment, Token, LTP, Provider, Status
 * 
 * Usage: node scripts/audit-all-pairs.js [BASE_URL]
 * Default: http://localhost:4000
 */

const BASE_URL = process.argv[2] || process.env.TERMINAL_URL || 'http://localhost:4000';

// ── Instruments to audit ──────────────────────────────────────────────────────
const AUDIT_PAIRS = [
  // Indices
  { token: '99926000', symbol: 'NIFTY 50',    segment: 'NSE', category: 'INDEX' },
  { token: '99926009', symbol: 'BANKNIFTY',   segment: 'NSE', category: 'INDEX' },
  { token: '99926037', symbol: 'FINNIFTY',    segment: 'NSE', category: 'INDEX' },
  { token: '99926074', symbol: 'MIDCPNIFTY',  segment: 'NSE', category: 'INDEX' },
  { token: '99919000', symbol: 'SENSEX',      segment: 'BSE', category: 'INDEX' },

  // Top Equities
  { token: '2885',  symbol: 'RELIANCE',   segment: 'NSE', category: 'EQUITY' },
  { token: '1333',  symbol: 'HDFCBANK',   segment: 'NSE', category: 'EQUITY' },
  { token: '4963',  symbol: 'ICICIBANK',  segment: 'NSE', category: 'EQUITY' },
  { token: '3045',  symbol: 'SBIN',       segment: 'NSE', category: 'EQUITY' },
  { token: '11536', symbol: 'TCS',        segment: 'NSE', category: 'EQUITY' },
  { token: '1594',  symbol: 'INFY',       segment: 'NSE', category: 'EQUITY' },
  { token: '11630', symbol: 'ITC',        segment: 'NSE', category: 'EQUITY' },
  { token: '5258',  symbol: 'LT',         segment: 'NSE', category: 'EQUITY' },
  { token: '317',   symbol: 'AXISBANK',   segment: 'NSE', category: 'EQUITY' },
  { token: '20374', symbol: 'BHARTIARTL', segment: 'NSE', category: 'EQUITY' },

  // Futures (placeholder tokens — expected ZERO LTP from feed)
  { token: 'NF_FUT',   symbol: 'NIFTY FUT',     segment: 'NFO', category: 'FUTURES' },
  { token: 'BNF_FUT',  symbol: 'BANKNIFTY FUT', segment: 'NFO', category: 'FUTURES' },
  { token: 'REL_FUT',  symbol: 'RELIANCE FUT',  segment: 'NFO', category: 'FUTURES' },
  { token: 'HDFC_FUT', symbol: 'HDFCBANK FUT',  segment: 'NFO', category: 'FUTURES' },
  { token: 'SBIN_FUT', symbol: 'SBIN FUT',      segment: 'NFO', category: 'FUTURES' },

  // MCX Commodities (placeholder tokens)
  { token: 'GOLD_F',      symbol: 'GOLD',       segment: 'MCX', category: 'MCX' },
  { token: 'SILVER_F',    symbol: 'SILVER',     segment: 'MCX', category: 'MCX' },
  { token: 'CRUDE_F',     symbol: 'CRUDEOIL',   segment: 'MCX', category: 'MCX' },
  { token: 'NATGAS_F',    symbol: 'NATURALGAS', segment: 'MCX', category: 'MCX' },
  { token: 'COPPER_F',    symbol: 'COPPER',     segment: 'MCX', category: 'MCX' },

  // CDS Currencies (placeholder tokens)
  { token: 'USDINR_F',  symbol: 'USDINR',  segment: 'CDS', category: 'CDS' },
  { token: 'EURINR_F',  symbol: 'EURINR',  segment: 'CDS', category: 'CDS' },
  { token: 'GBPINR_F',  symbol: 'GBPINR',  segment: 'CDS', category: 'CDS' },
  { token: 'JPYINR_F',  symbol: 'JPYINR',  segment: 'CDS', category: 'CDS' },
];

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  try {
    const resp = await fetch(`${BASE_URL}${path}`, { timeout: 10000 });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ── Main audit ────────────────────────────────────────────────────────────────
async function runAudit() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║        FUNDEDWEALTH TERMINAL — MULTI-ASSET PAIR AUDIT                   ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Target: ${BASE_URL.padEnd(60)}║`);
  console.log(`║  Time:   ${new Date().toISOString().padEnd(60)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Check server health
  const health = await fetchJSON('/health');
  console.log(`[Health] ${health.error ? '❌ ' + health.error : '✓ Server reachable'}`);

  // 2. Get market status
  const marketStatus = await fetchJSON('/api/market/status');
  if (marketStatus.error) {
    console.log(`[Market Status] ❌ ${marketStatus.error}`);
  } else {
    console.log(`[Market Status] Feed: ${marketStatus.feed?.connected ? '✓ LIVE' : '✗ OFFLINE'} | Adapter: ${marketStatus.feed?.adapterName || 'none'} | Cached Quotes: ${marketStatus.feed?.subscribedSymbols || 0}`);
  }

  // 3. Get data provider status
  const providerStatus = await fetchJSON('/api/provider/status');
  if (!providerStatus.error) {
    console.log(`[Provider] Active: ${providerStatus.activeProvider} | Dhan Ready: ${providerStatus.dhanReady} | Dhan Success: ${providerStatus.dhanSuccessCount} | Errors: ${providerStatus.dhanErrorCount}`);
    if (providerStatus.lastDhanError) {
      console.log(`[Provider] Last Error: ${providerStatus.lastDhanError.msg} (${new Date(providerStatus.lastDhanError.time).toLocaleTimeString()})`);
    }
  }

  console.log('');
  console.log('─── QUOTE AUDIT ───────────────────────────────────────────────────────────');
  console.log('');

  // Column headers
  const header = [
    'Category'.padEnd(8),
    'Symbol'.padEnd(16),
    'Token'.padEnd(12),
    'Segment'.padEnd(6),
    'LTP'.padStart(12),
    'Age(s)'.padStart(8),
    'Status'.padEnd(10),
  ].join(' │ ');
  console.log(header);
  console.log('─'.repeat(header.length));

  const results = { ok: 0, zero: 0, stale: 0, missing: 0, placeholder: 0 };

  for (const pair of AUDIT_PAIRS) {
    const quote = await fetchJSON(`/api/market/quote?token=${pair.token}`);
    const isPlaceholder = !(/^\d+$/.test(pair.token));
    
    let ltp = '—';
    let age = '—';
    let status = 'MISSING';

    if (quote && !quote.error && quote !== null) {
      const ltpVal = quote.ltp || 0;
      const ts = quote.timestamp || 0;
      const ageSeconds = ts ? Math.round((Date.now() - ts) / 1000) : -1;

      if (ltpVal > 0) {
        ltp = ltpVal.toFixed(2);
        age = ageSeconds >= 0 ? String(ageSeconds) : '—';
        if (ageSeconds > 120) {
          status = 'STALE';
          results.stale++;
        } else {
          status = 'OK';
          results.ok++;
        }
      } else {
        ltp = '0.00';
        if (isPlaceholder) {
          status = 'PLACEHOLDER';
          results.placeholder++;
        } else {
          status = 'ZERO_LTP';
          results.zero++;
        }
      }
    } else {
      if (isPlaceholder) {
        status = 'PLACEHOLDER';
        results.placeholder++;
      } else {
        results.missing++;
      }
    }

    const statusIcon = status === 'OK' ? '✓' : status === 'PLACEHOLDER' ? '○' : status === 'STALE' ? '⚠' : '✗';
    const row = [
      pair.category.padEnd(8),
      pair.symbol.padEnd(16),
      pair.token.padEnd(12),
      pair.segment.padEnd(6),
      ltp.padStart(12),
      age.padStart(8),
      `${statusIcon} ${status}`.padEnd(12),
    ].join(' │ ');
    console.log(row);
  }

  console.log('');
  console.log('─── SUMMARY ───────────────────────────────────────────────────────────────');
  console.log(`  ✓ OK:          ${results.ok}`);
  console.log(`  ○ Placeholder: ${results.placeholder} (expected — no live feed for FUT/MCX/CDS tokens)`);
  console.log(`  ⚠ Stale:       ${results.stale} (quote older than 2 minutes)`);
  console.log(`  ✗ Zero LTP:    ${results.zero}`);
  console.log(`  ✗ Missing:     ${results.missing}`);
  console.log('');

  // 4. Test option chain availability
  console.log('─── OPTION CHAIN AUDIT ────────────────────────────────────────────────────');
  for (const sym of ['NIFTY', 'BANKNIFTY']) {
    const expiries = await fetchJSON(`/api/market/option-expiries?symbol=${sym}`);
    if (expiries?.error || !Array.isArray(expiries) || expiries.length === 0) {
      console.log(`  ${sym}: ✗ No expiries available (${expiries?.error || 'empty'})`);
    } else {
      console.log(`  ${sym}: ✓ ${expiries.length} expiries | Next: ${expiries[0]}`);
      // Test first expiry chain
      const chain = await fetchJSON(`/api/market/option-chain?symbol=${sym}&expiry=${expiries[0]}`);
      if (Array.isArray(chain) && chain.length > 0) {
        const withLtp = chain.filter(s => (s.callLtp > 0 || s.putLtp > 0));
        console.log(`          Chain: ${chain.length} strikes | With LTP: ${withLtp.length}`);
      } else {
        console.log(`          Chain: ✗ Empty or failed`);
      }
    }
  }

  console.log('');
  console.log('─── HISTORICAL DATA AUDIT ─────────────────────────────────────────────────');
  // Test candle data for NIFTY
  const candleTest = await fetchJSON('/api/market/history?token=99926000&exchange=NSE&timeframe=5');
  if (candleTest?.error) {
    console.log(`  NIFTY 5m candles: ✗ ${candleTest.error}`);
  } else if (Array.isArray(candleTest)) {
    console.log(`  NIFTY 5m candles: ✓ ${candleTest.length} bars`);
  } else if (candleTest?.data) {
    console.log(`  NIFTY 5m candles: ✓ ${candleTest.data.length} bars (via ${candleTest.provider || 'unknown'})`);
  } else {
    console.log(`  NIFTY 5m candles: ⚠ Unexpected response format`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log(`AUDIT COMPLETE — ${new Date().toISOString()}`);
  
  // Exit with error code if critical failures
  if (results.zero > 0 || results.missing > 2) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('AUDIT FAILED:', err.message);
  process.exit(2);
});
