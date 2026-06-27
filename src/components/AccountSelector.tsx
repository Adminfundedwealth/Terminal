/**
 * ACCOUNT SELECTOR
 * 
 * Dropdown to switch between multiple trading accounts.
 * Only visible if user has more than 1 account.
 */

import { useState, useEffect, useRef } from 'react';
import { User, ChevronDown, Check, Zap } from 'lucide-react';
import { getAccounts, getAccountById } from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';
import type { AccountInfo } from '@/types';

export function AccountSelector() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const currentAccount = useTradingStore((s) => s.account);
  const setAccount = useTradingStore((s) => s.setAccount);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchAccounts() {
    try {
      const data = await getAccounts();
      if (data && data.length > 0) {
        setAccounts(data);
      }
    } catch {
      // Single account mode
    }
  }

  async function switchAccount(accountId: string) {
    if (accountId === currentAccount?.id) {
      setIsOpen(false);
      return;
    }
    setLoading(true);
    try {
      const account = await getAccountById(accountId);
      if (account) {
        setAccount(account);
        localStorage.setItem('fw_last_account', accountId);
      }
    } catch (err) {
      console.error('[AccountSelector] Switch failed:', err);
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  }

  // Don't show selector if only 1 account
  if (accounts.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded flex-shrink-0">
        <User size={12} className="text-fw-text-secondary" />
        <span className="text-[10px] text-fw-text-secondary font-medium">
          {currentAccount?.accountCode || 'FW-TERMINAL'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-fw-hover transition-colors"
      >
        <User size={12} className="text-fw-text-secondary" />
        <span className="text-[10px] text-fw-text-secondary font-medium">
          {currentAccount?.accountCode || 'Select Account'}
        </span>
        <ChevronDown size={9} className={cn('text-fw-text-muted transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-[260px] bg-fw-surface border border-fw-border rounded-lg shadow-xl z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-fw-border/50">
            <p className="text-[10px] font-bold text-fw-text-muted uppercase tracking-wider">Trading Accounts</p>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => switchAccount(acc.id!)}
                disabled={loading}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-fw-hover transition-colors text-left',
                  acc.id === currentAccount?.id && 'bg-fw-accent/5'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-fw-text">{acc.accountCode || acc.clientId}</span>
                    {acc.id === currentAccount?.id && <Check size={10} className="text-fw-accent" />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {acc.challenge && (
                      <span className="text-[9px] font-medium text-fw-accent flex items-center gap-0.5">
                        <Zap size={8} />
                        {acc.challenge.plan} • {acc.challenge.type === 'funded' ? 'Funded' : acc.challenge.type === 'evaluation' ? 'Phase 1' : acc.challenge.type}
                      </span>
                    )}
                    <span className={cn('text-[9px] font-mono', acc.status === 'active' ? 'text-emerald-400' : acc.status === 'breached' ? 'text-red-400' : 'text-yellow-400')}>
                      {acc.status?.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-mono text-fw-text-secondary">
                    ₹{((acc.balance || 0) / 100000).toFixed(1)}L
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
