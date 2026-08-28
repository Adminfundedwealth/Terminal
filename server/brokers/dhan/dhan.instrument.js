/**
 * Canonical instrument identity used by Dhan market-data consumers.
 *
 * Callers may provide terminal or legacy broker fields, but Dhan-facing code
 * must use the returned securityId and exchangeSegment values.
 */

const SEGMENT_MAP = {
  NSE: 'NSE_EQ',
  NSE_EQ: 'NSE_EQ',
  NFO: 'NSE_FNO',
  NSE_FNO: 'NSE_FNO',
  BSE: 'BSE_EQ',
  BSE_EQ: 'BSE_EQ',
  BFO: 'BSE_FNO',
  BSE_FNO: 'BSE_FNO',
  MCX: 'MCX_COMM',
  MCX_COMM: 'MCX_COMM',
  CDS: 'NSE_CURRENCY',
  CUR: 'NSE_CURRENCY',
  NSE_CURRENCY: 'NSE_CURRENCY',
  IDX_I: 'IDX_I',
};

const ALIASES = {
  '99926000': { securityId: '13', exchangeSegment: 'IDX_I', symbol: 'NIFTY 50', instrumentType: 'INDEX' },
  '99926009': { securityId: '25', exchangeSegment: 'IDX_I', symbol: 'BANKNIFTY', instrumentType: 'INDEX' },
  '99926037': { securityId: '27', exchangeSegment: 'IDX_I', symbol: 'FINNIFTY', instrumentType: 'INDEX' },
  '99926074': { securityId: '442', exchangeSegment: 'IDX_I', symbol: 'MIDCPNIFTY', instrumentType: 'INDEX' },
  '99919000': { securityId: '51', exchangeSegment: 'IDX_I', symbol: 'SENSEX', instrumentType: 'INDEX' },
};

const LEGACY_BROKER_IDS = new Set(['429604', '429638', '425475', '431765', '430596', '11091', '11363', '11096', '11098']);

export function resolveDhanInstrument(input = {}) {
  const rawId = String(input.securityId ?? input.token ?? '').trim();
  if (input.securityId === undefined && LEGACY_BROKER_IDS.has(rawId)) return null;
  const alias = ALIASES[rawId];
  const securityId = alias?.securityId || rawId;
  const exchangeSegment = alias?.exchangeSegment || SEGMENT_MAP[String(input.exchangeSegment ?? input.segment ?? input.exchange ?? '').toUpperCase()];

  if (!securityId || !/^\d+$/.test(securityId) || !exchangeSegment) return null;

  return {
    symbol: alias?.symbol || input.symbol || input.name || '',
    securityId,
    exchangeSegment,
    instrumentType: alias?.instrumentType || input.instrumentType || input.type || null,
    expiry: input.expiry || null,
    strike: input.strike ?? null,
    optionType: input.optionType || null,
    lotSize: input.lotSize ?? null,
  };
}
