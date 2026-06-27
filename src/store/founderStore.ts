import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiService } from '@/services/api';

/**
 * FOUNDER STORE — Multi-Account Management
 * 
 * Manages master-slave trading relationships, account grouping,
 * copy mode configuration, and portfolio exposure aggregation.
 * 
 * BACKEND STATUS: No dedicated multi-account backend routes exist.
 * State is persisted locally. Copy execution calls /api/orders/* for each slave.
 * For full server-side replication, implement /api/founder/* routes.
 */

export type CopyMode = 'mirror' | 'proportional' | 'fixed-lot';

export interface SlaveAccount {
  accountId: string;
  name: string;
  copyRatio: number;       // For proportional mode
  fixedLots: number;       // For fixed-lot mode
  enabled: boolean;
  lastSyncStatus: 'ok' | 'error' | 'pending' | 'idle';
  lastSyncMessage?: string;
}

export interface MasterSlaveConfig {
  masterAccountId: string | null;
  slaves: SlaveAccount[];
  copyMode: CopyMode;
  isActive: boolean;
}

export interface AccountExposure {
  accountId: string;
  accountName: string;
  totalPositions: number;
  netExposure: number;
  totalMtm: number;
  marginUsed: number;
}

interface FounderState {
  // Master-Slave Config
  config: MasterSlaveConfig;
  
  // Exposure View
  exposures: AccountExposure[];
  exposureLoading: boolean;
  
  // Actions
  setMasterAccount: (accountId: string) => void;
  clearMasterAccount: () => void;
  addSlaveAccount: (slave: Omit<SlaveAccount, 'lastSyncStatus'>) => void;
  removeSlaveAccount: (accountId: string) => void;
  updateSlaveAccount: (accountId: string, updates: Partial<SlaveAccount>) => void;
  setCopyMode: (mode: CopyMode) => void;
  toggleActive: () => void;
  toggleSlaveEnabled: (accountId: string) => void;
  
  // Exposure
  refreshExposures: () => Promise<void>;
  
  // Copy Execution
  replicateOrder: (order: { symbol: string; token: string; segment: string; side: string; qty: number; orderType: string; price?: number }) => Promise<{ successes: string[]; failures: { accountId: string; reason: string }[] }>;
}

export const useFounderStore = create<FounderState>()(
  persist(
    (set, get) => ({
      config: {
        masterAccountId: null,
        slaves: [],
        copyMode: 'proportional',
        isActive: false,
      },
      exposures: [],
      exposureLoading: false,

      setMasterAccount: (accountId) => set((s) => ({
        config: { ...s.config, masterAccountId: accountId },
      })),

      clearMasterAccount: () => set((s) => ({
        config: { ...s.config, masterAccountId: null },
      })),

      addSlaveAccount: (slave) => set((s) => ({
        config: {
          ...s.config,
          slaves: [...s.config.slaves.filter(sl => sl.accountId !== slave.accountId), { ...slave, lastSyncStatus: 'idle' }],
        },
      })),

      removeSlaveAccount: (accountId) => set((s) => ({
        config: {
          ...s.config,
          slaves: s.config.slaves.filter(sl => sl.accountId !== accountId),
        },
      })),

      updateSlaveAccount: (accountId, updates) => set((s) => ({
        config: {
          ...s.config,
          slaves: s.config.slaves.map(sl => sl.accountId === accountId ? { ...sl, ...updates } : sl),
        },
      })),

      setCopyMode: (mode) => set((s) => ({
        config: { ...s.config, copyMode: mode },
      })),

      toggleActive: () => set((s) => ({
        config: { ...s.config, isActive: !s.config.isActive },
      })),

      toggleSlaveEnabled: (accountId) => set((s) => ({
        config: {
          ...s.config,
          slaves: s.config.slaves.map(sl =>
            sl.accountId === accountId ? { ...sl, enabled: !sl.enabled } : sl
          ),
        },
      })),

      refreshExposures: async () => {
        set({ exposureLoading: true });
        try {
          // Attempt to fetch from backend — if not available, compute from local state
          const res = await apiService.get<AccountExposure[]>('/founder/exposures').catch(() => null);
          if (res) {
            set({ exposures: res, exposureLoading: false });
          } else {
            // No backend endpoint — exposures remain local
            set({ exposureLoading: false });
          }
        } catch {
          set({ exposureLoading: false });
        }
      },

      replicateOrder: async (order) => {
        const { config } = get();
        if (!config.isActive || !config.masterAccountId) {
          return { successes: [], failures: [] };
        }

        const enabledSlaves = config.slaves.filter(sl => sl.enabled);
        const successes: string[] = [];
        const failures: { accountId: string; reason: string }[] = [];

        for (const slave of enabledSlaves) {
          try {
            let slaveQty: number;
            switch (config.copyMode) {
              case 'mirror':
                slaveQty = order.qty;
                break;
              case 'proportional':
                slaveQty = Math.floor(order.qty * slave.copyRatio);
                break;
              case 'fixed-lot':
                slaveQty = slave.fixedLots;
                break;
              default:
                slaveQty = order.qty;
            }

            // Skip if qty rounds to 0
            if (slaveQty <= 0) {
              failures.push({ accountId: slave.accountId, reason: 'Qty rounds to 0 — copy ratio too small for instrument lot size' });
              set((s) => ({
                config: {
                  ...s.config,
                  slaves: s.config.slaves.map(sl => sl.accountId === slave.accountId ? { ...sl, lastSyncStatus: 'error', lastSyncMessage: 'Qty rounds to 0' } : sl),
                },
              }));
              continue;
            }

            // Place order for slave account
            await apiService.post('/orders', {
              ...order,
              qty: slaveQty,
              accountId: slave.accountId,
            });

            successes.push(slave.accountId);
            set((s) => ({
              config: {
                ...s.config,
                slaves: s.config.slaves.map(sl => sl.accountId === slave.accountId ? { ...sl, lastSyncStatus: 'ok', lastSyncMessage: `Placed ${slaveQty} qty` } : sl),
              },
            }));
          } catch (err: any) {
            failures.push({ accountId: slave.accountId, reason: err.message || 'Unknown error' });
            set((s) => ({
              config: {
                ...s.config,
                slaves: s.config.slaves.map(sl => sl.accountId === slave.accountId ? { ...sl, lastSyncStatus: 'error', lastSyncMessage: err.message } : sl),
              },
            }));
          }
        }

        return { successes, failures };
      },
    }),
    {
      name: 'fw-founder-v1',
      partialize: (state) => ({ config: state.config }),
    }
  )
);
