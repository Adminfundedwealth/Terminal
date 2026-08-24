import { describe, expect, it, vi } from 'vitest';
import { InstrumentService } from '../services/instrumentService.js';

describe('Angel One instrument-master integration', () => {
  it('loads and normalizes a broker NFO future without a placeholder token', async () => {
    const adapter = {
      getInstrumentMaster: vi.fn().mockResolvedValue([
        { token: '123456', symbol: 'NIFTY25AUG26FUT', name: 'NIFTY25AUG26FUT', exch_seg: 'NFO', instrumenttype: 'FUTIDX', lotsize: '65', tick_size: '5' },
      ]),
    };
    const service = new InstrumentService({ brokerAdapter: adapter });

    const refresh = await service.refreshFromBroker();
    const resolved = await service.resolveInstrument('NIFTY25AUG26FUT', 'NFO');

    expect(refresh.success).toBe(true);
    expect(resolved.instrument.token).toBe('123456');
    expect(resolved.instrument.segment).toBe('NFO');
    expect(resolved.instrument.lotSize).toBe(65);
  });

  it('normalizes broker-native fields from the master', async () => {
    const service = new InstrumentService();
    const normalized = service._normalizeInstrument({ token: '123456', symbol: 'NIFTY25AUG26FUT', exch_seg: 'NFO', instrumenttype: 'FUTIDX', lotsize: '65', tick_size: '5' });

    expect(normalized).toEqual(expect.objectContaining({ token: '123456', segment: 'NFO', lotSize: 65 }));
  });

  it('fails closed when a symbol exists only as a placeholder', async () => {
    const service = new InstrumentService();
    const result = await service.resolveInstrument('NIFTY FUT', 'NFO');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'INSTRUMENT_NOT_FOUND',
    }));
  });
});
