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

// ── CDN base (Upstox public assets — no auth required) ───────────────────────
const U = 'https://assets.upstox.com/market-quote/images';

const REGISTRY: Record<string, { kind: SymbolIconKind; accent: string; logoSrc?: string }> = {
  // ── 30 F&O Stocks (local SVG preferred, CDN fallback baked in via onError) ──
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

  // ── F&O stocks without local SVG — served via Upstox CDN ─────────────────
  TITAN:      { kind: 'logo', accent: '#eab308', logoSrc: `${U}/NSE_EQ_INE280A01028.svg` },
  ADANIPORTS: { kind: 'logo', accent: '#0ea5e9', logoSrc: `${U}/NSE_EQ_INE742F01042.svg` },
  BEL:        { kind: 'logo', accent: '#16a34a', logoSrc: `${U}/NSE_EQ_INE263A01024.svg` },
  HAL:        { kind: 'logo', accent: '#3b82f6', logoSrc: `${U}/NSE_EQ_INE066F01012.svg` },
  ZOMATO:     { kind: 'logo', accent: '#ef4444', logoSrc: `${U}/NSE_EQ_INE758T01015.svg` },
  DLF:        { kind: 'logo', accent: '#f59e0b', logoSrc: `${U}/NSE_EQ_INE271C01023.svg` },
  COALINDIA:  { kind: 'logo', accent: '#78716c', logoSrc: `${U}/NSE_EQ_INE522F01014.svg` },
  TIINDIA:    { kind: 'logo', accent: '#6366f1', logoSrc: `${U}/NSE_EQ_INE974X01010.svg` },
  VOLTAS:     { kind: 'logo', accent: '#0891b2', logoSrc: `${U}/NSE_EQ_INE226A01021.svg` },

  // ── Additional large-cap stocks ───────────────────────────────────────────
  BAJAJFINSV: { kind: 'logo', accent: '#f97316', logoSrc: `${U}/NSE_EQ_INE918I01026.svg` },
  BAJAJ_AUTO: { kind: 'logo', accent: '#dc2626', logoSrc: `${U}/NSE_EQ_INE917I01010.svg` },
  BAJAJ:      { kind: 'logo', accent: '#dc2626', logoSrc: `${U}/NSE_EQ_INE917I01010.svg` },
  HINDALCO:   { kind: 'logo', accent: '#94a3b8', logoSrc: `${U}/NSE_EQ_INE038A01020.svg` },
  DIVISLAB:   { kind: 'logo', accent: '#22c55e', logoSrc: `${U}/NSE_EQ_INE361B01024.svg` },
  SBILIFE:    { kind: 'logo', accent: '#dc2626', logoSrc: `${U}/NSE_EQ_INE123W01016.svg` },
  HDFCLIFE:   { kind: 'logo', accent: '#0284c7', logoSrc: `${U}/NSE_EQ_INE795G01014.svg` },
  ICICIPRULI: { kind: 'logo', accent: '#7c3aed', logoSrc: `${U}/NSE_EQ_INE726G01019.svg` },
  APOLLOHOSP: { kind: 'logo', accent: '#16a34a', logoSrc: `${U}/NSE_EQ_INE437A01024.svg` },
  BRITANNIA:  { kind: 'logo', accent: '#ef4444', logoSrc: `${U}/NSE_EQ_INE216A01030.svg` },
  SHREECEM:   { kind: 'logo', accent: '#a16207', logoSrc: `${U}/NSE_EQ_INE070A01015.svg` },
  TORNTPHARM: { kind: 'logo', accent: '#16a34a', logoSrc: `${U}/NSE_EQ_INE685A01028.svg` },
  PIDILITIND: { kind: 'logo', accent: '#dc2626', logoSrc: `${U}/NSE_EQ_INE318A01026.svg` },
  MUTHOOTFIN: { kind: 'logo', accent: '#f59e0b', logoSrc: `${U}/NSE_EQ_INE414G01012.svg` },

  // ── ETFs (chip style — indices as underlying) ─────────────────────────────
  NIFTYBEES:  { kind: 'index', accent: '#4f46e5' },
  BANKBEES:   { kind: 'index', accent: '#06b6d4' },
  JUNIORBEES: { kind: 'index', accent: '#8b5cf6' },
  GOLDBEES:   { kind: 'index', accent: '#f59e0b' },
  SILVERBEES: { kind: 'index', accent: '#94a3b8' },
  ITBEES:     { kind: 'index', accent: '#2563eb' },
  PHARMABEES: { kind: 'index', accent: '#16a34a' },
  CPSE:       { kind: 'index', accent: '#0f766e' },
  PSUBNKBEES: { kind: 'index', accent: '#dc2626' },
  MON100:     { kind: 'index', accent: '#f97316' },
  SETFNIF50:  { kind: 'index', accent: '#4f46e5' },
  ICICIB22:   { kind: 'index', accent: '#7c3aed' },
  NV20BEES:   { kind: 'index', accent: '#06b6d4' },
  LIQUIDBEES: { kind: 'index', accent: '#64748b' },

  // ── Indices ───────────────────────────────────────────────────────────────
  NIFTY:         { kind: 'index', accent: '#4f46e5' },
  NIFTY50:       { kind: 'index', accent: '#4f46e5' },
  BANKNIFTY:     { kind: 'index', accent: '#06b6d4' },
  FINNIFTY:      { kind: 'index', accent: '#f59e0b' },
  MIDCPNIFTY:    { kind: 'index', accent: '#8b5cf6' },
  SENSEX:        { kind: 'index', accent: '#ef4444' },
  NIFTYIT:       { kind: 'index', accent: '#2563eb' },
  NIFTYPHARMA:   { kind: 'index', accent: '#16a34a' },
  NIFTYAUTO:     { kind: 'index', accent: '#dc2626' },
  NIFTYMETAL:    { kind: 'index', accent: '#78716c' },
  NIFTYPSE:      { kind: 'index', accent: '#0f766e' },
  NIFTYREALTY:   { kind: 'index', accent: '#f97316' },
  NIFTYFMCG:     { kind: 'index', accent: '#16a34a' },
  NIFTYENERGY:   { kind: 'index', accent: '#eab308' },
  NIFTYINFRA:    { kind: 'index', accent: '#6366f1' },
  NIFTYSMALLCAP: { kind: 'index', accent: '#a855f7' },
  NIFTYMIDCAP:   { kind: 'index', accent: '#f97316' },
  INDIA_VIX:     { kind: 'index', accent: '#ef4444' },

  // ── CDS currency pairs ────────────────────────────────────────────────────
  USDINR: { kind: 'index', accent: '#16a34a' },
  EURINR: { kind: 'index', accent: '#2563eb' },
  GBPINR: { kind: 'index', accent: '#7c3aed' },
  JPYINR: { kind: 'index', accent: '#dc2626' },
  USDINRFUT: { kind: 'index', accent: '#16a34a' },
  EURINRFUT: { kind: 'index', accent: '#2563eb' },
  GBPINRFUT: { kind: 'index', accent: '#7c3aed' },
  JPYINRFUT: { kind: 'index', accent: '#dc2626' },

  // ── MCX commodities ───────────────────────────────────────────────────────
  GOLD:       { kind: 'index', accent: '#f59e0b' },
  GOLDM:      { kind: 'index', accent: '#d97706' },
  GOLDGUINEA: { kind: 'index', accent: '#eab308' },
  GOLDPETAL:  { kind: 'index', accent: '#fbbf24' },
  SILVER:     { kind: 'index', accent: '#94a3b8' },
  SILVERM:    { kind: 'index', accent: '#9ca3af' },
  SILVERMIC:  { kind: 'index', accent: '#94a3b8' },
  CRUDEOIL:   { kind: 'index', accent: '#78716c' },
  CRUDEOILM:  { kind: 'index', accent: '#78716c' },
  NATURALGAS: { kind: 'index', accent: '#06b6d4' },
  NATURALGASM:{ kind: 'index', accent: '#06b6d4' },
  COPPER:     { kind: 'index', accent: '#b45309' },
  ALUMINIUM:  { kind: 'index', accent: '#94a3b8' },
  ZINC:       { kind: 'index', accent: '#64748b' },
  LEAD:       { kind: 'index', accent: '#475569' },
  NICKEL:     { kind: 'index', accent: '#78716c' },
  MENTHAOIL:  { kind: 'index', accent: '#10b981' },
  COTTON:     { kind: 'index', accent: '#e2e8f0' },
  CARDAMOM:   { kind: 'index', accent: '#84cc16' },
};

// ─── Symbols that always use the chip (index/commodity) style ────────────────
const INDEX_SYMBOLS = new Set([
  'NIFTY', 'NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX',
  'NIFTYIT', 'NIFTYPHARMA', 'NIFTYAUTO', 'NIFTYMETAL', 'NIFTYPSE',
  'NIFTYREALTY', 'NIFTYFMCG', 'NIFTYENERGY', 'NIFTYINFRA',
  'NIFTYSMALLCAP', 'NIFTYMIDCAP', 'INDIA_VIX',
  'USDINR', 'EURINR', 'GBPINR', 'JPYINR',
  'USDINRFUT', 'EURINRFUT', 'GBPINRFUT', 'JPYINRFUT',
  'GOLD', 'GOLDM', 'GOLDGUINEA', 'GOLDPETAL',
  'SILVER', 'SILVERM', 'SILVERMIC',
  'CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATURALGASM',
  'COPPER', 'ALUMINIUM', 'ZINC', 'LEAD', 'NICKEL',
  'MENTHAOIL', 'COTTON', 'CARDAMOM',
  // ETFs use chip style
  'NIFTYBEES', 'BANKBEES', 'JUNIORBEES', 'GOLDBEES', 'SILVERBEES',
  'ITBEES', 'PHARMABEES', 'CPSE', 'PSUBNKBEES', 'MON100',
  'SETFNIF50', 'ICICIB22', 'NV20BEES', 'LIQUIDBEES',
]);

// ─── Short display labels for chip rendering ──────────────────────────────────
export const INDEX_LABELS: Record<string, string> = {
  // Indices
  NIFTY50: 'N50', NIFTY: 'N50', BANKNIFTY: 'BNK', FINNIFTY: 'FIN',
  MIDCPNIFTY: 'MID', SENSEX: 'SX', NIFTYIT: 'IT', NIFTYPHARMA: 'PHR',
  NIFTYAUTO: 'AUT', NIFTYMETAL: 'MET', NIFTYPSE: 'PSE', NIFTYREALTY: 'REL',
  NIFTYFMCG: 'FMC', NIFTYENERGY: 'ENG', NIFTYINFRA: 'INF',
  NIFTYSMALLCAP: 'SML', NIFTYMIDCAP: 'MID', INDIA_VIX: 'VIX',
  // ETFs
  NIFTYBEES: 'N50', BANKBEES: 'BNK', JUNIORBEES: 'JNR', GOLDBEES: 'AU',
  SILVERBEES: 'AG', ITBEES: 'IT', PHARMABEES: 'PHR', CPSE: 'PSU',
  PSUBNKBEES: 'PSB', MON100: 'M100', SETFNIF50: 'N50', NV20BEES: 'NV',
  LIQUIDBEES: 'LIQ',
  // Currencies
  USDINR: '$₹', EURINR: '€₹', GBPINR: '£₹', JPYINR: '¥₹',
  USDINRFUT: '$₹', EURINRFUT: '€₹', GBPINRFUT: '£₹', JPYINRFUT: '¥₹',
  // MCX Commodities
  GOLD: 'AU', GOLDM: 'Au', GOLDGUINEA: 'GG', GOLDPETAL: 'GP',
  SILVER: 'AG', SILVERM: 'Ag', SILVERMIC: 'AgM',
  CRUDEOIL: 'OIL', CRUDEOILM: 'OIL', NATURALGAS: 'GAS', NATURALGASM: 'GAS',
  COPPER: 'CU', ALUMINIUM: 'AL', ZINC: 'ZN', LEAD: 'PB', NICKEL: 'NI',
  MENTHAOIL: 'MNT', COTTON: 'CTN', CARDAMOM: 'CRD',
};

// ─── Strip futures/options suffixes to get the underlying symbol ──────────────
// Handles: "RELIANCE FUT", "NIFTY FUT", "TATAMOTORS 25JAN 500 CE", etc.
function extractBase(symbol?: string): string {
  if (!symbol) return '';
  return symbol
    .trim()
    .toUpperCase()
    // Strip expiry + strike + CE/PE:  "25JAN500CE", "29AUG24 24000 CE"
    .replace(/\s+\d{1,2}[A-Z]{3}\d{0,4}\s+\d+\s+(CE|PE)$/i, '')
    // Strip standalone FUT/FUTURES suffix
    .replace(/\s+FUT(URES)?$/i, '')
    // Strip internal spaces (NIFTY 50 → NIFTY50 in registry)
    .replace(/\s+/g, '')
    // Strip exchange prefix (NSE_, BSE_, MCX_)
    .replace(/^(NSE_|BSE_|MCX_|CDS_)/i, '');
}

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return '';
  return symbol.toUpperCase().trim().replace(/\s+/g, '').replace(/[^A-Z0-9_]/g, '');
}

export function resolveSymbolIconMeta(symbol?: string): SymbolIconMeta {
  const base = extractBase(symbol);           // strips FUT / CE / PE
  const normalized = normalizeSymbol(symbol); // raw, no stripping

  // Lookup order: base-stripped → raw → strip trailing digits
  const entry =
    REGISTRY[base] ||
    REGISTRY[normalized] ||
    REGISTRY[normalized.replace(/\d+$/, '')] ||
    { kind: 'fallback' as const, accent: accentFromString(base || normalized) };

  const initial = (base || normalized).charAt(0) || '?';
  const isIndex =
    INDEX_SYMBOLS.has(base) ||
    INDEX_SYMBOLS.has(normalized) ||
    INDEX_SYMBOLS.has(normalized.replace(/\d+$/, '')) ||
    entry.kind === 'index';

  return {
    symbol: normalized || 'SYM',
    normalized: base || normalized,
    kind: isIndex ? 'index' : entry.kind,
    initial,
    accent: entry.accent,
    logoSrc: entry.logoSrc,
    cacheKey: base || normalized || 'fallback',
  } as SymbolIconMeta;
}

// ─── Deterministic accent color from string hash (for unknown symbols) ────────
const ACCENT_PALETTE = [
  '#4f46e5', '#0ea5e9', '#16a34a', '#dc2626', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ef4444', '#10b981', '#f97316',
  '#ec4899', '#6366f1', '#14b8a6', '#a855f7', '#0891b2',
];

function accentFromString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return ACCENT_PALETTE[Math.abs(hash) % ACCENT_PALETTE.length];
}

export { INDEX_LABELS as default };
