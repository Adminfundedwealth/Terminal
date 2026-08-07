/**
 * PositionOverlay — React Integration Component
 *
 * This is the ONLY React component in the OverlayEngine system.
 * It mounts the engine to a chart instance and renders
 * the drag confirmation dialog.
 *
 * Usage (inside ChartPanel):
 *
 *   <PositionOverlay
 *     chart={chartRef.current}
 *     series={seriesRef.current}
 *     containerRef={chartContainerRef}
 *     activeToken={activeSymbol.token}
 *   />
 *
 * This component has NO internal state that causes chart rerenders.
 * It only manages:
 *  1. OverlayEngine lifecycle (mount/detach on prop changes)
 *  2. Drag confirmation dialog (minimal React state)
 *  3. Position context menu (minimal React state)
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { OverlayEngine, type DragConfirmation } from '../index';
import type { DragTarget } from '../types';
import { PositionContextMenu } from './PositionContextMenu';
import { DragConfirmDialog } from './DragConfirmDialog';
import { replayOpenPositions } from '../PositionSynchronization';

interface PositionOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  containerRef: RefObject<HTMLElement>;
  activeToken: string;
}

interface ContextMenuState {
  positionId: string;
  lineType: 'entry' | 'sl' | 'tp';
  x: number;
  y: number;
}

export function PositionOverlay({
  chart,
  series,
  containerRef,
  activeToken,
}: PositionOverlayProps) {
  const engineRef = useRef<OverlayEngine | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<DragConfirmation | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ─── Engine Lifecycle ───────────────────────────────────────────────────────

  // Create engine once
  useEffect(() => {
    const engine = new OverlayEngine({
      onDragConfirmRequired: (confirmation) => setPendingConfirm(confirmation),
      onDragConfirmDismiss: () => setPendingConfirm(null),
      onContextMenu: (positionId, lineType, x, y) =>
        setContextMenu({ positionId, lineType, x, y }),
    });
    engineRef.current = engine;

    // Subscribe to events (position opened/closed/modified)
    // The sync module already watches the Zustand store — just replay open positions
    replayOpenPositions();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Attach / re-attach engine when chart, series or container change
  useEffect(() => {
    const engine = engineRef.current;
    const container = containerRef.current;
    if (!engine || !chart || !series || !container || !activeToken) return;

    engine.attach(container, chart, series, activeToken);

    // Replay positions so overlays appear immediately on mount
    replayOpenPositions();

    return () => {
      engine.detachChart();
    };
  }, [chart, series, containerRef, activeToken]);

  // Update engine when series changes (timeframe change)
  useEffect(() => {
    if (!series) return;
    engineRef.current?.updateSeries(series);
  }, [series]);

  // Update engine when active token changes (symbol switch)
  useEffect(() => {
    engineRef.current?.setActiveToken(activeToken);
    replayOpenPositions();
  }, [activeToken]);

  // ─── Drag Confirmation Handlers ─────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    if (!pendingConfirm || !engineRef.current) return;
    engineRef.current.confirmDrag(
      pendingConfirm.positionId,
      pendingConfirm.target,
      pendingConfirm.newPrice
    );
    setPendingConfirm(null);
  }, [pendingConfirm]);

  const handleCancel = useCallback(() => {
    if (!pendingConfirm || !engineRef.current) return;
    engineRef.current.revertDrag(
      pendingConfirm.positionId,
      pendingConfirm.target,
      pendingConfirm.originalPrice
    );
    setPendingConfirm(null);
  }, [pendingConfirm]);

  // ─── Context Menu Handlers ───────────────────────────────────────────────────

  const handleContextMenuClose = useCallback(() => setContextMenu(null), []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  // This component renders NO DOM inside the chart container.
  // The canvas is created imperatively by PositionRenderer.
  // We only render the confirmation dialog and context menu as portals.

  return (
    <>
      {pendingConfirm && (
        <DragConfirmDialog
          confirmation={pendingConfirm}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {contextMenu && (
        <PositionContextMenu
          positionId={contextMenu.positionId}
          lineType={contextMenu.lineType}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleContextMenuClose}
        />
      )}
    </>
  );
}
