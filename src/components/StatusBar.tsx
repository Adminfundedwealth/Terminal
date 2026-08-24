import { useState, useEffect, useRef } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import SymbolLogo from '@/components/SymbolLogo';
import { wsService } from '@/services/websocket';
import { cn } from '@/utils/helpers';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

type WsState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export function StatusBar() {
  const marketStatus = useMarketStore((s) => s.marketStatus);
  const { activeSymbol } = useAppStore();
  const [wsState, setWsState] = useState<WsState>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);
  const lastPingAt = useRef<number | null>(null);

  useEffect(() => {
    const updateState = (data: any) => {
      setWsState(data.state);
      if (data.state !== 'connected') setLatency(null);
    };
    wsService.on('connection', updateState);
    setWsState(wsService.connected ? 'connected' : 'disconnected');
    return () => wsService.off('connection', updateState);
  }, []);

  // Measure latency via ping/pong
  useEffect(() => {
    if (wsState !== 'connected') return;

    const measure = () => {
      lastPingAt.current = performance.now();
      wsService.send({ type: 'ping', ts: lastPingAt.current });
    };

    const handler = (data: any) => {
      if (data.type !== 'pong') return;
      const sentAt = data.ts ?? lastPingAt.current;
      if (sentAt == null) return;
      const nextLatency = Math.max(0, performance.now() - sentAt);
      setLatency(nextLatency);
    };

    wsService.on('pong', handler);
    const interval = setInterval(measure, 10000);
    measure();

    return () => {
      wsService.off('pong', handler);
      clearInterval(interval);
    };
  }, [wsState]);

  const statusColor: Record<string, string> = {
    OPEN: 'text-green',
    CLOSED: 'text-red',
    PRE_OPEN: 'text-yellow-400',
    POST_CLOSE: 'text-orange-400',
  };

  const wsConfig: Record<WsState, { dot: string; label: string; color: string; icon: React.ReactNode }> = {
    connected: { dot: 'bg-emerald-500', label: 'Connected', color: 'text-emerald-400', icon: <Wifi size={9} className="text-emerald-400" /> },
    connecting: { dot: 'bg-yellow-500 animate-pulse', label: 'Connecting...', color: 'text-yellow-400', icon: <Loader2 size={9} className="text-yellow-400 animate-spin" /> },
    reconnecting: { dot: 'bg-orange-500 animate-pulse', label: 'Reconnecting...', color: 'text-orange-400', icon: <Loader2 size={9} className="text-orange-400 animate-spin" /> },
    disconnected: { dot: 'bg-red-500', label: 'Disconnected', color: 'text-red-400', icon: <WifiOff size={9} className="text-red-400" /> },
  };

  const ws = wsConfig[wsState];

  return (
    <div className="h-[22px] min-h-[22px] bg-fw-bg border-t border-fw-border/50 flex items-center px-3 gap-4 text-[13px] select-none">
      {/* Backend feed connection status */}
      <div className="flex items-center gap-1">
        {ws.icon}
        <span className={ws.color}>{ws.label}</span>
      </div>

      {/* Latency */}
      {wsState === 'connected' && (
        <div className="flex items-center gap-1">
          <span className="text-fw-text-secondary">Ping:</span>
          <span className={cn('font-mono tabular-nums', latency === null ? 'text-fw-text-secondary' : latency < 50 ? 'text-emerald-400' : latency < 150 ? 'text-yellow-400' : 'text-red-400')}>
            {latency !== null ? `${latency}ms` : '—'}
          </span>
        </div>
      )}

      {/* Market Status */}
      <div className="flex items-center gap-1">
        <div className={cn('w-1 h-1 rounded-full', marketStatus === 'OPEN' ? 'bg-emerald-500' : marketStatus === 'PRE_OPEN' ? 'bg-yellow-400' : 'bg-red-500')} />
        <span className={cn('font-medium', statusColor[marketStatus] || 'text-fw-text-secondary')}>
          {marketStatus === 'OPEN' ? 'Market Open' : marketStatus === 'CLOSED' ? 'Closed' : marketStatus.replace('_', ' ')}
        </span>
      </div>

      <div className="flex-1" />

      {/* Active Symbol */}
      {activeSymbol && (
        <div className="flex items-center gap-1.5">
          <SymbolLogo symbol={activeSymbol.symbol} size={14} />
          <span className="text-fw-text-secondary font-mono">{activeSymbol.symbol}</span>
        </div>
      )}
    </div>
  );
}

// Panel toggles consolidated to TopBar
