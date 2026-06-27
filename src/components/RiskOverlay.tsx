/**
 * RISK OVERLAY
 * 
 * Full-screen overlay when account is locked or breached.
 * Blocks all trading until status changes.
 */

import { useTradingStore } from '@/store/tradingStore';
import { Shield, Ban, Phone, Mail } from 'lucide-react';

export function RiskOverlay() {
  const account = useTradingStore((s) => s.account);

  if (!account) return null;
  if (account.status !== 'locked' && account.status !== 'breached') return null;

  const isBreached = account.status === 'breached';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="max-w-md w-full mx-4 text-center">
        {/* Icon */}
        <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6 ${isBreached ? 'bg-red-500/20 border-2 border-red-500/50' : 'bg-yellow-500/20 border-2 border-yellow-500/50'}`}>
          {isBreached
            ? <Ban size={40} className="text-red-400" />
            : <Shield size={40} className="text-yellow-400" />
          }
        </div>

        {/* Title */}
        <h1 className={`text-2xl font-bold mb-3 ${isBreached ? 'text-red-400' : 'text-yellow-400'}`}>
          {isBreached ? 'Account Breached' : 'Account Locked'}
        </h1>

        {/* Message */}
        <p className="text-white/80 text-sm mb-6 leading-relaxed">
          {isBreached
            ? 'Maximum drawdown limit exceeded. Your trading account has been permanently breached. All positions have been closed.'
            : 'Daily loss limit breached. Your account is locked for today. Trading will resume on the next trading day.'
          }
        </p>

        {/* Reason */}
        {account.lockedReason && (
          <div className={`rounded-lg px-4 py-3 mb-6 text-left ${isBreached ? 'bg-red-500/10 border border-red-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
            <p className="text-[11px] font-medium text-white/60 mb-1">Reason</p>
            <p className="text-[12px] text-white/90">{account.lockedReason}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {isBreached ? (
            <>
              <a href="mailto:support@fundedwealth.com" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-colors text-sm font-medium">
                <Mail size={14} />
                Contact Support
              </a>
              <a href="https://fundedwealth.com/dashboard" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-colors text-sm">
                Go to Dashboard
              </a>
            </>
          ) : (
            <>
              <div className="px-4 py-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-[11px] text-white/50 mb-1">Trading resumes</p>
                <p className="text-sm text-white/90 font-medium">Next trading day at 9:15 AM IST</p>
              </div>
              <a href="https://fundedwealth.com/dashboard" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-colors text-sm">
                Go to Dashboard
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
