/**
 * OverlayEngine — Core Types
 *
 * These types define the data contract for the entire overlay system.
 * The engine is instrument-agnostic — it operates on prices and tokens only.
 * No symbol, exchange, or market hardcoding anywhere.
 */

// ─── Overlay State ──────────────────────────────────────────────────────────

export type OverlayLineSide = 'LONG' | 'SHORT';

/**
 * The canonical data structure for one position's overlay.
 * Created when a position opens; destroyed when it closes.
 */
export interface PositionOverlay {
  /** Unique overlay id — matches the position id from the trading engine */
  id: string;
  /** Instrument token — used to match chart context */
  token: string;
  /** LONG or SHORT */
  side: OverlayLineSide;
  /** Number of contracts/shares/lots */
  qty: number;
  /** Average execution price */
  avgPrice: number;
  /** Stop Loss price — undefined means no SL set */
  stopLoss?: number;
  /** Take Profit price — undefined means no TP set */
  takeProfit?: number;
  /** Current last-traded price for P&L calculation */
  ltp: number;
  /** UI interaction state */
  ui: OverlayUIState;
}

export interface OverlayUIState {
  isSelected: boolean;
  isHovered: boolean;
  isDraggingSL: boolean;
  isDraggingTP: boolean;
  /** Price being dragged to (live during drag) */
  dragPrice?: number;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type OverlayEventType =
  | 'POSITION_OPENED'
  | 'POSITION_MODIFIED'
  | 'POSITION_CLOSED'
  | 'SL_MODIFIED'
  | 'TP_MODIFIED'
  | 'LTP_UPDATED'
  | 'CONNECTION_RESTORED'
  | 'WORKSPACE_LOADED';

export interface OverlayEvent {
  type: OverlayEventType;
  positionId: string;
  payload?: Partial<PositionOverlay>;
}

// ─── Dragging ─────────────────────────────────────────────────────────────────

export type DragTarget = 'sl' | 'tp';

export interface ActiveDrag {
  positionId: string;
  target: DragTarget;
  /** Price at drag start — used for cancel/revert */
  originalPrice: number;
  /** Current live drag price */
  currentPrice: number;
  /** Canvas Y at start */
  startY: number;
}

// ─── Hit Regions ─────────────────────────────────────────────────────────────

export type HitType = 'entry' | 'sl' | 'tp' | 'close_btn' | 'sl_drag' | 'tp_drag';

export interface HitRegion {
  positionId: string;
  hitType: HitType;
  /** Canvas Y coordinate of the line */
  y: number;
  /** Hit tolerance in pixels */
  tolerance: number;
}

// ─── Render Context ───────────────────────────────────────────────────────────

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical width (CSS pixels) */
  width: number;
  /** Logical height (CSS pixels) */
  height: number;
  /** Device pixel ratio — already applied via ctx.scale() */
  dpr: number;
  /** X where price labels / buttons start (right edge minus price scale) */
  labelAreaX: number;
  /** X of the chart's right visible edge (before price scale) */
  chartRightEdge: number;
}

// ─── Confirmation Dialog State ────────────────────────────────────────────────

export interface DragConfirmation {
  positionId: string;
  target: DragTarget;
  originalPrice: number;
  newPrice: number;
  /** Screen-space anchor for the confirmation UI */
  x: number;
  y: number;
}
