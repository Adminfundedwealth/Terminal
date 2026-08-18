/**
 * DHAN API VERIFICATION TEST
 * 
 * Standalone script to verify Dhan API connectivity before running the main server.
 * Tests: Auth/Profile, Historical Charts, Option Chain + Greeks, Token Renewal.
 * 
 * Usage:
 *   node scripts/test-dhan.js
 * 
 * Environment (from server/.env or process.env):
 *   DHAN_CLIENT_ID       — Required
 *   DHAN_ACCESS_TOKEN    — Required
 * 
 * Exit codes:
 *   0 = All tests passed
 *   1 = One or more tests failed (or credentials missing)
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// ═══ Load .env manually (no dotenv dependency at root) ═══════════
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load from server/.env first, then root .env
loadEnvFile(path.resolve(__dirname, '../server/.env'));
loadEnvFile(path.resolve(__dirname, '../.env'));

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const CLIENT_ID = process.env.DHAN_CLIENT_ID;
const ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;

// Force IPv4
const agent = new https.Agent({ family: 4 });

// ═══════════════════════════════════════════════════════════════════
// HTTP HELPERS (native https — no axios dependency)
// ═══════════════════════════════════════════════════════════════════

function httpRequest(method, urlStr, body, customHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const hdrs = customHeaders || {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': ACCESS_TOKEN,
      'client-id': CLIENT_ID,
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) hdrs['Content-Length'] = Buffer.byteLength(bodyStr);

    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: hdrs,
      agent,
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function httpGet(url, headers) { return httpRequest('GET', url, null, headers); }
function httpPost(url, body, headers) { return httpRequest('POST', url, body, headers); }

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail: detail || '' });
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: AUTH & PROFILE CHECK
// ═══════════════════════════════════════════════════════════════════

async function testProfile() {
  const testName = '1. Auth & Profile';
  try {
    const resp = await httpGet(`${DHAN_API_BASE}/profile`);
    const data = resp.data?.data || resp.data;

    if (resp.status === 200 && data && typeof data === 'object') {
      const clientId = data.clientId || data.dhanClientId || data.client_id || 'unknown';
      const name = data.name || data.clientName || data.userName || '';
      record(testName, 'PASS', `Client: ${clientId}, Name: ${name}`);
      return true;
    }
    record(testName, 'FAIL', `Status ${resp.status}, response: ${JSON.stringify(data).slice(0, 100)}`);
    return false;
  } catch (err) {
    record(testName, 'FAIL', `Error: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: HISTORICAL CHART FEED
// ═══════════════════════════════════════════════════════════════════

async function testHistorical() {
  const testName = '2. Historical Chart (NIFTY)';
  try {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 10 * 24 * 60 * 60 * 1000);

    const payload = {
      securityId: '13',
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: 'DAY',
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate),
    };

    const resp = await httpPost(`${DHAN_API_BASE}/charts/historical`, payload);
    const data = resp.data?.data || resp.data;

    if (resp.status !== 200) {
      record(testName, 'FAIL', `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 150)}`);
      return false;
    }

    // Dhan returns parallel arrays: { open, high, low, close, volume, timestamp }
    const timestamps = data?.timestamp || data?.start_Time || [];
    const opens = data?.open || [];
    const highs = data?.high || [];
    const lows = data?.low || [];
    const closes = data?.close || [];

    if (timestamps.length > 0 && opens.length > 0) {
      const sample = `O=${opens[0]} H=${highs[0]} L=${lows[0]} C=${closes[0]}`;
      record(testName, 'PASS', `${timestamps.length} candles. Sample: ${sample}`);
      return true;
    }

    const keys = Object.keys(data || {});
    record(testName, 'FAIL', `No candle arrays. Keys: [${keys.join(', ')}]. Raw: ${JSON.stringify(data).slice(0, 100)}`);
    return false;
  } catch (err) {
    record(testName, 'FAIL', `Error: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: OPTION CHAIN & GREEKS
// ═══════════════════════════════════════════════════════════════════

async function testOptionChain() {
  const testName = '3. Option Chain (NIFTY)';
  try {
    // Step 1: Get expiry list first (to use a valid expiry date)
    const expiryResp = await httpPost(`${DHAN_API_BASE}/optionchain/expirylist`,
      { UnderlyingScrip: 13, UnderlyingSeg: 'IDX_I' },
      {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'access-token': ACCESS_TOKEN,
        'client-id': CLIENT_ID,
        'dhan-client-id': CLIENT_ID,
      }
    );

    const expiries = expiryResp.data?.data || [];
    if (!Array.isArray(expiries) || expiries.length === 0) {
      record(testName, 'FAIL', `Expiry list empty. Status: ${expiryResp.status}, Data: ${JSON.stringify(expiryResp.data).slice(0, 100)}`);
      return false;
    }

    const nearestExpiry = expiries[0]; // e.g. "2026-08-18"

    // Step 2: Get option chain for nearest expiry
    const payload = {
      UnderlyingScrip: 13,
      UnderlyingSeg: 'IDX_I',
      Expirydate: nearestExpiry,
    };

    const resp = await httpPost(`${DHAN_API_BASE}/optionchain`, payload, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': ACCESS_TOKEN,
      'client-id': CLIENT_ID,
      'dhan-client-id': CLIENT_ID,
      'dhanClientId': CLIENT_ID,
    });

    const data = resp.data?.data || resp.data;

    if (resp.status === 401) {
      // Option Chain may require Data API subscription in Dhan portal
      record(testName, 'FAIL', `HTTP 401: Option Chain API may require Data API subscription. Expiry list works (${expiries.length} dates). Enable "Data APIs" in Dhan Developer Portal.`);
      return false;
    }

    if (resp.status !== 200) {
      record(testName, 'FAIL', `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 150)}`);
      return false;
    }

    if (Array.isArray(data) && data.length > 0) {
      const sample = data[0];
      const keys = Object.keys(sample);

      const hasGreeks = keys.some(k =>
        k.toLowerCase().includes('delta') ||
        k.toLowerCase().includes('theta') ||
        k.toLowerCase().includes('gamma') ||
        k.toLowerCase().includes('iv')
      );

      const hasOI = keys.some(k =>
        k.toLowerCase().includes('oi') || k.toLowerCase().includes('open_interest')
      );

      const hasStrike = keys.some(k => k.toLowerCase().includes('strike'));

      const parts = [];
      parts.push(`${data.length} entries`);
      parts.push(`Strike: ${hasStrike ? 'YES' : 'NO'}`);
      parts.push(`OI: ${hasOI ? 'YES' : 'NO'}`);
      parts.push(`Greeks: ${hasGreeks ? 'YES' : 'NO'}`);
      parts.push(`Keys: [${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '...' : ''}]`);

      record(testName, 'PASS', parts.join(' | '));
      return true;
    }

    // Partial pass — expiry list works
    const type = Array.isArray(data) ? 'empty array' : typeof data;
    record(testName, 'FAIL', `Expiry list OK (${expiries.length} dates, nearest: ${nearestExpiry}). Chain type: ${type}. Raw: ${JSON.stringify(data).slice(0, 100)}`);
    return false;
  } catch (err) {
    record(testName, 'FAIL', `Error: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: TOKEN RENEWAL
// ═══════════════════════════════════════════════════════════════════

async function testTokenRenewal() {
  const testName = '4. Token Renewal';
  try {
    const resp = await httpGet(`${DHAN_API_BASE}/RenewToken`, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': ACCESS_TOKEN,
      'dhanClientId': CLIENT_ID,
    });

    const data = resp.data;
    const newToken = data?.token || data?.access_token || data?.accessToken || data?.data?.token;

    if (resp.status === 200 && newToken) {
      // IMPORTANT: Update the in-memory token for subsequent calls
      // (Dhan invalidates the old token on renewal)
      record(testName, 'PASS', `New token: ${newToken.slice(0, 25)}... (${newToken.length} chars). NOTE: Old token is now REVOKED.`);
      return true;
    }

    if (resp.status === 200) {
      const keys = Object.keys(data || {});
      record(testName, 'FAIL', `HTTP 200 but no token. Keys: [${keys.join(', ')}]`);
    } else {
      record(testName, 'FAIL', `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 120)}`);
    }
    return false;
  } catch (err) {
    record(testName, 'FAIL', `Error: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function printResults() {
  console.log('');
  console.log('\u2554' + '\u2550'.repeat(74) + '\u2557');
  console.log('\u2551  DHAN API VERIFICATION \u2014 RESULTS' + ' '.repeat(40) + '\u2551');
  console.log('\u2560' + '\u2550'.repeat(74) + '\u2563');

  let passed = 0, failed = 0, skipped = 0;

  for (const r of results) {
    const icon = r.status === 'PASS' ? '\u2713' : r.status === 'SKIP' ? '\u25CB' : '\u2717';
    const tag = r.status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : r.status === 'SKIP' ? '\x1b[33m[SKIP]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`\u2551  ${tag} ${icon} ${r.name}`);
    if (r.detail) {
      // Wrap long details
      const maxLen = 68;
      const lines = [];
      let remaining = r.detail;
      while (remaining.length > maxLen) {
        lines.push(remaining.slice(0, maxLen));
        remaining = remaining.slice(maxLen);
      }
      lines.push(remaining);
      for (const l of lines) {
        console.log(`\u2551        ${l}`);
      }
    }
    if (r.status === 'PASS') passed++; else if (r.status === 'SKIP') skipped++; else failed++;
  }

  console.log('\u2560' + '\u2550'.repeat(74) + '\u2563');
  const summary = `  TOTAL: ${passed} PASSED / ${failed} FAILED / ${skipped} SKIPPED`;
  console.log(`\u2551${summary}${' '.repeat(Math.max(0, 74 - summary.length))}\u2551`);
  console.log('\u255A' + '\u2550'.repeat(74) + '\u255D');
  console.log('');

  return failed === 0;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('\u2550'.repeat(55));
  console.log('  DHAN API VERIFICATION TEST');
  console.log('\u2550'.repeat(55));
  console.log(`  API Base:     ${DHAN_API_BASE}`);
  console.log(`  Client ID:    ${CLIENT_ID || '(NOT SET)'}`);
  console.log(`  Access Token: ${ACCESS_TOKEN ? ACCESS_TOKEN.slice(0, 20) + '...' : '(NOT SET)'}`);
  console.log('\u2550'.repeat(55));
  console.log('');

  // Pre-flight check
  if (!CLIENT_ID || !ACCESS_TOKEN) {
    console.error('\x1b[31m[FATAL] DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN must be set.\x1b[0m');
    console.error('');
    console.error('Add to server/.env:');
    console.error('  DHAN_CLIENT_ID=your_client_id');
    console.error('  DHAN_ACCESS_TOKEN=your_access_token');
    console.error('');
    process.exit(1);
  }

  console.log('Running tests...\n');

  await testProfile();
  await sleep(300);

  await testHistorical();
  await sleep(300);

  await testOptionChain();
  await sleep(300);

  // Token Renewal SKIPPED by default (Dhan revokes old token on renewal)
  if (process.argv.includes('--with-renewal')) {
    await testTokenRenewal();
  } else {
    record('4. Token Renewal', 'SKIP', 'Skipped (use --with-renewal). RenewToken revokes current token.');
  }

  const allPassed = printResults();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('\x1b[31m[FATAL] Unhandled error:\x1b[0m', err.message);
  process.exit(1);
});
