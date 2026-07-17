import { useState, useEffect } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import { wsService } from '@/services/websocket';
import { cn } from '@/utils/helpers';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

type WsState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export function StatusBar() {
  const marketStatus = useMarketStore((s) => s.marketStatus);
  const { activeWorkspace, activeSymbol } = useAppStore();
  const [wsState, setWsState] = useState<WsState>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);

  // Poll WebSocket connection state
  useEffect(() => {
    const interval = setInterval(() => {
      const connected = wsService.connected;
      if (connected) {
        setWsState('connected');
      } else {
        // Check if it's actively reconnecting
        setWsState((prev) => prev === 'connecting' ? 'connecting' : 'disconnected');
      }
      if (!connected) setLatency(null);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Measure latency via ping/pong
  useEffect(() => {
    if (wsState !== 'connected') return;

    const measure = () => {
      wsService.send({ type: 'ping', ts: Date.now() });
    };

    const handler = (data: any) => {
      if (data.type === 'pong' && data.ts) {
        setLatency(Date.now() - data.ts);
      }
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
    <div className="h-[22px] min-h-[22px] bg-[#08090e] border-t border-fw-border/50 flex items-center px-3 gap-4 text-[13px] select-none">
      {/* Broker Feed Status */}
      <div className="flex items-center gap-1">
        {ws.icon}
        <span className={ws.color}>{ws.label}</span>
      </div>

      {/* Latency */}
      {wsState === 'connected' && (
        <div className="flex items-center gap-1">
          <span className="text-fw-text-muted">Ping:</span>
          <span className={cn('font-mono tabular-nums', latency === null ? 'text-fw-text-muted' : latency < 50 ? 'text-emerald-400' : latency < 150 ? 'text-yellow-400' : 'text-red-400')}>
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

      {/* Workspace + Symbol */}
      <span className="text-fw-text-muted">
        <span className="text-fw-text-secondary uppercase font-medium">{activeWorkspace}</span>
        {activeSymbol && <span className="ml-2 text-fw-text-muted font-mono">{activeSymbol.symbol}</span>}
      </span>

      {/* Version */}
      <span className="text-fw-text-muted/60 font-mono">v1.0</span>
    </div>
  );
}

// Panel toggles consolidated to TopBar
