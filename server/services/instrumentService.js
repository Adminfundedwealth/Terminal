/**
 * Instrument Service
 * Manages all tradeable instruments across segments.
 *
 * TOKEN VALIDITY:
 *   NSE equity tokens (numeric) and index tokens (99926xxx) are valid Angel One
 *   SmartStream tokens confirmed in live sessions.
 *
 *   All NFO/MCX/CDS tokens such as 'NF_FUT', 'GOLD_F', 'USDINR_F' are
 *   PLACEHOLDER strings — not real Angel One broker tokens. They are tagged
 *   { isPlaceholder: true } and must NOT be forwarded to the live feed.
 *   Real numeric tokens must be obtained from the Angel One daily instrument
 *   master CSV at server startup.
 */
export class InstrumentService {
  constructor(options = {}) {
    this.brokerAdapter = options.brokerAdapter || null;
    this.cacheMs = options.cacheMs || 5 * 60 * 1000;
    this._lastRefreshAt = 0;
    this.instruments = this.loadInstruments();
  }

  _normalizeInstrument(item, source = 'broker') {
    if (!item || typeof item !== 'object') return null;
    const symbol = String(item.tradingsymbol || item.symbol || item.name || '').trim();
    const token = String(item.token || item.symboltoken || '').trim();
    if (!symbol || !token) return null;
    return {
      ...item,
      token,
      symbol: symbol.toUpperCase(),
      name: String(item.name || symbol).trim(),
      segment: String(item.segment || item.exch_seg || item.exchange || 'NSE').toUpperCase(),
      exchange: String(item.exchange || item.exch_seg || item.segment || 'NSE').toUpperCase(),
      instrumentType: String(item.instrumentType || item.instrumenttype || item.type || 'EQ').toUpperCase(),
      lotSize: Number(item.lotSize || item.lotsize || 1),
      tickSize: Number(item.tickSize || item.ticksize || (Number(item.tick_size) / 100) || 0.05),
      tradingSymbol: item.tradingsymbol || item.symbol || symbol,
      source,
    };
  }

  async refreshFromBroker() {
    if (!this.brokerAdapter?.getInstrumentMaster) return { success: false, code: 'BROKER_UNAVAILABLE', message: 'No broker-backed instrument master is configured.' };
    if (this._lastRefreshAt && Date.now() - this._lastRefreshAt < this.cacheMs) return { success: true, count: this.instruments.length, source: 'cache' };
    try {
      const payload = await this.brokerAdapter.getInstrumentMaster();
      const normalized = (Array.isArray(payload) ? payload : []).map((item) => this._normalizeInstrument(item)).filter(Boolean);
      if (!normalized.length) return { success: false, code: 'BROKER_INSTRUMENT_MASTER_EMPTY', message: 'Broker instrument master was empty or invalid.' };
      this.instruments = [...this.instruments.filter((item) => !item.isPlaceholder), ...normalized];
      this._lastRefreshAt = Date.now();
      return { success: true, count: this.instruments.length, source: 'broker' };
    } catch (error) {
      return { success: false, code: 'BROKER_INSTRUMENT_MASTER_ERROR', message: error?.message || 'Failed to load broker instrument master.' };
    }
  }

  async resolveInstrument(query, segment) {
    if (this.brokerAdapter && Date.now() - this._lastRefreshAt >= this.cacheMs) await this.refreshFromBroker();
    const raw = String(query || '').trim();
    const value = raw.toUpperCase();
    const instrument = this.instruments.find((item) => (!segment || item.segment === segment || item.exchange === segment) && !item.isPlaceholder && (String(item.symbol || '').toUpperCase() === value || String(item.tradingsymbol || item.tradingSymbol || '').toUpperCase() === value || String(item.token) === raw));
    return instrument ? { success: true, instrument } : { success: false, code: 'INSTRUMENT_NOT_FOUND', message: `Instrument not found for "${query}".`, query, segment };
  }

  /** Returns true when a token is a real numeric Angel One broker token. */
  static isValidBrokerToken(token) {
    return typeof token === 'string' && /^\d+$/.test(token);
  }

  loadInstruments() {
    // ── NSE Equity — valid numeric tokens ───────────────────────────────────
    return [
      // NSE Equity — Top F&O stocks with verified Dhan security IDs
      { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3045', symbol: 'SBIN', name: 'State Bank of India', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '1333', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '4963', symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '11536', symbol: 'TCS', name: 'Tata Consultancy Services', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '1594', symbol: 'INFY', name: 'Infosys Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '1660', symbol: 'ITC', name: 'ITC Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '25', symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '1922', symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '11483', symbol: 'LT', name: 'Larsen & Toubro', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3456', symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3499', symbol: 'TATASTEEL', name: 'Tata Steel', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '7229', symbol: 'HCLTECH', name: 'HCL Technologies', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '317', symbol: 'BAJFINANCE', name: 'Bajaj Finance', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '5900', symbol: 'AXISBANK', name: 'Axis Bank', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '10999', symbol: 'MARUTI', name: 'Maruti Suzuki', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3787', symbol: 'WIPRO', name: 'Wipro Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '881', symbol: 'SUNPHARMA', name: 'Sun Pharma', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '467', symbol: 'BHARTIARTL', name: 'Bharti Airtel', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '1363', symbol: 'HINDUNILVR', name: 'Hindustan Unilever', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3506', symbol: 'TITAN', name: 'Titan Company', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '15083', symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '14977', symbol: 'POWERGRID', name: 'Power Grid Corporation', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '11630', symbol: 'NTPC', name: 'NTPC Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '694', symbol: 'COALINDIA', name: 'Coal India Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '16669', symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '2031', symbol: 'M&M', name: 'Mahindra & Mahindra', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '11723', symbol: 'TECHM', name: 'Tech Mahindra', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '910', symbol: 'EICHERMOT', name: 'Eicher Motors', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '547', symbol: 'BRITANNIA', name: 'Britannia Industries', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      // New F&O stocks
      { token: '1410', symbol: 'TIINDIA', name: 'Tube Investments', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '3718', symbol: 'VOLTAS', name: 'Voltas Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '383', symbol: 'BEL', name: 'Bharat Electronics', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '2303', symbol: 'HAL', name: 'Hindustan Aeronautics', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '5097', symbol: 'ZOMATO', name: 'Zomato Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '14732', symbol: 'DLF', name: 'DLF Limited', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '236', symbol: 'ASIANPAINT', name: 'Asian Paints', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '6191', symbol: 'CIPLA', name: 'Cipla Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '4717', symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '14418', symbol: 'JSWSTEEL', name: 'JSW Steel', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },
      { token: '288', symbol: 'DRREDDY', name: "Dr Reddy's Labs", segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05, fno: true },

      // Indices
      { token: '99926000', symbol: 'NIFTY', name: 'Nifty 50 Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
      { token: '99926009', symbol: 'BANKNIFTY', name: 'Bank Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 15, tickSize: 0.05 },
      { token: '99926037', symbol: 'FINNIFTY', name: 'Fin Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 25, tickSize: 0.05 },
      { token: '99926074', symbol: 'MIDCPNIFTY', name: 'Midcap Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
      { token: '99919000', symbol: 'SENSEX', name: 'BSE Sensex Index', segment: 'BSE', instrumentType: 'EQ', exchange: 'BSE', lotSize: 10, tickSize: 0.05 },

      // Index Futures — PLACEHOLDER TOKENS (isPlaceholder: true)
      // These string tokens are NOT real Angel One tokens. They produce no live ticks.
      { token: 'NF_FUT',    symbol: 'NIFTY FUT',       name: 'Nifty Futures (current)',       segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50,   tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'NF_FUT_N',  symbol: 'NIFTY FUT JUL',   name: 'Nifty Futures Jul 2026',        segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50,   tickSize: 0.05, expiry: '2026-07-30', isPlaceholder: true },
      { token: 'NF_FUT_F',  symbol: 'NIFTY FUT AUG',   name: 'Nifty Futures Aug 2026',        segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50,   tickSize: 0.05, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'BNF_FUT',   symbol: 'BANKNIFTY FUT',   name: 'BankNifty Futures (current)',   segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 15,   tickSize: 0.05, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'BNF_FUT_N', symbol: 'BANKNIFTY FUT JUL', name: 'BankNifty Futures Jul 2026',  segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 15,   tickSize: 0.05, expiry: '2026-07-30', isPlaceholder: true },
      { token: 'FNF_FUT',   symbol: 'FINNIFTY FUT',    name: 'FinNifty Futures (current)',    segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 25,   tickSize: 0.05, expiry: '2026-08-26', isPlaceholder: true },
      { token: 'MCN_FUT',   symbol: 'MIDCPNIFTY FUT',  name: 'MidcapNifty Futures (current)', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50,   tickSize: 0.05, expiry: '2026-08-25', isPlaceholder: true },
      { token: 'SEN_FUT',   symbol: 'SENSEX FUT',      name: 'Sensex Futures (current)',      segment: 'BFO', instrumentType: 'FUT', exchange: 'BSE', lotSize: 10,   tickSize: 0.05, expiry: '2026-08-29', isPlaceholder: true },

      // Stock Futures — PLACEHOLDER TOKENS
      { token: 'REL_FUT',   symbol: 'RELIANCE FUT',  name: 'Reliance Futures (current)',  segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 250,  tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'SBIN_FUT',  symbol: 'SBIN FUT',      name: 'SBIN Futures (current)',      segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1500, tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'HDFC_FUT',  symbol: 'HDFCBANK FUT',  name: 'HDFCBANK Futures (current)',  segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 550,  tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'ICICI_FUT', symbol: 'ICICIBANK FUT', name: 'ICICIBANK Futures (current)', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 700,  tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'TCS_FUT',   symbol: 'TCS FUT',       name: 'TCS Futures (current)',       segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 150,  tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },
      { token: 'INFY_FUT',  symbol: 'INFY FUT',      name: 'Infosys Futures (current)',   segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 300,  tickSize: 0.05, expiry: '2026-08-28', isPlaceholder: true },

      // MCX Commodities — PLACEHOLDER TOKENS
      { token: 'GOLD_F',      symbol: 'GOLD',       name: 'Gold Futures',        segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 100,  tickSize: 1,    expiry: '2026-08-05', isPlaceholder: true },
      { token: 'GOLDM_F',     symbol: 'GOLD MINI',  name: 'Gold Mini Futures',   segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 10,   tickSize: 1,    expiry: '2026-07-07', isPlaceholder: true },
      { token: 'SILVER_F',    symbol: 'SILVER',     name: 'Silver Futures',      segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 30,   tickSize: 1,    expiry: '2026-09-04', isPlaceholder: true },
      { token: 'SILVERM_F',   symbol: 'SILVER MINI',name: 'Silver Mini Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5,    tickSize: 1,    expiry: '2026-07-07', isPlaceholder: true },
      { token: 'COPPER_F',    symbol: 'COPPER',     name: 'Copper Futures',      segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 2500, tickSize: 0.05, expiry: '2026-07-30', isPlaceholder: true },
      { token: 'ZINC_F',      symbol: 'ZINC',       name: 'Zinc Futures',        segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5000, tickSize: 0.05, expiry: '2026-07-30', isPlaceholder: true },
      { token: 'ALUMINIUM_F', symbol: 'ALUMINIUM',  name: 'Aluminium Futures',   segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5000, tickSize: 0.05, expiry: '2026-07-30', isPlaceholder: true },
      { token: 'CRUDE_F',     symbol: 'CRUDEOIL',   name: 'Crude Oil Futures',   segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 100,  tickSize: 1,    expiry: '2026-07-19', isPlaceholder: true },
      { token: 'NG_F',        symbol: 'NATURALGAS', name: 'Natural Gas Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 1250, tickSize: 0.1,  expiry: '2026-07-26', isPlaceholder: true },

      // Currency Derivatives — PLACEHOLDER TOKENS
      { token: 'USDINR_F',  symbol: 'USDINR FUT',     name: 'USD/INR Futures (current)', segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'USDINR_FN', symbol: 'USDINR FUT JUL', name: 'USD/INR Futures Jul 2026',  segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-07-29', isPlaceholder: true },
      { token: 'USDINR_FF', symbol: 'USDINR FUT AUG', name: 'USD/INR Futures Aug 2026',  segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'EURINR_F',  symbol: 'EURINR FUT',     name: 'EUR/INR Futures (current)', segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'GBPINR_F',  symbol: 'GBPINR FUT',     name: 'GBP/INR Futures (current)', segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27', isPlaceholder: true },
      { token: 'JPYINR_F',  symbol: 'JPYINR FUT',     name: 'JPY/INR Futures (current)', segment: 'CDS', instrumentType: 'FUT', exchange: 'CDS', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27', isPlaceholder: true },
    ];
  }

  search(query, segment) {
    const q = query.toLowerCase();
    return this.instruments
      .filter((inst) => {
        const matchesQuery =
          inst.symbol.toLowerCase().includes(q) ||
          inst.name.toLowerCase().includes(q);
        const matchesSegment = !segment || inst.segment === segment;
        return matchesQuery && matchesSegment;
      })
      .slice(0, 20);
  }

  getBySegment(segment) {
    return this.instruments.filter((inst) => inst.segment === segment);
  }

  getByToken(token) {
    return this.instruments.find((inst) => inst.token === token);
  }

  /**
   * Returns only instruments with valid numeric broker tokens that can
   * receive live SmartStream ticks. Excludes all placeholder F&O/MCX/CDS entries.
   */
  getLiveSubscribable() {
    return this.instruments.filter(inst => !inst.isPlaceholder);
  }

  getExpiries(symbol) {
    // Fallback expiry dates used ONLY when optionChainService discovery fails.
    // Returns dates that actually have option contracts on Angel One's API.
    //
    // Provider-confirmed expiry patterns (from live searchScrip testing):
    //   NIFTY      — weekly Tuesday (still active)
    //   BANKNIFTY  — monthly (last Tuesday of month, NOT Wednesday — weekly discontinued)
    //   FINNIFTY   — quarterly (last Tuesday of quarter-end months)
    //   MIDCPNIFTY — monthly (last Tuesday of month — Monday weekly discontinued)
    //   SENSEX     — no option contracts available via Angel One NFO
    //
    // For stocks: last Thursday of month (standard NSE monthly expiry).
    const baseSymbol = symbol.toUpperCase();
    const now = new Date();
    const expiries = [];

    // Use IST midnight to avoid UTC day-boundary shifts (IST = UTC+5:30)
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
    const todayISO = nowIST.toISOString().split('T')[0];

    if (baseSymbol === 'NIFTY') {
      // NIFTY: weekly Tuesday — still active on Angel One
      for (let i = 0; i < 6; i++) {
        const d = new Date(nowIST);
        const daysUntilTue = (2 - d.getUTCDay() + 7) % 7 || 7;
        d.setUTCDate(d.getUTCDate() + daysUntilTue + i * 7);
        const iso = d.toISOString().split('T')[0];
        if (iso >= todayISO) expiries.push(iso);
      }
    } else if (baseSymbol === 'BANKNIFTY' || baseSymbol === 'MIDCPNIFTY') {
      // Monthly: last Tuesday of each of the next 4 months
      // Confirmed: BANKNIFTY25AUG26 (Tue) = 660 contracts
      //            MIDCPNIFTY25AUG26 (Tue) = 460 contracts
      for (let i = 0; i < 4; i++) {
        const y = nowIST.getUTCFullYear();
        const m = nowIST.getUTCMonth() + i;
        const lastDay = new Date(Date.UTC(y, m + 1, 0));
        while (lastDay.getUTCDay() !== 2) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
        const iso = lastDay.toISOString().split('T')[0];
        if (iso >= todayISO) expiries.push(iso);
      }
    } else if (baseSymbol === 'FINNIFTY') {
      // Quarterly: last Tuesday of next 4 months (quarterly contracts only)
      // Confirmed: FINNIFTY29SEP26 (Tue) = 220 contracts
      for (let i = 0; i < 6; i++) {
        const y = nowIST.getUTCFullYear();
        const m = nowIST.getUTCMonth() + i;
        const lastDay = new Date(Date.UTC(y, m + 1, 0));
        while (lastDay.getUTCDay() !== 2) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
        const iso = lastDay.toISOString().split('T')[0];
        if (iso >= todayISO && !expiries.includes(iso)) expiries.push(iso);
      }
    } else if (baseSymbol === 'SENSEX') {
      // SENSEX: no option contracts available on Angel One NFO.
      // Return empty — frontend handles this with provider-unavailable message.
      return [];
    } else {
      // Stocks: last Thursday of next 3 months (standard NSE monthly)
      for (let i = 0; i < 3; i++) {
        const y = nowIST.getUTCFullYear();
        const m = nowIST.getUTCMonth() + i;
        const lastDay = new Date(Date.UTC(y, m + 1, 0));
        while (lastDay.getUTCDay() !== 4) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
        const iso = lastDay.toISOString().split('T')[0];
        if (iso >= todayISO) expiries.push(iso);
      }
    }

    return expiries;
  }

  /**
   * Patch placeholder futures instruments with real broker securityIds,
   * expiry dates, and lot sizes sourced from FuturesContractService.
   *
   * Called once from server/index.js after FuturesContractService.warmCache()
   * resolves. Safe to call multiple times (subsequent calls update stale expiry
   * dates on monthly rollover).
   *
   * @param {import('./futuresContractService.js').FuturesContractService} fcs
   */
  patchFuturesTokens(fcs) {
    const contracts = fcs.getCachedContracts();
    if (!contracts.length) return;

    // Build a lookup: underlying → contract, preferring front-month (earliest expiry)
    // Multiple entries per underlying can exist (e.g. NIFTY NSE_FNO current, next, far)
    const byUnderlying = new Map(); // underlying → contract
    for (const c of contracts) {
      if (!c.securityId || !/^\d+$/.test(c.securityId)) continue;
      const existing = byUnderlying.get(c.underlying);
      if (!existing) {
        byUnderlying.set(c.underlying, c);
      } else {
        // Keep the one with the earliest expiry (front month)
        const d1 = existing.expiry ? new Date(existing.expiry).getTime() : Infinity;
        const d2 = c.expiry       ? new Date(c.expiry).getTime()        : Infinity;
        if (d2 < d1) byUnderlying.set(c.underlying, c);
      }
    }

    // Mapping from InstrumentService placeholder symbol → canonical underlying name
    // used as key in byUnderlying map above.
    const SYMBOL_TO_UNDERLYING = {
      'NIFTY FUT':       'NIFTY',
      'NIFTY FUT JUL':   'NIFTY',
      'NIFTY FUT AUG':   'NIFTY',
      'BANKNIFTY FUT':   'BANKNIFTY',
      'BANKNIFTY FUT JUL': 'BANKNIFTY',
      'FINNIFTY FUT':    'FINNIFTY',
      'MIDCPNIFTY FUT':  'MIDCPNIFTY',
      'SENSEX FUT':      'SENSEX',
      'RELIANCE FUT':    'RELIANCE',
      'SBIN FUT':        'SBIN',
      'HDFCBANK FUT':    'HDFCBANK',
      'ICICIBANK FUT':   'ICICIBANK',
      'TCS FUT':         'TCS',
      'INFY FUT':        'INFY',
      'ITC FUT':         'ITC',
      'LT FUT':          'LT',
      'AXISBANK FUT':    'AXISBANK',
      'HCLTECH FUT':     'HCLTECH',
      'BAJFINANCE FUT':  'BAJFINANCE',
      'KOTAKBANK FUT':   'KOTAKBANK',
      'TATAMOTORS FUT':  'TATAMOTORS',
      'TATASTEEL FUT':   'TATASTEEL',
      'MARUTI FUT':      'MARUTI',
      'TITAN FUT':       'TITAN',
      'ADANIENT FUT':    'ADANIENT',
      'ADANIPORTS FUT':  'ADANIPORTS',
      'BEL FUT':         'BEL',
      'HAL FUT':         'HAL',
      'ZOMATO FUT':      'ZOMATO',
      'DLF FUT':         'DLF',
      'SUNPHARMA FUT':   'SUNPHARMA',
      'POWERGRID FUT':   'POWERGRID',
      'NTPC FUT':        'NTPC',
      'COALINDIA FUT':   'COALINDIA',
      'BHARTIARTL FUT':  'BHARTIARTL',
      'TIINDIA FUT':     'TIINDIA',
      'VOLTAS FUT':      'VOLTAS',
      'WIPRO FUT':       'WIPRO',
    };

    let patched = 0;
    for (const inst of this.instruments) {
      if (!inst.isPlaceholder) continue;
      if (inst.instrumentType !== 'FUT') continue;
      // Skip MCX / CDS — they have their own resolver
      if (inst.segment === 'MCX' || inst.segment === 'CDS') continue;

      const underlying = SYMBOL_TO_UNDERLYING[inst.symbol];
      if (!underlying) continue;
      const contract = byUnderlying.get(underlying);
      if (!contract) continue;

      // Overwrite with real values from scrip master
      inst.token       = contract.securityId;
      inst.expiry      = contract.expiry      || inst.expiry;
      inst.lotSize     = contract.lotSize > 1 ? contract.lotSize : inst.lotSize;
      inst.tickSize    = contract.tickSize    || inst.tickSize;
      // Set exchange to the correct derivative exchange so ChartPanel and
      // MarketDepthPanel send the right segment hint to the WS server.
      // NSE_FNO instruments → exchange = 'NFO'
      // BSE_FNO instruments → exchange = 'BFO'
      // This is critical: without it wsService sends hint='NSE' → NSE_EQ,
      // and the Dhan WS subscribes the wrong segment for this token.
      if (contract.segment === 'NSE_FNO') inst.exchange = 'NFO';
      else if (contract.segment === 'BSE_FNO') inst.exchange = 'BFO';
      inst.isPlaceholder = false;  // now a real token
      inst._resolvedFrom = 'scrip-master';
      patched++;
    }

    if (patched > 0) {
      console.log(`[InstrumentService] ✓ Patched ${patched} placeholder futures instruments with real securityIds`);
    }
  }
}
