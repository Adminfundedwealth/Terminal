/**
 * symbolLogo.ts — Universal instrument logo resolver
 *
 * Provides:
 *  - extractBaseSymbol()  strip FUT / CE / PE / expiry suffixes
 *  - getInstrumentLogo()  resolve a CDN or local logo URL (null if unknown)
 *  - resolveSymbolIconMeta() — re-exported from symbolIconRegistry for full metadata
 */

export { resolveSymbolIconMeta } from '@/utils/symbolIconRegistry';

// ── CDN base ────────────────────────────────────────────────────────────────
const U = 'https://assets.upstox.com/market-quote/images';

/**
 * Known logo URLs keyed by the BASE symbol (no FUT / CE / PE suffix).
 * Local public/logos/* takes priority in the <SymbolLogo> component — this
 * map is used when a direct URL is needed (e.g. PDF export, OG images).
 */
export const KNOWN_LOGOS: Record<string, string> = {
  // ── Indices ────────────────────────────────────────────────────────────────
  'NIFTY':       `${U}/NSE_INDEX_Nifty_50.svg`,
  'NIFTY50':     `${U}/NSE_INDEX_Nifty_50.svg`,
  'NIFTY 50':    `${U}/NSE_INDEX_Nifty_50.svg`,
  'BANKNIFTY':   `${U}/NSE_INDEX_Nifty_Bank.svg`,
  'FINNIFTY':    `${U}/NSE_INDEX_Nifty_Fin_Service.svg`,
  'MIDCPNIFTY':  `${U}/NSE_INDEX_NIFTY_MID_SELECT.svg`,
  'SENSEX':      `${U}/BSE_INDEX_SENSEX.svg`,

  // ── MCX Commodities ────────────────────────────────────────────────────────
  'GOLD':        `${U}/MCX_COMM_GOLD.svg`,
  'GOLDM':       `${U}/MCX_COMM_GOLD.svg`,
  'SILVER':      `${U}/MCX_COMM_SILVER.svg`,
  'SILVERM':     `${U}/MCX_COMM_SILVER.svg`,
  'CRUDEOIL':    `${U}/MCX_COMM_CRUDEOIL.svg`,
  'NATURALGAS':  `${U}/MCX_COMM_NATURALGAS.svg`,
  'COPPER':      `${U}/MCX_COMM_COPPER.svg`,

  // ── CDS Currencies (use flag / RBI logo placeholders) ─────────────────────
  'USDINR':      `${U}/NSE_EQ_INE094A01015.svg`,
  'EURINR':      `${U}/NSE_EQ_INE094A01015.svg`,
  'GBPINR':      `${U}/NSE_EQ_INE094A01015.svg`,
  'JPYINR':      `${U}/NSE_EQ_INE094A01015.svg`,

  // ── ETFs ───────────────────────────────────────────────────────────────────
  'NIFTYBEES':   `${U}/NSE_INDEX_Nifty_50.svg`,
  'BANKBEES':    `${U}/NSE_INDEX_Nifty_Bank.svg`,
  'JUNIORBEES':  `${U}/NSE_INDEX_Nifty_50.svg`,
  'GOLDBEES':    `${U}/MCX_COMM_GOLD.svg`,
  'SILVERBEES':  `${U}/MCX_COMM_SILVER.svg`,
  'ITBEES':      `${U}/NSE_INDEX_Nifty_50.svg`,
  'PHARMABEES':  `${U}/NSE_INDEX_Nifty_50.svg`,

  // ── 30 F&O Stocks ─────────────────────────────────────────────────────────
  'RELIANCE':    `${U}/NSE_EQ_INE002A01018.svg`,
  'HDFCBANK':    `${U}/NSE_EQ_INE040A01034.svg`,
  'ICICIBANK':   `${U}/NSE_EQ_INE090A01021.svg`,
  'SBIN':        `${U}/NSE_EQ_INE062A01020.svg`,
  'TCS':         `${U}/NSE_EQ_INE467B01029.svg`,
  'INFY':        `${U}/NSE_EQ_INE009A01021.svg`,
  'ITC':         `${U}/NSE_EQ_INE154A01025.svg`,
  'LT':          `${U}/NSE_EQ_INE018A01030.svg`,
  'AXISBANK':    `${U}/NSE_EQ_INE238A01034.svg`,
  'HCLTECH':     `${U}/NSE_EQ_INE860A01027.svg`,
  'BAJFINANCE':  `${U}/NSE_EQ_INE296A01024.svg`,
  'KOTAKBANK':   `${U}/NSE_EQ_INE237A01028.svg`,
  'TATAMOTORS':  `${U}/NSE_EQ_INE155A01022.svg`,
  'TATASTEEL':   `${U}/NSE_EQ_INE081A01020.svg`,
  'MARUTI':      `${U}/NSE_EQ_INE585B01010.svg`,
  'TITAN':       `${U}/NSE_EQ_INE280A01028.svg`,
  'ADANIENT':    `${U}/NSE_EQ_INE423A01024.svg`,
  'ADANIPORTS':  `${U}/NSE_EQ_INE742F01042.svg`,
  'BEL':         `${U}/NSE_EQ_INE263A01024.svg`,
  'HAL':         `${U}/NSE_EQ_INE066F01012.svg`,
  'ZOMATO':      `${U}/NSE_EQ_INE758T01015.svg`,
  'DLF':         `${U}/NSE_EQ_INE271C01023.svg`,
  'SUNPHARMA':   `${U}/NSE_EQ_INE044A01036.svg`,
  'POWERGRID':   `${U}/NSE_EQ_INE752E01010.svg`,
  'NTPC':        `${U}/NSE_EQ_INE733E01010.svg`,
  'COALINDIA':   `${U}/NSE_EQ_INE522F01014.svg`,
  'BHARTIARTL':  `${U}/NSE_EQ_INE397D01024.svg`,
  'TIINDIA':     `${U}/NSE_EQ_INE974X01010.svg`,
  'VOLTAS':      `${U}/NSE_EQ_INE226A01021.svg`,
  'WIPRO':       `${U}/NSE_EQ_INE075A01022.svg`,

  // ── Additional large-caps ──────────────────────────────────────────────────
  'ASIANPAINT':  `${U}/NSE_EQ_INE021A01026.svg`,
  'NESTLEIND':   `${U}/NSE_EQ_INE239A01016.svg`,
  'ULTRACEMCO':  `${U}/NSE_EQ_INE481G01011.svg`,
  'CIPLA':       `${U}/NSE_EQ_INE059A01026.svg`,
  'DRREDDY':     `${U}/NSE_EQ_INE089A01023.svg`,
  'EICHERMOT':   `${U}/NSE_EQ_INE066A01021.svg`,
  'JSWSTEEL':    `${U}/NSE_EQ_INE019A01038.svg`,
  'GRASIM':      `${U}/NSE_EQ_INE047A01021.svg`,
  'INDUSINDBK':  `${U}/NSE_EQ_INE095A01012.svg`,
  'TECHM':       `${U}/NSE_EQ_INE669C01036.svg`,
  'MANDM':       `${U}/NSE_EQ_INE101A01026.svg`,
  'HINDALCO':    `${U}/NSE_EQ_INE038A01020.svg`,
  'BAJAJFINSV':  `${U}/NSE_EQ_INE918I01026.svg`,
  'ONGC':        `${U}/NSE_EQ_INE213A01029.svg`,
  'HERO':        `${U}/NSE_EQ_INE158A01026.svg`,
};

/**
 * Strip futures/options expiry and type suffixes to get the underlying symbol.
 *
 * Examples:
 *   "RELIANCE FUT"                       → "RELIANCE"
 *   "NIFTY FUT"                          → "NIFTY"
 *   "TATAMOTORS 25JAN 500 CE"            → "TATAMOTORS"
 *   "NIFTY 29AUG24 24000 PE"             → "NIFTY"
 *   "NSE_RELIANCE"                       → "RELIANCE"
 */
export function extractBaseSymbol(rawSymbol: string): string {
  if (!rawSymbol) return '';
  return rawSymbol
    .trim()
    .toUpperCase()
    // Strip expiry + strike + CE/PE
    .replace(/\s+\d{1,2}[A-Z]{3}\d{0,4}\s+\d+\s*(CE|PE)$/i, '')
    // Strip standalone FUT/FUTURES
    .replace(/\s+FUT(URES)?$/i, '')
    // Strip exchange prefix
    .replace(/^(NSE_|BSE_|MCX_|CDS_)/i, '')
    // Collapse spaces (e.g. "NIFTY 50" → "NIFTY50" for map lookup but preserve "NIFTY 50" key)
    .trim();
}

/**
 * Resolve a logo URL for any instrument symbol.
 * Returns null if the symbol is not in the known catalog — use <SymbolLogo>
 * for a full component with initials fallback.
 */
export function getInstrumentLogo(symbol: string): string | null {
  const base = extractBaseSymbol(symbol);
  return (
    KNOWN_LOGOS[base] ||
    KNOWN_LOGOS[base.replace(/\s+/g, '')] ||  // "NIFTY 50" → "NIFTY50"
    null
  );
}
