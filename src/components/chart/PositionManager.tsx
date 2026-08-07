/**
 * POSITION MANAGER
 * Thin connector: TradingStore → PositionCanvas
 * Drag state lives entirely inside PositionCanvas — this component only
 * handles API calls after drag ends.
 */

import { useCallback, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import {
  attachStopLoss, attachTakeProfit, exitPosition,
  partialClosePosition, reversePosition, breakEvenPosition,
} from '@/services/api';
import { PositionCanvas, type PositionVisual } from './PositionCanvas';
import { PositionContextMenu } from './PositionContextMenu';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function PositionManager({ chart, series, containerRef }: Props) {
  const positions    = useTradingStore((s) => s.positions);
  const updatePos    = useTradingStore((s) => s.updatePosition);
  const activeSymbol = useAppStore((s) => s.activeSymbol);
  const quotes       = useMarketStore((s) => s.quotes);
  const [ctx, setCtx] = useState<{ pid: string; type: 'entry'|'sl'|'tp'; x: number; y: number } | null>(null);

  const symbolPos = positions.filter(p => p.token === activeSymbol?.token && p.qty !== 0);

  const visuals: PositionVisual[] = symbolPos.map(p => ({
    position: p,
    slPrice: p.stopLoss,
    tpPrice: p.takeProfit,
    ltp: quotes[p.token]?.ltp ?? p.ltp ?? p.avgPrice,
  }));

  // Canvas owns drag internally — onDragStart/Move are no-ops here
  const noop = useCallback(() => {}, []);

  const onDragEnd = useCallback(async (pid: string, type: 'sl'|'tp', price: number) => {
    // Optimistic update
    updatePos(pid, type === 'sl' ? { stopLoss: price } : { takeProfit: price });
    try {
      if (type === 'sl') await attachStopLoss(pid, price);
      else               await attachTakeProfit(pid, price);
    } catch (err) {
      console.error('[PositionManager] SL/TP update failed:', err);
      // Revert
      const orig = useTradingStore.getState().positions.find(p => p.id === pid);
      if (orig) updatePos(pid, type === 'sl' ? { stopLoss: orig.stopLoss } : { takeProfit: orig.takeProfit });
    }
  }, [updatePos]);

  const onClose = useCallback(async (pid: string) => {
    try { await exitPosition(pid); } catch {}
  }, []);

  if (symbolPos.length === 0) return null;

  return (
    <>
      <PositionCanvas
        chart={chart}
        series={series}
        containerRef={containerRef}
        positions={visuals}
        onDragStart={noop as any}
        onDragMove={noop as any}
        onDragEnd={onDragEnd}
        onClose={onClose}
        onPartialClose={async (pid, qty) => { try { await partialClosePosition(pid, qty); } catch {} }}
        onReversePosition={async (pid) => { try { await reversePosition(pid); } catch {} }}
        onMoveBreakeven={async (pid) => { try { await breakEvenPosition(pid); } catch {} }}
        onContextMenu={(pid, type, x, y) => setCtx({ pid, type, x, y })}
      />
      {ctx && (
        <PositionContextMenu
          x={ctx.x} y={ctx.y}
          positionId={ctx.pid} type={ctx.type}
          onClose={() => setCtx(null)}
          onClosePosition={() => { onClose(ctx.pid); setCtx(null); }}
          onClosePartial={async pct => {
            const p = useTradingStore.getState().positions.find(p => p.id === ctx.pid);
            if (p) await partialClosePosition(ctx.pid, Math.max(1, Math.floor(p.qty * pct / 100)));
            setCtx(null);
          }}
          onReversePosition={() => { reversePosition(ctx.pid).catch(()=>{}); setCtx(null); }}
          onMoveBreakeven={() => { breakEvenPosition(ctx.pid).catch(()=>{}); setCtx(null); }}
          onTrailingStop={() => setCtx(null)}
          onModify={() => setCtx(null)}
          onCopyPrice={() => {
            const p = useTradingStore.getState().positions.find(p => p.id === ctx.pid);
            const v = ctx.type==='sl' ? p?.stopLoss : ctx.type==='tp' ? p?.takeProfit : p?.avgPrice;
            if (v) navigator.clipboard.writeText(String(v)).catch(()=>{});
            setCtx(null);
          }}
        />
      )}
    </>
  );
}
