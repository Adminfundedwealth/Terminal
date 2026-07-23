/**
 * ACCOUNT SELECTOR
 *
 * Multi-account switcher in the TopBar.
 * - Always visible (shows current account code + chevron)
 * - Opens a dropdown listing all accounts for the session user
 * - Calls /api/account/switch (server-side) so the session cookie flips
 * - Reconnects WebSocket after switching so live data targets the new account
 * - Emits a custom "fw:account-switched" event so TopBar can re-fetch risk/margin
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Zap, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { switchAccount, getAccounts } from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';
import { wsService } from '@/services/websocket';
import { cn } from '@/utils/helpers';
import type { AccountInfo } from '@/types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function accountLabel(acc: AccountInfo): string {
  return acc.accountCode || acc.clientId || acc.id || 'Account';
}

function phaseLabel(acc: AccountInfo): string {
  if (!acc.challenge) return '';
  const { type, plan } = acc.challenge;
  const phase =
    type === 'funded' ? 'Funded' :
    type === 'evaluation' ? 'Phase 1' :
    type === 'phase2' ? 'Phase 2' :
    type ?? '';
  return plan ? `${plan} · ${phase}` : phase;
}

function balanceLabel(acc: AccountInfo): string {
  const b = acc.balance ?? 0;
  if (b >= 10_000_000) return `₹${(b / 10_000_000).toFixed(1)}Cr`;
  if (b >= 100_000)    return `₹${(b / 100_000).toFixed(1)}L`;
  return `₹${b.toLocaleString('en-IN')}`;
}

const STATUS_STYLES: Record<string, string> = {
  active:   'text-emerald-400 bg-emerald-900/25 border-emerald-800/40',
  funded:   'text-sky-400    bg-sky-900/25    border-sky-800/40',
  breached: 'text-red-400    bg-red-900/25    border-red-800/40',
  expired:  'text-red-400    bg-red-900/25    border-red-800/40',
  pending:  'text-yellow-400 bg-yellow-900/25 border-yellow-800/40',
  inactive: 'text-zinc-400   bg-zinc-900/25   border-zinc-800/40',
};

function statusBadge(status?: string) {
  const key = (status ?? 'inactive').toLowerCase();
  return (
    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider', STATUS_STYLES[key] ?? STATUS_STYLES.inactive)}>
      {key}
    </span>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function AccountSelector() {
  const currentAccount  = useTradingStore((s) => s.account);
  const allAccounts     = useTradingStore((s) => s.accounts);
  const setAccount      = useTradingStore((s) => s.setAccount);
  const setAccounts     = useTradingStore((s) => s.setAccounts);
  const isSwitching     = useTradingStore((s) => s.isSwitching);
  const setIsSwitching  = useTradingStore((s) => s.setIsSwitching);
  const switchError     = useTradingStore((s) => s.switchError);
  const setSwitchError  = useTradingStore((s) => s.setSwitchError);

  const [isOpen, setIsOpen]         = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSwitchError(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [setSwitchError]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setIsOpen(false); setSwitchError(null); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setSwitchError]);

  // Re-fetch accounts list (user clicks refresh icon in dropdown header)
  const refreshAccounts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await getAccounts();
      if (data?.length) setAccounts(data);
    } catch { /* silently fail */ }
    finally { setIsRefreshing(false); }
  }, [setAccounts]);

  async function handleSwitch(accountId: string) {
    if (accountId === currentAccount?.id || isSwitching) return;

    setSwitchError(null);
    setIsSwitching(true);

    try {
      const { account } = await switchAccount(accountId);
      setAccount(account);
      localStorage.setItem('fw_last_account', accountId);

      // Reconnect WS so subscriptions go through the new session context
      wsService.disconnect();
      setTimeout(() => wsService.connect(), 300);

      // Tell TopBar (and any other listener) to re-fetch risk / margin
      window.dispatchEvent(new CustomEvent('fw:account-switched', { detail: { accountId } }));

      setIsOpen(false);
    } catch (err: any) {
      setSwitchError(err?.message || 'Switch failed. Please try again.');
    } finally {
      setIsSwitching(false);
    }
  }

  const accounts = allAccounts.length > 0 ? allAccounts : (currentAccount ? [currentAccount] : []);
  const hasMultiple = accounts.length > 1;

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      {/* ── Trigger button ── */}
      <button
        onClick={() => { setIsOpen((v) => !v); setSwitchError(null); }}
        disabled={isSwitching}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded transition-colors cursor-pointer hover:bg-fw-hover',
          isOpen && 'bg-fw-hover',
        )}
        title="Switch account"
      >
        {isSwitching ? (
          <Loader2 size={11} className="text-fw-accent animate-spin flex-shrink-0" />
        ) : (
          <span className="w-5 h-5 rounded-full bg-fw-accent/20 border border-fw-accent/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold text-fw-accent">
              {(accountLabel(currentAccount ?? {} as AccountInfo)[0] ?? 'A').toUpperCase()}
            </span>
          </span>
        )}

        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-semibold text-fw-text">
            {currentAccount ? accountLabel(currentAccount) : 'Select Account'}
          </span>
          {currentAccount?.challenge && (
            <span className="text-[10px] text-fw-accent/70 font-medium leading-tight">
              {phaseLabel(currentAccount)}
            </span>
          )}
        </div>

        {hasMultiple && (
          <ChevronDown
            size={11}
            className={cn('text-fw-text-muted transition-transform flex-shrink-0', isOpen && 'rotate-180')}
          />
        )}
      </button>

      {/* ── Dropdown ── */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-[300px] bg-[#0f1219] border border-fw-border rounded-xl shadow-2xl z-[200] overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border/60 bg-[#0c0e14]">
            <span className="text-[11px] font-bold text-fw-text-muted uppercase tracking-widest">
              Trading Accounts ({accounts.length})
            </span>
            <button
              onClick={refreshAccounts}
              disabled={isRefreshing}
              className="p-1 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors"
              title="Refresh accounts"
            >
              <RefreshCw size={11} className={cn(isRefreshing && 'animate-spin')} />
            </button>
          </div>

          {/* Error strip */}
          {switchError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border-b border-red-800/30">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
              <span className="text-[12px] text-red-300">{switchError}</span>
            </div>
          )}

          {/* Account list */}
          <div className="max-h-[340px] overflow-y-auto">
            {accounts.map((acc) => {
              const active = acc.id === currentAccount?.id;
              return (
                <button
                  key={acc.id ?? acc.accountCode}
                  onClick={() => handleSwitch(acc.id!)}
                  disabled={isSwitching || active}
                  className={cn(
                    'w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'bg-fw-accent/8 cursor-default'
                      : 'hover:bg-fw-hover cursor-pointer',
                    isSwitching && !active && 'opacity-50'
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-[13px] font-bold',
                    active ? 'bg-fw-accent/20 text-fw-accent border border-fw-accent/40' : 'bg-fw-surface text-fw-text-muted border border-fw-border'
                  )}>
                    {accountLabel(acc)[0]?.toUpperCase() ?? 'A'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-fw-text truncate">
                        {accountLabel(acc)}
                      </span>
                      {active && <Check size={11} className="text-fw-accent flex-shrink-0" />}
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {acc.challenge && (
                        <span className="flex items-center gap-0.5 text-[11px] text-fw-accent/80 font-medium">
                          <Zap size={9} />
                          {phaseLabel(acc)}
                        </span>
                      )}
                      {statusBadge(acc.status)}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="text-right flex-shrink-0">
                    <span className="text-[13px] font-mono font-semibold text-fw-text">
                      {balanceLabel(acc)}
                    </span>
                    {acc.totalPnl !== undefined && (
                      <div className={cn('text-[11px] font-mono', acc.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {acc.totalPnl >= 0 ? '+' : ''}{balanceLabel({ ...acc, balance: Math.abs(acc.totalPnl) })}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          {hasMultiple && (
            <div className="px-3 py-1.5 border-t border-fw-border/40 bg-[#0c0e14]">
              <p className="text-[11px] text-fw-text-muted/60">
                Switching reloads live data for the selected account.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
