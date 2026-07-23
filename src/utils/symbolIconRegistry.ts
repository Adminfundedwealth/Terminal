export type SymbolIconKind = 'logo' | 'index' | 'fallback';

export interface SymbolIconMeta {
  symbol: string;
  normalized: string;
  kind: SymbolIconKind;
  initial: string;
  accent: string;
  logoSrc?: string;
  cacheKey: string;
}

const REGISTRY: Record<string, { kind: SymbolIconKind; accent: string; logoSrc?: string }> = {
  // ── Nifty 50 / popular NSE stocks with local SVG artwork ────────────────
  RELIANCE:   { kind: 'logo', accent: '#f97316', logoSrc: '/logos/RELIANCE.svg' },
  TCS:        { kind: 'logo', accent: '#2563eb', logoSrc: '/logos/TCS.svg' },
  HDFCBANK:   { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/HDFCBANK.svg' },
  HDFC:       { kind: 'logo', accent: '#0078d4', logoSrc: '/logos/HDFCBANK.svg' },
  ICICIBANK:  { kind: 'logo', accent: '#7c3aed', logoSrc: '/logos/ICICIBANK.svg' },
  INFY:       { kind: 'logo', accent: '#2563eb', logoSrc: '/logos/INFY.svg' },
  SBIN:       { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/SBIN.svg' },
  BHARTIARTL: { kind: 'logo', accent: '#8b5cf6', logoSrc: '/logos/BHARTIARTL.svg' },
  ITC:        { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/ITC.svg' },
  KOTAKBANK:  { kind: 'logo', accent: '#f59e0b', logoSrc: '/logos/KOTAKBANK.svg' },
  LT:         { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/LT.svg' },
  HCLTECH:    { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/HCLTECH.svg' },
  AXISBANK:   { kind: 'logo', accent: '#ef4444', logoSrc: '/logos/AXISBANK.svg' },
  WIPRO:      { kind: 'logo', accent: '#06b6d4', logoSrc: '/logos/WIPRO.svg' },
  ADANIENT:   { kind: 'logo', accent: '#ef4444', logoSrc: '/logos/ADANIENT.svg' },
  MARUTI:     { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/MARUTI.svg' },
  BAJFINANCE: { kind: 'logo', accent: '#fb923c', logoSrc: '/logos/BAJFINANCE.svg' },
  SUNPHARMA:  { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/SUNPHARMA.svg' },
  TATAMOTORS: { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/TATAMOTORS.svg' },
  TATASTEEL:  { kind: 'logo', accent: '#7c2d12', logoSrc: '/logos/TATASTEEL.svg' },
  NTPC:       { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/NTPC.svg' },
  ONGC:       { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/ONGC.svg' },
  POWERGRID:  { kind: 'logo', accent: '#7c3aed', logoSrc: '/logos/POWERGRID.svg' },
  ASIANPAINT: { kind: 'logo', accent: '#f43f5e', logoSrc: '/logos/ASIANPAINT.svg' },
  ULTRACEMCO: { kind: 'logo', accent: '#a16207', logoSrc: '/logos/ULTRACEMCO.svg' },
  CIPLA:      { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/CIPLA.svg' },
  TECHM:      { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/TECHM.svg' },
  JSWSTEEL:   { kind: 'logo', accent: '#f59e0b', logoSrc: '/logos/JSWSTEEL.svg' },
  DRREDDY:    { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/DRREDDY.svg' },
  GRASIM:     { kind: 'logo', accent: '#4f46e5', logoSrc: '/logos/GRASIM.svg' },
  INDUSINDBK: { kind: 'logo', accent: '#03a9f4', logoSrc: '/logos/INDUSINDBK.svg' },
  EICHERMOT:  { kind: 'logo', accent: '#1d4ed8', logoSrc: '/logos/EICHERMOT.svg' },
  NESTLEIND:  { kind: 'logo', accent: '#86198f', logoSrc: '/logos/NESTLEIND.svg' },
  MANDM:      { kind: 'logo', accent: '#1d4ed8', logoSrc: '/logos/MANDM.svg' },
  HERO:       { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/HERO.svg' },
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
  // ── MCX commodities ──────────────────────────────────────────────────────
  GOLD:       { kind: 'index', accent: '#f59e0b' },
  SILVER:     { kind: 'index', accent: '#94a3b8' },
  CRUDEOIL:   { kind: 'index', accent: '#78716c' },
  NATURALGAS: { kind: 'index', accent: '#06b6d4' },
  COPPER:     { kind: 'index', accent: '#b45309' },
  ALUMINIUM:  { kind: 'index', accent: '#94a3b8' },
  ZINC:       { kind: 'index', accent: '#64748b' },
  LEAD:       { kind: 'index', accent: '#475569' },
  NICKEL:     { kind: 'index', accent: '#78716c' },
};

// Symbols that always use the index/commodity chip style
const INDEX_SYMBOLS = new Set([
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX',
  'NIFTYIT', 'NIFTYPHARMA', 'NIFTYAUTO',
  'USDINR', 'EURINR', 'GBPINR', 'JPYINR',
  'GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER',
  'ALUMINIUM', 'ZINC', 'LEAD', 'NICKEL',
]);

// Short display labels for index/commodity chips
const INDEX_LABELS: Record<string, string> = {
  NIFTY50: 'N50',  NIFTY: 'N50',   BANKNIFTY: 'BNK', FINNIFTY: 'FIN',
  MIDCPNIFTY: 'MID', SENSEX: 'SX', NIFTYIT: 'IT',    NIFTYPHARMA: 'PHR',
  NIFTYAUTO: 'AUT',  USDINR: '$₹', EURINR: '€₹',     GBPINR: '£₹',
  JPYINR: '¥₹',     GOLD: 'AU',   SILVER: 'AG',      CRUDEOIL: 'OIL',
  NATURALGAS: 'GAS', COPPER: 'CU', ALUMINIUM: 'AL',   ZINC: 'ZN',
  LEAD: 'PB',        NICKEL: 'NI',
};

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return '';
  return symbol.toUpperCase().trim().replace(/\s+/g, '').replace(/[^A-Z0-9_]/g, '');
}

export function resolveSymbolIconMeta(symbol?: string): SymbolIconMeta {
  const normalized = normalizeSymbol(symbol);
  // Try exact, then strip trailing digits (NIFTY50 → NIFTY)
  const base = REGISTRY[normalized] || REGISTRY[normalized.replace(/\d+$/, '')];
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
    // expose label for index chips
    cacheKey: normalized || 'fallback',
    ...(isIndex && { indexLabel: INDEX_LABELS[normalized] || INDEX_LABELS[normalized.replace(/\d+$/, '')] || initial }),
  } as SymbolIconMeta & { indexLabel?: string };
}

export { INDEX_LABELS };
