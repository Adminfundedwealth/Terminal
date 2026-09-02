import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getJournalEntries: vi.fn(),
  saveJournalEntry: vi.fn(),
  updateJournalEntry: vi.fn(),
  deleteJournalEntry: vi.fn(),
}));

vi.mock('@/services/api', () => api);

import { useJournalStore } from '@/store/journalStore';

const entry = {
  date: '2026-09-03',
  symbol: 'NIFTY',
  side: 'BUY' as const,
  notes: 'Breakout followed through',
  emotion: 'disciplined' as const,
  rating: 4 as const,
  pnl: 1250,
  lessons: 'Wait for confirmation',
  mistakes: '',
  tags: ['breakout'],
  screenshotUrl: '',
  tradePhase: 'after' as const,
  tradingAccountId: 'account-1',
  executionId: 'trade-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  useJournalStore.setState({ entries: [], backendAvailable: false, _lastHydrated: 0 });
});

describe('P1.6 journal persistence', () => {
  it('creates once with a stable client id and marks the saved entry synced', async () => {
    api.saveJournalEntry.mockImplementation(async (payload) => ({ id: payload.id, ...payload }));
    await useJournalStore.getState().addEntry(entry);
    const payload = api.saveJournalEntry.mock.calls[0][0];
    expect(payload.id).toBeTruthy();
    expect(payload.tradingAccountId).toBe('account-1');
    expect(useJournalStore.getState().entries[0]).toMatchObject({ id: payload.id, synced: true, pnl: 1250 });
  });

  it('restores database entries with account and trade associations', async () => {
    api.getJournalEntries.mockResolvedValue([{ id: 'server-1', entry_date: '2026-09-03', symbol: 'NIFTY', side: 'BUY', notes: 'Saved', trading_account_id: 'account-1', execution_id: 'trade-1', tags: ['breakout'] }]);
    await useJournalStore.getState().hydrateFromBackend();
    expect(useJournalStore.getState().entries[0]).toMatchObject({ id: 'server-1', notes: 'Saved', tradingAccountId: 'account-1', executionId: 'trade-1', synced: true });
  });

  it('persists edits and rolls back the local edit when persistence fails', async () => {
    useJournalStore.setState({ entries: [{ id: 'server-2', ...entry, createdAt: '2026-09-03T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z', synced: true }] });
    api.updateJournalEntry.mockResolvedValue({ id: 'server-2' });
    await useJournalStore.getState().updateEntry('server-2', { notes: 'Edited' });
    expect(api.updateJournalEntry).toHaveBeenCalledWith('server-2', { notes: 'Edited' });
    expect(useJournalStore.getState().entries[0]).toMatchObject({ notes: 'Edited', synced: true });

    api.updateJournalEntry.mockRejectedValue(new Error('write failed'));
    await expect(useJournalStore.getState().updateEntry('server-2', { notes: 'Broken edit' })).rejects.toThrow('write failed');
    expect(useJournalStore.getState().entries[0].notes).toBe('Edited');
  });

  it('deletes only after durable deletion and restores local state on failure', async () => {
    useJournalStore.setState({ entries: [
      { id: 'server-3', ...entry, createdAt: '', updatedAt: '', synced: true },
      { id: 'server-4', ...entry, symbol: 'BANKNIFTY', createdAt: '', updatedAt: '', synced: true },
    ] });
    api.deleteJournalEntry.mockResolvedValue({ status: 'deleted' });
    await useJournalStore.getState().deleteEntry('server-3');
    expect(useJournalStore.getState().entries.map((item) => item.id)).toEqual(['server-4']);

    api.deleteJournalEntry.mockRejectedValue(new Error('delete failed'));
    await expect(useJournalStore.getState().deleteEntry('server-4')).rejects.toThrow('delete failed');
    expect(useJournalStore.getState().entries.map((item) => item.id)).toEqual(['server-4']);
  });

  it('does not fake success when create persistence fails', async () => {
    api.saveJournalEntry.mockRejectedValue(new Error('offline'));
    await expect(useJournalStore.getState().addEntry(entry)).rejects.toThrow('offline');
    expect(useJournalStore.getState().entries).toEqual([]);
    expect(useJournalStore.getState().backendAvailable).toBe(false);
  });

  it('assigns a client id per create so request retries can be idempotent', async () => {
    api.saveJournalEntry.mockImplementation(async (payload) => ({ id: payload.id }));
    await useJournalStore.getState().addEntry(entry);
    const firstId = api.saveJournalEntry.mock.calls[0][0].id;
    await useJournalStore.getState().addEntry({ ...entry });
    expect(api.saveJournalEntry.mock.calls[1][0].id).not.toBe(firstId);
    expect(new Set(useJournalStore.getState().entries.map((item) => item.id)).size).toBe(2);
  });
});
