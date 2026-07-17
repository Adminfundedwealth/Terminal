/**
 * ACCOUNT SWITCHER HOOK
 *
 * Manages multi-account switching without page reload or re-auth.
 *
 * On mount:
 *   1. Loads all active accounts for the user.
 *   2. Reads ?account=FW-XXXXXXXXXX or ?accountId=<uuid> from URL.
 *   3. Falls back to localStorage 'fw_last_account' (persists across refreshes).
 *   4. Auto-selects the SSO-launched account (already set by useAuth).
 *
 * On switch:
 *   1. POST /api/account/switch  — server overrides accountId for all subsequent requests.
 *   2. Updates tradingStore.account with full account data.
 *   3. Clears positions / orders / trades (no stale data).
 *   4. Updates URL param + localStorage.
 *   5. Triggers BottomPanel + TopBar + RiskWidget refresh via store change.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const { account, setAccount, setPositions, setOrders, setTrades } = useTradingStore();
  const didAutoSelect = useRef(false);

  const refreshAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      if (data && data.length > 0) setAccounts(data);
    } catch {
      // Silently fail — single-account mode
    }
  }, []);

  // Load accounts on mount
  useEffect(() => {
    (async () => {
      setIsLoadingAccounts(true);
      await refreshAccounts();
      setIsLoadingAccounts(false);
    })();
  }, [refreshAccounts]);

  // Auto-select from URL params or localStorage, once accounts + current account are known
  useEffect(() => {
    if (didAutoSelect.current || !account || accounts.length === 0) return;
    didAutoSelect.current = true;

    // 1. Check URL: ?account=FW-XXXXXXXX or ?accountId=<uuid>
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('account');
    const urlId = params.get('accountId');

    let targetId: string | null = null;

    if (urlCode) {
      const match = accounts.find(
        (a) => a.accountCode?.toLowerCase() === urlCode.toLowerCase()
      );
      if (match) targetId = match.id ?? null;
    }

    if (!targetId && urlId) {
      const match = accounts.find((a) => a.id === urlId);
      if (match) targetId = match.id ?? null;
    }

    // 2. Fall back to localStorage
    if (!targetId) {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const match = accounts.find((a) => a.id === stored || a.accountCode === stored);
        if (match && match.id !== account.id) targetId = match.id ?? null;
      }
    }

    // 3. If a different account should be active, switch now
    if (targetId && targetId !== account.id) {
      switchAccount(targetId);
    }
  }, [account, accounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (isSwitching) return;
    if (accountId === account?.id) return;

    setIsSwitching(true);
    setSwitchError(null);

    // Immediately clear stale data — UI shows empty state while loading
    setPositions([]);
    setOrders([]);
    setTrades([]);

    try {
      // Server-side switch — validates ownership + sets session override
      const result = await apiSwitchAccount(accountId);

      if (!result.success || !result.account) {
        throw new Error('Switch failed — account not found or not owned by you.');
      }

      // Update active account in store — triggers all subscribed components
      setAccount(result.account);

      // Persist selection
      localStorage.setItem(LS_KEY, accountId);

      // Update URL param (no page reload)
      const params = new URLSearchParams(window.location.search);
      params.set('account', result.account.accountCode || accountId);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);

      // Load fresh data for the new account
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
      console.error('[AccountSwitcher] switch error:', err);
    } finally {
      setIsSwitching(false);
    }
  }, [isSwitching, account, setAccount, setPositions, setOrders, setTrades]);

  return {
    accounts,
    isSwitching,
    isLoadingAccounts,
    switchError,
    switchAccount,
    refreshAccounts,
  };
}
