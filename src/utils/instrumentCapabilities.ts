import type { Instrument, InstrumentType, Segment } from '@/types';

const SPOT_INDEX_TOKENS = new Set(['99926000', '99926009', '99926037', '99926074', '99919000']);

export interface InstrumentCapabilities {
  canViewChart: boolean;
  canTrade: boolean;
}

export function getInstrumentCapabilities(instrument: Pick<Instrument, 'token' | 'segment' | 'instrumentType' | 'canViewChart' | 'canTrade' | 'tradable'>): InstrumentCapabilities {
  const isSpotIndex = instrument.instrumentType === 'INDEX'
    || instrument.segment === ('IDX_I' as Segment)
    || SPOT_INDEX_TOKENS.has(instrument.token);

  return {
    canViewChart: instrument.canViewChart ?? true,
    canTrade: instrument.canTrade ?? instrument.tradable ?? !isSpotIndex,
  };
}

export function getWatchlistInstrumentMetadata(item: {
  token: string;
  segment: Segment;
  instrumentType?: InstrumentType;
  exchange?: string;
  canViewChart?: boolean;
  canTrade?: boolean;
  tradable?: boolean;
}) {
  const instrumentType = item.instrumentType
    || (SPOT_INDEX_TOKENS.has(item.token) ? 'INDEX' : item.segment === 'NFO' ? 'FUT' : 'EQ');
  const capabilities = getInstrumentCapabilities({ ...item, instrumentType });
  return { instrumentType, exchange: item.exchange || item.segment, tradable: capabilities.canTrade, ...capabilities };
}