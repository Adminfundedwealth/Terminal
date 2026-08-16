/**
 * WATCHLIST SYNC HOOK
 *
 * Synchronizes watchlists between backend and local storage.
 * Backend is source of truth, localStorage is fallback.
 * On first load: fetch from backend. If empty, seed all 6 default lists.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { apiService } from '@/services/api';

const defaultWatchlists = [
  {
    id: 'index', name: 'INDEX', color: '#2962ff',
    items: [
      { token: '99926000', symbol: 'NIFTY 50', segment: 'NSE' },
      { token: '99926009', symbol: 'BANKNIFTY', segment: 'NSE' },
      { token: '99926037', symbol: 'FINNIFTY', segment: 'NSE' },
      { token: '99926074', symbol: 'MIDCPNIFTY', segment: 'NSE' },
      { token: '99919000', symbol: 'SENSEX', segment: 'BSE' },
    ],
  },
  {
    id: 'stocks', name: 'STOCKS', color: '#26a69a',
    items: [
      { token: '2885', symbol: 'RELIANCE', segment: 'NSE' },
      { token: '1333', symbol: 'HDFCBANK', segment: 'NSE' },
      { token: '4963', symbol: 'ICICIBANK', segment: 'NSE' },
      { token: '3045', symbol: 'SBIN', segment: 'NSE' },
      { token: '11536', symbol: 'TCS', segment: 'NSE' },
      { token: '1594', symbol: 'INFY', segment: 'NSE' },
      { token: '11630', symbol: 'ITC', segment: 'NSE' },
      { token: '5258', symbol: 'LT', segment: 'NSE' },
      { token: '317', symbol: 'AXISBANK', segment: 'NSE' },
    ],
  },
  {
    id: 'futures', name: 'FUTURES', color: '#ff9800',
    items: [
      { token: '26000', symbol: 'NIFTY FUT', segment: 'NFO' },
      { token: '26009', symbol: 'BANKNIFTY FUT', segment: 'NFO' },
      { token: '2885', symbol: 'RELIANCE FUT', segment: 'NFO' },
      { token: '1333', symbol: 'HDFCBANK FUT', segment: 'NFO' },
      { token: '3045', symbol: 'SBIN FUT', segment: 'NFO' },
    ],
  },
  {
    id: 'options', name: 'OPTIONS', color: '#ab47bc',
    items: [
      { token: '99926000', symbol: 'NIFTY', segment: 'NSE' },
      { token: '99926009', symbol: 'BANKNIFTY', segment: 'NSE' },
      { token: '99926037', symbol: 'FINNIFTY', segment: 'NSE' },
    ],
  },
  {
    id: 'etf', name: 'ETF', color: '#10b981',
    items: [
      { token: '2150',  symbol: 'NIFTYBEES',  segment: 'NSE' },
      { token: '15068', symbol: 'BANKBEES',   segment: 'NSE' },
      { token: '13751', symbol: 'JUNIORBEES', segment: 'NSE' },
      { token: '1660',  symbol: 'GOLDBEES',   segment: 'NSE' },
      { token: '22536', symbol: 'SILVERBEES', segment: 'NSE' },
      { token: '14428', symbol: 'ITBEES',     segment: 'NSE' },
      { token: '14423', symbol: 'PHARMABEES', segment: 'NSE' },
    ],
  },
  {
    id: 'mcx', name: 'MCX', color: '#f59e0b',
    items: [
      { token: '429604', symbol: 'GOLD', segment: 'MCX' },
      { token: '429638', symbol: 'SILVER', segment: 'MCX' },
      { token: '425475', symbol: 'CRUDEOIL', segment: 'MCX' },
      { token: '431765', symbol: 'NATURALGAS', segment: 'MCX' },
      { token: '430596', symbol: 'COPPER', segment: 'MCX' },
    ],
  },
  {
    id: 'cds', name: 'CDS', color: '#06b6d4',
    items: [
      { token: '11091', symbol: 'USDINR', segment: 'CDS' },
      { token: '11363', symbol: 'EURINR', segment: 'CDS' },
      { token: '11096', symbol: 'GBPINR', segment: 'CDS' },
      { token: '11098', symbol: 'JPYINR', segment: 'CDS' },
    ],
  },
];

export function useWatchlistSync() {
  const { setWatchlists } = useAppStore();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    loadWatchlistsFromBackend();
  }, []);

  async function loadWatchlistsFromBackend() {
    try {
      const data = await apiService.get<any[]>('/watchlists');
      if (data && data.length > 0) {
        // Backend has data — use it as source of truth
        // But fill any empty category watchlists with defaults
        const merged = data.map((wl: any) => {
          if (wl.items && wl.items.length > 0) return wl;
          // This watchlist has no items — check if we have defaults for it
          const matchingDefault = defaultWatchlists.find(
            d => d.name.toLowerCase() === (wl.name || '').toLowerCase()
          );
          if (matchingDefault) {
            return { ...wl, items: matchingDefault.items };
          }
          return wl;
        });
        setWatchlists(merged);
      } else {
        // Backend empty — seed all default watchlists
        await seedDefaultWatchlists();
      }
    } catch (err) {
      // Backend unavailable — keep current localStorage watchlists
      console.warn('[WatchlistSync] Failed to load from backend, using local:', err);
    }
  }

  async function seedDefaultWatchlists() {
    try {
      const created: any[] = [];
      for (const wl of defaultWatchlists) {
        try {
          const result = await apiService.post('/watchlists', {
            name: wl.name,
            color: wl.color,
            items: wl.items,
          });
          created.push(result);
        } catch (err) {
          console.warn(`[WatchlistSync] Failed to seed ${wl.name}:`, err);
        }
      }
      if (created.length > 0) {
        setWatchlists(created);
      }
    } catch (err) {
      console.warn('[WatchlistSync] Failed to seed defaults:', err);
    }
  }
}
