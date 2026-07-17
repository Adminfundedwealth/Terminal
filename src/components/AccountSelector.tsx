/**
 * ACCOUNT SELECTOR — Match-Trader style
 *
 * Opens a dropdown that immediately shows ALL active accounts.
 * Search bar filters the list — does not hide accounts by default.
 * Only active accounts are shown.
 */

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ChevronDown, Search, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useAccountSwitcher } from '@/hooks/useAccountSwitcher';
import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';
import type { AccountInfo } from '@/types';

function formatCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return val.toFixed(0);
}

function getPlanLabel(acc: AccountInfo): string {
  const t = (acc.challenge?.type || '').toLowerCase();
  if (t.includes('funded')) return 'Funded';
  if (t.includes('flash')) return 'Flash';
  if (t.includes('instant')) return 'Instant';
  if (t.includes('phase2') || t.includes('phase_2') || t.includes('evaluation_phase2')) return 'Phase 2';
  if (t.includes('1step') || t.includes('1-step')) return '1-Step';
  if (t.includes('2step') || t.includes('2-step')) return '2-Step';
  if (t.includes('phase1') || t.includes('phase_1') || t.includes('evaluation_phase1')) return 'Phase 1';
  if (acc.challenge?.plan) return acc.challenge.plan;
  return 'Challenge';
}

function getPlanColor(label: string): string {
  if (label === 'Funded') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (label === 'Flash') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  if (label === 'Instant') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (label === 'Phase 2') return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  return 'bg-fw-accent/20 text-fw-accent border-fw-accent/30';
}

function getDDPct(acc: AccountInfo): number {
  const bal = acc.balance || 0;
  const peak = acc.peakBalance || bal;
  const init = acc.challenge?.initialBalance || bal || 1;
  return init > 0 ? Math.max(0, ((peak - bal) / init) * 100) : 0;
}

function getProfitPct(acc: AccountInfo): number {
  const bal = acc.balance || 0;
  const init = acc.challenge?.initialBalance || bal || 1;
  return init > 0 ? ((bal - init) / init) * 100 : 0;
}

interface AccountRowProps {
  acc: AccountInfo;
  isActive: boolean;
  isFocused: boolean;
  isSwitching: boolean;
  onSelect: () => void;
}

function AccountRow({ acc, isActive, isFocused, isSwitching, onSelect }: AccountRowProps) {
  const planLabel = getPlanLabel(acc);
  const planColor = getPlanColor(planLabel);
  const ddPct = getDDPct(acc);
  const profitPct = getProfitPct(acc);

  return (
    <button
      onClick={onSelect}
      disabled={isSwitching && !isActive}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-white/5 last:border-0',
        isFocused ? 'bg-fw-accent/15' : isActive ? 'bg-fw-accent/8' : 'hover:bg-white/5',
        'disabled:cursor-not-allowed'
      )}
    >
      {/* Active indicator */}
      <div className="flex-shrink-0 w-2 h-2 rounded-full mt-0.5"
        style={{
          background: isActive ? '#10b981' : acc.status === 'active' ? '#10b981' : '#ef4444',
          boxShadow: isActive ? '0 0 6px #10b981' : undefined,
        }}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Line 1: code + plan badge + active check */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold font-mono text-white tracking-wide">
            {acc.accountCode || acc.clientId || '—'}
          </span>
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border', planColor)}>
            {planLabel}
          </span>
          {isActive && (
            <span className="ml-auto text-[9px] font-bold text-fw-accent flex items-center gap-1">
              <Check size={9} />
              ACTIVE
            </span>
          )}
        </div>

        {/* Line 2: balance + metrics */}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[11px] font-mono font-semibold text-fw-text-secondary">
            ₹{formatCompact(acc.balance || 0)}
          </span>
          {ddPct > 0.1 && (
            <span className="text-[9px] text-orange-400 flex items-center gap-0.5">
              <AlertTriangle size={8} />
              DD {ddPct.toFixed(1)}%
            </span>
          )}
          {Math.abs(profitPct) > 0.01 && (
            <span className={cn('text-[9px] font-mono', profitPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Right: switching spinner */}
      {isSwitching && isActive && (
        <Loader2 size={12} className="animate-spin text-fw-accent flex-shrink-0" />
      )}
    </button>
  );
}

export function AccountSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const currentAccount = useTradingStore((s) => s.account);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { accounts, isSwitching, switchAccount } = useAccountSwitcher();

  // Only active accounts
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  // Filter by search — empty search shows ALL
  const filtered = search.trim()
    ? activeAccounts.filter((a) => {
        const q = search.toLowerCase();
        return (
          a.accountCode?.toLowerCase().includes(q) ||
          a.clientId?.toLowerCase().includes(q) ||
          getPlanLabel(a).toLowerCase().includes(q)
        );
      })
    : activeAccounts;

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Focus search when dropdown opens, reset state
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setFocusedIdx(0);
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // Keep focused index in bounds when filter changes
  useEffect(() => {
    setFocusedIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { setIsOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = filtered[focusedIdx];
      if (t?.id) handleSelect(t.id);
    }
  }, [isOpen, filtered, focusedIdx]);

  const handleSelect = useCallback((accountId: string) => {
    setIsOpen(false);
    if (accountId !== currentAccount?.id) switchAccount(accountId);
  }, [currentAccount, switchAccount]);

  const planLabel = currentAccount ? getPlanLabel(currentAccount) : '';
  const planColor = getPlanColor(planLabel);

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef} onKeyDown={handleKeyDown}>

      {/* ── Trigger ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all select-none',
          isOpen
            ? 'bg-fw-accent/10 border-fw-accent/50 text-white'
            : 'bg-[#0e1018] border-fw-border hover:border-fw-accent/40 hover:bg-fw-hover text-fw-text-secondary hover:text-white'
        )}
        title="Switch Trading Account"
      >
        {/* Status dot */}
        <div className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          isSwitching ? 'bg-yellow-400 animate-pulse' :
          currentAccount?.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
        )} />

        <div className="flex flex-col leading-none items-start min-w-0">
          <span className="text-[9px] text-fw-text-muted font-semibold tracking-widest uppercase">
            Trading Account
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {isSwitching
              ? <Loader2 size={10} className="animate-spin text-fw-accent" />
              : null
            }
            <span className="text-[11px] font-bold font-mono text-white">
              {currentAccount?.accountCode || '—'}
            </span>
            {planLabel && (
              <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border', planColor)}>
                {planLabel}
              </span>
            )}
          </div>
        </div>

        <ChevronDown size={11} className={cn(
          'text-fw-text-muted flex-shrink-0 transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* ── Dropdown ── */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-[340px] bg-[#0c0e14] border border-fw-border/70 rounded-xl shadow-2xl z-[500] overflow-hidden flex flex-col"
          style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>

          {/* Header */}
          <div className="px-4 py-3 border-b border-white/8 bg-[#0e1018]">
            <p className="text-[10px] font-black text-fw-text-muted uppercase tracking-[0.18em] mb-2">
              Trading Accounts
            </p>
            {/* Search — only shown when there are multiple accounts */}
            {activeAccounts.length > 1 && (
              <div className="flex items-center gap-2 bg-[#090b10] border border-white/10 rounded-lg px-3 py-2">
                <Search size={11} className="text-fw-text-muted flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setFocusedIdx(0); }}
                  placeholder="Search accounts…"
                  className="flex-1 bg-transparent text-[11px] text-white placeholder:text-fw-text-muted outline-none"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-fw-text-muted hover:text-white text-[10px]">✕</button>
                )}
              </div>
            )}
          </div>

          {/* Account list — ALL accounts shown immediately */}
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[11px] text-fw-text-muted">
                  {activeAccounts.length === 0
                    ? 'No active accounts found'
                    : `No results for "${search}"`}
                </p>
              </div>
            ) : (
              filtered.map((acc, idx) => (
                <AccountRow
                  key={acc.id}
                  acc={acc}
                  isActive={acc.id === currentAccount?.id}
                  isFocused={idx === focusedIdx}
                  isSwitching={isSwitching && acc.id === currentAccount?.id}
                  onSelect={() => acc.id && handleSelect(acc.id)}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/5 bg-[#090b10] flex items-center justify-between">
            <span className="text-[9px] text-fw-text-muted">
              {activeAccounts.length} active account{activeAccounts.length !== 1 ? 's' : ''}
            </span>
            {activeAccounts.length > 1 && (
              <span className="text-[9px] text-fw-text-muted">
                ↑↓ navigate · Enter select · Esc close
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
