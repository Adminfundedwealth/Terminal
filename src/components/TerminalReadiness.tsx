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
  const [lastKnownStatus, setLastKnownStatus] = useState<TerminalStatus | null>(null);
  const account = useTradingStore((s) => s.account);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const next = await getTerminalStatus();
      setStatus(next);
      setLastKnownStatus(next);
    } catch {
      if (lastKnownStatus) {
        setStatus(lastKnownStatus);
      } else {
        setStatus(null);
      }
    }
  }

  const effectiveStatus = status ?? lastKnownStatus;
  const statusKnown = effectiveStatus !== null;
  const brokerOk = effectiveStatus?.broker?.connected === true;
  const feedOk = effectiveStatus?.feed?.isLive === true;
  const accountStatus = account?.status || 'active';
  const isLocked = accountStatus === 'locked' || accountStatus === 'breached';
  const tradingAllowed = !isLocked && (effectiveStatus?.tradingAllowed ?? true);

  // Overall readiness
  const isReady = statusKnown && brokerOk && feedOk && tradingAllowed && !isLocked;
  const readinessLabel = !statusKnown ? 'CHECKING' : isLocked ? 'BLOCKED' : !brokerOk ? 'BROKER OFFLINE' : !tradingAllowed ? 'RESTRICTED' : isReady ? 'READY' : 'DEGRADED';
  const readinessColor = !statusKnown ? 'text-yellow-400' : isLocked ? 'text-red' : !brokerOk ? 'text-orange-400' : isReady ? 'text-emerald-400' : 'text-yellow-400';
  const readinessBadge = !statusKnown ? 'fw-badge-yellow' : isLocked ? 'fw-badge-red' : !brokerOk ? 'fw-badge-orange' : isReady ? 'fw-badge-green' : 'fw-badge-yellow';

  return (
    <div className="px-3 py-2 border-b border-fw-border bg-fw-surface">
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
          <div className="flex items-center gap-1" title={!statusKnown ? 'Checking broker and feed status' : brokerOk ? 'Broker data feed connected' : 'Broker data feed offline — market data unavailable'}>
            {!statusKnown ? <Wifi size={9} className="text-yellow-400" /> : brokerOk ? <Wifi size={9} className="text-emerald-400" /> : <WifiOff size={9} className="text-red-400" />}
            <span className={cn('text-[13px] font-medium', !statusKnown ? 'text-yellow-400' : brokerOk ? 'text-emerald-400' : 'text-red-400')}>
              {!statusKnown ? 'Checking...' : brokerOk ? 'Feed Live' : 'Feed Offline'}
            </span>
          </div>
          {/* Quotes */}
          {status?.feed?.cachedQuotes != null && (
            <span className="text-[8px] text-fw-text-muted font-mono">{status.feed.cachedQuotes}q</span>
          )}
        </div>
      </div>

      {statusKnown && (
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
          <span className={effectiveStatus.executionMode.isPaper ? 'text-emerald-400' : 'text-red-400'}>
            MODE: {effectiveStatus.executionMode.mode.toUpperCase()}
          </span>
          <span className={effectiveStatus.executionMode.isLive ? 'text-red-400' : 'text-emerald-400'}>
            LIVE: {effectiveStatus.executionMode.isLive ? 'YES' : 'NO'}
          </span>
          <span className="text-fw-text-secondary truncate" title={effectiveStatus.broker.provider}>
            ROUTE: {effectiveStatus.broker.provider}
          </span>
        </div>
      )}

      {/* Status Details Row */}
      {isLocked && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-red/80 font-semibold">⚠ Account {accountStatus} — trading disabled</span>
        </div>
      )}
    </div>
  );
}
