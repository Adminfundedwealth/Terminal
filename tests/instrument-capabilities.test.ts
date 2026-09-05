import { describe, expect, it } from 'vitest';
import { getInstrumentCapabilities, getWatchlistInstrumentMetadata } from '@/utils/instrumentCapabilities';

describe('instrument capabilities', () => {
  it('keeps regular stocks chartable and tradable', () => {
    expect(getInstrumentCapabilities({
      token: '2885', segment: 'NSE', instrumentType: 'EQ',
    })).toEqual({ canViewChart: true, canTrade: true });
  });

  it.each([
    ['99926000', 'NIFTY 50'],
    ['99926009', 'BANKNIFTY'],
    ['99926037', 'FINNIFTY'],
    ['99926074', 'MIDCPNIFTY'],
    ['99919000', 'SENSEX'],
  ])('marks %s as chartable but not tradable', (token) => {
    expect(getWatchlistInstrumentMetadata({ token, segment: 'NSE' })).toMatchObject({
      instrumentType: 'INDEX',
      canViewChart: true,
      canTrade: false,
    });
  });

  it('keeps futures and option contracts tradable', () => {
    expect(getInstrumentCapabilities({ token: '58072', segment: 'NFO', instrumentType: 'FUT' }).canTrade).toBe(true);
    expect(getInstrumentCapabilities({ token: '123', segment: 'NFO', instrumentType: 'CE' }).canTrade).toBe(true);
    expect(getInstrumentCapabilities({ token: '124', segment: 'NFO', instrumentType: 'PE' }).canTrade).toBe(true);
  });
});