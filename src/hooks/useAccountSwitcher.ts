/**
 * ACCOUNT SWITCHER HOOK
 *
 * Singleton pattern — state lives in tradingStore so all consumers
 * share the same accounts list regardless of how many components call this hook.
 */

import { useEffect, useCallback, useRef } from 'react';
import { getAccounts, switchAccount as apiSwitchAccount, getPositions, getOrders, getTrades } from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';
import type { AccountInfo } from '@/types';

const LS_KEY = 'fw_last_account';

export interface AccountSwitcherState {
  accounts: AccountInfo[];
  isSwitching: boolean;
  isLoadingAccounts: boolean;
  switchError: string | null;
  switchAccount: (accountId: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
}

export function useAccountSwitcher(): AccountSwitcherState {
  // All state lives in tradingStore — shared across every call site
  const {
    account,
    accounts,
    isSwitching,
    isLoadingAccounts,
    switchError,
    setAccount,
    setAccounts,
    setIsSwitching,
    setIsLoadingAccounts,
    setSwitchError,
    setPositions,
    setOrders,
    setTrades,
  } = useTradingStore();

  const didAutoSelect = useRef(false);
  const didFetch = useRef(false);

  const refreshAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      if (data && data.length > 0) setAccounts(data);
    } catch {
      // single-account mode — ignore
    }
  }, [setAccounts]);

  // Fetch accounts once per session
  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;
    setIsLoadingAccounts(true);
    refreshAccounts().finally(() => setIsLoadingAccounts(false));
  }, [refreshAccounts, setIsLoadingAccounts]);

  // Auto-select from URL / localStorage once
  useEffect(() => {
    if (didAutoSelect.current || !account || accounts.length === 0) return;
    didAutoSelect.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('account');
    const urlId = params.get('accountId');

    let targetId: string | null = null;

    if (urlCode) {
      const m = accounts.find((a) => a.accountCode?.toLowerCase() === urlCode.toLowerCase());
      if (m) targetId = m.id ?? null;
    }
    if (!targetId && urlId) {
      const m = accounts.find((a) => a.id === urlId);
      if (m) targetId = m.id ?? null;
    }
    if (!targetId) {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const m = accounts.find((a) => a.id === stored || a.accountCode === stored);
        if (m && m.id !== account.id) targetId = m.id ?? null;
      }
    }

    if (targetId && targetId !== account.id) switchAccount(targetId);
  }, [account, accounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (isSwitching || accountId === account?.id) return;

    setIsSwitching(true);
    setSwitchError(null);
    setPositions([]);
    setOrders([]);
    setTrades([]);

    try {
      const result = await apiSwitchAccount(accountId);
      if (!result.success || !result.account) throw new Error('Switch failed.');

      setAccount(result.account);
      localStorage.setItem(LS_KEY, accountId);

      const params = new URLSearchParams(window.location.search);
      params.set('account', result.account.accountCode || accountId);
      window.history.replaceState({}, '', `${window.location.pathname}?${params}`);

      const [pos, ord, trd] = await Promise.all([
        getPositions().catch(() => []),
        getOrders().catch(() => []),
        getTrades().catch(() => []),
      ]);
      setPositions(pos);
      setOrders(ord);
      setTrades(trd);
    } catch (err: any) {
      setSwitchError(err?.message || 'Failed to switch account.');
    } finally {
      setIsSwitching(false);
    }
  }, [isSwitching, account, setAccount, setPositions, setOrders, setTrades, setIsSwitching, setSwitchError]);

  return { accounts, isSwitching, isLoadingAccounts: isLoadingAccounts ?? false, switchError: switchError ?? null, switchAccount, refreshAccounts };
}
