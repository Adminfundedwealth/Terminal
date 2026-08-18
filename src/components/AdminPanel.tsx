/**
 * ADMIN PANEL — Account Freeze / Unfreeze / Force-Close
 *
 * Only rendered when the logged-in user is a founder (checked via JWT claims).
 * Accessible from the bottom panel "Admin" tab.
 *
 * Features:
 *  - Search accounts by email, name, or account code
 *  - Filter by status (all / active / locked / breached)
 *  - Freeze account with a mandatory reason
 *  - Unfreeze (restore trading) for locked or breached accounts
 *  - Force-close all open positions without going through the risk engine
 *  - View open positions and recent risk events per account
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, ShieldOff, Search, RefreshCw, X, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Crosshair, Clock, User, Activity, Settings,
} from 'lucide-react';
import {
  adminListAccounts, adminFreezeAccount, adminUnfreezeAccount,
  adminClosePositions, adminGetAccount,
  type AdminAccount, type AdminAccountDetail,
} from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import { useToast } from '@/components/ToastProvider';
import { useTradingStore } from '@/store/tradingStore';
import { AdminRiskManagement } from '@/components/AdminRiskManagement';

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    'bg-green-900/25 text-green-400 border-green-800/40',
    locked:    'bg-yellow-900/25 text-yellow-400 border-yellow-800/40',
    breached:  'bg-red-900/25 text-red-400 border-red-800/40',
    completed: 'bg-blue-900/25 text-blue-400 border-blue-800/40',
  };
  return (
    <span className={cn('px-1.5 py-0.5 text-[11px] font-bold uppercase rounded border', map[status] ?? 'bg-fw-bg text-fw-text-muted border-fw-border')}>
      {status}
    </span>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel, confirmClass, onConfirm, onCancel,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-fw-surface-2 border border-fw-border rounded-xl shadow-2xl p-5 w-[340px] mx-3 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-[14px] font-bold text-fw-text">{title}</div>
            <div className="text-[13px] text-fw-text-secondary mt-0.5">{message}</div>
          </div>
        </div>
        {children}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            onClick={onCancel}
            className="py-2 rounded-md text-[13px] font-bold bg-fw-bg border border-fw-border text-fw-text-secondary hover:text-fw-text"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn('py-2 rounded-md text-[13px] font-bold text-white', confirmClass ?? 'bg-fw-accent')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Account row (expandable) ─────────────────────────────────────────────────

function AccountRow({
  account,
  onFreezeRequest,
  onUnfreezeRequest,
  onClosePositionsRequest,
}: {
  account: AdminAccount;
  onFreezeRequest: (account: AdminAccount) => void;
  onUnfreezeRequest: (account: AdminAccount) => void;
  onClosePositionsRequest: (account: AdminAccount) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleExpand = async () => {
    setExpanded(v => !v);
    if (!expanded && !detail) {
      setLoadingDetail(true);
      try {
        const d = await adminGetAccount(account.id);
        setDetail(d as AdminAccountDetail);
      } catch {
        // ignore — basic info still shown
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const trader = detail?.trader ?? account.terminal_traders;
  const email = trader?.email ?? '—';
  const displayName = trader?.display_name ?? '—';

  return (
    <>
      <tr
        className={cn('group cursor-pointer hover:bg-fw-hover/20 transition-colors', expanded && 'bg-fw-hover/10')}
        onClick={handleExpand}
      >
        {/* Expand chevron */}
        <td className="w-6 pl-2 text-fw-text-muted">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </td>

        {/* Account code */}
        <td>
          <span className="font-mono text-[13px] font-semibold text-fw-text">{account.account_code}</span>
        </td>

        {/* Trader */}
        <td>
          <div className="text-[13px] text-fw-text font-medium truncate max-w-[140px]">{displayName}</div>
          <div className="text-[11px] text-fw-text-muted truncate max-w-[140px]">{email}</div>
        </td>

        {/* Balance */}
        <td className="font-mono text-[13px] tabular-nums text-fw-text-secondary">
          ₹{formatPrice(account.balance)}
        </td>

        {/* Status */}
        <td>
          <StatusBadge status={account.status} />
          {account.locked_reason && account.status === 'locked' && (
            <div className="text-[11px] text-yellow-400/70 mt-0.5 max-w-[160px] truncate" title={account.locked_reason}>
              {account.locked_reason}
            </div>
          )}
        </td>

        {/* Actions */}
        <td onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {(account.status === 'active') && (
              <button
                onClick={() => onFreezeRequest(account)}
                title="Freeze account — blocks all trading"
                className="flex items-center gap-1 px-2 py-1 text-[12px] font-bold rounded bg-yellow-900/20 border border-yellow-800/30 text-yellow-400 hover:bg-yellow-900/40 transition-colors"
              >
                <Shield size={11} /> Freeze
              </button>
            )}
            {(account.status === 'locked' || account.status === 'breached') && (
              <button
                onClick={() => onUnfreezeRequest(account)}
                title="Unfreeze account — restore trading"
                className="flex items-center gap-1 px-2 py-1 text-[12px] font-bold rounded bg-green-900/20 border border-green-800/30 text-green-400 hover:bg-green-900/40 transition-colors"
              >
                <ShieldOff size={11} /> Unfreeze
              </button>
            )}
            <button
              onClick={() => onClosePositionsRequest(account)}
              title="Force-close all open positions (bypasses risk engine)"
              className="flex items-center gap-1 px-2 py-1 text-[12px] font-bold rounded bg-red-900/20 border border-red-800/30 text-red-400 hover:bg-red-900/40 transition-colors"
            >
              <X size={11} /> Close All
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-fw-bg border-b border-fw-border/40 px-3 pb-3">
            {loadingDetail && (
              <div className="py-4 text-center text-[13px] text-fw-text-muted">Loading…</div>
            )}
            {!loadingDetail && detail && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                {/* Positions */}
                <div>
                  <div className="text-[12px] text-fw-text-muted uppercase font-bold mb-1.5 flex items-center gap-1">
                    <Crosshair size={11} /> Open Positions ({detail.positions?.length ?? 0})
                  </div>
                  {!detail.positions || detail.positions.length === 0 ? (
                    <div className="text-[12px] text-fw-text-muted italic">No open positions</div>
                  ) : (
                    <div className="space-y-1">
                      {detail.positions.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-[12px] bg-fw-bg rounded px-2 py-1 border border-fw-border/30">
                          <span className="font-semibold text-fw-text">{p.symbol}</span>
                          <span className={cn('font-bold', p.side === 'LONG' ? 'text-green' : 'text-red')}>{p.side}</span>
                          <span className="font-mono text-fw-text-secondary">{p.qty} × {p.product_type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Challenge + Account Info */}
                <div>
                  <div className="text-[12px] text-fw-text-muted uppercase font-bold mb-1.5 flex items-center gap-1">
                    <Activity size={11} /> Account Info
                  </div>
                  <div className="space-y-1 text-[12px]">
                    <div className="flex justify-between">
                      <span className="text-fw-text-muted">Broker</span>
                      <span className="font-mono text-fw-text">{detail.broker_provider}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fw-text-muted">Balance</span>
                      <span className="font-mono text-fw-text">₹{formatPrice(detail.balance)}</span>
                    </div>
                    {detail.challenge && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-fw-text-muted">Plan</span>
                          <span className="font-mono text-fw-text uppercase">{detail.challenge.plan}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fw-text-muted">Phase</span>
                          <span className="font-mono text-fw-text">{detail.challenge.type}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fw-text-muted">Daily Limit</span>
                          <span className="font-mono text-red-400">{detail.challenge.daily_loss_limit_pct}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fw-text-muted">Max DD</span>
                          <span className="font-mono text-orange-400">{detail.challenge.max_drawdown_pct}%</span>
                        </div>
                      </>
                    )}
                    {detail.locked_reason && (
                      <div className="mt-1 px-2 py-1.5 rounded bg-yellow-900/10 border border-yellow-800/30 text-yellow-400 text-[11px]">
                        Locked reason: {detail.locked_reason}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Account Management panel (inner) ─────────────────────────────────────────

function AccountManagementPanel() {
  const { showToast } = useToast();
  const account = useTradingStore(s => s.account);

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Dialogs
  const [freezeTarget, setFreezeTarget] = useState<AdminAccount | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [unfreezeTarget, setUnfreezeTarget] = useState<AdminAccount | null>(null);
  const [closeTarget, setCloseTarget] = useState<AdminAccount | null>(null);
  const [working, setWorking] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadAccounts = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await adminListAccounts({
        search: debouncedSearch,
        status: statusFilter,
        page,
        limit: pagination.limit,
      });
      setAccounts(res.accounts);
      setPagination({ ...pagination, ...res.pagination, page });
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Admin Error', message: err?.message ?? 'Failed to load accounts' });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, pagination.limit]);

  useEffect(() => { loadAccounts(1); }, [debouncedSearch, statusFilter]);

  // ── Freeze ──────────────────────────────────────────────────────────────────
  const handleFreeze = async () => {
    if (!freezeTarget || !freezeReason.trim()) return;
    setWorking(true);
    try {
      const res = await adminFreezeAccount(freezeTarget.id, freezeReason.trim());
      showToast({ type: 'warning', title: 'Account Frozen', message: res.message });
      setFreezeTarget(null);
      setFreezeReason('');
      await loadAccounts(pagination.page);
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Freeze Failed', message: err?.message ?? 'Could not freeze account' });
    } finally {
      setWorking(false);
    }
  };

  // ── Unfreeze ────────────────────────────────────────────────────────────────
  const handleUnfreeze = async () => {
    if (!unfreezeTarget) return;
    setWorking(true);
    try {
      const res = await adminUnfreezeAccount(unfreezeTarget.id);
      showToast({ type: 'success', title: 'Account Unfrozen', message: res.message });
      setUnfreezeTarget(null);
      await loadAccounts(pagination.page);
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Unfreeze Failed', message: err?.message ?? 'Could not unfreeze account' });
    } finally {
      setWorking(false);
    }
  };

  // ── Force-close positions ────────────────────────────────────────────────────
  const handleClosePositions = async () => {
    if (!closeTarget) return;
    setWorking(true);
    try {
      const res = await adminClosePositions(closeTarget.id);
      showToast({
        type: res.closed > 0 ? 'success' : 'warning',
        title: 'Positions Closed',
        message: res.message,
      });
      setCloseTarget(null);
      await loadAccounts(pagination.page);
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Close Failed', message: err?.message ?? 'Could not close positions' });
    } finally {
      setWorking(false);
    }
  };

  const statusCounts = {
    all: pagination.total,
    active: accounts.filter(a => a.status === 'active').length,
    locked: accounts.filter(a => a.status === 'locked').length,
    breached: accounts.filter(a => a.status === 'breached').length,
  };

  return (
    <div className="h-full flex flex-col bg-fw-bg relative">

      {/* Freeze Dialog */}
      {freezeTarget && (
        <ConfirmDialog
          title={`Freeze ${freezeTarget.account_code}?`}
          message="This will block all trading for this account immediately. Provide a reason."
          confirmLabel={working ? 'Freezing…' : 'Freeze Account'}
          confirmClass="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40"
          onConfirm={handleFreeze}
          onCancel={() => { setFreezeTarget(null); setFreezeReason(''); }}
        >
          <input
            autoFocus
            type="text"
            value={freezeReason}
            onChange={e => setFreezeReason(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && freezeReason.trim() && handleFreeze()}
            placeholder="Reason (required)"
            className="w-full bg-fw-bg border border-fw-border rounded px-2.5 py-1.5 text-[13px] text-fw-text outline-none focus:border-yellow-600"
          />
        </ConfirmDialog>
      )}

      {/* Unfreeze Dialog */}
      {unfreezeTarget && (
        <ConfirmDialog
          title={`Unfreeze ${unfreezeTarget.account_code}?`}
          message={`Current status: ${unfreezeTarget.status}. This will restore trading access immediately.`}
          confirmLabel={working ? 'Unfreezing…' : 'Restore Trading'}
          confirmClass="bg-green-700 hover:bg-green-600"
          onConfirm={handleUnfreeze}
          onCancel={() => setUnfreezeTarget(null)}
        />
      )}

      {/* Close Positions Dialog */}
      {closeTarget && (
        <ConfirmDialog
          title={`Force-close all positions for ${closeTarget.account_code}?`}
          message="All open positions will be closed directly in the database, bypassing the risk engine. This cannot be undone."
          confirmLabel={working ? 'Closing…' : 'Close All Positions'}
          confirmClass="bg-red-700 hover:bg-red-600"
          onConfirm={handleClosePositions}
          onCancel={() => setCloseTarget(null)}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border bg-fw-bg flex-shrink-0">
        <Shield size={14} className="text-red-400" />
        <span className="text-[13px] font-bold text-fw-text">Admin — Account Management</span>
        <div className="flex-1" />
        <span className="text-[11px] text-fw-text-muted">
          {pagination.total} account{pagination.total !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => loadAccounts(pagination.page)}
          className={cn('p-1.5 rounded hover:bg-fw-hover text-fw-text-secondary', loading && 'animate-spin')}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border/50 bg-fw-bg flex-shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fw-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search email, name, or code…"
            className="w-full bg-fw-bg border border-fw-border rounded pl-7 pr-2.5 py-1.5 text-[13px] text-fw-text outline-none focus:border-fw-accent placeholder:text-fw-text-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fw-text-muted hover:text-fw-text">
              <X size={10} />
            </button>
          )}
        </div>

        {/* Status filter pills */}
        {(['', 'active', 'locked', 'breached'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-2.5 py-1 text-[12px] font-bold rounded capitalize transition-colors',
              statusFilter === s
                ? s === '' ? 'bg-fw-accent text-white'
                  : s === 'locked' ? 'bg-yellow-700 text-white'
                  : s === 'breached' ? 'bg-red-700 text-white'
                  : 'bg-green-800 text-white'
                : 'text-fw-text-secondary bg-fw-bg border border-fw-border hover:border-fw-text-muted'
            )}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && accounts.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-fw-text-muted text-[13px]">
            Loading accounts…
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-fw-text-muted">
            <User size={24} className="opacity-30" />
            <span className="text-[13px]">No accounts found</span>
          </div>
        ) : (
          <table className="fw-table w-full">
            <thead>
              <tr>
                <th className="w-6" />
                <th>Account</th>
                <th>Trader</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <AccountRow
                  key={acc.id}
                  account={acc}
                  onFreezeRequest={setFreezeTarget}
                  onUnfreezeRequest={setUnfreezeTarget}
                  onClosePositionsRequest={setCloseTarget}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 border-t border-fw-border bg-fw-bg flex-shrink-0">
          <button
            disabled={pagination.page <= 1}
            onClick={() => loadAccounts(pagination.page - 1)}
            className="px-2 py-1 text-[12px] rounded bg-fw-bg border border-fw-border text-fw-text-secondary disabled:opacity-30 hover:not-disabled:bg-fw-hover"
          >
            ← Prev
          </button>
          <span className="text-[12px] text-fw-text-muted">
            Page {pagination.page} / {pagination.pages}
          </span>
          <button
            disabled={pagination.page >= pagination.pages}
            onClick={() => loadAccounts(pagination.page + 1)}
            className="px-2 py-1 text-[12px] rounded bg-fw-bg border border-fw-border text-fw-text-secondary disabled:opacity-30 hover:not-disabled:bg-fw-hover"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Top-level Admin Panel with section switcher ───────────────────────────────

type AdminSection = 'accounts' | 'risk';

export function AdminPanel() {
  const [section, setSection] = useState<AdminSection>('accounts');

  return (
    <div className="h-full flex flex-col">
      {/* Section switcher */}
      <div className="flex items-center gap-0 px-2 pt-2 pb-0 bg-fw-bg border-b border-fw-border flex-shrink-0">
        <button
          onClick={() => setSection('accounts')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-t border-b-2 transition-colors',
            section === 'accounts'
              ? 'text-fw-text border-fw-accent bg-fw-hover/20'
              : 'text-fw-text-muted border-transparent hover:text-fw-text hover:bg-fw-hover/10'
          )}
        >
          <Shield size={12} />
          Account Management
        </button>
        <button
          onClick={() => setSection('risk')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-t border-b-2 transition-colors',
            section === 'risk'
              ? 'text-orange-400 border-orange-500 bg-fw-hover/20'
              : 'text-fw-text-muted border-transparent hover:text-fw-text hover:bg-fw-hover/10'
          )}
        >
          <Settings size={12} />
          Risk Management
        </button>
      </div>

      {/* Section content — fills remaining height */}
      <div className="flex-1 min-h-0">
        {section === 'accounts' && <AccountManagementPanel />}
        {section === 'risk'     && <AdminRiskManagement />}
      </div>
    </div>
  );
}
