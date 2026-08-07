/**
 * OverlayEngine — Core Orchestrator
 *
 * The single entry point for the entire position overlay system.
 *
 * Responsibilities:
 *  - Owns the overlay registry (Map<id, PositionOverlay>)
 *  - Subscribes to positionEventBus and updates the registry
 *  - Drives PositionRenderer, DragController, MarkerRenderer
 *  - Handles drag confirmation flow
 *  - Exposes attach/detach API for ChartPanel
 *
 * Architecture:
 *   positionEventBus ──→ OverlayEngine ──→ PositionRenderer (canvas)
 *                                      ──→ DragController   (mouse events)
 *                                      ──→ MarkerRenderer   (LW markers)
 *
 * The engine owns state; the chart only renders.
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type {
  PositionOverlay,
  OverlayEvent,
  DragTarget,
  DragConfirmation,
} from './types';
import { positionEventBus } from './PositionEvents';
import { PositionRenderer } from './PositionRenderer';
import { DragController } from './DragController';
import { MarkerRenderer, setOverlayRegistry } from './MarkerRenderer';
import {
  attachStopLoss,
  attachTakeProfit,
  exitPosition,
} from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';

export type { PositionOverlay, DragConfirmation };

export interface OverlayEngineCallbacks {
  /** Called when a drag needs user confirmation before sending to backend. */
  onDragConfirmRequired: (confirmation: DragConfirmation) => void;
  /** Called when a confirmation is dismissed (e.g., confirmed or cancelled). */
  onDragConfirmDismiss: () => void;
  /** Called when right-click context menu is requested. */
  onContextMenu: (positionId: string, lineType: 'entry' | 'sl' | 'tp', x: number, y: number) => void;
}

export class OverlayEngine {
  // ─── Registry ──────────────────────────────────────────────────────────────
  private overlays: Map<string, PositionOverlay> = new Map();

  // ─── Sub-systems ───────────────────────────────────────────────────────────
  readonly renderer = new PositionRenderer();
  readonly markerRenderer = new MarkerRenderer();
  private dragController: DragController;

  // ─── Chart context ─────────────────────────────────────────────────────────
  private chart: IChartApi | null = null;
  private series: ISeriesApi<any> | null = null;
  private containerEl: HTMLElement | null = null;
  /** Token of the symbol currently displayed on this chart */
  private activeToken: string | null = null;

  // ─── State ─────────────────────────────────────────────────────────────────
  private hoveredPositionId: string | null = null;
  private eventUnsubscribes: Array<() => void> = [];

  // ─── Callbacks (set by host component) ────────────────────────────────────
  private callbacks: OverlayEngineCallbacks;

  constructor(callbacks: OverlayEngineCallbacks) {
    this.callbacks = callbacks;

    this.dragController = new DragController({
      onDragMove: this.handleDragMove.bind(this),
      onDragEnd: this.handleDragEnd.bind(this),
      onDragCancel: this.handleDragCancel.bind(this),
      onHoverChange: this.handleHoverChange.bind(this),
      onCloseClick: this.handleCloseClick.bind(this),
      onContextMenu: callbacks.onContextMenu,
    });

    // Share registry with MarkerRenderer
    setOverlayRegistry(this.overlays);
  }

  // ─── Chart Lifecycle ───────────────────────────────────────────────────────

  /**
   * Attach to a mounted chart. Call after chart + series are ready.
   * Safe to call multiple times (on timeframe change, etc.).
   */
  attach(
    container: HTMLElement,
    chart: IChartApi,
    series: ISeriesApi<any>,
    activeToken: string
  ): void {
    // Detach previous if needed
    if (this.containerEl) {
      this.detachChart();
    }

    this.chart = chart;
    this.series = series;
    this.containerEl = container;
    this.activeToken = activeToken;

    // Mount canvas renderer
    const canvas = this.renderer.mount(container, chart, series);

    // Attach drag controller to the canvas
    this.dragController.attach(
      canvas,
      (y) => this.renderer.yToPrice(y),
      () => this.renderer.hitRegions
    );

    // Wire overlays into renderer
    this.renderer.overlays = this.visibleOverlays();

    // Attach marker renderer
    this.markerRenderer.attachSeries(series);

    // Subscribe to events (idempotent — deduped by cleanup array)
    this.subscribeToEvents();
  }

  /**
   * Update the active token (called when user switches symbol).
   * Rebuilds the visible overlay set without recreating the canvas.
   */
  setActiveToken(token: string): void {
    this.activeToken = token;
    this.syncVisibleOverlays();
  }

  /**
   * Update the series reference (called when chart type / timeframe changes).
   */
  updateSeries(series: ISeriesApi<any>): void {
    this.series = series;
    this.renderer.updateSeries(series);
    this.markerRenderer.attachSeries(series);
  }

  /**
   * Detach from the current chart (called on chart destroy).
   */
  detachChart(): void {
    this.dragController.detach();
    this.renderer.unmount();
    this.markerRenderer.detachSeries();
    this.chart = null;
    this.series = null;
    this.containerEl = null;
  }

  /**
   * Full teardown — call when terminal unmounts.
   */
  destroy(): void {
    this.detachChart();
    this.eventUnsubscribes.forEach((fn) => fn());
    this.eventUnsubscribes = [];
    this.overlays.clear();
  }

  // ─── Event Bus Subscriptions ────────────────────────────────────────────────

  private subscribeToEvents(): void {
    // Prevent duplicate subscriptions
    if (this.eventUnsubscribes.length > 0) return;

    const unsub1 = positionEventBus.on('POSITION_OPENED', (e) => this.handlePositionOpened(e));
    const unsub2 = positionEventBus.on('POSITION_MODIFIED', (e) => this.handlePositionModified(e));
    const unsub3 = positionEventBus.on('POSITION_CLOSED', (e) => this.handlePositionClosed(e));
    const unsub4 = positionEventBus.on('SL_MODIFIED', (e) => this.handleSLModified(e));
    const unsub5 = positionEventBus.on('TP_MODIFIED', (e) => this.handleTPModified(e));
    const unsub6 = positionEventBus.on('LTP_UPDATED', (e) => this.handleLTPUpdated(e));
    const unsub7 = positionEventBus.on('CONNECTION_RESTORED', (e) => this.handleConnectionRestored(e));
    const unsub8 = positionEventBus.on('WORKSPACE_LOADED', () => this.syncVisibleOverlays());

    this.eventUnsubscribes.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub7, unsub8);
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  private handlePositionOpened(e: OverlayEvent): void {
    if (!e.payload || !e.payload.token) return;

    const overlay: PositionOverlay = {
      id: e.positionId,
      token: e.payload.token!,
      side: e.payload.side ?? 'LONG',
      qty: e.payload.qty ?? 0,
      avgPrice: e.payload.avgPrice ?? 0,
      stopLoss: e.payload.stopLoss,
      takeProfit: e.payload.takeProfit,
      ltp: e.payload.ltp ?? e.payload.avgPrice ?? 0,
      ui: {
        isSelected: false,
        isHovered: false,
        isDraggingSL: false,
        isDraggingTP: false,
      },
    };

    this.overlays.set(e.positionId, overlay);
    this.syncVisibleOverlays();

    // Add entry marker at current candle time
    const now = Math.floor(Date.now() / 1000);
    this.markerRenderer.addMarker(overlay, now);
  }

  private handlePositionModified(e: OverlayEvent): void {
    const overlay = this.overlays.get(e.positionId);
    if (!overlay || !e.payload) return;

    if (e.payload.avgPrice != null) overlay.avgPrice = e.payload.avgPrice;
    if (e.payload.qty != null) overlay.qty = e.payload.qty;
    if (e.payload.side != null) overlay.side = e.payload.side;
    if (e.payload.stopLoss !== undefined) overlay.stopLoss = e.payload.stopLoss;
    if (e.payload.takeProfit !== undefined) overlay.takeProfit = e.payload.takeProfit;
    if (e.payload.ltp != null) overlay.ltp = e.payload.ltp;
  }

  private handlePositionClosed(e: OverlayEvent): void {
    this.overlays.delete(e.positionId);
    this.markerRenderer.removeMarker(e.positionId);
    this.syncVisibleOverlays();
  }

  private handleSLModified(e: OverlayEvent): void {
    const overlay = this.overlays.get(e.positionId);
    if (!overlay || !e.payload) return;
    // Only update SL — do not rerender entire overlay
    overlay.stopLoss = e.payload.stopLoss;
    // The RAF render loop picks this up on next frame automatically
  }

  private handleTPModified(e: OverlayEvent): void {
    const overlay = this.overlays.get(e.positionId);
    if (!overlay || !e.payload) return;
    overlay.takeProfit = e.payload.takeProfit;
  }

  private handleLTPUpdated(e: OverlayEvent): void {
    const overlay = this.overlays.get(e.positionId);
    if (!overlay || e.payload?.ltp == null) return;
    overlay.ltp = e.payload.ltp;
  }

  private handleConnectionRestored(e: OverlayEvent): void {
    if (!e.payload) return;
    // Merge fresh data from store
    const existing = this.overlays.get(e.positionId);
    if (existing && e.payload) {
      Object.assign(existing, e.payload);
    }
    this.syncVisibleOverlays();
  }

  // ─── Drag Callbacks ────────────────────────────────────────────────────────

  private handleDragMove(positionId: string, target: DragTarget, price: number): void {
    const overlay = this.overlays.get(positionId);
    if (!overlay) return;
    overlay.ui.isDraggingSL = target === 'sl';
    overlay.ui.isDraggingTP = target === 'tp';
    overlay.ui.dragPrice = price;
    // Renderer reads this on next RAF frame — no React state needed
  }

  private handleDragEnd(
    positionId: string,
    target: DragTarget,
    finalPrice: number,
    originalPrice: number
  ): void {
    const overlay = this.overlays.get(positionId);
    if (!overlay) return;

    // Reset drag state
    overlay.ui.isDraggingSL = false;
    overlay.ui.isDraggingTP = false;
    overlay.ui.dragPrice = undefined;

    if (Math.abs(finalPrice - originalPrice) < 0.0001) {
      // No meaningful movement — skip confirmation
      return;
    }

    // Request confirmation before committing to backend
    const canvas = this.renderer.getCanvas();
    const canvasY = canvas ? canvas.getBoundingClientRect().top : window.innerHeight / 2;
    const approxY = this.series ? (this.series.priceToCoordinate(finalPrice) ?? 0) : 0;

    this.callbacks.onDragConfirmRequired({
      positionId,
      target,
      originalPrice,
      newPrice: finalPrice,
      x: window.innerWidth / 2,
      y: canvasY + approxY,
    });
  }

  private handleDragCancel(positionId: string, _target: DragTarget): void {
    const overlay = this.overlays.get(positionId);
    if (!overlay) return;
    overlay.ui.isDraggingSL = false;
    overlay.ui.isDraggingTP = false;
    overlay.ui.dragPrice = undefined;
    this.callbacks.onDragConfirmDismiss();
  }

  private handleHoverChange(positionId: string | null): void {
    // Clear previous hover
    if (this.hoveredPositionId) {
      const prev = this.overlays.get(this.hoveredPositionId);
      if (prev) prev.ui.isHovered = false;
    }
    this.hoveredPositionId = positionId;
    if (positionId) {
      const curr = this.overlays.get(positionId);
      if (curr) curr.ui.isHovered = true;
    }
  }

  private handleCloseClick(positionId: string): void {
    exitPosition(positionId).catch((err) => {
      console.error('[OverlayEngine] Failed to close position:', err);
    });
  }

  // ─── Public API — Drag Confirmation ───────────────────────────────────────

  /**
   * Called by host component when user confirms a drag modification.
   */
  async confirmDrag(positionId: string, target: DragTarget, newPrice: number): Promise<void> {
    const overlay = this.overlays.get(positionId);
    if (!overlay) return;

    // Optimistic update
    if (target === 'sl') {
      overlay.stopLoss = newPrice;
      useTradingStore.getState().updatePosition(positionId, { stopLoss: newPrice });
    } else {
      overlay.takeProfit = newPrice;
      useTradingStore.getState().updatePosition(positionId, { takeProfit: newPrice });
    }

    this.callbacks.onDragConfirmDismiss();

    // Backend update
    try {
      if (target === 'sl') {
        await attachStopLoss(positionId, newPrice);
      } else {
        await attachTakeProfit(positionId, newPrice);
      }
    } catch (err) {
      console.error('[OverlayEngine] Backend SL/TP update failed:', err);
      // Revert optimistic update
      const store = useTradingStore.getState();
      const storePos = store.positions.find((p) => p.id === positionId);
      if (storePos) {
        if (target === 'sl') {
          overlay.stopLoss = storePos.stopLoss;
          store.updatePosition(positionId, { stopLoss: storePos.stopLoss });
        } else {
          overlay.takeProfit = storePos.takeProfit;
          store.updatePosition(positionId, { takeProfit: storePos.takeProfit });
        }
      }
    }
  }

  /**
   * Called by host component when user cancels a drag modification.
   */
  revertDrag(positionId: string, target: DragTarget, originalPrice: number): void {
    const overlay = this.overlays.get(positionId);
    if (!overlay) return;

    if (target === 'sl') {
      overlay.stopLoss = originalPrice;
    } else {
      overlay.takeProfit = originalPrice;
    }

    this.callbacks.onDragConfirmDismiss();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build the visible overlay map for the current token and push to renderer.
   */
  private syncVisibleOverlays(): void {
    this.renderer.overlays = this.visibleOverlays();
  }

  /**
   * Return only overlays for the active chart symbol.
   */
  private visibleOverlays(): Map<string, PositionOverlay> {
    if (!this.activeToken) return new Map();
    const result = new Map<string, PositionOverlay>();
    this.overlays.forEach((overlay, id) => {
      if (overlay.token === this.activeToken) {
        result.set(id, overlay);
      }
    });
    return result;
  }

  get hasOverlays(): boolean {
    return this.overlays.size > 0;
  }
}
