/**
 * FUTURES CONTRACT SERVICE
 *
 * Single authoritative resolver for NSE_FNO, BSE_FNO, MCX_COMM, and
 * NSE_CURRENCY futures contracts.
 *
 * All callers (api.js history route, api.js quote route, server/index.js WS
 * subscriptions, InstrumentService) must go through this service — never
 * directly through dhan.historical or hardcoded IDX_I/NSE_EQ mappings for
 * futures instruments.
 *
 * Resolution order for NSE/BSE futures:
 *   1. In-memory cache (populated after first scrip master load)
 *   2. dhan.historical.getActiveFuturesContract() (scrip master lookup)
 *   3. Nothing — null returned; caller falls back gracefully
 *
 * Resolution order for MCX/CDS futures:
 *   1. In-memory cache
 *   2. dhan.historical.getActiveContract() (existing MCX/CDS path)
 *   3. dhan.historical.resolveActiveContractLive() (Dhan scrip search API)
 *   4. Nothing — null returned
 *
 * The cache is refreshed:
 *   - On first call after startup (lazy load, single Promise)
 *   - Whenever refreshAll() is called (scheduled daily by server/index.js)
 *
 * IMPORTANT: This service is read-only. It does not modify any broker state,
 * database, positions, orders, or risk rules.
 */

// ─── Underlying → exchange-segment mapping ────────────────────────────────────
// Determines which Dhan segment to query for each underlying.
// Index futures are FUTIDX in NSE_FNO; stock futures are FUTSTK in NSE_FNO.
// SENSEX and BANKEX are in BSE_FNO.
const NSE_INDEX_UNDERLYINGS = new Set([
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50',
]);
const BSE_INDEX_UNDERLYINGS = new Set([
  'SENSEX', 'BANKEX',
]);

// Canonical underlying names as they appear in Dhan's SM_SYMBOL_NAME column.
// This is the key that getActiveFuturesContract() matches against item.symbol.
const UNDERLYING_CANONICAL = {
  // index variants
  'NIFTY50':        'NIFTY',
  'NIFTY 50':       'NIFTY',
  'NIFTY FUT':      'NIFTY',
  'BANKNIFTY FUT':  'BANKNIFTY',
  'BANK NIFTY':     'BANKNIFTY',
  'FINNIFTY FUT':   'FINNIFTY',
  'FIN NIFTY':      'FINNIFTY',
  'MIDCPNIFTY FUT': 'MIDCPNIFTY',
  'MIDCAP NIFTY':   'MIDCPNIFTY',
  'SENSEX FUT':     'SENSEX',
  // stock futures (strip " FUT" suffix → canonical equity symbol)
};

function canonicalise(name) {
  const up = (name || '').toUpperCase().trim();
  if (UNDERLYING_CANONICAL[up]) return UNDERLYING_CANONICAL[up];
  // Strip " FUT" / " FUTURES" suffix for stock futures
  return up.replace(/\s+FUT(URES?)?$/i, '').trim();
}

// ─── Placeholder token → underlying mapping ───────────────────────────────────
// Maps placeholder string tokens used throughout the app to their canonical
// underlying + exchange so the resolver knows which segment to query.
const PLACEHOLDER_MAP = {
  // NSE Index Futures
  'NF_FUT':    { underlying: 'NIFTY',       exchange: 'NSE_FNO' },
  'NF_FUT_N':  { underlying: 'NIFTY',       exchange: 'NSE_FNO' },
  'NF_FUT_F':  { underlying: 'NIFTY',       exchange: 'NSE_FNO' },
  'BNF_FUT':   { underlying: 'BANKNIFTY',   exchange: 'NSE_FNO' },
  'BNF_FUT_N': { underlying: 'BANKNIFTY',   exchange: 'NSE_FNO' },
  'FNF_FUT':   { underlying: 'FINNIFTY',    exchange: 'NSE_FNO' },
  'MCN_FUT':   { underlying: 'MIDCPNIFTY',  exchange: 'NSE_FNO' },
  'MNF_FUT':   { underlying: 'MIDCPNIFTY',  exchange: 'NSE_FNO' },
  // BSE Index Futures
  'SEN_FUT':   { underlying: 'SENSEX',      exchange: 'BSE_FNO' },
  'SNX_FUT':   { underlying: 'SENSEX',      exchange: 'BSE_FNO' },
  // NSE Stock Futures
  'REL_FUT':   { underlying: 'RELIANCE',    exchange: 'NSE_FNO' },
  'HDFC_FUT':  { underlying: 'HDFCBANK',    exchange: 'NSE_FNO' },
  'ICICI_FUT': { underlying: 'ICICIBANK',   exchange: 'NSE_FNO' },
  'SBIN_FUT':  { underlying: 'SBIN',        exchange: 'NSE_FNO' },
  'TCS_FUT':   { underlying: 'TCS',         exchange: 'NSE_FNO' },
  'INFY_FUT':  { underlying: 'INFY',        exchange: 'NSE_FNO' },
  'ITC_FUT':   { underlying: 'ITC',         exchange: 'NSE_FNO' },
  'LT_FUT':    { underlying: 'LT',          exchange: 'NSE_FNO' },
  'AXIS_FUT':  { underlying: 'AXISBANK',    exchange: 'NSE_FNO' },
  'HCL_FUT':   { underlying: 'HCLTECH',     exchange: 'NSE_FNO' },
  'BAJF_FUT':  { underlying: 'BAJFINANCE',  exchange: 'NSE_FNO' },
  'KOTAK_FUT': { underlying: 'KOTAKBANK',   exchange: 'NSE_FNO' },
  'TATAM_FUT': { underlying: 'TATAMOTORS',  exchange: 'NSE_FNO' },
  'TATAS_FUT': { underlying: 'TATASTEEL',   exchange: 'NSE_FNO' },
  'MARUTI_FUT':  { underlying: 'MARUTI',    exchange: 'NSE_FNO' },
  'TITAN_FUT':   { underlying: 'TITAN',     exchange: 'NSE_FNO' },
  'ADANIE_FUT':  { underlying: 'ADANIENT',  exchange: 'NSE_FNO' },
  'ADANIP_FUT':  { underlying: 'ADANIPORTS',exchange: 'NSE_FNO' },
  'BEL_FUT':     { underlying: 'BEL',       exchange: 'NSE_FNO' },
  'HAL_FUT':     { underlying: 'HAL',       exchange: 'NSE_FNO' },
  'ZOMATO_FUT':  { underlying: 'ZOMATO',    exchange: 'NSE_FNO' },
  'DLF_FUT':     { underlying: 'DLF',       exchange: 'NSE_FNO' },
  'SUNP_FUT':    { underlying: 'SUNPHARMA', exchange: 'NSE_FNO' },
  'PWRGRD_FUT':  { underlying: 'POWERGRID', exchange: 'NSE_FNO' },
  'NTPC_FUT':    { underlying: 'NTPC',      exchange: 'NSE_FNO' },
  'COAL_FUT':    { underlying: 'COALINDIA', exchange: 'NSE_FNO' },
  'BHARTI_FUT':  { underlying: 'BHARTIARTL',exchange: 'NSE_FNO' },
  'TIIN_FUT':    { underlying: 'TIINDIA',   exchange: 'NSE_FNO' },
  'VOLTAS_FUT':  { underlying: 'VOLTAS',    exchange: 'NSE_FNO' },
  'WIPRO_FUT':   { underlying: 'WIPRO',     exchange: 'NSE_FNO' },
  // MCX Commodities
  'GOLD_F':      { underlying: 'GOLD',       exchange: 'MCX_COMM' },
  'GOLDM_F':     { underlying: 'GOLDM',      exchange: 'MCX_COMM' },
  'SILVER_F':    { underlying: 'SILVER',     exchange: 'MCX_COMM' },
  'SILVERM_F':   { underlying: 'SILVERM',    exchange: 'MCX_COMM' },
  'CRUDE_F':     { underlying: 'CRUDEOIL',   exchange: 'MCX_COMM' },
  'NATGAS_F':    { underlying: 'NATURALGAS', exchange: 'MCX_COMM' },
  'COPPER_F':    { underlying: 'COPPER',     exchange: 'MCX_COMM' },
  'ZINC_F':      { underlying: 'ZINC',       exchange: 'MCX_COMM' },
  'ALUMINIUM_F': { underlying: 'ALUMINIUM',  exchange: 'MCX_COMM' },
  // CDS Currency
  'USDINR_F':    { underlying: 'USDINR',     exchange: 'NSE_CURRENCY' },
  'USDINR_FN':   { underlying: 'USDINR',     exchange: 'NSE_CURRENCY' },
  'USDINR_FF':   { underlying: 'USDINR',     exchange: 'NSE_CURRENCY' },
  'EURINR_F':    { underlying: 'EURINR',     exchange: 'NSE_CURRENCY' },
  'GBPINR_F':    { underlying: 'GBPINR',     exchange: 'NSE_CURRENCY' },
  'JPYINR_F':    { underlying: 'JPYINR',     exchange: 'NSE_CURRENCY' },
};

export class FuturesContractService {
  constructor() {
    // cache: underlying:exchange → { securityId, segment, instrument, expiry, tradingSymbol, lotSize, tickSize }
    this._cache   = new Map();
    this._warming = null;  // Promise when a full warm is in progress
    this._dhanHistorical = null; // set via init()
  }

  /**
   * Attach the DhanHistoricalService instance.
   * Called once at startup from server/index.js or wherever the service is
   * first used.
   * @param {import('../brokers/dhan/dhan.historical.js').DhanHistoricalService} historicalSvc
   */
  init(historicalSvc) {
    this._dhanHistorical = historicalSvc;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Resolve a placeholder token (e.g. 'NF_FUT') or a symbol string
   * (e.g. 'NIFTY FUT', 'RELIANCE FUT') to a live contract descriptor.
   *
   * @param {string} tokenOrSymbol - placeholder token OR symbol name
   * @returns {Promise<{
   *   securityId: string,
   *   segment:    string,
   *   instrument: string,
   *   expiry:     string|null,
   *   tradingSymbol: string|null,
   *   lotSize:    number,
   *   tickSize:   number,
   * }|null>}
   */
  async resolve(tokenOrSymbol) {
    if (!tokenOrSymbol) return null;

    // 1. Placeholder token path
    const ph = PLACEHOLDER_MAP[tokenOrSymbol];
    if (ph) return this._resolveUnderlying(ph.underlying, ph.exchange);

    // 2. Symbol-name path ("NIFTY FUT", "RELIANCE FUT", etc.)
    const canonical = canonicalise(tokenOrSymbol);
    const exchange  = this._inferExchange(canonical);
    if (exchange) return this._resolveUnderlying(canonical, exchange);

    // 3. Already a numeric Dhan securityId — return minimal descriptor
    if (/^\d+$/.test(tokenOrSymbol)) {
      const cached = this._cacheGet(tokenOrSymbol, '*');
      if (cached) return cached;
    }

    return null;
  }

  /**
   * Resolve directly by underlying name + exchange segment.
   * The primary path used internally and by api.js.
   *
   * @param {string} underlying - 'NIFTY', 'BANKNIFTY', 'RELIANCE', 'SENSEX', 'GOLD', 'USDINR', …
   * @param {string} exchange   - 'NSE_FNO' | 'BSE_FNO' | 'MCX_COMM' | 'NSE_CURRENCY'
   * @returns {Promise<ContractDescriptor|null>}
   */
  async resolveUnderlying(underlying, exchange) {
    return this._resolveUnderlying(underlying.toUpperCase().trim(), exchange);
  }

  /**
   * Warm the full cache for a curated list of high-priority underlyings.
   * Called once at startup; safe to call again for daily refresh.
   * Non-blocking — failures are logged but do not throw.
   */
  async warmCache() {
    if (this._warming) return this._warming;
    this._warming = this._doWarm().finally(() => { this._warming = null; });
    return this._warming;
  }

  /**
   * Refresh cache for all underlyings that are currently cached.
   * Called on a daily schedule so expiry dates stay current.
   */
  async refreshAll() {
    const keys = [...this._cache.keys()];
    for (const key of keys) {
      const [underlying, exchange] = key.split(':');
      try {
        await this._fetchAndCache(underlying, exchange);
      } catch (err) {
        console.warn(`[FuturesContractSvc] Refresh failed for ${key}:`, err.message);
      }
    }
    console.log(`[FuturesContractSvc] Cache refreshed — ${this._cache.size} contracts`);
  }

  /**
   * Return the full contents of the in-memory cache as a plain array.
   * Used by server/index.js to build the initial WS subscription list and by
   * InstrumentService to populate real securityIds.
   * @returns {Array<{underlying:string, exchange:string, ...contract}>}
   */
  getCachedContracts() {
    const out = [];
    for (const [key, contract] of this._cache.entries()) {
      const colonIdx = key.indexOf(':');
      out.push({
        underlying: key.slice(0, colonIdx),
        exchange:   key.slice(colonIdx + 1),
        ...contract,
      });
    }
    return out;
  }

  // ─── Internal resolution ─────────────────────────────────────────────────

  async _resolveUnderlying(underlying, exchange) {
    const cacheKey = `${underlying}:${exchange}`;
    const hit = this._cache.get(cacheKey);
    if (hit) return hit;

    // Ensure scrip master is loaded before trying
    if (this._dhanHistorical) {
      await this._dhanHistorical._getScripMaster();
    }

    return this._fetchAndCache(underlying, exchange);
  }

  async _fetchAndCache(underlying, exchange) {
    if (!this._dhanHistorical) {
      console.warn('[FuturesContractSvc] DhanHistoricalService not yet attached — call init() first');
      return null;
    }

    let contract = null;

    try {
      if (exchange === 'NSE_FNO' || exchange === 'BSE_FNO') {
        // ── NSE / BSE equity+index futures ──────────────────────────────
        const raw = this._dhanHistorical.getActiveFuturesContract(underlying, exchange);
        if (raw) {
          // Augment with lot size and tick size from scrip master
          const lotSize  = this._dhanHistorical.getLotSize(underlying) || raw.lotSize || 1;
          const tickSize = this._dhanHistorical.getTickSize(underlying) || raw.tickSize || 0.05;
          contract = { ...raw, lotSize, tickSize };
        }
      } else {
        // ── MCX / CDS — use existing resolver ───────────────────────────
        const secId = await this._dhanHistorical.resolveActiveContractLive(underlying, exchange);
        if (secId) {
          const lotSize  = this._dhanHistorical.getLotSize(underlying) || 1;
          const tickSize = this._inferTickSize(underlying, exchange);
          contract = {
            securityId:    secId,
            segment:       exchange,
            instrument:    exchange === 'MCX_COMM' ? 'FUTCOM' : 'FUTCUR',
            expiry:        null,
            tradingSymbol: null,
            lotSize,
            tickSize,
          };
        }
      }
    } catch (err) {
      console.warn(`[FuturesContractSvc] Resolution error for ${underlying}/${exchange}:`, err.message);
      return null;
    }

    if (contract) {
      this._cache.set(`${underlying}:${exchange}`, contract);
      console.log(`[FuturesContractSvc] Cached ${underlying}/${exchange} → securityId=${contract.securityId} expiry=${contract.expiry}`);
    }
    return contract;
  }

  async _doWarm() {
    console.log('[FuturesContractSvc] Warming futures contract cache...');
    // Ensure scrip master is loaded first
    if (this._dhanHistorical) {
      await this._dhanHistorical._getScripMaster();
    }

    const priority = [
      // NSE Index Futures
      { u: 'NIFTY',       e: 'NSE_FNO' },
      { u: 'BANKNIFTY',   e: 'NSE_FNO' },
      { u: 'FINNIFTY',    e: 'NSE_FNO' },
      { u: 'MIDCPNIFTY',  e: 'NSE_FNO' },
      // BSE Index Futures
      { u: 'SENSEX',      e: 'BSE_FNO' },
      // NSE Stock Futures (top 15 by liquidity)
      { u: 'RELIANCE',    e: 'NSE_FNO' },
      { u: 'HDFCBANK',    e: 'NSE_FNO' },
      { u: 'ICICIBANK',   e: 'NSE_FNO' },
      { u: 'SBIN',        e: 'NSE_FNO' },
      { u: 'TCS',         e: 'NSE_FNO' },
      { u: 'INFY',        e: 'NSE_FNO' },
      { u: 'ITC',         e: 'NSE_FNO' },
      { u: 'LT',          e: 'NSE_FNO' },
      { u: 'AXISBANK',    e: 'NSE_FNO' },
      { u: 'HCLTECH',     e: 'NSE_FNO' },
      { u: 'BAJFINANCE',  e: 'NSE_FNO' },
      { u: 'KOTAKBANK',   e: 'NSE_FNO' },
      { u: 'TATAMOTORS',  e: 'NSE_FNO' },
      { u: 'TATASTEEL',   e: 'NSE_FNO' },
      { u: 'MARUTI',      e: 'NSE_FNO' },
      { u: 'TITAN',       e: 'NSE_FNO' },
      { u: 'ADANIENT',    e: 'NSE_FNO' },
      { u: 'ADANIPORTS',  e: 'NSE_FNO' },
      { u: 'WIPRO',       e: 'NSE_FNO' },
      { u: 'BHARTIARTL',  e: 'NSE_FNO' },
      { u: 'SUNPHARMA',   e: 'NSE_FNO' },
      { u: 'NTPC',        e: 'NSE_FNO' },
      { u: 'POWERGRID',   e: 'NSE_FNO' },
      { u: 'COALINDIA',   e: 'NSE_FNO' },
      { u: 'ZOMATO',      e: 'NSE_FNO' },
      { u: 'DLF',         e: 'NSE_FNO' },
      { u: 'HAL',         e: 'NSE_FNO' },
      { u: 'BEL',         e: 'NSE_FNO' },
      { u: 'TIINDIA',     e: 'NSE_FNO' },
      { u: 'VOLTAS',      e: 'NSE_FNO' },
      // MCX Commodities
      { u: 'GOLD',        e: 'MCX_COMM' },
      { u: 'SILVER',      e: 'MCX_COMM' },
      { u: 'CRUDEOIL',    e: 'MCX_COMM' },
      { u: 'NATURALGAS',  e: 'MCX_COMM' },
      { u: 'COPPER',      e: 'MCX_COMM' },
      // CDS Currency
      { u: 'USDINR',      e: 'NSE_CURRENCY' },
      { u: 'EURINR',      e: 'NSE_CURRENCY' },
      { u: 'GBPINR',      e: 'NSE_CURRENCY' },
      { u: 'JPYINR',      e: 'NSE_CURRENCY' },
    ];

    let resolved = 0, failed = 0;
    for (const { u, e } of priority) {
      try {
        const c = await this._fetchAndCache(u, e);
        if (c) resolved++;
        else    failed++;
      } catch (_) { failed++; }
    }
    console.log(`[FuturesContractSvc] Cache warm complete: ${resolved} resolved, ${failed} not found (scrip master may not list all)`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _cacheGet(underlying, exchange) {
    if (exchange === '*') {
      // Linear scan — used only for numeric ID lookups, rare path
      for (const v of this._cache.values()) {
        if (v.securityId === underlying) return v;
      }
      return null;
    }
    return this._cache.get(`${underlying}:${exchange}`) || null;
  }

  _inferExchange(canonical) {
    if (NSE_INDEX_UNDERLYINGS.has(canonical)) return 'NSE_FNO';
    if (BSE_INDEX_UNDERLYINGS.has(canonical)) return 'BSE_FNO';
    // If it ends with "FUT" it was already stripped by canonicalise; if we
    // still have a purely-alphabetic name it's likely a stock future
    if (/^[A-Z]+$/.test(canonical) && canonical.length >= 2) return 'NSE_FNO';
    return null; // cannot infer — let caller handle
  }

  /**
   * Reasonable tick-size defaults by segment/underlying.
   * These are conservative defaults — the real tick size should come from
   * the exchange via Dhan's instrument master when that field is available.
   */
  _inferTickSize(underlying, exchange) {
    if (exchange === 'MCX_COMM') {
      const u = underlying.toUpperCase();
      if (u === 'CRUDEOIL' || u === 'NATURALGAS') return 1;
      if (u === 'GOLD' || u === 'GOLDM' || u === 'SILVER' || u === 'SILVERM') return 1;
      return 0.05;
    }
    if (exchange === 'NSE_CURRENCY') return 0.0025;
    // NSE_FNO and BSE_FNO — both index and stock futures
    return 0.05;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────
// Exported as a singleton so all server modules share one cache.
export const futuresContractService = new FuturesContractService();
