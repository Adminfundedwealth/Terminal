/**
 * AUTH HOOK
 * 
 * Checks session validity on mount.
 * If no valid session → redirects to FundedWealth Dashboard.
 * If valid → stores account context in trading store.
 * 
 * Used in App.tsx to gate terminal access.
 */

import { useState, useEffect } from 'react';
import { getAccount } from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';

const DASHBOARD_URL = import.meta.env.VITE_FW_DASHBOARD_URL || 'https://fundedwealth.com';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });
  const { setAccount } = useTradingStore();

  useEffect(() => {
    const controller = new AbortController();
    checkAuth(controller.signal);
    return () => controller.abort();
  }, []);

  async function checkAuth(signal?: AbortSignal) {
    try {
      const account = await getAccount(signal);
      if (signal?.aborted) return;
      setAccount(account);
      setState({ isAuthenticated: true, isLoading: false, error: null });
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') return;
      const status = err?.status || err?.message;

      // Check if it's an auth error (401/403)
      if (
        status === 401 ||
        status === 403 ||
        err?.message?.includes('unauthorized') ||
        err?.message?.includes('session_expired') ||
        err?.message?.includes('invalid_token') ||
        err?.message?.includes('Authentication required')
      ) {
        // Redirect to dashboard
        setState({ isAuthenticated: false, isLoading: false, error: 'Session expired or invalid' });
        redirectToDashboard();
      } else {
        // Network error or server down — allow terminal to load (graceful degradation)
        setState({ isAuthenticated: true, isLoading: false, error: null });
      }
    }
  }

  function redirectToDashboard() {
    const currentUrl = encodeURIComponent(window.location.href);
    window.location.href = `${DASHBOARD_URL}/login?redirect=${currentUrl}`;
  }

  return state;
}

/**
 * Logout — revoke session and redirect to dashboard.
 */
export async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Ignore network errors on logout
  }
  const dashboardUrl = import.meta.env.VITE_FW_DASHBOARD_URL || 'https://fundedwealth.com';
  window.location.href = dashboardUrl;
}
