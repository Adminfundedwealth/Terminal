import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { saveJournalEntry, updateJournalEntry, deleteJournalEntry, getJournalEntries } from '@/services/api';

export interface JournalEntry {
  id: string;
  date: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  notes: string;
  emotion: 'confident' | 'neutral' | 'fearful' | 'greedy' | 'disciplined';
  rating: 1 | 2 | 3 | 4 | 5;
  pnl?: number;
  lessons?: string;
  mistakes?: string;
  tags?: string[];
  screenshotUrl?: string;
  tradePhase: 'before' | 'after' | 'during';
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
}

export type AlertNotifyMethod = 'popup' | 'sound' | 'toast';

export interface PriceAlert {
  id: string;
  symbol: string;
  token: string;
  condition: 'above' | 'below' | 'cross_above' | 'cross_below';
  price: number;
  triggered: boolean;
  triggeredAt?: string;
  createdAt: string;
  active: boolean;
  notifyVia: AlertNotifyMethod[];
  lastLtp?: number;
}

interface JournalState {
  entries: JournalEntry[];
  alerts: PriceAlert[];
  backendAvailable: boolean;
  _lastHydrated: number;

  addEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'synced'>) => void;
  updateEntry: (id: string, update: Partial<JournalEntry>) => void;
  deleteEntry: (id: string) => void;
  hydrateFromBackend: () => Promise<void>;

  addAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered' | 'active'>) => void;
  triggerAlert: (id: string) => void;
  deleteAlert: (id: string) => void;
  toggleAlert: (id: string) => void;
  updateAlertLtp: (id: string, ltp: number) => void;
}

export const useJournalStore = create<JournalState>()(
  persist(
    (set, get) => ({
      entries: [],
      alerts: [],
      backendAvailable: false,
      _lastHydrated: 0,

      hydrateFromBackend: async () => {
        try {
          const serverEntries: any[] = await getJournalEntries();
          if (!Array.isArray(serverEntries) || serverEntries.length === 0) {
            set({ backendAvailable: true, _lastHydrated: Date.now() });
            return;
          }

          const mapped: JournalEntry[] = serverEntries.map((e: any) => ({
            id: e.id,
            date: e.date || new Date(e.created_at || e.createdAt).toISOString().split('T')[0],
            symbol: e.symbol || '',
            side: e.side || 'BUY',
            notes: e.notes || e.content || '',
            emotion: e.emotion || 'neutral',
            rating: e.rating || 3,
            pnl: e.pnl !== undefined ? parseFloat(e.pnl) : undefined,
            lessons: e.lessons || '',
            mistakes: e.mistakes || '',
            tags: e.tags || [],
            screenshotUrl: e.screenshot_urls?.[0] || e.screenshotUrl || '',
            tradePhase: e.trade_phase || e.tradePhase || 'after',
            createdAt: e.created_at || e.createdAt || new Date().toISOString(),
            updatedAt: e.updated_at || e.updatedAt || new Date().toISOString(),
            synced: true,
          }));

          const { entries: localEntries } = get();
          const unsyncedLocal = localEntries.filter(e => !e.synced);
          const serverIds = new Set(mapped.map(e => e.id));
          const mergedLocal = unsyncedLocal.filter(e => !serverIds.has(e.id));

          const merged = [...mapped, ...mergedLocal].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          set({ entries: merged, backendAvailable: true, _lastHydrated: Date.now() });
        } catch {
          // Backend unavailable — keep local entries as-is
        }
      },

      addEntry: (entry) => {
        const newEntry: JournalEntry = {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          synced: false,
        };
        set((s) => ({ entries: [newEntry, ...s.entries] }));

        saveJournalEntry({
          symbol: newEntry.symbol,
          side: newEntry.side,
          date: newEntry.date,
          pnl: newEntry.pnl,
          emotion: newEntry.emotion,
          rating: newEntry.rating,
          tradePhase: newEntry.tradePhase,
          notes: newEntry.notes,
          lessons: newEntry.lessons,
          mistakes: newEntry.mistakes,
          tags: newEntry.tags,
          screenshotUrls: newEntry.screenshotUrl ? [newEntry.screenshotUrl] : [],
        }).then((saved: any) => {
          const serverId = saved?.id || saved?.data?.id;
          set((s) => ({
            entries: s.entries.map((e) =>
              e.id === newEntry.id ? { ...e, id: serverId || e.id, synced: true } : e
            ),
            backendAvailable: true,
          }));
        }).catch(() => {});
      },

      updateEntry: (id, update) => {
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, ...update, updatedAt: new Date().toISOString(), synced: false } : e
          ),
        }));
        updateJournalEntry(id, update).then(() => {
          set((s) => ({
            entries: s.entries.map((e) => e.id === id ? { ...e, synced: true } : e),
            backendAvailable: true,
          }));
        }).catch(() => {});
      },

      deleteEntry: (id) => {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
        deleteJournalEntry(id).then(() => {
          set({ backendAvailable: true });
        }).catch(() => {});
      },

      addAlert: (alert) => set((s) => ({
        alerts: [{
          ...alert,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          triggered: false,
          active: true,
        }, ...s.alerts],
      })),

      triggerAlert: (id) => set((s) => ({
        alerts: s.alerts.map((a) =>
          a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString(), active: false } : a
        ),
      })),

      deleteAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

      toggleAlert: (id) => set((s) => ({
        alerts: s.alerts.map((a) => a.id === id ? { ...a, active: !a.active } : a),
      })),

      updateAlertLtp: (id, ltp) => set((s) => ({
        alerts: s.alerts.map((a) => a.id === id ? { ...a, lastLtp: ltp } : a),
      })),
    }),
    { name: 'fw-journal-v2' }
  )
);
