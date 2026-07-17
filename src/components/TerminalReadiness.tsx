import { useState, useEffect } from 'react';
import { getTerminalStatus, type TerminalStatus } from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';
import { cn } from '@/utils/helpers';
import { Shield, Wifi, WifiOff, Zap, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

/**
 * Terminal Readiness Strip
 * Shows the full operating state of the terminal at a glance.
 * Placed prominently in the right dock above the order panel.
 */
export function TerminalReadiness() {
  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const account = useTradingStore((s) => s.account);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try { setStatus(await getTerminalStatus()); } catch {}
  }

  const brokerOk = status?.broker?.connected ?? false;
  const feedOk = status?.feed?.isLive ?? false;
  const accountStatus = account?.status || 'active';
  const isLocked = accountStatus === 'locked' || accountStatus === 'breached';
  const tradingAllowed = !isLocked && (status?.tradingAllowed ?? true);

  // Overall readiness
  const isReady = brokerOk && feedOk && tradingAllowed && !isLocked;
  const readinessLabel = isLocked ? 'BLOCKED' : !brokerOk ? 'NO FEED' : !tradingAllowed ? 'RESTRICTED' : isReady ? 'READY' : 'DEGRADED';
  const readinessColor = isLocked ? 'text-red' : !brokerOk ? 'text-orange-400' : isReady ? 'text-emerald-400' : 'text-yellow-400';
  const readinessBadge = isLocked ? 'fw-badge-red' : !brokerOk ? 'fw-badge-orange' : isReady ? 'fw-badge-green' : 'fw-badge-yellow';

  return (
    <div className="px-3 py-2 border-b border-fw-border bg-gradient-to-r from-[#0a0c12] to-[#0c0e16]">
      {/* Readiness Row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className={cn('fw-badge', readinessBadge)}>
            {isReady ? <CheckCircle size={9} className={readinessColor} /> : <AlertTriangle size={9} className={readinessColor} />}
            <span className={readinessColor}>{readinessLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Broker */}
          <div className="flex items-center gap-1" title={brokerOk ? 'Broker connected' : 'Broker disconnected'}>
            {brokerOk ? <Wifi size={9} className="text-emerald-400" /> : <WifiOff size={9} className="text-red-400" />}
            <span className={cn('text-[9px] font-medium', brokerOk ? 'text-emerald-400' : 'text-red-400')}>
              {brokerOk ? 'Feed' : 'No Feed'}
            </span>
          </div>
          {/* Quotes */}
          {status?.feed?.cachedQuotes != null && (
            <span className="text-[8px] text-fw-text-muted font-mono">{status.feed.cachedQuotes}q</span>
          )}
        </div>
      </div>

      {/* Status Details Row */}
      {isLocked && (
        <div className="flex items-center gap-3 text-[9px]">
          <span className="text-red/80 font-semibold">⚠ Account {accountStatus} — trading disabled</span>
        </div>
      )}
    </div>
  );
}
