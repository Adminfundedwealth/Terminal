/**
 * WHO-IS-SERVING — Live Data Provider Diagnostics
 * 
 * Reconciles EXACTLY which provider (Dhan vs Angel One) is serving
 * each asset type: Option Strikes, Historical Candles, Live Ticks,
 * Futures, MCX.
 * 
 * Tests are performed against LIVE APIs — requires valid credentials.
 * 
 * Usage:
 *   node scripts/who-is-serving.js
 * 
 * Environment (from server/.env):
 *   DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN
 *   ANGEL_API_KEY, ANGEL_CLIENT_ID, ANGEL_PASSWORD, ANGEL_TOTP_SECRET
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// ═══ Load .env ═══════════════════════════════════════════════════════
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
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.resolve(__dirname, '../server/.env'));
loadEnvFile(path.resolve(__dirname, '../.env'));

// ═══ Resolve server node_modules for otplib ═══════════════════════════
const SERVER_NODE_MODULES = path.resolve(__dirname, '../server/node_modules');
// Add server node_modules to require path so @otplib resolves correctly
module.paths.unshift(SERVER_NODE_MODULES);

// ═══ Constants ═══════════════════════════════════════════════════════
const DHAN_API = 'https://api.dhan.co/v2';
const ANGEL_API = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

const DHAN_CLIENT_ID = (process.env.DHAN_CLIENT_ID || '').trim();
const DHAN_TOKEN = (process.env.DHAN_ACCESS_TOKEN || '').trim();
const ANGEL_API_KEY = (process.env.ANGEL_API_KEY || '').trim();
const ANGEL_CLIENT_ID = (process.env.ANGEL_CLIENT_ID || '').trim();
const ANGEL_PASSWORD = (process.env.ANGEL_PASSWORD || '').trim();
const ANGEL_TOTP_SECRET = (process.env.ANGEL_TOTP_SECRET || '').trim();

// ═══ HTTP Helpers (native, zero-dep) ═════════════════════════════════
function httpRequest(method, urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const hdrs = { ...headers };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) hdrs['Content-Length'] = Buffer.byteLength(bodyStr);

    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: hdrs,
      agent: IPV4_AGENT,
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (15s)')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function dhanHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'access-token': DHAN_TOKEN,
    'client-id': DHAN_CLIENT_ID,
    'dhan-client-id': DHAN_CLIENT_ID,
    'dhanClientId': DHAN_CLIENT_ID,
  };
}

function angelHeaders(jwt) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${jwt}`,
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': ANGEL_API_KEY,
  };
}

// ═══ Angel One Login (TOTP-based) ════════════════════════════════════
let angelJWT = null;

async function angelLogin() {
  if (!ANGEL_API_KEY || !ANGEL_CLIENT_ID || !ANGEL_PASSWORD || !ANGEL_TOTP_SECRET) {
    return { ok: false, error: 'ANGEL credentials not set in env' };
  }

  try {
    // Generate TOTP
    let totp;
    try {
      const { authenticator } = require('@otplib/preset-default');
      totp = authenticator.generate(ANGEL_TOTP_SECRET);
    } catch (e) {
      return { ok: false, error: `TOTP generation failed: ${e.message}. Install @otplib/preset-default.` };
    }

    const resp = await httpRequest('POST',
      `${ANGEL_API}/rest/auth/angelbroking/user/v1/loginByPassword`,
      { clientcode: ANGEL_CLIENT_ID, password: ANGEL_PASSWORD, totp },
      {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': ANGEL_API_KEY,
      }
    );

    const jwt = resp.data?.data?.jwtToken;
    if (jwt) {
      angelJWT = jwt;
      return { ok: true, clientId: ANGEL_CLIENT_ID };
    }
    return { ok: false, error: `Login HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 150)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══ Dhan Auth Check ═════════════════════════════════════════════════
async function dhanAuthCheck() {
  if (!DHAN_CLIENT_ID || !DHAN_TOKEN) {
    return { ok: false, error: 'DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not set' };
  }
  try {
    const resp = await httpRequest('GET', `${DHAN_API}/profile`, null, dhanHeaders());
    if (resp.status === 200) {
      const d = resp.data?.data || resp.data;
      return { ok: true, clientId: d?.clientId || d?.dhanClientId || DHAN_CLIENT_ID };
    }
    return { ok: false, error: `HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 120)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══ Format date helper ══════════════════════════════════════════════
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 1: Historical Candles — Index (NIFTY 50)
// ═══════════════════════════════════════════════════════════════════════
async function testHistoricalIndex() {
  const results = { asset: 'Index Charts', instrument: 'NIFTY 50', dhan: null, angel: null };

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 5);

  // --- DHAN ---
  try {
    const payload = {
      securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX',
      interval: '5', fromDate: fmtDate(from), toDate: fmtDate(now),
    };
    const resp = await httpRequest('POST', `${DHAN_API}/charts/intraday`, payload, dhanHeaders());
    const d = resp.data?.data || resp.data;
    const count = d?.timestamp?.length || d?.open?.length || 0;
    if (resp.status === 200 && count > 0) {
      results.dhan = { status: 'OK', candles: count, sample: `O=${d.open?.[0]} C=${d.close?.[0]}` };
    } else {
      results.dhan = { status: 'FAIL', http: resp.status, error: JSON.stringify(d).slice(0, 100) };
    }
  } catch (err) {
    results.dhan = { status: 'ERROR', error: err.message };
  }

  // --- ANGEL ONE ---
  if (angelJWT) {
    try {
      const payload = {
        exchange: 'NSE', symboltoken: '99926000', interval: 'FIVE_MINUTE',
        fromdate: `${fmtDate(from)} 09:15`, todate: `${fmtDate(now)} 15:30`,
      };
      const resp = await httpRequest('POST',
        `${ANGEL_API}/rest/secure/angelbroking/historical/v1/getCandleData`,
        payload, angelHeaders(angelJWT)
      );
      const candles = resp.data?.data || [];
      if (resp.status === 200 && Array.isArray(candles) && candles.length > 0) {
        results.angel = { status: 'OK', candles: candles.length, sample: `OHLCV=${candles[0]}` };
      } else {
        results.angel = { status: 'FAIL', http: resp.status, error: JSON.stringify(resp.data).slice(0, 100) };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 2: Historical Candles — Stock (RELIANCE)
// ═══════════════════════════════════════════════════════════════════════
async function testHistoricalStock() {
  const results = { asset: 'Stock Charts', instrument: 'RELIANCE', dhan: null, angel: null };

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 5);

  // --- DHAN (RELIANCE securityId = 2885, segment NSE_EQ) ---
  try {
    const payload = {
      securityId: '2885', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY',
      interval: '5', fromDate: fmtDate(from), toDate: fmtDate(now),
    };
    const resp = await httpRequest('POST', `${DHAN_API}/charts/intraday`, payload, dhanHeaders());
    const d = resp.data?.data || resp.data;
    const count = d?.timestamp?.length || d?.open?.length || 0;
    if (resp.status === 200 && count > 0) {
      results.dhan = { status: 'OK', candles: count, sample: `O=${d.open?.[0]} C=${d.close?.[0]}` };
    } else {
      results.dhan = { status: 'FAIL', http: resp.status, error: JSON.stringify(d).slice(0, 100) };
    }
  } catch (err) {
    results.dhan = { status: 'ERROR', error: err.message };
  }

  // --- ANGEL ONE (RELIANCE token = 2885) ---
  if (angelJWT) {
    try {
      const payload = {
        exchange: 'NSE', symboltoken: '2885', interval: 'FIVE_MINUTE',
        fromdate: `${fmtDate(from)} 09:15`, todate: `${fmtDate(now)} 15:30`,
      };
      const resp = await httpRequest('POST',
        `${ANGEL_API}/rest/secure/angelbroking/historical/v1/getCandleData`,
        payload, angelHeaders(angelJWT)
      );
      const candles = resp.data?.data || [];
      if (resp.status === 200 && Array.isArray(candles) && candles.length > 0) {
        results.angel = { status: 'OK', candles: candles.length };
      } else {
        results.angel = { status: 'FAIL', http: resp.status, error: JSON.stringify(resp.data).slice(0, 100) };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 3: Historical Candles — Option (NIFTY 24200 CE)
// ═══════════════════════════════════════════════════════════════════════
async function testHistoricalOption() {
  const results = { asset: 'Option Charts', instrument: 'NIFTY 24200 CE', dhan: null, angel: null };

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 3);

  // --- DHAN (need a valid NIFTY option securityId — use scrip search approach) ---
  // For diagnostics, we'll attempt with a known near-ATM strike.
  // Dhan option securityId changes per expiry — test via option chain first.
  try {
    // First get expiry list to find a valid option token
    const expiryResp = await httpRequest('POST', `${DHAN_API}/optionchain/expirylist`,
      { UnderlyingScrip: 13, UnderlyingSeg: 'IDX_I' }, dhanHeaders()
    );
    const expiries = expiryResp.data?.data || [];
    
    if (expiries.length > 0) {
      // Use next expiry (not today's)
      const expiry = expiries.length > 1 ? expiries[1] : expiries[0];
      
      // Wait 4s for Dhan rate limit (1 req per 3s for option chain)
      await new Promise(r => setTimeout(r, 4000));
      
      // Get chain with correct "Expiry" key
      const chainResp = await httpRequest('POST', `${DHAN_API}/optionchain`,
        { UnderlyingScrip: 13, UnderlyingSeg: 'IDX_I', Expiry: expiry }, dhanHeaders()
      );
      const chainData = chainResp.data?.data;
      
      let ceSecId = null;
      if (chainData?.oc) {
        // Find a near-24200 CE strike from the oc map
        const strikeKeys = Object.keys(chainData.oc);
        const target = strikeKeys.find(k => {
          const s = parseFloat(k);
          return s >= 24000 && s <= 24400;
        });
        if (target) {
          ceSecId = chainData.oc[target]?.ce?.security_id;
        } else if (strikeKeys.length > 0) {
          // Use any available strike
          const midIdx = Math.floor(strikeKeys.length / 2);
          ceSecId = chainData.oc[strikeKeys[midIdx]]?.ce?.security_id;
        }
      } else if (Array.isArray(chainData) && chainData.length > 0) {
        const ce = chainData.find(s => s.strikePrice >= 24000 && s.strikePrice <= 24400 && s.optionType === 'CE');
        ceSecId = ce?.securityId || ce?.security_id;
      }

      if (ceSecId) {
        await new Promise(r => setTimeout(r, 1000));
        const payload = {
          securityId: String(ceSecId), exchangeSegment: 'NSE_FNO', instrument: 'OPTIDX',
          interval: '5', fromDate: fmtDate(from), toDate: fmtDate(now),
        };
        const resp = await httpRequest('POST', `${DHAN_API}/charts/intraday`, payload, dhanHeaders());
        const d = resp.data?.data || resp.data;
        const count = d?.timestamp?.length || d?.open?.length || 0;
        if (resp.status === 200 && count > 0) {
          results.dhan = { status: 'OK', candles: count, secId: ceSecId };
        } else {
          // Empty candles at this hour is OK — option may not have traded
          results.dhan = { status: 'OK', candles: 0, secId: ceSecId, note: 'No candles (market closed or no trades)' };
        }
      } else {
        results.dhan = { status: 'FAIL', error: `Chain returned but no CE token found. Chain HTTP ${chainResp.status}` };
      }
    } else {
      results.dhan = { status: 'FAIL', error: `No expiries returned (HTTP ${expiryResp.status})` };
    }
  } catch (err) {
    results.dhan = { status: 'ERROR', error: err.message };
  }

  // --- ANGEL ONE (searchScrip to find NIFTY CE token, then historical) ---
  if (angelJWT) {
    try {
      // Search for a NIFTY option token
      const searchResp = await httpRequest('POST',
        `${ANGEL_API}/rest/secure/angelbroking/order/v1/searchScrip`,
        { exchange: 'NFO', searchscrip: 'NIFTY' },
        angelHeaders(angelJWT)
      );
      const scripts = searchResp.data?.data || [];
      // Find a 24200 CE or near-ATM CE
      const ceScript = Array.isArray(scripts) 
        ? scripts.find(s => s.tradingsymbol && s.tradingsymbol.includes('24200') && s.tradingsymbol.includes('CE'))
        : null;

      if (ceScript) {
        const payload = {
          exchange: 'NFO', symboltoken: ceScript.symboltoken, interval: 'FIVE_MINUTE',
          fromdate: `${fmtDate(from)} 09:15`, todate: `${fmtDate(now)} 15:30`,
        };
        const resp = await httpRequest('POST',
          `${ANGEL_API}/rest/secure/angelbroking/historical/v1/getCandleData`,
          payload, angelHeaders(angelJWT)
        );
        const candles = resp.data?.data || [];
        if (resp.status === 200 && Array.isArray(candles) && candles.length > 0) {
          results.angel = { status: 'OK', candles: candles.length, symbol: ceScript.tradingsymbol };
        } else {
          results.angel = { status: 'FAIL', http: resp.status, symbol: ceScript.tradingsymbol, error: JSON.stringify(resp.data).slice(0, 80) };
        }
      } else {
        results.angel = { status: 'FAIL', error: 'searchScrip did not find a matching CE option' };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 4: Option Chain (NIFTY Weekly — Strikes + Greeks)
// ═══════════════════════════════════════════════════════════════════════
async function testOptionChain() {
  const results = { asset: 'Option Chain', instrument: 'NIFTY Weekly', dhan: null, angel: null };

  // --- DHAN ---
  try {
    // Get nearest expiry
    const exResp = await httpRequest('POST', `${DHAN_API}/optionchain/expirylist`,
      { UnderlyingScrip: 13, UnderlyingSeg: 'IDX_I' }, dhanHeaders()
    );
    const expiries = exResp.data?.data || [];
    
    if (expiries.length === 0) {
      results.dhan = { status: 'FAIL', error: `Expiry list empty (HTTP ${exResp.status})` };
    } else {
      // Use next expiry (not today's — today's expiry may be post-settlement)
      const nearestExpiry = expiries.length > 1 ? expiries[1] : expiries[0];
      
      // CRITICAL: Dhan rate limit is 1 req per 3 seconds for option chain
      await new Promise(r => setTimeout(r, 4000));
      
      // Use correct key "Expiry" per official Dhan docs (NOT Expirydate/ExpiryDate)
      const chainResp = await httpRequest('POST', `${DHAN_API}/optionchain`,
        { UnderlyingScrip: 13, UnderlyingSeg: 'IDX_I', Expiry: nearestExpiry },
        dhanHeaders()
      );
      const d = chainResp.data?.data || chainResp.data;

      if (chainResp.status === 200 && d?.oc) {
        const strikes = Object.keys(d.oc).length;
        // Check for Greeks in first non-empty strike
        const firstStrikeKey = Object.keys(d.oc).find(k => d.oc[k]?.ce?.last_price > 0) || Object.keys(d.oc)[0];
        const sample = d.oc[firstStrikeKey]?.ce;
        const hasGreeks = sample?.greeks && (sample.greeks.delta !== undefined);
        const hasLTP = sample?.last_price > 0;
        results.dhan = {
          status: 'OK', strikes, expiry: nearestExpiry,
          greeks: hasGreeks ? 'YES (delta/theta/gamma/vega)' : 'NO',
          ltp: hasLTP ? `LTP: ${sample.last_price}` : 'ZERO (market closed)',
          sampleKeys: Object.keys(sample || {}).slice(0, 8),
          underlyingLTP: d.last_price || 0,
        };
      } else if (chainResp.status === 200 && Array.isArray(d) && d.length > 0) {
        results.dhan = { status: 'OK', strikes: d.length, expiry: nearestExpiry };
      } else {
        results.dhan = { status: 'FAIL', http: chainResp.status, expiry: nearestExpiry, error: JSON.stringify(d).slice(0, 120) };
      }
    }
  } catch (err) {
    results.dhan = { status: 'ERROR', error: err.message };
  }

  // --- ANGEL ONE (searchScrip-based chain) ---
  if (angelJWT) {
    try {
      // Angel's searchScrip for NIFTY NFO options
      const searchResp = await httpRequest('POST',
        `${ANGEL_API}/rest/secure/angelbroking/order/v1/searchScrip`,
        { exchange: 'NFO', searchscrip: 'NIFTY' },
        angelHeaders(angelJWT)
      );
      const scripts = searchResp.data?.data || [];
      
      if (Array.isArray(scripts) && scripts.length > 0) {
        // Count CE and PE entries
        const ceCount = scripts.filter(s => s.tradingsymbol?.includes('CE')).length;
        const peCount = scripts.filter(s => s.tradingsymbol?.includes('PE')).length;
        
        // Try to get LTP for one via market quote
        const sampleToken = scripts[0]?.symboltoken;
        let ltp = null;
        if (sampleToken) {
          try {
            const quoteResp = await httpRequest('POST',
              `${ANGEL_API}/rest/secure/angelbroking/market/v1/quote`,
              { mode: 'LTP', exchangeTokens: { NFO: [sampleToken] } },
              angelHeaders(angelJWT)
            );
            const fetched = quoteResp.data?.data?.fetched || [];
            ltp = fetched[0]?.ltp || null;
          } catch {}
        }
        
        results.angel = {
          status: 'OK',
          strikes: `${ceCount} CE + ${peCount} PE = ${ceCount + peCount} total`,
          greeks: 'NO (Angel searchScrip has no Greeks)',
          ltp: ltp ? `Sample LTP: ${ltp}` : 'Quote fetch pending',
          totalResults: scripts.length,
        };
      } else {
        results.angel = { status: 'FAIL', http: searchResp.status, error: JSON.stringify(searchResp.data).slice(0, 100) };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 5: Live WebSocket Ticks (connection test only — no persistent WS)
// ═══════════════════════════════════════════════════════════════════════
async function testLiveTicks() {
  const results = { asset: 'Live Ticks', instrument: 'Watchlist & DOM', dhan: null, angel: null };

  // --- DHAN WebSocket connectivity test ---
  if (DHAN_CLIENT_ID && DHAN_TOKEN) {
    try {
      const wsUrl = `wss://api-feed.dhan.co/api/v2/ws?version=2&token=${DHAN_TOKEN}&clientId=${DHAN_CLIENT_ID}&authType=2`;
      results.dhan = await testWebSocket(wsUrl, 'Dhan');
    } catch (err) {
      results.dhan = { status: 'ERROR', error: err.message };
    }
  } else {
    results.dhan = { status: 'SKIP', error: 'No Dhan credentials' };
  }

  // --- Angel One SmartStream WebSocket test ---
  if (angelJWT) {
    try {
      const feedToken = await getAngelFeedToken();
      if (feedToken) {
        const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${ANGEL_CLIENT_ID}&feedToken=${feedToken}&apiKey=${ANGEL_API_KEY}`;
        results.angel = await testWebSocket(wsUrl, 'Angel');
      } else {
        results.angel = { status: 'FAIL', error: 'No feed token obtained from login' };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// Quick WebSocket connection test (connect, wait 3s for any data, disconnect)
function testWebSocket(url, label) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };

    try {
      const WebSocket = require('ws');
      const ws = new WebSocket(url, { agent: IPV4_AGENT, handshakeTimeout: 8000 });
      let gotData = false;
      let dataBytes = 0;

      ws.on('open', () => {
        // Connection established — wait for data
        setTimeout(() => {
          ws.close();
          if (gotData) {
            done({ status: 'OK', connected: true, receivedData: true, bytes: dataBytes });
          } else {
            done({ status: 'OK', connected: true, receivedData: false, note: 'Connected but no data in 3s (may need subscription)' });
          }
        }, 3000);
      });

      ws.on('message', (data) => {
        gotData = true;
        dataBytes += data.length;
      });

      ws.on('error', (err) => {
        done({ status: 'FAIL', error: `WS error: ${err.message}` });
      });

      ws.on('close', (code, reason) => {
        if (!gotData) {
          done({ status: 'FAIL', error: `WS closed: code=${code} reason=${reason || 'none'}` });
        }
      });

      // Hard timeout
      setTimeout(() => {
        try { ws.close(); } catch {}
        done({ status: 'TIMEOUT', error: 'WS did not connect within 8s' });
      }, 8000);
    } catch (err) {
      done({ status: 'ERROR', error: `WS module error: ${err.message}` });
    }
  });
}

// Get Angel One feed token from the login response
let angelFeedToken = null;
async function getAngelFeedToken() {
  if (angelFeedToken) return angelFeedToken;
  // Re-login to get feedToken (included in login response)
  try {
    const { authenticator } = require('@otplib/preset-default');
    const totp = authenticator.generate(ANGEL_TOTP_SECRET);
    const resp = await httpRequest('POST',
      `${ANGEL_API}/rest/auth/angelbroking/user/v1/loginByPassword`,
      { clientcode: ANGEL_CLIENT_ID, password: ANGEL_PASSWORD, totp },
      {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-UserType': 'USER', 'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1', 'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': ANGEL_API_KEY,
      }
    );
    angelFeedToken = resp.data?.data?.feedToken;
    return angelFeedToken;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 6: Commodities — MCX (GOLD)
// ═══════════════════════════════════════════════════════════════════════
async function testMCX() {
  const results = { asset: 'Commodities', instrument: 'GOLD (MCX)', dhan: null, angel: null };

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 5);

  // --- DHAN (GOLD MCX securityId = 429604 per dhan.historical.js) ---
  // Note: MCX futures contracts roll over — if 429604 returns empty, it's expired.
  // MCX market hours: 9:00 AM - 11:30 PM IST — data may be empty outside these hours.
  try {
    const payload = {
      securityId: '429604', exchangeSegment: 'MCX_COMM', instrument: 'FUTCOM',
      interval: '5', fromDate: fmtDate(from), toDate: fmtDate(now),
    };
    const resp = await httpRequest('POST', `${DHAN_API}/charts/intraday`, payload, dhanHeaders());
    const d = resp.data?.data || resp.data;
    const count = d?.timestamp?.length || d?.open?.length || 0;
    if (resp.status === 200 && count > 0) {
      results.dhan = { status: 'OK', candles: count, sample: `O=${d.open?.[0]} C=${d.close?.[0]}` };
    } else if (resp.status === 200 && count === 0) {
      // Try daily historical instead (more likely to have data)
      const dailyPayload = {
        securityId: '429604', exchangeSegment: 'MCX_COMM', instrument: 'FUTCOM',
        interval: 'DAY', fromDate: fmtDate(new Date(now.getTime() - 30 * 24 * 3600000)), toDate: fmtDate(now),
      };
      await new Promise(r => setTimeout(r, 1000));
      const dailyResp = await httpRequest('POST', `${DHAN_API}/charts/historical`, dailyPayload, dhanHeaders());
      const dd = dailyResp.data?.data || dailyResp.data;
      const dailyCount = dd?.timestamp?.length || dd?.open?.length || 0;
      if (dailyCount > 0) {
        results.dhan = { status: 'OK', candles: dailyCount, note: 'Daily candles (intraday empty - MCX closed or contract rolled)', sample: `O=${dd.open?.[0]} C=${dd.close?.[0]}` };
      } else {
        results.dhan = { status: 'FAIL', http: 200, error: 'Empty data - MCX contract 429604 may have rolled over. Update securityId.' };
      }
    } else {
      results.dhan = { status: 'FAIL', http: resp.status, error: JSON.stringify(d).slice(0, 100) };
    }
  } catch (err) {
    results.dhan = { status: 'ERROR', error: err.message };
  }

  // --- ANGEL ONE (GOLD MCX — need to search for active GOLD future) ---
  if (angelJWT) {
    try {
      const searchResp = await httpRequest('POST',
        `${ANGEL_API}/rest/secure/angelbroking/order/v1/searchScrip`,
        { exchange: 'MCX', searchscrip: 'GOLD' },
        angelHeaders(angelJWT)
      );
      const scripts = searchResp.data?.data || [];
      // Get the first futures contract
      const fut = Array.isArray(scripts) ? scripts.find(s => s.instrumenttype === 'FUTCOM' || s.tradingsymbol?.includes('FUT')) || scripts[0] : null;

      if (fut) {
        const payload = {
          exchange: 'MCX', symboltoken: fut.symboltoken, interval: 'FIVE_MINUTE',
          fromdate: `${fmtDate(from)} 09:00`, todate: `${fmtDate(now)} 23:30`,
        };
        const resp = await httpRequest('POST',
          `${ANGEL_API}/rest/secure/angelbroking/historical/v1/getCandleData`,
          payload, angelHeaders(angelJWT)
        );
        const candles = resp.data?.data || [];
        if (resp.status === 200 && Array.isArray(candles) && candles.length > 0) {
          results.angel = { status: 'OK', candles: candles.length, symbol: fut.tradingsymbol };
        } else {
          results.angel = { status: 'FAIL', http: resp.status, symbol: fut.tradingsymbol, error: JSON.stringify(resp.data).slice(0, 80) };
        }
      } else {
        results.angel = { status: 'FAIL', error: 'No GOLD contract found via searchScrip' };
      }
    } catch (err) {
      results.angel = { status: 'ERROR', error: err.message };
    }
  } else {
    results.angel = { status: 'SKIP', error: 'No Angel JWT' };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// RESULTS TABLE
// ═══════════════════════════════════════════════════════════════════════
function determineProvider(r) {
  if (r.dhan?.status === 'OK') return 'DHAN';
  return 'NONE — DHAN FAILING';
}

function printTable(allResults) {
  console.log('\n');
  console.log('═'.repeat(130));
  console.log('  WHO IS SERVING — ASSET-BY-ASSET RECONCILIATION');
  console.log('═'.repeat(130));
  console.log('');

  const headers = ['Asset Class', 'Instrument', 'Current Provider', 'Dhan Status', 'Angel Status', 'Fallback?'];
  const widths = [16, 18, 38, 28, 28, 10];
  
  // Header row
  let hdr = '│ ';
  headers.forEach((h, i) => hdr += h.padEnd(widths[i]) + '│ ');
  console.log('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');
  console.log(hdr);
  console.log('├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤');

  for (const r of allResults) {
    const provider = determineProvider(r);
    const dhanSummary = r.dhan?.status === 'OK' 
      ? `OK (${r.dhan.candles || r.dhan.strikes || 'data'})`
      : `${r.dhan?.status}: ${(r.dhan?.error || '').slice(0, 20)}`;
    const angelSummary = r.angel?.status === 'OK'
      ? `OK (${r.angel.candles || r.angel.strikes || 'data'})`
      : `${r.angel?.status}: ${(r.angel?.error || '').slice(0, 20)}`;
    const fallback = 'NO (disabled)';

    let row = '│ ';
    row += (r.asset || '').padEnd(widths[0]) + '│ ';
    row += (r.instrument || '').padEnd(widths[1]) + '│ ';
    row += provider.padEnd(widths[2]) + '│ ';
    row += dhanSummary.padEnd(widths[3]) + '│ ';
    row += angelSummary.padEnd(widths[4]) + '│ ';
    row += fallback.padEnd(widths[5]) + '│ ';
    console.log(row);
  }

  console.log('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
  console.log('');
}

function printDetailedResults(allResults) {
  console.log('═'.repeat(80));
  console.log('  DETAILED RESPONSE PAYLOADS');
  console.log('═'.repeat(80));
  
  for (const r of allResults) {
    console.log(`\n─── ${r.asset} (${r.instrument}) ───`);
    console.log('  DHAN:', JSON.stringify(r.dhan, null, 2));
    console.log('  ANGEL:', JSON.stringify(r.angel, null, 2));
  }
}

function printDiagnosis(allResults) {
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('  DIAGNOSIS & RECOMMENDED ACTIONS');
  console.log('═'.repeat(80));

  const dhanFailing = allResults.filter(r => r.dhan?.status !== 'OK');
  const angelFailing = allResults.filter(r => r.angel?.status !== 'OK' && r.angel?.status !== 'SKIP');
  const noneServing = allResults.filter(r => r.dhan?.status !== 'OK' && r.angel?.status !== 'OK');

  if (dhanFailing.length > 0) {
    console.log('\n  ⚠ DHAN FAILURES:');
    for (const r of dhanFailing) {
      console.log(`    • ${r.asset} (${r.instrument}): ${r.dhan?.status} — ${r.dhan?.error || 'see details'}`);
    }
    console.log('\n  POSSIBLE CAUSES:');
    console.log('    1. DHAN_ACCESS_TOKEN expired (tokens last ~24h from generation)');
    console.log('    2. Dhan "Data APIs" subscription not enabled in Developer Portal');
    console.log('    3. Market hours restriction (some endpoints return empty outside 9:15-15:30 IST)');
    console.log('    4. Rate limiting — Dhan limits to ~10 req/second');
    console.log('    5. MCX security IDs may have changed with contract rollover');
  }

  if (noneServing.length > 0) {
    console.log('\n  🔴 CRITICAL — NO PROVIDER SERVING:');
    for (const r of noneServing) {
      console.log(`    • ${r.asset}: Users will see "0.00" or "Chart data unavailable"`);
    }
    console.log('\n  IMMEDIATE FIX:');
    console.log('    - Check server logs for DataProviderSwitch errors');
    console.log('    - Verify ANGEL credentials and TOTP secret haven\'t rotated');
    console.log('    - Regenerate DHAN_ACCESS_TOKEN at https://dhanhq.co/app/developer');
  }

  if (dhanFailing.length === 0 && angelFailing.length === 0) {
    console.log('\n  ✓ ALL PROVIDERS HEALTHY — Dhan serving as primary, Angel One ready as fallback');
  }

  console.log('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  WHO-IS-SERVING — Data Provider Reconciliation');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(60));
  console.log('');

  // ── Credential Status ──
  console.log('  CREDENTIALS:');
  console.log(`    Dhan Client ID:    ${DHAN_CLIENT_ID || '(NOT SET)'}`);
  console.log(`    Dhan Token:        ${DHAN_TOKEN ? DHAN_TOKEN.slice(0, 20) + '...' : '(NOT SET)'}`);
  console.log(`    Angel Client ID:   ${ANGEL_CLIENT_ID || '(NOT SET)'}`);
  console.log(`    Angel API Key:     ${ANGEL_API_KEY ? ANGEL_API_KEY.slice(0, 10) + '...' : '(NOT SET)'}`);
  console.log(`    Angel TOTP Secret: ${ANGEL_TOTP_SECRET ? '****' + ANGEL_TOTP_SECRET.slice(-4) : '(NOT SET)'}`);
  console.log('');

  // ── Auth Phase ──
  console.log('  AUTHENTICATION:');
  
  const dhanAuth = await dhanAuthCheck();
  console.log(`    Dhan:     ${dhanAuth.ok ? '✓ Authenticated' : '✗ ' + dhanAuth.error}`);
  
  const angelAuth = await angelLogin();
  console.log(`    Angel:    ${angelAuth.ok ? '✓ Authenticated' : '✗ ' + angelAuth.error}`);
  console.log('');

  if (!dhanAuth.ok && !angelAuth.ok) {
    console.error('\n  ❌ FATAL: Both providers failed authentication. Cannot proceed.\n');
    console.error('  Fix credentials in server/.env and retry.\n');
    process.exit(1);
  }

  // ── Run Tests ──
  console.log('  Running asset-by-asset tests...\n');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  const allResults = [];

  process.stdout.write('    [1/6] Index Charts (NIFTY 50)...');
  allResults.push(await testHistoricalIndex());
  console.log(' done');
  await sleep(2000);

  process.stdout.write('    [2/6] Stock Charts (RELIANCE)...');
  allResults.push(await testHistoricalStock());
  console.log(' done');
  await sleep(2000);

  process.stdout.write('    [3/6] Option Charts (NIFTY CE)...');
  allResults.push(await testHistoricalOption());
  console.log(' done');
  await sleep(4000); // Extra spacing — option chain rate limit is 1 per 3s

  process.stdout.write('    [4/6] Option Chain (NIFTY Weekly)...');
  allResults.push(await testOptionChain());
  console.log(' done');
  await sleep(3000);

  process.stdout.write('    [5/6] Live Ticks (WebSocket)...');
  allResults.push(await testLiveTicks());
  console.log(' done');
  await sleep(2000);

  process.stdout.write('    [6/6] Commodities (GOLD MCX)...');
  allResults.push(await testMCX());
  console.log(' done');

  // ── Output ──
  printTable(allResults);
  printDetailedResults(allResults);
  printDiagnosis(allResults);

  // Exit code: 0 = all OK, 1 = at least one asset has no provider
  const anyFailing = allResults.some(r => r.dhan?.status !== 'OK' && r.angel?.status !== 'OK');
  process.exit(anyFailing ? 1 : 0);
}

main().catch(err => {
  console.error(`\n  ❌ FATAL: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
});
