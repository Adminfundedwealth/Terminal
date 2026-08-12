/**
 * PROFILE PANEL
 * 
 * Displays user info, account details, and challenge status.
 * Opens as a modal overlay.
 */

import { X, User, Shield, TrendingUp, LogOut, Copy, CheckCircle } from 'lucide-react';
import { useTradingStore } from '@/store/tradingStore';
import { logout } from '@/hooks/useAuth';
import { cn, getChallengeRulePct, formatChallengePhase } from '@/utils/helpers';
import { useState } from 'react';

interface ProfilePanelProps {
  onClose: () => void;
}

function formatCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${(val / 100000).toFixed(2)} L`;
  if (abs >= 1000) return `${(val / 1000).toFixed(1)} K`;
  return val.toFixed(0);
}

export function ProfilePanel({ onClose }: ProfilePanelProps) {
  const account = useTradingStore((s) => s.account);
  const [copied, setCopied] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const copyCode = () => {
    if (account?.accountCode) {
      navigator.clipboard.writeText(account.accountCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };


  const phase = formatChallengePhase(account?.challenge?.plan, account?.challenge?.type);

  const phaseColor =
    phase === 'Funded' ? 'text-emerald-400 bg-emerald-900/20 border-emerald-800/30' :
    phase === 'Phase 2' ? 'text-blue-400 bg-blue-900/20 border-blue-800/30' :
    'text-fw-accent bg-fw-accent/10 border-fw-accent/20';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12141f] border border-fw-border rounded-xl shadow-2xl w-[400px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-fw-border/60">
          <h2 className="text-[14px] font-black text-fw-text">Profile</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* User Identity */}
        <div className="px-5 py-5 flex items-center gap-4 border-b border-fw-border/30">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] flex items-center justify-center flex-shrink-0">
            <User size={20} className="text-white" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[15px] font-black text-fw-text truncate">
              {account?.name || account?.displayName || 'Trader'}
            </span>
            <span className="text-[13px] text-fw-text-muted truncate">
              {account?.email || 'terminal@fundedwealth.com'}
            </span>
          </div>
          <div className={cn('ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-black', phaseColor)}>
            <Shield size={11} />
            {phase}
          </div>
        </div>

        {/* Account Details */}
        <div className="px-5 py-4 flex flex-col gap-3 border-b border-fw-border/30">
          <p className="text-[14px] font-bold uppercase tracking-wider text-fw-text-muted">Account Details</p>

          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Account Code">
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-fw-text text-[14px]">
                  {account?.accountCode || '—'}
                </span>
                {account?.accountCode && (
                  <button
                    onClick={copyCode}
                    className="p-0.5 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors"
                    title="Copy account code"
                  >
                    {copied ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  </button>
                )}
              </div>
            </InfoRow>

            <InfoRow label="Broker">
              <span className="text-[14px] font-bold text-fw-text">
                FundedWealth
              </span>
            </InfoRow>

            <InfoRow label="Balance">
              <span className="text-[14px] font-mono font-bold text-fw-text">
                ₹{account?.balance ? formatCompact(account.balance) : '—'}
              </span>
            </InfoRow>

            <InfoRow label="Status">
              <span className={cn(
                'text-[13px] font-bold capitalize',
                account?.status === 'active' ? 'text-emerald-400' : 'text-red-400'
              )}>
                {account?.status || 'Active'}
              </span>
            </InfoRow>
          </div>
        </div>

        {/* Challenge Limits */}
        {account?.challenge && (
          <div className="px-5 py-4 border-b border-fw-border/30">
            <p className="text-[14px] font-bold uppercase tracking-wider text-fw-text-muted mb-3">
              Challenge Rules
            </p>
            <div className="grid grid-cols-3 gap-3">
              <ChallengeMetric
                label="Daily Loss"
                value={`${getChallengeRulePct(account.challenge.dailyLossLimitPct, account.challenge.plan, 'dailyLossLimitPct')}%`}
                color="text-red-400"
              />
              <ChallengeMetric
                label="Max Drawdown"
                value={`${getChallengeRulePct(account.challenge.maxDrawdownPct, account.challenge.plan, 'maxDrawdownPct')}%`}
                color="text-orange-400"
              />
              <ChallengeMetric
                label="Profit Target"
                value={`${getChallengeRulePct(account.challenge.profitTargetPct, account.challenge.plan, 'profitTargetPct')}%`}
                color="text-emerald-400"
              />
            </div>
          </div>
        )}

        {/* Footer — Logout */}
        <div className="px-5 py-4">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-800/40 bg-red-900/10 text-red-400 hover:bg-red-900/20 hover:border-red-700/60 text-[14px] font-bold transition-all disabled:opacity-50"
          >
            <LogOut size={14} />
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[14px] text-fw-text-muted font-semibold">{label}</span>
      {children}
    </div>
  );
}

function ChallengeMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-[#0e1018] rounded-lg px-3 py-2.5 border border-fw-border/30">
      <span className={cn('text-[15px] font-black font-mono tabular-nums', color)}>{value}</span>
      <span className="text-[13px] text-fw-text-muted text-center leading-tight">{label}</span>
    </div>
  );
}
