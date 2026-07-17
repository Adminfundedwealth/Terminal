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
  RELIANCE: { kind: 'logo', accent: '#f97316', logoSrc: 'https://logo.clearbit.com/reliance.com' },
  TCS: { kind: 'logo', accent: '#2563eb', logoSrc: 'https://logo.clearbit.com/tcs.com' },
  ITC: { kind: 'logo', accent: '#16a34a', logoSrc: 'https://logo.clearbit.com/itcportal.com' },
  HDFCBANK: { kind: 'logo', accent: '#0ea5e9', logoSrc: 'https://logo.clearbit.com/hdfcbank.com' },
  ICICIBANK: { kind: 'logo', accent: '#7c3aed', logoSrc: 'https://logo.clearbit.com/icicibank.com' },
  SBIN: { kind: 'logo', accent: '#dc2626', logoSrc: 'https://logo.clearbit.com/sbi.co.in' },
  LT: { kind: 'logo', accent: '#0f766e', logoSrc: 'https://logo.clearbit.com/larsentoubro.com' },
  AXISBANK: { kind: 'logo', accent: '#ef4444', logoSrc: 'https://logo.clearbit.com/axisbank.com' },
  INFY: { kind: 'logo', accent: '#2563eb', logoSrc: 'https://logo.clearbit.com/infosys.com' },
  HDFC: { kind: 'logo', accent: '#0078d4', logoSrc: 'https://logo.clearbit.com/hdfc.com' },
  KOTAKBANK: { kind: 'logo', accent: '#f59e0b', logoSrc: 'https://logo.clearbit.com/kotak.com' },
  BAJFINANCE: { kind: 'logo', accent: '#fb923c', logoSrc: 'https://logo.clearbit.com/bajajfinserv.in' },
  MANDM: { kind: 'logo', accent: '#1d4ed8', logoSrc: 'https://logo.clearbit.com/mahindra.com' },
  MARUTI: { kind: 'logo', accent: '#dc2626', logoSrc: 'https://logo.clearbit.com/marutisuzuki.com' },
  NTPC: { kind: 'logo', accent: '#0f766e', logoSrc: 'https://logo.clearbit.com/ntpc.co.in' },
  ONGC: { kind: 'logo', accent: '#0ea5e9', logoSrc: 'https://logo.clearbit.com/ongcindia.com' },
  POWERGRID: { kind: 'logo', accent: '#7c3aed', logoSrc: 'https://logo.clearbit.com/powergrid.in' },
  TATAMOTORS: { kind: 'logo', accent: '#dc2626', logoSrc: 'https://logo.clearbit.com/tatamotors.com' },
  ASIANPAINT: { kind: 'logo', accent: '#f43f5e', logoSrc: 'https://logo.clearbit.com/asianpaints.com' },
  HCLTECH: { kind: 'logo', accent: '#0ea5e9', logoSrc: 'https://logo.clearbit.com/hcltech.com' },
  ULTRACEMCO: { kind: 'logo', accent: '#a16207', logoSrc: 'https://logo.clearbit.com/ultratechcement.com' },
  WIPRO: { kind: 'logo', accent: '#2563eb', logoSrc: 'https://logo.clearbit.com/wipro.com' },
  CIPLA: { kind: 'logo', accent: '#16a34a', logoSrc: 'https://logo.clearbit.com/cipla.com' },
  TECHM: { kind: 'logo', accent: '#0f766e', logoSrc: 'https://logo.clearbit.com/techmahindra.com' },
  BHARTIARTL: { kind: 'logo', accent: '#8b5cf6', logoSrc: 'https://logo.clearbit.com/bhartiairtel.in' },
  JSWSTEEL: { kind: 'logo', accent: '#f59e0b', logoSrc: 'https://logo.clearbit.com/jsw.in' },
  DRREDDY: { kind: 'logo', accent: '#0f766e', logoSrc: 'https://logo.clearbit.com/drreddys.com' },
  GRASIM: { kind: 'logo', accent: '#4f46e5', logoSrc: 'https://logo.clearbit.com/grasim.com' },
  INDUSINDBK: { kind: 'logo', accent: '#03a9f4', logoSrc: 'https://logo.clearbit.com/indusind.com' },
  ADANIENT: { kind: 'logo', accent: '#ef4444', logoSrc: 'https://logo.clearbit.com/adanigroup.com' },
  SUNPHARMA: { kind: 'logo', accent: '#16a34a', logoSrc: 'https://logo.clearbit.com/sunpharma.com' },
  EICHERMOT: { kind: 'logo', accent: '#1d4ed8', logoSrc: 'https://logo.clearbit.com/eichermot.com' },
  HERO: { kind: 'logo', accent: '#dc2626', logoSrc: 'https://logo.clearbit.com/heromotocorp.com' },
  TATASTEEL: { kind: 'logo', accent: '#7c2d12', logoSrc: 'https://logo.clearbit.com/tatasteel.com' },
  NESTLEIND: { kind: 'logo', accent: '#86198f', logoSrc: 'https://logo.clearbit.com/nestle.com' },
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
