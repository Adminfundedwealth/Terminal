/**
 * POSITION MANAGER
 *
 * Connects TradingStore positions → PositionCanvas overlay.
 *
 * Critical design rules:
 *  - ZERO useState during drag — everything in refs
 *  - positionVisuals built from refs, not state, so no re-render kills the drag
 *  - Only the contextMenu state causes React re-renders (infrequent)
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import {
  attachStopLoss,
  attachTakeProfit,
  exitPosition,
  partialClosePosition,
  reversePosition,
  breakEvenPosition,
} from '@/services/api';
import { PositionCanvas, type PositionVisual } from './PositionCanvas';
import { PositionContextMenu } from './PositionContextMenu';

interface PositionManagerProps {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  containerRef: React.RefObject<HTMLDivElement>;
}

interface ContextMenuState {
  x: number;
  y: number;
  positionId: string;
  type: 'entry' | 'sl' | 'tp';
}

export function PositionManager({ chart, series, containerRef }: PositionManagerProps) {
  // Read from store — these are used to build visuals, not for drag tracking
  const positions = useTradingStore((s) => s.positions);
  const updatePosition = useTradingStore((s) => s.updatePosition);
  const activeSymbol = useAppStore((s) => s.activeSymbol);
  const quotes = useMarketStore((s) => s.quotes);

  // ── Drag state — ALL in refs, zero setState during drag ──────────────────
  const draggingRef = useRef<{
    positionId: string;
    type: 'sl' | 'tp';
    currentPrice: number;
    originalPrice: number;
  } | null>(null);

  // Separate ref that holds the live overrides for the canvas render loop
  // so it always reads the latest drag price without React re-renders
  const dragOverrideRef = useRef<{
    positionId: string;
    type: 'sl' | 'tp';
    price: number;
  } | null>(null);

  const dragCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Force re-render ONLY after drag ends (to sync final position)
  const [renderTick, setRenderTick] = useState(0);
  const forceUpdate = useCallback(() => setRenderTick((n) => n + 1), []);

  // Context menu — rare, so useState is fine
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ── Filtered positions ────────────────────────────────────────────────────
  const symbolPositions = positions.filter(
    (p) => p.token === activeSymbol?.token && p.qty !== 0
  );

  // ── Build PositionVisuals — reads drag override from ref, not state ───────
  const positionVisuals: PositionVisual[] = symbolPositions.map((p) => {
    const override = dragOverrideRef.current;
    return {
      position: p,
      slPrice:
        override?.positionId === p.id && override.type === 'sl'
          ? override.price
          : p.stopLoss,
      tpPrice:
        override?.positionId === p.id && override.type === 'tp'
          ? override.price
          : p.takeProfit,
      ltp: quotes[p.token]?.ltp ?? p.ltp ?? p.avgPrice,
      isDraggingSlThis:
        override?.positionId === p.id && override.type === 'sl',
      isDraggingTpThis:
        override?.positionId === p.id && override.type === 'tp',
    };
  });

  // ── Drag handlers — NO setState ──────────────────────────────────────────

  const handleDragStart = useCallback(
    (positionId: string, type: 'sl' | 'tp', price: number, _e: MouseEvent) => {
      const position = useTradingStore.getState().positions.find((p) => p.id === positionId);
      const originalPrice =
        type === 'sl' ? (position?.stopLoss ?? price) : (position?.takeProfit ?? price);

      draggingRef.current = { positionId, type, currentPrice: price, originalPrice };
      dragOverrideRef.current = { positionId, type, price };
      // No setState — canvas reads dragOverrideRef directly via positionVisuals rebuild on next RAF
    },
    []
  );

  const handleDragMove = useCallback((price: number) => {
    if (!draggingRef.current) return;
    draggingRef.current.currentPrice = price;
    // Update override ref — canvas render loop picks this up each RAF frame
    if (dragOverrideRef.current) {
      dragOverrideRef.current.price = price;
    }
    // No setState — intentional. Canvas reads refs.
  }, []);

  const handleDragEnd = useCallback(
    async (positionId: string, type: 'sl' | 'tp', finalPrice: number) => {
      const drag = draggingRef.current;
      draggingRef.current = null;
      dragOverrideRef.current = null;

      // Force one re-render to sync final position
      forceUpdate();

      if (!drag) return;

      const position = useTradingStore.getState().positions.find((p) => p.id === positionId);
      if (!position) return;

      // Optimistic store update
      if (type === 'sl') {
        updatePosition(positionId, { stopLoss: finalPrice });
      } else {
        updatePosition(positionId, { takeProfit: finalPrice });
      }

      // Debounced API commit
      if (dragCommitRef.current) clearTimeout(dragCommitRef.current);
      dragCommitRef.current = setTimeout(async () => {
        try {
          if (type === 'sl') {
            await attachStopLoss(positionId, finalPrice);
          } else {
            await attachTakeProfit(positionId, finalPrice);
          }
        } catch (err) {
          console.error('[PositionManager] SL/TP update failed:', err);
          // Revert on failure
          if (type === 'sl') {
            updatePosition(positionId, { stopLoss: drag.originalPrice });
          } else {
            updatePosition(positionId, { takeProfit: drag.originalPrice });
          }
        }
      }, 120);
    },
    [updatePosition, forceUpdate]
  );

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleClose = useCallback(async (positionId: string) => {
    try { await exitPosition(positionId); } catch (err) { console.error('[PositionManager] close failed:', err); }
  }, []);

  const handlePartialClose = useCallback(async (positionId: string, qty: number) => {
    try { await partialClosePosition(positionId, qty); } catch (err) { console.error('[PositionManager] partial close failed:', err); }
  }, []);

  const handleReversePosition = useCallback(async (positionId: string) => {
    try { await reversePosition(positionId); } catch (err) { console.error('[PositionManager] reverse failed:', err); }
  }, []);

  const handleMoveBreakeven = useCallback(async (positionId: string) => {
    try { await breakEvenPosition(positionId); } catch (err) { console.error('[PositionManager] breakeven failed:', err); }
  }, []);

  const handleContextMenu = useCallback(
    (positionId: string, type: 'entry' | 'sl' | 'tp', x: number, y: number) => {
      setContextMenu({ x, y, positionId, type });
    },
    []
  );

  if (symbolPositions.length === 0) return null;

  return (
    <>
      <PositionCanvas
        chart={chart}
        series={series}
        containerRef={containerRef}
        positions={positionVisuals}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClose={handleClose}
        onPartialClose={handlePartialClose}
        onReversePosition={handleReversePosition}
        onMoveBreakeven={handleMoveBreakeven}
        onContextMenu={handleContextMenu}
      />

      {contextMenu && (
        <PositionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          positionId={contextMenu.positionId}
          type={contextMenu.type}
          onClose={() => setContextMenu(null)}
          onClosePosition={() => handleClose(contextMenu.positionId)}
          onClosePartial={async (pct) => {
            const pos = useTradingStore.getState().positions.find((p) => p.id === contextMenu.positionId);
            if (!pos) return;
            const qty = Math.max(1, Math.floor(pos.qty * pct / 100));
            await handlePartialClose(contextMenu.positionId, qty);
          }}
          onReversePosition={() => handleReversePosition(contextMenu.positionId)}
          onMoveBreakeven={() => handleMoveBreakeven(contextMenu.positionId)}
          onTrailingStop={() => console.info('[PositionManager] trailing stop:', contextMenu.positionId)}
          onModify={() => console.info('[PositionManager] modify:', contextMenu.positionId)}
          onCopyPrice={() => {
            const pos = useTradingStore.getState().positions.find((p) => p.id === contextMenu.positionId);
            if (!pos) return;
            const price =
              contextMenu.type === 'entry' ? pos.avgPrice :
              contextMenu.type === 'sl' ? pos.stopLoss :
              pos.takeProfit;
            if (price) navigator.clipboard.writeText(String(price)).catch(() => {});
          }}
        />
      )}
    </>
  );
}
