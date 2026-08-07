/**
 * DragController — SL/TP Drag Interaction
 *
 * Handles mouse events on the canvas for dragging SL and TP lines.
 *
 * Lifecycle:
 *   mousedown on a drag hit region → beginDrag()
 *   mousemove                      → updateDrag()  (fires onDragMove)
 *   mouseup / mouseleave           → endDrag()     (fires onDragEnd)
 *   ESC key                        → cancelDrag()  (fires onDragCancel)
 *
 * Performance rules:
 *  - NEVER causes React state updates during drag
 *  - NEVER triggers chart rerender
 *  - Only the overlay's ui.dragPrice is mutated — handled by OverlayEngine
 *  - Targets 60 FPS — the render loop reads dragPrice each frame
 *
 * After release, a confirmation is requested before the API call is made.
 * If cancelled, the overlay reverts to originalPrice.
 */

import type { HitRegion, ActiveDrag, DragTarget } from '../types';

export interface DragCallbacks {
  /** Called every mouse move during drag with the new price. */
  onDragMove: (positionId: string, target: DragTarget, price: number) => void;
  /** Called on mouse release — triggers confirmation flow. */
  onDragEnd: (positionId: string, target: DragTarget, finalPrice: number, originalPrice: number) => void;
  /** Called when drag is cancelled (ESC). */
  onDragCancel: (positionId: string, target: DragTarget) => void;
  /** Called on hover hit region change. */
  onHoverChange: (positionId: string | null) => void;
  /** Called on close-button click. */
  onCloseClick: (positionId: string) => void;
  /** Called on right-click over a line. */
  onContextMenu: (positionId: string, lineType: 'entry' | 'sl' | 'tp', x: number, y: number) => void;
}

export class DragController {
  private canvas: HTMLCanvasElement | null = null;
  private activeDrag: ActiveDrag | null = null;
  private yToPrice: (y: number) => number | null = () => null;
  private getHitRegions: () => HitRegion[] = () => [];
  private callbacks: DragCallbacks;

  private abortController: AbortController | null = null;

  constructor(callbacks: DragCallbacks) {
    this.callbacks = callbacks;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  attach(
    canvas: HTMLCanvasElement,
    yToPriceFn: (y: number) => number | null,
    hitRegionsFn: () => HitRegion[]
  ): void {
    this.canvas = canvas;
    this.yToPrice = yToPriceFn;
    this.getHitRegions = hitRegionsFn;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    canvas.addEventListener('mousemove', this.handleMouseMove, { signal });
    canvas.addEventListener('mousedown', this.handleMouseDown, { signal });
    canvas.addEventListener('mouseup', this.handleMouseUp, { signal });
    canvas.addEventListener('mouseleave', this.handleMouseLeave, { signal });
    canvas.addEventListener('click', this.handleClick, { signal });
    canvas.addEventListener('contextmenu', this.handleContextMenu, { signal });

    // Global mouseup — release drag even if mouse leaves canvas
    window.addEventListener('mouseup', this.handleGlobalMouseUp, { signal });
    // ESC to cancel
    window.addEventListener('keydown', this.handleKeyDown, { signal });
  }

  detach(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.activeDrag = null;
    this.canvas = null;
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  private handleMouseMove = (e: MouseEvent): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;

    if (this.activeDrag) {
      const price = this.yToPrice(my);
      if (price != null) {
        this.activeDrag.currentPrice = price;
        this.callbacks.onDragMove(this.activeDrag.positionId, this.activeDrag.target, price);
      }
      canvas.style.cursor = 'ns-resize';
      return;
    }

    // Hover detection
    const hit = this.findHit(my);
    if (hit) {
      if (hit.hitType === 'sl_drag' || hit.hitType === 'tp_drag') {
        canvas.style.cursor = 'ns-resize';
      } else {
        canvas.style.cursor = 'pointer';
      }
      this.callbacks.onHoverChange(hit.positionId);
    } else {
      canvas.style.cursor = '';
      this.callbacks.onHoverChange(null);
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;

    const hit = this.findHit(my);
    if (!hit) return;

    if (hit.hitType === 'sl_drag' || hit.hitType === 'tp_drag') {
      e.preventDefault();
      e.stopPropagation();
      const price = this.yToPrice(my) ?? 0;
      const target: DragTarget = hit.hitType === 'sl_drag' ? 'sl' : 'tp';
      this.activeDrag = {
        positionId: hit.positionId,
        target,
        originalPrice: price,
        currentPrice: price,
        startY: my,
      };
      canvas.style.cursor = 'ns-resize';
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.finishDrag();
  };

  private handleGlobalMouseUp = (): void => {
    this.finishDrag();
  };

  private handleMouseLeave = (): void => {
    this.callbacks.onHoverChange(null);
    if (this.canvas) this.canvas.style.cursor = '';
    // Don't cancel drag on mouse leave — user may re-enter
  };

  private handleClick = (e: MouseEvent): void => {
    if (this.activeDrag) return; // ignore click at end of drag
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;

    const hit = this.findHit(my);
    if (!hit) return;

    if (hit.hitType === 'close_btn') {
      this.callbacks.onCloseClick(hit.positionId);
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;

    const hit = this.findHit(my);
    if (!hit) return;

    e.preventDefault();
    const lineType =
      hit.hitType === 'sl' || hit.hitType === 'sl_drag' ? 'sl' :
      hit.hitType === 'tp' || hit.hitType === 'tp_drag' ? 'tp' : 'entry';
    this.callbacks.onContextMenu(hit.positionId, lineType, e.clientX, e.clientY);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.activeDrag) {
      const { positionId, target } = this.activeDrag;
      this.activeDrag = null;
      this.callbacks.onDragCancel(positionId, target);
      if (this.canvas) this.canvas.style.cursor = '';
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private finishDrag(): void {
    if (!this.activeDrag) return;
    const { positionId, target, currentPrice, originalPrice } = this.activeDrag;
    this.activeDrag = null;
    if (this.canvas) this.canvas.style.cursor = '';
    this.callbacks.onDragEnd(positionId, target, currentPrice, originalPrice);
  }

  private findHit(canvasY: number): HitRegion | null {
    const regions = this.getHitRegions();
    for (const region of regions) {
      if (Math.abs(canvasY - region.y) <= region.tolerance) {
        return region;
      }
    }
    return null;
  }

  get isDragging(): boolean {
    return this.activeDrag != null;
  }
}
