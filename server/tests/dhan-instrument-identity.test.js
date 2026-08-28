import { describe, expect, it, vi } from 'vitest';
import { resolveDhanInstrument } from '../brokers/dhan/dhan.instrument.js';
import { DhanWebSocketFeed } from '../brokers/dhan/dhan.websocket.js';

describe('canonical Dhan instrument identity', () => {
  it.each([
    [{ token: '99926000', segment: 'NSE' }, '13', 'IDX_I'],
    [{ token: '99926009', segment: 'NSE' }, '25', 'IDX_I'],
    [{ token: '99919000', segment: 'BSE' }, '51', 'IDX_I'],
    [{ token: '2885', segment: 'NSE' }, '2885', 'NSE_EQ'],
    [{ securityId: '68407', exchangeSegment: 'NSE_CURRENCY' }, '68407', 'NSE_CURRENCY'],
  ])('resolves %j to Dhan identity', (input, securityId, exchangeSegment) => {
    expect(resolveDhanInstrument(input)).toMatchObject({ securityId, exchangeSegment });
  });

  it('does not route placeholder contracts to Dhan', () => {
    expect(resolveDhanInstrument({ token: 'NF_FUT', segment: 'NFO' })).toBeNull();
    expect(resolveDhanInstrument({ token: '11091', segment: 'CDS' })).toBeNull();
  });

  it('uses canonical identity in websocket subscription payloads', () => {
    const feed = new DhanWebSocketFeed({});
    const send = vi.fn();
    feed._connected = true;
    feed._ws = { readyState: 1, send };

    feed.subscribe([
      { token: '99926000', segment: 'NSE' },
      { token: '2885', segment: 'NSE' },
      { token: 'NF_FUT', segment: 'NFO' },
    ], 15);

    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      RequestCode: 15,
      InstrumentCount: 2,
      InstrumentList: [
        { ExchangeSegment: 'IDX_I', SecurityId: '13' },
        { ExchangeSegment: 'NSE_EQ', SecurityId: '2885' },
      ],
    });
  });

  it('normalizes incoming ticks with the subscribed canonical segment', () => {
    const feed = new DhanWebSocketFeed({});
    feed.subscribe([{ token: '99926000', segment: 'NSE' }]);
    const tick = vi.fn();
    feed.on('tick', tick);

    const packet = Buffer.alloc(16);
    packet.writeUInt16LE(15, 0);
    packet.writeUInt16LE(1, 2);
    packet.writeInt32LE(13, 4);
    packet.writeFloatLE(24112.5, 8);
    feed._parseBinaryPacket(packet);

    expect(tick).toHaveBeenCalledWith(expect.objectContaining({
      token: '13',
      securityId: '13',
      exchangeSegment: 'IDX_I',
      ltp: 24112.5,
    }));
  });
});
