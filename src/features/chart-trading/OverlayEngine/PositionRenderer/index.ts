/**
 * PositionRenderer — 60 FPS Canvas Overlay
 *
 * Draws all position overlays on a single canvas element.
 *
 * Drawing order (back to front):
 *  1. Risk zone fill (SL ↔ entry)
 *  2. Reward zone fill (TP ↔ entry)
 *  3. Stop Loss line + drag handle
 *  4. Take Profit line + drag handle
 *  5. Entry line
 *  6. SL label box
 *  7. TP label box
 *  8. Entry label / P&L box
 *  9. Live drag tooltip
 *
 * Performance:
 *  - Single RAF loop
 *  - No React state mutations during render
 *  - Hit regions rebuilt each frame (no stale refs)
 *  - Canvas is cleared and redrawn each frame (simple and correct)
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { PositionOverlay, HitRegion, RenderContext } from '../types';
import { OVERLAY_COLORS } from './colors';
import { roundRect, drawGripLines, measureText } from './geometry';

const LABEL_RIGHT_MARGIN = 72;   // px from right edge to price scale
const HANDLE_RADIUS_IDLE = 5;
const HANDLE_RADIUS_HOVER = 7;
const HIT_TOLERANCE = 9;         // px — match zone for hit testing
const FONT_MAIN = 'bold 11px "Inter", ui-sans-serif, system-ui, monospace';
const FONT_SUB = '10px "Inter", ui-sans-serif, system-ui, monospace';

export class PositionRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private chart: IChartApi | null = null;
  private series: ISeriesApi<any> | null = null;
  private containerEl: HTMLElement | null = null;

  private rafId = 0;
  private isRunning = false;
  private resizeObserver: ResizeObserver | null = null;

  /** All overlays to render — updated externally */
  overlays: Map<string, PositionOverlay> = new Map();

  /** Built each frame — used by DragController and click handler */
  hitRegions: HitRegion[] = [];

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  mount(
    container: HTMLElement,
    chart: IChartApi,
    series: ISeriesApi<any>
  ): HTMLCanvasElement {
    this.chart = chart;
    this.series = series;
    this.containerEl = container;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;z-index:10;';
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    this.syncSize();

    // Watch for container resize
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(container);

    this.start();
    return canvas;
  }

  updateSeries(series: ISeriesApi<any>): void {
    this.series = series;
  }

  unmount(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.containerEl = null;
    this.overlays.clear();
    this.hitRegions = [];
  }

  /** Enable / disable pointer events on the canvas (needed for drag). */
  setPointerEvents(enabled: boolean): void {
    if (this.canvas) {
      this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    }
  }

  // ─── RAF Loop ─────────────────────────────────────────────────────────────

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const loop = () => {
      if (!this.isRunning) return;
      this.renderFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stop(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
  }

  // ─── Size Sync ────────────────────────────────────────────────────────────

  private syncSize(): void {
    const canvas = this.canvas;
    const container = this.containerEl;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // ─── Coordinate Helpers ────────────────────────────────────────────────────

  private priceToY(price: number): number | null {
    if (!this.series) return null;
    const y = this.series.priceToCoordinate(price);
    return y ?? null;
  }

  // ─── Main Render Frame ────────────────────────────────────────────────────

  private renderFrame(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx || !this.chart || !this.series) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    ctx.clearRect(0, 0, W, H);

    if (this.overlays.size === 0) return;

    const rCtx: RenderContext = {
      canvas,
      ctx,
      width: W,
      height: H,
      dpr,
      labelAreaX: W - LABEL_RIGHT_MARGIN - 220,
      chartRightEdge: W - LABEL_RIGHT_MARGIN,
    };

    const newHitRegions: HitRegion[] = [];

    this.overlays.forEach((overlay) => {
      this.renderOverlay(overlay, rCtx, newHitRegions);
    });

    this.hitRegions = newHitRegions;

    // Enable pointer events only when there are overlays
    if (this.canvas) {
      this.canvas.style.pointerEvents = this.overlays.size > 0 ? 'auto' : 'none';
    }
  }

  // ─── Per-Overlay Rendering ─────────────────────────────────────────────────

  private renderOverlay(
    overlay: PositionOverlay,
    rc: RenderContext,
    hitRegions: HitRegion[]
  ): void {
    const { ctx, chartRightEdge, labelAreaX } = rc;
    const { avgPrice, side, qty, ltp, stopLoss, takeProfit, ui } = overlay;

    const entryY = this.priceToY(avgPrice);
    if (entryY == null) return;

    const isLong = side === 'LONG';

    // Live drag price overrides
    const currentSL = ui.isDraggingSL && ui.dragPrice != null ? ui.dragPrice : stopLoss;
    const currentTP = ui.isDraggingTP && ui.dragPrice != null ? ui.dragPrice : takeProfit;

    // ── 1. Zone fills ───────────────────────────────────────────────────────
    if (currentSL && currentSL > 0) {
      const slY = this.priceToY(currentSL);
      if (slY != null) {
        const yMin = Math.min(entryY, slY);
        const yMax = Math.max(entryY, slY);
        ctx.fillStyle = OVERLAY_COLORS.slZone;
        ctx.fillRect(0, yMin, chartRightEdge, yMax - yMin);
      }
    }

    if (currentTP && currentTP > 0) {
      const tpY = this.priceToY(currentTP);
      if (tpY != null) {
        const yMin = Math.min(entryY, tpY);
        const yMax = Math.max(entryY, tpY);
        ctx.fillStyle = OVERLAY_COLORS.tpZone;
        ctx.fillRect(0, yMin, chartRightEdge, yMax - yMin);
      }
    }

    // ── 2. Stop Loss line + handle ──────────────────────────────────────────
    if (currentSL && currentSL > 0) {
      const slY = this.priceToY(currentSL);
      if (slY != null) {
        const isHovered = ui.isHovered && !ui.isDraggingSL && !ui.isDraggingTP;
        const isActive = ui.isDraggingSL || isHovered;

        this.drawDashedLine(ctx, slY, chartRightEdge, OVERLAY_COLORS.sl, isActive ? 2 : 1.5);
        this.drawDragHandle(ctx, slY, OVERLAY_COLORS.slHandle, isActive);

        hitRegions.push({ positionId: overlay.id, hitType: 'sl_drag', y: slY, tolerance: HIT_TOLERANCE });
      }
    }

    // ── 3. Take Profit line + handle ───────────────────────────────────────
    if (currentTP && currentTP > 0) {
      const tpY = this.priceToY(currentTP);
      if (tpY != null) {
        const isHovered = ui.isHovered && !ui.isDraggingSL && !ui.isDraggingTP;
        const isActive = ui.isDraggingTP || isHovered;

        this.drawDashedLine(ctx, tpY, chartRightEdge, OVERLAY_COLORS.tp, isActive ? 2 : 1.5);
        this.drawDragHandle(ctx, tpY, OVERLAY_COLORS.tpHandle, isActive);

        hitRegions.push({ positionId: overlay.id, hitType: 'tp_drag', y: tpY, tolerance: HIT_TOLERANCE });
      }
    }

    // ── 4. Entry line ───────────────────────────────────────────────────────
    const entryColor = isLong ? OVERLAY_COLORS.long : OVERLAY_COLORS.short;
    ctx.save();
    ctx.strokeStyle = entryColor;
    ctx.lineWidth = ui.isHovered ? 2 : 1.5;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, entryY);
    ctx.lineTo(chartRightEdge, entryY);
    ctx.stroke();
    ctx.restore();

    hitRegions.push({ positionId: overlay.id, hitType: 'entry', y: entryY, tolerance: HIT_TOLERANCE });

    // ── 5. SL Label box ─────────────────────────────────────────────────────
    if (currentSL && currentSL > 0) {
      const slY = this.priceToY(currentSL);
      if (slY != null) {
        const risk = Math.abs(avgPrice - currentSL) * qty;
        const pts = Math.abs(avgPrice - currentSL);
        const riskPct = avgPrice > 0 ? (pts / avgPrice) * 100 : 0;
        const mainText = `SL  ${formatPrice(currentSL)}`;
        const subText = `${formatRupee(-risk)}   ${pts.toFixed(2)} pts   ${riskPct.toFixed(2)}%`;
        this.drawLabelBox(
          ctx, slY, labelAreaX, chartRightEdge,
          mainText, subText,
          OVERLAY_COLORS.sl, OVERLAY_COLORS.textMuted,
          overlay.id, 'sl', hitRegions,
          ui.isDraggingSL || (ui.isHovered && !ui.isDraggingTP)
        );
      }
    }

    // ── 6. TP Label box ─────────────────────────────────────────────────────
    if (currentTP && currentTP > 0) {
      const tpY = this.priceToY(currentTP);
      if (tpY != null) {
        const reward = Math.abs(currentTP - avgPrice) * qty;
        const pts = Math.abs(currentTP - avgPrice);
        const rewardPct = avgPrice > 0 ? (pts / avgPrice) * 100 : 0;
        // Risk/Reward ratio
        const riskPts = currentSL ? Math.abs(avgPrice - currentSL) : 0;
        const rrStr = riskPts > 0 ? `   RR 1:${(pts / riskPts).toFixed(1)}` : '';
        const mainText = `TP  ${formatPrice(currentTP)}`;
        const subText = `${formatRupee(reward)}   ${pts.toFixed(2)} pts   ${rewardPct.toFixed(2)}%${rrStr}`;
        this.drawLabelBox(
          ctx, tpY, labelAreaX, chartRightEdge,
          mainText, subText,
          OVERLAY_COLORS.tp, OVERLAY_COLORS.textMuted,
          overlay.id, 'tp', hitRegions,
          ui.isDraggingTP || (ui.isHovered && !ui.isDraggingSL)
        );
      }
    }

    // ── 7. Entry label / P&L box ────────────────────────────────────────────
    const pnlPerUnit = isLong ? ltp - avgPrice : avgPrice - ltp;
    const pnl = pnlPerUnit * qty;
    const pnlColor = pnl >= 0 ? OVERLAY_COLORS.pnlProfit : OVERLAY_COLORS.pnlLoss;
    const arrow = pnl >= 0 ? '▲' : '▼';
    const sideLabel = isLong ? 'BUY' : 'SELL';
    const mainText = `${sideLabel}  ${qty}  @${formatPrice(avgPrice)}`;
    const pnlText = `${formatRupee(pnl)} ${arrow}`;

    this.drawEntryLabelBox(
      ctx, entryY, labelAreaX, chartRightEdge,
      mainText, pnlText,
      entryColor, pnlColor,
      overlay.id, hitRegions,
      ui.isHovered
    );

    // ── 8. Live drag tooltip ─────────────────────────────────────────────────
    if ((ui.isDraggingSL || ui.isDraggingTP) && ui.dragPrice != null) {
      const dragY = this.priceToY(ui.dragPrice);
      if (dragY != null) {
        this.drawDragTooltip(ctx, overlay, dragY, ui.isDraggingSL);
      }
    }
  }

  // ─── Drawing Primitives ────────────────────────────────────────────────────

  private drawDashedLine(
    ctx: CanvasRenderingContext2D,
    y: number,
    rightEdge: number,
    color: string,
    lineWidth: number
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([8, 4]);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(rightEdge, y);
    ctx.stroke();
    ctx.restore();
  }

  private drawDragHandle(
    ctx: CanvasRenderingContext2D,
    y: number,
    color: string,
    active: boolean
  ): void {
    const cx = 22;
    const r = active ? HANDLE_RADIUS_HOVER : HANDLE_RADIUS_IDLE;

    ctx.save();
    // Circle
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Grip lines
    drawGripLines(ctx, cx, y, 'rgba(255,255,255,0.85)');
    ctx.restore();
  }

  private drawLabelBox(
    ctx: CanvasRenderingContext2D,
    y: number,
    labelAreaX: number,
    rightEdge: number,
    mainText: string,
    subText: string,
    mainColor: string,
    subColor: string,
    positionId: string,
    lineType: 'sl' | 'tp',
    hitRegions: HitRegion[],
    active: boolean
  ): void {
    const PAD = 7;
    const LINE_H = 16;
    const BOX_H = LINE_H * 2 + PAD * 2;
    const CLOSE_BTN_W = 22;

    ctx.save();

    ctx.font = FONT_MAIN;
    const mainW = measureText(ctx, mainText);
    ctx.font = FONT_SUB;
    const subW = measureText(ctx, subText);

    const contentW = Math.max(mainW, subW);
    const boxW = contentW + PAD * 2 + CLOSE_BTN_W + 4;
    const boxX = rightEdge - boxW - 4;
    const boxY = y - BOX_H / 2;

    // Background
    roundRect(ctx, boxX, boxY, boxW, BOX_H, 4);
    ctx.fillStyle = active ? OVERLAY_COLORS.labelBgHover : OVERLAY_COLORS.labelBg;
    ctx.fill();

    // Border
    roundRect(ctx, boxX, boxY, boxW, BOX_H, 4);
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = active ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.stroke();

    // Main text
    ctx.fillStyle = mainColor;
    ctx.font = FONT_MAIN;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(mainText, boxX + PAD, boxY + PAD);

    // Sub text
    ctx.fillStyle = subColor;
    ctx.font = FONT_SUB;
    ctx.fillText(subText, boxX + PAD, boxY + PAD + LINE_H);

    // Close button
    const btnX = boxX + boxW - CLOSE_BTN_W;
    const btnY = boxY + BOX_H / 2 - 8;
    const btnSize = 16;

    if (active) {
      roundRect(ctx, btnX, btnY, btnSize, btnSize, 3);
      ctx.fillStyle = OVERLAY_COLORS.closeBtnHoverBg;
      ctx.fill();
    }

    ctx.fillStyle = active ? OVERLAY_COLORS.closeBtnHover : OVERLAY_COLORS.closeBtnText;
    ctx.font = 'bold 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('✕', btnX + btnSize / 2, btnY + btnSize / 2);

    ctx.restore();

    // Hit regions
    hitRegions.push({ positionId, hitType: lineType, y, tolerance: HIT_TOLERANCE });
    hitRegions.push({ positionId, hitType: 'close_btn', y, tolerance: HIT_TOLERANCE });
  }

  private drawEntryLabelBox(
    ctx: CanvasRenderingContext2D,
    y: number,
    labelAreaX: number,
    rightEdge: number,
    mainText: string,
    pnlText: string,
    entryColor: string,
    pnlColor: string,
    positionId: string,
    hitRegions: HitRegion[],
    active: boolean
  ): void {
    const PAD = 7;
    const LINE_H = 16;
    const BOX_H = LINE_H * 2 + PAD * 2;
    const CLOSE_BTN_W = 22;

    ctx.save();

    ctx.font = FONT_MAIN;
    const mainW = measureText(ctx, mainText);
    ctx.font = FONT_SUB;
    const pnlW = measureText(ctx, pnlText);

    const contentW = Math.max(mainW, pnlW);
    const boxW = contentW + PAD * 2 + CLOSE_BTN_W + 4;
    const boxX = rightEdge - boxW - 4;
    const boxY = y - BOX_H / 2;

    // Background
    roundRect(ctx, boxX, boxY, boxW, BOX_H, 4);
    ctx.fillStyle = active ? OVERLAY_COLORS.labelBgHover : OVERLAY_COLORS.labelBg;
    ctx.fill();

    // Border
    roundRect(ctx, boxX, boxY, boxW, BOX_H, 4);
    ctx.strokeStyle = entryColor;
    ctx.lineWidth = active ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.stroke();

    // Main text
    ctx.fillStyle = entryColor;
    ctx.font = FONT_MAIN;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(mainText, boxX + PAD, boxY + PAD);

    // P&L text
    ctx.fillStyle = pnlColor;
    ctx.font = FONT_MAIN;
    ctx.fillText(pnlText, boxX + PAD, boxY + PAD + LINE_H);

    // Close button
    const btnX = boxX + boxW - CLOSE_BTN_W;
    const btnY = boxY + BOX_H / 2 - 8;
    const btnSize = 16;

    if (active) {
      roundRect(ctx, btnX, btnY, btnSize, btnSize, 3);
      ctx.fillStyle = OVERLAY_COLORS.closeBtnHoverBg;
      ctx.fill();
    }

    ctx.fillStyle = active ? OVERLAY_COLORS.closeBtnHover : OVERLAY_COLORS.closeBtnText;
    ctx.font = 'bold 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('✕', btnX + btnSize / 2, btnY + btnSize / 2);

    ctx.restore();

    hitRegions.push({ positionId, hitType: 'entry', y, tolerance: HIT_TOLERANCE });
    hitRegions.push({ positionId, hitType: 'close_btn', y, tolerance: HIT_TOLERANCE });
  }

  private drawDragTooltip(
    ctx: CanvasRenderingContext2D,
    overlay: PositionOverlay,
    y: number,
    isSL: boolean
  ): void {
    if (overlay.ui.dragPrice == null) return;
    const price = overlay.ui.dragPrice;
    const refPrice = overlay.avgPrice;
    const distance = Math.abs(refPrice - price);
    const distPct = refPrice > 0 ? (distance / refPrice) * 100 : 0;
    const value = distance * overlay.qty;

    const label = isSL
      ? `SL  ${formatPrice(price)}   Risk ${formatRupee(value)}   ${distPct.toFixed(2)}%   ${distance.toFixed(2)} pts`
      : `TP  ${formatPrice(price)}   Reward ${formatRupee(value)}   ${distPct.toFixed(2)}%   ${distance.toFixed(2)} pts`;

    const boxW = 400;
    const boxH = 26;
    const boxX = 50;
    const boxY = y - boxH - 6;

    ctx.save();
    roundRect(ctx, boxX, boxY, boxW, boxH, 4);
    ctx.fillStyle = isSL ? OVERLAY_COLORS.dragTooltipSL : OVERLAY_COLORS.dragTooltipTP;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Inter", ui-sans-serif, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, boxX + 10, boxY + boxH / 2);
    ctx.restore();
  }

  // ─── Y → Price ────────────────────────────────────────────────────────────

  yToPrice(canvasY: number): number | null {
    if (!this.series) return null;
    return this.series.coordinateToPrice(canvasY) ?? null;
  }

  /** Returns the canvas element for external event binding. */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(2);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}

function formatRupee(val: number): string {
  const sign = val >= 0 ? '+' : '-';
  const abs = Math.abs(val);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000)  return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000)    return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}
