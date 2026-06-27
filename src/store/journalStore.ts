import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

  addEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
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
    (set) => ({
      entries: [],
      alerts: [],

      addEntry: (entry) => set((s) => ({
        entries: [{ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...s.entries],
      })),

      updateEntry: (id, update) => set((s) => ({
        entries: s.entries.map((e) => e.id === id ? { ...e, ...update, updatedAt: new Date().toISOString() } : e),
      })),

      deleteEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      addAlert: (alert) => set((s) => ({
        alerts: [{ ...alert, id: crypto.randomUUID(), createdAt: new Date().toISOString(), triggered: false, active: true }, ...s.alerts],
      })),

      triggerAlert: (id) => set((s) => ({
        alerts: s.alerts.map((a) => a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString(), active: false } : a),
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
