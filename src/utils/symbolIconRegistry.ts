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
  // Local logo assets served from `/logos/<SYMBOL>.svg` in the `public` directory.
  // Place high-quality SVG/PNG files at `public/logos/RELIANCE.svg`, etc.
  RELIANCE: { kind: 'logo', accent: '#f97316', logoSrc: '/logos/RELIANCE.svg' },
  TCS: { kind: 'logo', accent: '#2563eb', logoSrc: '/logos/TCS.svg' },
  ITC: { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/ITC.svg' },
  HDFCBANK: { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/HDFCBANK.svg' },
  ICICIBANK: { kind: 'logo', accent: '#7c3aed', logoSrc: '/logos/ICICIBANK.svg' },
  SBIN: { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/SBIN.svg' },
  LT: { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/LT.svg' },
  AXISBANK: { kind: 'logo', accent: '#ef4444', logoSrc: '/logos/AXISBANK.svg' },
  INFY: { kind: 'logo', accent: '#2563eb', logoSrc: '/logos/INFY.svg' },
  HDFC: { kind: 'logo', accent: '#0078d4', logoSrc: '/logos/HDFCBANK.svg' },
  KOTAKBANK: { kind: 'logo', accent: '#f59e0b', logoSrc: '/logos/KOTAKBANK.svg' },
  BAJFINANCE: { kind: 'logo', accent: '#fb923c', logoSrc: '/logos/BAJFINANCE.svg' },
  MANDM: { kind: 'logo', accent: '#1d4ed8', logoSrc: '/logos/MANDM.svg' },
  MARUTI: { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/MARUTI.svg' },
  NTPC: { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/NTPC.svg' },
  ONGC: { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/ONGC.svg' },
  POWERGRID: { kind: 'logo', accent: '#7c3aed', logoSrc: '/logos/POWERGRID.svg' },
  TATAMOTORS: { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/TATAMOTORS.svg' },
  ASIANPAINT: { kind: 'logo', accent: '#f43f5e', logoSrc: '/logos/ASIANPAINT.svg' },
  HCLTECH: { kind: 'logo', accent: '#0ea5e9', logoSrc: '/logos/HCLTECH.svg' },
  ULTRACEMCO: { kind: 'logo', accent: '#a16207', logoSrc: '/logos/ULTRACEMCO.svg' },
  WIPRO: { kind: 'logo', accent: '#2563eb', logoSrc: '/logos/WIPRO.svg' },
  CIPLA: { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/CIPLA.svg' },
  TECHM: { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/TECHM.svg' },
  BHARTIARTL: { kind: 'logo', accent: '#8b5cf6', logoSrc: '/logos/BHARTIARTL.svg' },
  JSWSTEEL: { kind: 'logo', accent: '#f59e0b', logoSrc: '/logos/JSWSTEEL.svg' },
  DRREDDY: { kind: 'logo', accent: '#0f766e', logoSrc: '/logos/DRREDDY.svg' },
  GRASIM: { kind: 'logo', accent: '#4f46e5', logoSrc: '/logos/GRASIM.svg' },
  INDUSINDBK: { kind: 'logo', accent: '#03a9f4', logoSrc: '/logos/INDUSINDBK.svg' },
  ADANIENT: { kind: 'logo', accent: '#ef4444', logoSrc: '/logos/ADANIENT.svg' },
  SUNPHARMA: { kind: 'logo', accent: '#16a34a', logoSrc: '/logos/SUNPHARMA.svg' },
  EICHERMOT: { kind: 'logo', accent: '#1d4ed8', logoSrc: '/logos/EICHERMOT.svg' },
  HERO: { kind: 'logo', accent: '#dc2626', logoSrc: '/logos/HERO.svg' },
  TATASTEEL: { kind: 'logo', accent: '#7c2d12', logoSrc: '/logos/TATASTEEL.svg' },
  NESTLEIND: { kind: 'logo', accent: '#86198f', logoSrc: '/logos/NESTLEIND.svg' },
  NIFTY: { kind: 'index', accent: '#4f46e5' },
  BANKNIFTY: { kind: 'index', accent: '#06b6d4' },
  FINNIFTY: { kind: 'index', accent: '#f59e0b' },
  MIDCPNIFTY: { kind: 'index', accent: '#8b5cf6' },
  SENSEX: { kind: 'index', accent: '#ef4444' },
};

const INDEX_SYMBOLS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX']);

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return '';
  const cleaned = symbol.toUpperCase().trim().replace(/\s+/g, ' ').split(' ')[0];
  return cleaned.replace(/[^A-Z0-9]/g, '');
}

export function resolveSymbolIconMeta(symbol?: string): SymbolIconMeta {
  const normalized = normalizeSymbol(symbol);
  const base = REGISTRY[normalized] || REGISTRY[normalized.replace(/\d+$/, '')];
  const entry = base || { kind: 'fallback' as const, accent: '#4f46e5' };
  const initial = normalized ? normalized.charAt(0) : '?';
  const isIndex = INDEX_SYMBOLS.has(normalized) || entry.kind === 'index';

  return {
    symbol: normalized || 'SYM',
    normalized,
    kind: entry.kind === 'index' || isIndex ? 'index' : entry.kind,
    initial,
    accent: entry.accent,
    logoSrc: entry.logoSrc,
    cacheKey: normalized || 'fallback',
  };
}
