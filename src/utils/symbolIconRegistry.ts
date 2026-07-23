export type SymbolIconKind = 'logo' | 'index' | 'fallback';

export interface SymbolIconMeta {
  symbol: string;
  normalized: string;
  kind: SymbolIconKind;
  initial: string;
  accent: string;
  /** Primary logo URL — tried first (Google favicon CDN) */
  logoSrc?: string;
  /** Fallback logo URL — tried if primary fails (local SVG) */
  logoFallback?: string;
  cacheKey: string;
}

// Google favicon service — free, no API key, returns real company brand icons at up to 256px
function gfav(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

const REGISTRY: Record<string, {
  kind: SymbolIconKind;
  accent: string;
  logoSrc?: string;
  logoFallback?: string;
}> = {
  // ── Nifty 50 stocks ──────────────────────────────────────────────────────
  RELIANCE:   { kind: 'logo', accent: '#f97316', logoSrc: gfav('ril.com'),                logoFallback: '/logos/RELIANCE.svg' },
  TCS:        { kind: 'logo', accent: '#2563eb', logoSrc: gfav('tcs.com'),                logoFallback: '/logos/TCS.svg' },
  HDFCBANK:   { kind: 'logo', accent: '#0ea5e9', logoSrc: gfav('hdfcbank.com'),           logoFallback: '/logos/HDFCBANK.svg' },
  HDFC:       { kind: 'logo', accent: '#0078d4', logoSrc: gfav('hdfcbank.com'),           logoFallback: '/logos/HDFCBANK.svg' },
  ICICIBANK:  { kind: 'logo', accent: '#7c3aed', logoSrc: gfav('icicibank.com'),          logoFallback: '/logos/ICICIBANK.svg' },
  INFY:       { kind: 'logo', accent: '#2563eb', logoSrc: gfav('infosys.com'),            logoFallback: '/logos/INFY.svg' },
  SBIN:       { kind: 'logo', accent: '#dc2626', logoSrc: gfav('sbi.co.in'),              logoFallback: '/logos/SBIN.svg' },
  BHARTIARTL: { kind: 'logo', accent: '#8b5cf6', logoSrc: gfav('airtel.in'),              logoFallback: '/logos/BHARTIARTL.svg' },
  ITC:        { kind: 'logo', accent: '#16a34a', logoSrc: gfav('itcportal.com'),          logoFallback: '/logos/ITC.svg' },
  KOTAKBANK:  { kind: 'logo', accent: '#f59e0b', logoSrc: gfav('kotak.com'),              logoFallback: '/logos/KOTAKBANK.svg' },
  LT:         { kind: 'logo', accent: '#0f766e', logoSrc: gfav('larsentoubro.com'),       logoFallback: '/logos/LT.svg' },
  HCLTECH:    { kind: 'logo', accent: '#0ea5e9', logoSrc: gfav('hcltech.com'),            logoFallback: '/logos/HCLTECH.svg' },
  AXISBANK:   { kind: 'logo', accent: '#ef4444', logoSrc: gfav('axisbank.com'),           logoFallback: '/logos/AXISBANK.svg' },
  WIPRO:      { kind: 'logo', accent: '#2563eb', logoSrc: gfav('wipro.com'),              logoFallback: '/logos/WIPRO.svg' },
  ADANIENT:   { kind: 'logo', accent: '#ef4444', logoSrc: gfav('adani.com'),              logoFallback: '/logos/ADANIENT.svg' },
  MARUTI:     { kind: 'logo', accent: '#dc2626', logoSrc: gfav('marutisuzuki.com'),       logoFallback: '/logos/MARUTI.svg' },
  BAJFINANCE: { kind: 'logo', accent: '#fb923c', logoSrc: gfav('bajajfinserv.in'),        logoFallback: '/logos/BAJFINANCE.svg' },
  SUNPHARMA:  { kind: 'logo', accent: '#16a34a', logoSrc: gfav('sunpharma.com'),          logoFallback: '/logos/SUNPHARMA.svg' },
  TATAMOTORS: { kind: 'logo', accent: '#dc2626', logoSrc: gfav('tatamotors.com'),         logoFallback: '/logos/TATAMOTORS.svg' },
  TATASTEEL:  { kind: 'logo', accent: '#7c2d12', logoSrc: gfav('tatasteel.com'),          logoFallback: '/logos/TATASTEEL.svg' },
  NTPC:       { kind: 'logo', accent: '#0f766e', logoSrc: gfav('ntpc.co.in'),             logoFallback: '/logos/NTPC.svg' },
  ONGC:       { kind: 'logo', accent: '#0ea5e9', logoSrc: gfav('ongcindia.com'),          logoFallback: '/logos/ONGC.svg' },
  POWERGRID:  { kind: 'logo', accent: '#7c3aed', logoSrc: gfav('powergrid.in'),           logoFallback: '/logos/POWERGRID.svg' },
  ASIANPAINT: { kind: 'logo', accent: '#f43f5e', logoSrc: gfav('asianpaints.com'),        logoFallback: '/logos/ASIANPAINT.svg' },
  ULTRACEMCO: { kind: 'logo', accent: '#a16207', logoSrc: gfav('ultratechcement.com'),    logoFallback: '/logos/ULTRACEMCO.svg' },
  CIPLA:      { kind: 'logo', accent: '#16a34a', logoSrc: gfav('cipla.com'),              logoFallback: '/logos/CIPLA.svg' },
  TECHM:      { kind: 'logo', accent: '#0f766e', logoSrc: gfav('techmahindra.com'),       logoFallback: '/logos/TECHM.svg' },
  JSWSTEEL:   { kind: 'logo', accent: '#f59e0b', logoSrc: gfav('jsw.in'),                 logoFallback: '/logos/JSWSTEEL.svg' },
  DRREDDY:    { kind: 'logo', accent: '#0f766e', logoSrc: gfav('drreddys.com'),           logoFallback: '/logos/DRREDDY.svg' },
  GRASIM:     { kind: 'logo', accent: '#4f46e5', logoSrc: gfav('adityabirla.com'),        logoFallback: '/logos/GRASIM.svg' },
  INDUSINDBK: { kind: 'logo', accent: '#03a9f4', logoSrc: gfav('indusind.com'),           logoFallback: '/logos/INDUSINDBK.svg' },
  EICHERMOT:  { kind: 'logo', accent: '#1d4ed8', logoSrc: gfav('eichergroup.com'),        logoFallback: '/logos/EICHERMOT.svg' },
  NESTLEIND:  { kind: 'logo', accent: '#86198f', logoSrc: gfav('nestle.in'),              logoFallback: '/logos/NESTLEIND.svg' },
  MANDM:      { kind: 'logo', accent: '#1d4ed8', logoSrc: gfav('mahindra.com'),           logoFallback: '/logos/MANDM.svg' },
  HERO:       { kind: 'logo', accent: '#dc2626', logoSrc: gfav('heromotocorp.com'),       logoFallback: '/logos/HERO.svg' },
  // ── Extra popular NSE stocks ─────────────────────────────────────────────
  BAJAJFINSV: { kind: 'logo', accent: '#fb923c', logoSrc: gfav('bajajfinserv.in') },
  HINDUNILVR: { kind: 'logo', accent: '#1d4ed8', logoSrc: gfav('hul.co.in') },
  TITAN:      { kind: 'logo', accent: '#f59e0b', logoSrc: gfav('titancompany.in') },
  COALINDIA:  { kind: 'logo', accent: '#78716c', logoSrc: gfav('coalindia.in') },
  BPCL:       { kind: 'logo', accent: '#16a34a', logoSrc: gfav('bharatpetroleum.com') },
  IOC:        { kind: 'logo', accent: '#dc2626', logoSrc: gfav('iocl.com') },
  DIVISLAB:   { kind: 'logo', accent: '#16a34a', logoSrc: gfav('divislabs.com') },
  APOLLOHOSP: { kind: 'logo', accent: '#ef4444', logoSrc: gfav('apollohospitals.com') },
  BAJAJ_AUTO: { kind: 'logo', accent: '#1d4ed8', logoSrc: gfav('bajajauto.com') },
  VEDL:       { kind: 'logo', accent: '#7c2d12', logoSrc: gfav('vedantalimited.com') },
  TATACONSUM: { kind: 'logo', accent: '#dc2626', logoSrc: gfav('tataconsumer.com') },
  PIDILITIND: { kind: 'logo', accent: '#ef4444', logoSrc: gfav('pidilite.com') },
  SHREECEM:   { kind: 'logo', accent: '#78716c', logoSrc: gfav('shreecement.com') },
  ADANIPORTS: { kind: 'logo', accent: '#ef4444', logoSrc: gfav('adaniports.com') },
  ADANIGREEN: { kind: 'logo', accent: '#16a34a', logoSrc: gfav('adanigreen.com') },
  ADANIPOWER: { kind: 'logo', accent: '#f97316', logoSrc: gfav('adanipower.com') },
  SIEMENS:    { kind: 'logo', accent: '#009999', logoSrc: gfav('siemens.com') },
  ABB:        { kind: 'logo', accent: '#ff0000', logoSrc: gfav('abb.com') },
  ZOMATO:     { kind: 'logo', accent: '#ef4444', logoSrc: gfav('zomato.com') },
  PAYTM:      { kind: 'logo', accent: '#00b9f5', logoSrc: gfav('paytm.com') },
  NYKAA:      { kind: 'logo', accent: '#fc2779', logoSrc: gfav('nykaa.com') },
  // ── MCX commodities — use exchange favicon ───────────────────────────────
  GOLD:       { kind: 'logo', accent: '#f59e0b', logoSrc: gfav('mcxindia.com') },
  SILVER:     { kind: 'logo', accent: '#94a3b8', logoSrc: gfav('mcxindia.com') },
  CRUDEOIL:   { kind: 'logo', accent: '#78716c', logoSrc: gfav('mcxindia.com') },
  NATURALGAS: { kind: 'logo', accent: '#06b6d4', logoSrc: gfav('mcxindia.com') },
  COPPER:     { kind: 'logo', accent: '#b45309', logoSrc: gfav('mcxindia.com') },
  // ── Indices ──────────────────────────────────────────────────────────────
  NIFTY:      { kind: 'index', accent: '#4f46e5' },
  BANKNIFTY:  { kind: 'index', accent: '#06b6d4' },
  FINNIFTY:   { kind: 'index', accent: '#f59e0b' },
  MIDCPNIFTY: { kind: 'index', accent: '#8b5cf6' },
  SENSEX:     { kind: 'index', accent: '#ef4444' },
  NIFTYIT:    { kind: 'index', accent: '#2563eb' },
  NIFTYPHARMA:{ kind: 'index', accent: '#16a34a' },
  NIFTYAUTO:  { kind: 'index', accent: '#dc2626' },
  // ── CDS currency pairs ───────────────────────────────────────────────────
  USDINR:     { kind: 'index', accent: '#16a34a' },
  EURINR:     { kind: 'index', accent: '#2563eb' },
  GBPINR:     { kind: 'index', accent: '#7c3aed' },
  JPYINR:     { kind: 'index', accent: '#dc2626' },
};

const INDEX_SYMBOLS = new Set([
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX',
  'NIFTYIT', 'NIFTYPHARMA', 'NIFTYAUTO',
  'USDINR', 'EURINR', 'GBPINR', 'JPYINR',
]);

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return '';
  // "NIFTY 50" → "NIFTY50", strip trailing spaces, take first token
  const cleaned = symbol.toUpperCase().trim().replace(/\s+/g, '');
  return cleaned.replace(/[^A-Z0-9_]/g, '');
}

export function resolveSymbolIconMeta(symbol?: string): SymbolIconMeta {
  const normalized = normalizeSymbol(symbol);
  // Try exact, then strip trailing digits (e.g. NIFTY50 → NIFTY), then strip underscores
  const base =
    REGISTRY[normalized] ||
    REGISTRY[normalized.replace(/\d+$/, '')] ||
    REGISTRY[normalized.replace(/_/g, '')];
  const entry = base || { kind: 'fallback' as const, accent: '#4f46e5' };
  const initial = normalized ? normalized.charAt(0) : '?';
  const isIndex = INDEX_SYMBOLS.has(normalized) ||
                  INDEX_SYMBOLS.has(normalized.replace(/\d+$/, '')) ||
                  entry.kind === 'index';

  return {
    symbol: normalized || 'SYM',
    normalized,
    kind: isIndex ? 'index' : entry.kind,
    initial,
    accent: entry.accent,
    logoSrc: entry.logoSrc,
    logoFallback: (entry as any).logoFallback,
    cacheKey: normalized || 'fallback',
  };
}
