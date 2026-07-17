import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { saveJournalEntry, updateJournalEntry, deleteJournalEntry } from '@/services/api';

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
  /** true when this entry has been successfully persisted to the backend */
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
  /** true when backend sync is available (set after first successful API call) */
  backendAvailable: boolean;

  addEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'synced'>) => void;
  updateEntry: (id: string, update: Partial<JournalEntry>) => void;
  deleteEntry: (id: string) => void;

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

      addEntry: (entry) => {
        const newEntry: JournalEntry = {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          synced: false,
        };
        // Optimistic local update first
        set((s) => ({ entries: [newEntry, ...s.entries] }));

        // Fire-and-forget backend sync — mark synced on success
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
        }).then(() => {
          set((s) => ({
            entries: s.entries.map((e) => e.id === newEntry.id ? { ...e, synced: true } : e),
            backendAvailable: true,
          }));
        }).catch(() => {
          // Backend unavailable — entry stays in localStorage with synced: false
        });
      },

      updateEntry: (id, update) => {
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, ...update, updatedAt: new Date().toISOString(), synced: false } : e
          ),
        }));
        // Sync to backend
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
        alerts: [
          {
            ...alert,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            triggered: false,
            active: true,
          },
          ...s.alerts,
        ],
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
