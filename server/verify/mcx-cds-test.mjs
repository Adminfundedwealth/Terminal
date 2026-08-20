/**
 * MCX + CDS Historical Data Verification
 * Run: node server/verify/mcx-cds-test.mjs
 *
 * Tests Dhan historical API directly with the security IDs resolved by the new
 * resolveActiveContractLive() logic.
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dir, '../../.env') });

const DHAN_API = 'https://api.dhan.co/v2';
const IPV4 = new https.Agent({ family: 4 });

const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'access-token': process.env.DHAN_ACCESS_TOKEN?.trim(),
  'client-id': process.env.DHAN_CLIENT_ID?.trim(),
};

const today = new Date();
const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 10);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

async function testHistorical(label, securityId, exchangeSegment, instrument) {
  const payload = {
    securityId: String(securityId),
    exchangeSegment,
    instrument,
    interval: '15',
    fromDate: fmt(fromDate),
    toDate: fmt(today),
  };
  console.log(`\n[TEST] ${label}`);
  console.log('  payload:', JSON.stringify(payload));
  try {
    const resp = await axios.post(`${DHAN_API}/charts/intraday`, payload, {
      httpsAgent: IPV4, timeout: 15000, headers,
    });
    const raw = resp.data?.data || resp.data;
    const ts = raw?.timestamp || raw?.start_Time || (Array.isArray(raw) ? raw.map(r => r.time) : []);
    const count = Array.isArray(ts) ? ts.length : 0;
    if (count > 0) {
      console.log(`  ✓ PASS — ${count} candles returned`);
      // Show first and last candle
      if (raw?.timestamp) {
        const i = raw.timestamp.length - 1;
        console.log(`    first: ${raw.timestamp[0]}  O=${raw.open?.[0]} H=${raw.high?.[0]} L=${raw.low?.[0]} C=${raw.close?.[0]}`);
        console.log(`    last:  ${raw.timestamp[i]}  O=${raw.open?.[i]} H=${raw.high?.[i]} L=${raw.low?.[i]} C=${raw.close?.[i]}`);
      }
      return { pass: true, count };
    } else {
      console.log(`  ✗ FAIL — 0 candles. Response: ${JSON.stringify(resp.data).slice(0,200)}`);
      return { pass: false, count: 0 };
    }
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0,300) : err.message;
    console.log(`  ✗ ERROR — ${err.response?.status || ''} ${msg}`);
    return { pass: false, error: msg };
  }
}

async function searchScrip(symbol, exchange) {
  console.log(`\n[SCRIP SEARCH] ${symbol} on ${exchange}`);
  try {
    const resp = await axios.post(`${DHAN_API}/searchScrip`, { searchString: symbol, exchange }, {
      httpsAgent: IPV4, timeout: 10000, headers,
    });
    const items = resp.data?.data || [];
    const now = new Date();
    const futures = items.filter(item => {
      const exp = item.expiryDate ? new Date(item.expiryDate) : null;
      return exp && exp >= now && (
        item.instrumentType === 'FUTCOM' || item.instrumentType === 'FUTCUR' || item.instrumentType === 'FUT'
      );
    });
    futures.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    console.log(`  Total results: ${items.length}, Future contracts: ${futures.length}`);
    if (futures.length > 0) {
      const f = futures[0];
      console.log(`  Front-month: securityId=${f.securityId} tradingSymbol=${f.tradingSymbol} expiry=${f.expiryDate} type=${f.instrumentType}`);
      return f.securityId ? String(f.securityId) : null;
    }
    console.log('  No future contracts found via searchScrip');
    return null;
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0,200) : err.message;
    console.log(`  ERROR: ${msg}`);
    return null;
  }
}

async function main() {
  console.log('=== MCX + CDS Dhan API Verification ===');
  console.log(`Client: ${process.env.DHAN_CLIENT_ID ? process.env.DHAN_CLIENT_ID.slice(0,6)+'...' : 'NOT SET'}`);
  console.log(`Token:  ${process.env.DHAN_ACCESS_TOKEN ? process.env.DHAN_ACCESS_TOKEN.slice(0,12)+'...' : 'NOT SET'}`);
  console.log(`Date range: ${fmt(fromDate)} → ${fmt(today)}`);

  const results = {};

  // ── MCX GOLD ─────────────────────────────────────────────────────────────
  // Static fallback from scrip master: 483079 = GOLD-05Oct2026-FUT
  console.log('\n══════ MCX GOLD ══════');
  results.gold_static = await testHistorical('GOLD static (483079)', '483079', 'MCX_COMM', 'FUTCOM');

  // Also try searchScrip
  const goldLive = await searchScrip('GOLD', 'MCX');
  if (goldLive && goldLive !== '483079') {
    results.gold_live = await testHistorical(`GOLD live (${goldLive})`, goldLive, 'MCX_COMM', 'FUTCOM');
  }

  // ── MCX SILVER ───────────────────────────────────────────────────────────
  console.log('\n══════ MCX SILVER ══════');
  // 471725 = SILVER-04Sep2026-FUT (from scrip master)
  results.silver = await testHistorical('SILVER static (471725)', '471725', 'MCX_COMM', 'FUTCOM');

  // ── MCX CRUDEOIL ─────────────────────────────────────────────────────────
  console.log('\n══════ MCX CRUDEOIL ══════');
  // 565899 = CRUDEOIL-21Sep2026-FUT
  results.crude = await testHistorical('CRUDEOIL static (565899)', '565899', 'MCX_COMM', 'FUTCOM');

  // ── MCX NATURALGAS ───────────────────────────────────────────────────────
  console.log('\n══════ MCX NATURALGAS ══════');
  // 568245 = NATURALGAS-25Sep2026-FUT
  results.natgas = await testHistorical('NATURALGAS static (568245)', '568245', 'MCX_COMM', 'FUTCOM');

  // ── CDS USDINR ───────────────────────────────────────────────────────────
  // The scrip master has no Aug 2026+ CDS contracts. Try searchScrip first.
  console.log('\n══════ CDS USDINR ══════');
  const usdLive = await searchScrip('USDINR', 'CUR');
  if (usdLive) {
    results.usdinr_live = await testHistorical(`USDINR live (${usdLive})`, usdLive, 'NSE_CURRENCY', 'FUTCUR');
  }
  // Also try the Jun 2026 static ID (expired — expected to return 0 or error)
  results.usdinr_static = await testHistorical('USDINR static/expired (6601)', '6601', 'NSE_CURRENCY', 'FUTCUR');

  // ── CDS EURINR ───────────────────────────────────────────────────────────
  console.log('\n══════ CDS EURINR ══════');
  const eurLive = await searchScrip('EURINR', 'CUR');
  if (eurLive) {
    results.eurinr = await testHistorical(`EURINR live (${eurLive})`, eurLive, 'NSE_CURRENCY', 'FUTCUR');
  }

  // ── CDS GBPINR ───────────────────────────────────────────────────────────
  console.log('\n══════ CDS GBPINR ══════');
  const gbpLive = await searchScrip('GBPINR', 'CUR');
  if (gbpLive) {
    results.gbpinr = await testHistorical(`GBPINR live (${gbpLive})`, gbpLive, 'NSE_CURRENCY', 'FUTCUR');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════');
  for (const [k, v] of Object.entries(results)) {
    const status = v.pass ? `✓ PASS (${v.count} candles)` : `✗ FAIL`;
    console.log(`  ${k.padEnd(20)}: ${status}`);
  }

  const anyFail = Object.values(results).some(r => !r.pass);
  process.exit(anyFail ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
