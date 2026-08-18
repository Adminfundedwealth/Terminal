/**
 * DHAN HISTORICAL DATA SERVICE
 * 
 * Fetches historical OHLCV candle data from Dhan API v2.
 * 
 * Endpoints:
 *   POST /v2/charts/historical  — Daily candles (multi-day)
 *   POST /v2/charts/intraday    — Intraday candles (1m, 5m, 15m, 25m, 60m)
 * 
 * Key discovery from live testing:
 *   - Dhan uses same security IDs as Angel One for NSE_EQ stocks (e.g. 2885 = RELIANCE)
 *   - Index IDs: NIFTY=13, BANKNIFTY=25, FINNIFTY=27, MIDCPNIFTY=442, SENSEX=51
 *   - Index segment must be 'IDX_I' (not NSE_EQ)
 *   - NSE stocks use 'NSE_EQ' + instrument 'EQUITY'
 *   - NFO futures/options need Dhan-specific security IDs (different from Angel)
 *   - MCX uses 'MCX_COMM' segment
 *   - Header 'dhan-client-id' is required alongside 'client-id'
 * 
 * Output:
 *   Normalized array of { time, open, high, low, close, volume }
 *   Sorted ascending. Validated. Compatible with TradingView Lightweight Charts.
 */

import axios from 'axios';
import https from 'https';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Known index tokens (Angel One token → Dhan securityId + segment)
const INDEX_MAP = {
  '99926000': { securityId: '13', segment: 'IDX_I', instrument: 'INDEX' },   // NIFTY 50
  '99926009': { securityId: '25', segment: 'IDX_I', instrument: 'INDEX' },   // BANKNIFTY
  '99926037': { securityId: '27', segment: 'IDX_I', instrument: 'INDEX' },   // FINNIFTY
  '99926074': { securityId: '442', segment: 'IDX_I', instrument: 'INDEX' },  // MIDCPNIFTY
  '99919000': { securityId: '51', segment: 'IDX_I', instrument: 'INDEX' },   // SENSEX
};

// Exchange → Dhan segment mapping
const SEGMENT_MAP = {
  'NSE': 'NSE_EQ',
  'BSE': 'BSE_EQ',
  'NFO': 'NSE_FNO',
  'BFO': 'BSE_FNO',
  'MCX': 'MCX_COMM',
  'CDS': 'CUR',
  // Pass-through
  'NSE_EQ': 'NSE_EQ',
  'BSE_EQ': 'BSE_EQ',
  'NSE_FNO': 'NSE_FNO',
  'IDX_I': 'IDX_I',
  'MCX_COMM': 'MCX_COMM',
};

// Instrument type by segment
const INSTRUMENT_MAP = {
  'NSE_EQ': 'EQUITY',
  'BSE_EQ': 'EQUITY',
  'NSE_FNO': 'FUTIDX',
  'BSE_FNO': 'FUTIDX',
  'MCX_COMM': 'FUTCOM',
  'IDX_I': 'INDEX',
  'CUR': 'FUTCUR',
};

// Timeframe → endpoint + interval
const TIMEFRAME_CONFIG = {
  '1':   { endpoint: 'intraday', interval: '1' },
  '3':   { endpoint: 'intraday', interval: '5' },   // Dhan has no 3m, use 5m
  '5':   { endpoint: 'intraday', interval: '5' },
  '15':  { endpoint: 'intraday', interval: '15' },
  '30':  { endpoint: 'intraday', interval: '25' },  // Dhan has 25m, closest to 30
  '60':  { endpoint: 'intraday', interval: '60' },
  '240': { endpoint: 'historical', interval: 'DAY' },
  'D':   { endpoint: 'historical', interval: 'DAY' },
  'W':   { endpoint: 'historical', interval: 'DAY' },
};

export class DhanHistoricalService {
  constructor(authService) {
    this.auth = authService;
  }

  /**
   * Fetch historical candles.
   * 
   * @param {string} token          — Angel One token / security ID
   * @param {string} exchange       — Exchange as passed from frontend: NSE, NFO, MCX, etc.
   * @param {string} timeframe      — '1','5','15','30','60','240','D','W'
   * @param {number} fromTimestamp  — Unix seconds
   * @param {number} toTimestamp    — Unix seconds
   * @returns {Array<{time, open, high, low, close, volume}>}
   */
  async getCandles(token, exchange, timeframe, fromTimestamp, toTimestamp) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanHistorical] No valid token');
      }
    }

    const tfConfig = TIMEFRAME_CONFIG[timeframe];
    if (!tfConfig) {
      throw new Error(`[DhanHistorical] Unsupported timeframe: ${timeframe}`);
    }

    // Resolve Dhan-specific params from the Angel token + exchange
    const { securityId, segment, instrument } = this._resolveInstrument(token, exchange);

    const fromDate = this._formatDate(new Date(fromTimestamp * 1000));
    const toDate = this._formatDate(new Date(toTimestamp * 1000));

    const payload = {
      securityId,
      exchangeSegment: segment,
      instrument,
      interval: tfConfig.interval,
      fromDate,
      toDate,
    };

    const endpoint = tfConfig.endpoint === 'intraday'
      ? `${DHAN_API_BASE}/charts/intraday`
      : `${DHAN_API_BASE}/charts/historical`;

    console.log(`[DhanHistorical] ${tfConfig.endpoint} ${securityId}/${segment} ${timeframe} ${fromDate}→${toDate}`);

    try {
      const resp = await this._request(endpoint, payload);
      const candles = this._parse(resp.data, timeframe);
      console.log(`[DhanHistorical] Got ${candles.length} candles`);
      return candles;
    } catch (err) {
      // Retry once on 401
      if (err.response?.status === 401 || err.response?.status === 403) {
        const refreshed = await this.auth.refreshToken();
        if (refreshed) {
          const resp = await this._request(endpoint, payload);
          return this._parse(resp.data, timeframe);
        }
      }
      const msg = err.response?.data || err.message;
      console.error(`[DhanHistorical] Failed:`, JSON.stringify(msg).slice(0, 200));
      throw err;
    }
  }

  /**
   * Resolve Angel token + exchange into Dhan securityId + segment + instrument.
   */
  _resolveInstrument(token, exchange) {
    // Check if it's a known index token
    if (INDEX_MAP[token]) {
      return INDEX_MAP[token];
    }

    // Map exchange to Dhan segment
    const segment = SEGMENT_MAP[exchange] || 'NSE_EQ';
    const instrument = INSTRUMENT_MAP[segment] || 'EQUITY';

    // For NSE equity, the Angel token IS the Dhan securityId
    // For NFO/MCX, they may differ — but many are the same
    return {
      securityId: String(token),
      segment,
      instrument,
    };
  }

  /**
   * Parse Dhan parallel-array response into candle objects.
   */
  _parse(data, timeframe) {
    const raw = data?.data || data;
    const timestamps = raw?.timestamp || raw?.start_Time || [];
    const opens = raw?.open || [];
    const highs = raw?.high || [];
    const lows = raw?.low || [];
    const closes = raw?.close || [];
    const volumes = raw?.volume || [];

    if (!timestamps.length) return [];

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const time = this._normalizeTimestamp(timestamps[i]);
      const open = parseFloat(opens[i]) || 0;
      const high = parseFloat(highs[i]) || 0;
      const low = parseFloat(lows[i]) || 0;
      const close = parseFloat(closes[i]) || 0;
      const volume = parseInt(volumes[i]) || 0;

      if (!this._isValid(time, open, high, low, close)) continue;
      candles.push({ time, open, high, low, close, volume });
    }

    // Sort ascending, deduplicate
    candles.sort((a, b) => a.time - b.time);
    const deduped = [];
    let prevTime = 0;
    for (const c of candles) {
      if (c.time !== prevTime) { deduped.push(c); prevTime = c.time; }
    }

    // Aggregate to weekly if needed
    if (timeframe === 'W') return this._aggregateWeekly(deduped);
    return deduped;
  }

  _normalizeTimestamp(ts) {
    if (typeof ts === 'number') return ts > 9999999999 ? Math.floor(ts / 1000) : ts;
    if (typeof ts === 'string') { const d = new Date(ts).getTime(); return isNaN(d) ? 0 : Math.floor(d / 1000); }
    return 0;
  }

  _isValid(time, o, h, l, c) {
    return time > 0 && o > 0 && h > 0 && l > 0 && c > 0 && h >= l && h >= o && h >= c && l <= o && l <= c;
  }

  _aggregateWeekly(daily) {
    if (!daily.length) return [];
    const weeks = [];
    let cur = null;
    for (const c of daily) {
      const ws = this._weekStart(new Date(c.time * 1000));
      if (!cur || cur._ws !== ws) {
        if (cur) weeks.push(cur);
        cur = { _ws: ws, time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      } else {
        cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low);
        cur.close = c.close; cur.volume += c.volume;
      }
    }
    if (cur) weeks.push(cur);
    return weeks.map(({ _ws, ...c }) => c);
  }

  _weekStart(d) { const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); return d.toISOString().slice(0, 10); }

  _formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  async _request(url, payload) {
    return axios.post(url, payload, {
      httpsAgent: IPV4_AGENT,
      timeout: 12000,
      headers: this.auth.getHeaders(),
    });
  }
}
