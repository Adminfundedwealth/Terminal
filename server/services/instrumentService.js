/**
 * Instrument Service
 * Manages all tradeable instruments across segments
 * NSE, BSE, NFO (Futures & Options), MCX, CDS
 */
export class InstrumentService {
  constructor() {
    this.instruments = this.loadInstruments();
  }

  loadInstruments() {
    // Complete instrument master - in production, this would be loaded from broker's instrument file daily
    return [
      // NSE Equity
      { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '3045', symbol: 'SBIN', name: 'State Bank of India', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '1333', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '4963', symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '11536', symbol: 'TCS', name: 'Tata Consultancy Services', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '1594', symbol: 'INFY', name: 'Infosys Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '11630', symbol: 'ITC', name: 'ITC Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '25', symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '1922', symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '5258', symbol: 'LT', name: 'Larsen & Toubro', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '3456', symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '3787', symbol: 'WIPRO', name: 'Wipro Ltd', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '1270', symbol: 'HCLTECH', name: 'HCL Technologies', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '2865', symbol: 'BAJFINANCE', name: 'Bajaj Finance', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '317', symbol: 'AXISBANK', name: 'Axis Bank', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '14366', symbol: 'MARUTI', name: 'Maruti Suzuki', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '10999', symbol: 'TATASTEEL', name: 'Tata Steel', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '11723', symbol: 'SUNPHARMA', name: 'Sun Pharma', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '20374', symbol: 'BHARTIARTL', name: 'Bharti Airtel', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
      { token: '467', symbol: 'HINDUNILVR', name: 'Hindustan Unilever', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },

      // Indices
      { token: '99926000', symbol: 'NIFTY', name: 'Nifty 50 Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
      { token: '99926009', symbol: 'BANKNIFTY', name: 'Bank Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 15, tickSize: 0.05 },
      { token: '99926037', symbol: 'FINNIFTY', name: 'Fin Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 25, tickSize: 0.05 },
      { token: '99926074', symbol: 'MIDCPNIFTY', name: 'Midcap Nifty Index', segment: 'NSE', instrumentType: 'EQ', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
      { token: '99919000', symbol: 'SENSEX', name: 'BSE Sensex Index', segment: 'BSE', instrumentType: 'EQ', exchange: 'BSE', lotSize: 10, tickSize: 0.05 },

      // Index Futures
      { token: 'NF_FUT', symbol: 'NIFTY FUT', name: 'Nifty Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'NF_FUT_N', symbol: 'NIFTY FUT JUL', name: 'Nifty Futures Jul 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50, tickSize: 0.05, expiry: '2026-07-30' },
      { token: 'NF_FUT_F', symbol: 'NIFTY FUT AUG', name: 'Nifty Futures Aug 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50, tickSize: 0.05, expiry: '2026-08-27' },
      { token: 'BNF_FUT', symbol: 'BANKNIFTY FUT', name: 'BankNifty Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 15, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'BNF_FUT_N', symbol: 'BANKNIFTY FUT JUL', name: 'BankNifty Futures Jul 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 15, tickSize: 0.05, expiry: '2026-07-30' },
      { token: 'FNF_FUT', symbol: 'FINNIFTY FUT', name: 'FinNifty Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 25, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'MCN_FUT', symbol: 'MIDCPNIFTY FUT', name: 'MidcapNifty Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 50, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'SEN_FUT', symbol: 'SENSEX FUT', name: 'Sensex Futures Jun 2026', segment: 'BFO', instrumentType: 'FUT', exchange: 'BSE', lotSize: 10, tickSize: 0.05, expiry: '2026-06-25' },

      // Stock Futures
      { token: 'REL_FUT', symbol: 'RELIANCE FUT', name: 'Reliance Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 250, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'SBIN_FUT', symbol: 'SBIN FUT', name: 'SBIN Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1500, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'HDFC_FUT', symbol: 'HDFCBANK FUT', name: 'HDFCBANK Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 550, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'ICICI_FUT', symbol: 'ICICIBANK FUT', name: 'ICICIBANK Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 700, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'TCS_FUT', symbol: 'TCS FUT', name: 'TCS Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 150, tickSize: 0.05, expiry: '2026-06-25' },
      { token: 'INFY_FUT', symbol: 'INFY FUT', name: 'Infosys Futures Jun 2026', segment: 'NFO', instrumentType: 'FUT', exchange: 'NSE', lotSize: 300, tickSize: 0.05, expiry: '2026-06-25' },

      // MCX Commodities
      { token: 'GOLD_F', symbol: 'GOLD', name: 'Gold Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 100, tickSize: 1, expiry: '2026-08-05' },
      { token: 'GOLDM_F', symbol: 'GOLD MINI', name: 'Gold Mini Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 10, tickSize: 1, expiry: '2026-07-07' },
      { token: 'SILVER_F', symbol: 'SILVER', name: 'Silver Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 30, tickSize: 1, expiry: '2026-09-04' },
      { token: 'SILVERM_F', symbol: 'SILVER MINI', name: 'Silver Mini Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5, tickSize: 1, expiry: '2026-07-07' },
      { token: 'COPPER_F', symbol: 'COPPER', name: 'Copper Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 2500, tickSize: 0.05, expiry: '2026-07-30' },
      { token: 'ZINC_F', symbol: 'ZINC', name: 'Zinc Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5000, tickSize: 0.05, expiry: '2026-07-30' },
      { token: 'ALUMINIUM_F', symbol: 'ALUMINIUM', name: 'Aluminium Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 5000, tickSize: 0.05, expiry: '2026-07-30' },
      { token: 'CRUDE_F', symbol: 'CRUDEOIL', name: 'Crude Oil Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 100, tickSize: 1, expiry: '2026-07-19' },
      { token: 'NG_F', symbol: 'NATURALGAS', name: 'Natural Gas Futures', segment: 'MCX', instrumentType: 'FUT', exchange: 'MCX', lotSize: 1250, tickSize: 0.1, expiry: '2026-07-26' },

      // Currency Derivatives
      { token: 'USDINR_F', symbol: 'USDINR FUT', name: 'USD/INR Futures Jun 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-06-25' },
      { token: 'USDINR_FN', symbol: 'USDINR FUT JUL', name: 'USD/INR Futures Jul 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-07-29' },
      { token: 'USDINR_FF', symbol: 'USDINR FUT AUG', name: 'USD/INR Futures Aug 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-08-27' },
      { token: 'EURINR_F', symbol: 'EURINR FUT', name: 'EUR/INR Futures Jun 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-06-25' },
      { token: 'GBPINR_F', symbol: 'GBPINR FUT', name: 'GBP/INR Futures Jun 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-06-25' },
      { token: 'JPYINR_F', symbol: 'JPYINR FUT', name: 'JPY/INR Futures Jun 2026', segment: 'CDS', instrumentType: 'FUT', exchange: 'NSE', lotSize: 1000, tickSize: 0.0025, expiry: '2026-06-25' },
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

  getExpiries(symbol) {
    // Return available expiry dates for a symbol
    const baseSymbol = symbol.toUpperCase();
    const now = new Date();
    const expiries = [];

    // Generate weekly expiries for indices, monthly for stocks
    const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].includes(baseSymbol);

    if (isIndex) {
      // Weekly expiries on TUESDAY (NSE moved NIFTY/BANKNIFTY to Tuesday, effective 2024)
      // NIFTY = Tuesday, BANKNIFTY = Wednesday, FINNIFTY = Tuesday, MIDCPNIFTY = Monday, SENSEX = Friday
      let expiryDay;
      switch (baseSymbol) {
        case 'NIFTY': expiryDay = 2; break;       // Tuesday
        case 'BANKNIFTY': expiryDay = 3; break;   // Wednesday
        case 'FINNIFTY': expiryDay = 2; break;    // Tuesday
        case 'MIDCPNIFTY': expiryDay = 1; break;  // Monday
        case 'SENSEX': expiryDay = 5; break;      // Friday
        default: expiryDay = 4; break;             // Thursday fallback
      }

      for (let i = 0; i < 8; i++) {
        const date = new Date(now);
        // Find the next occurrence of expiryDay
        const daysUntil = (expiryDay - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + daysUntil + i * 7);
        if (date > now) {
          expiries.push(date.toISOString().split('T')[0]);
        }
      }
    } else {
      // Monthly expiries (last Thursday of month)
      for (let i = 0; i < 3; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
        while (date.getDay() !== 4) {
          date.setDate(date.getDate() - 1);
        }
        expiries.push(date.toISOString().split('T')[0]);
      }
    }

    return expiries;
  }
}
