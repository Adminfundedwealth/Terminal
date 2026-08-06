/**
 * POSITION CANVAS
 * 
 * High-performance canvas overlay for position visualization.
 * Renders at 60 FPS using requestAnimationFrame.
 * Handles all position-related drawing: lines, labels, zones, drag handles.
 * 
 * Architecture:
 * - Single canvas element overlaid on top of lightweight-charts
 * - Coordinate conversion via chart API
 * - Mouse events handled directly for drag/drop
 * - No React re-renders during mouse movement (pure canvas)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Position } from '@/types';
import { formatPrice } from '@/utils/helpers';

export interface PositionVisual {
  position: Position;
  slPrice?: number;
  tpPrice?: number;
  ltp: number;
  isDraggingSlThis?: boolean;
  isDraggingTpThis?: boolean;
}

interface PositionCanvasProps {
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  containerRef: React.RefObject<HTMLDivElement>;
  positions: PositionVisual[];
  onDragStart: (positionId: string, type: 'sl' | 'tp', price: number, e: MouseEvent) => void;
  onDragMove: (price: number) => void;
  onDragEnd: (positionId: string, type: 'sl' | 'tp', price: number) => void;
  onClose: (positionId: string) => void;
  onPartialClose: (positionId: string, qty: number) => void;
  onReversePosition: (positionId: string) => void;
  onMoveBreakeven: (positionId: string) => void;
  onContextMenu: (positionId: string, type: 'entry' | 'sl' | 'tp', x: number, y: number) => void;
}

interface HitRegion {
  positionId: string;
  type: 'entry' | 'sl' | 'tp' | 'close_entry' | 'close_sl' | 'close_tp';
  y: number;
  dragCursor?: boolean;
}

// Color palette
const COLORS = {
  entryBlue: '#2962ff',
  entryBlueDim: 'rgba(41, 98, 255, 0.15)',
  slRed: '#dc2626',
  slRedDim: 'rgba(220, 38, 38, 0.15)',
  tpGreen: '#16a34a',
  tpGreenDim: 'rgba(22, 163, 74, 0.15)',
  profitZone: 'rgba(22, 163, 74, 0.08)',
  lossZone: 'rgba(220, 38, 38, 0.08)',
  labelBg: 'rgba(10, 12, 20, 0.92)',
  textWhite: '#e2e8f0',
  textMuted: '#6b7280',
  longGreen: '#16a34a',
  shortRed: '#dc2626',
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function PositionCanvas({
  chart,
  series,
  containerRef,
  positions,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClose,
  onPartialClose,
  onReversePosition,
  onMoveBreakeven,
  onContextMenu,
}: PositionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const hoveredRef = useRef<HitRegion | null>(null);
  const draggingRef = useRef<{
    positionId: string;
    type: 'sl' | 'tp';
    currentY: number;
    currentPrice: number;
  } | null>(null);

  // Convert chart price to canvas Y coordinate
  const priceToY = useCallback((price: number): number | null => {
    if (!series) return null;
    const y = series.priceToCoordinate(price);
    return y ?? null;
  }, [series]);

  // Convert canvas Y coordinate to price
  const yToPrice = useCallback((y: number): number | null => {
    if (!series) return null;
    const price = series.coordinateToPrice(y);
    return price ?? null;
  }, [series]);

  // Format currency
  const formatRupee = (val: number) => {
    const abs = Math.abs(val);
    const sign = val >= 0 ? '+' : '-';
    if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
    return `${sign}₹${Math.round(abs)}`;
  };

  // Main render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !chart || !series) return;

    const W = canvas.width;
    const H = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, W, H);

    const newHitRegions: HitRegion[] = [];
    
    // Right margin where labels/buttons are placed
    const labelAreaWidth = 220;
    const labelAreaX = W / dpr - labelAreaWidth - 70; // 70px for price scale
    const rightEdge = W / dpr - 72;

    positions.forEach(({ position, slPrice, tpPrice, ltp, isDraggingSlThis, isDraggingTpThis }) => {
      const entryY = priceToY(position.avgPrice);
      if (entryY == null) return;

      const isLong = position.side === 'LONG' || position.buyQty > position.sellQty;

      // Calculate P/L
      const pnlPerUnit = isLong ? ltp - position.avgPrice : position.avgPrice - ltp;
      const pnl = pnlPerUnit * position.qty;
      const pnlPercent = position.avgPrice > 0 ? (pnlPerUnit / position.avgPrice) * 100 : 0;

      // ═══════════════════════════════════════════════
      // RISK/REWARD ZONES (fill between lines)
      // ═══════════════════════════════════════════════
      
      if (slPrice && slPrice > 0) {
        const slY = priceToY(slPrice);
        if (slY != null) {
          const minY = Math.min(entryY, slY);
          const maxY = Math.max(entryY, slY);
          ctx.fillStyle = COLORS.lossZone;
          ctx.fillRect(0, minY, rightEdge, maxY - minY);
        }
      }

      if (tpPrice && tpPrice > 0) {
        const tpY = priceToY(tpPrice);
        if (tpY != null) {
          const minY = Math.min(entryY, tpY);
          const maxY = Math.max(entryY, tpY);
          ctx.fillStyle = COLORS.profitZone;
          ctx.fillRect(0, minY, rightEdge, maxY - minY);
        }
      }

      // ═══════════════════════════════════════════════
      // ENTRY LINE
      // ═══════════════════════════════════════════════
      const isHoveredEntry = hoveredRef.current?.positionId === position.id && 
                              hoveredRef.current?.type === 'entry';
      
      ctx.save();
      ctx.strokeStyle = COLORS.entryBlue;
      ctx.lineWidth = isHoveredEntry ? 2.5 : 1.5;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, entryY);
      ctx.lineTo(rightEdge, entryY);
      ctx.stroke();
      ctx.restore();

      // Entry label (right side)
      const sideLabel = isLong ? 'BUY' : 'SELL';
      const sideColor = isLong ? COLORS.longGreen : COLORS.shortRed;
      const pnlColor = pnl >= 0 ? COLORS.longGreen : COLORS.shortRed;
      const pnlArrow = pnl >= 0 ? '▲' : '▼';
      const entryText = `${sideLabel}  ${position.qty} Qty  ${formatPrice(position.avgPrice)}`;
      const pnlText = `${formatRupee(pnl)} ${pnlArrow}`;

      drawLineLabel(ctx, labelAreaX, entryY, entryText, pnlText, sideColor, pnlColor, 'entry', position.id, newHitRegions, rightEdge, isHoveredEntry);

      // ═══════════════════════════════════════════════
      // STOP LOSS LINE
      // ═══════════════════════════════════════════════
      const currentSlPrice = isDraggingSlThis && draggingRef.current
        ? draggingRef.current.currentPrice
        : slPrice;

      if (currentSlPrice && currentSlPrice > 0) {
        const slY = priceToY(currentSlPrice);
        if (slY != null) {
          const isHoveredSL = hoveredRef.current?.positionId === position.id && 
                               hoveredRef.current?.type === 'sl';

          ctx.save();
          ctx.strokeStyle = COLORS.slRed;
          ctx.lineWidth = (isHoveredSL || isDraggingSlThis) ? 2.5 : 1.5;
          ctx.setLineDash([8, 4]);
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(0, slY);
          ctx.lineTo(rightEdge, slY);
          ctx.stroke();

          // Drag handle (circle on left side)
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS.slRed;
          ctx.beginPath();
          ctx.arc(30, slY, isHoveredSL || isDraggingSlThis ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();

          // Drag grip lines
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          for (let i = -2; i <= 2; i += 2) {
            ctx.beginPath();
            ctx.moveTo(26, slY + i);
            ctx.lineTo(34, slY + i);
            ctx.stroke();
          }
          ctx.restore();

          // SL label
          const slRisk = Math.abs(position.avgPrice - currentSlPrice) * position.qty;
          const slPoints = Math.abs(position.avgPrice - currentSlPrice);
          const slRiskPct = position.avgPrice > 0 ? (slPoints / position.avgPrice) * 100 : 0;
          const slText = `SL  ${formatPrice(currentSlPrice)}`;
          const slSubText = `-₹${Math.round(slRisk)}  ${slPoints.toFixed(2)}pts  ${slRiskPct.toFixed(2)}%`;
          
          drawLineLabel(ctx, labelAreaX, slY, slText, slSubText, COLORS.slRed, '#9ca3af', 'sl', position.id, newHitRegions, rightEdge, isHoveredSL || !!isDraggingSlThis);
          
          // Add drag hit region
          newHitRegions.push({ positionId: position.id, type: 'sl', y: slY, dragCursor: true });
        }
      }

      // ═══════════════════════════════════════════════
      // TAKE PROFIT LINE
      // ═══════════════════════════════════════════════
      const currentTpPrice = isDraggingTpThis && draggingRef.current
        ? draggingRef.current.currentPrice
        : tpPrice;

      if (currentTpPrice && currentTpPrice > 0) {
        const tpY = priceToY(currentTpPrice);
        if (tpY != null) {
          const isHoveredTP = hoveredRef.current?.positionId === position.id && 
                               hoveredRef.current?.type === 'tp';

          ctx.save();
          ctx.strokeStyle = COLORS.tpGreen;
          ctx.lineWidth = (isHoveredTP || isDraggingTpThis) ? 2.5 : 1.5;
          ctx.setLineDash([8, 4]);
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(0, tpY);
          ctx.lineTo(rightEdge, tpY);
          ctx.stroke();

          // Drag handle
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS.tpGreen;
          ctx.beginPath();
          ctx.arc(30, tpY, isHoveredTP || isDraggingTpThis ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();

          // Drag grip
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          for (let i = -2; i <= 2; i += 2) {
            ctx.beginPath();
            ctx.moveTo(26, tpY + i);
            ctx.lineTo(34, tpY + i);
            ctx.stroke();
          }
          ctx.restore();

          // TP label
          const tpReward = Math.abs(currentTpPrice - position.avgPrice) * position.qty;
          const tpPoints = Math.abs(currentTpPrice - position.avgPrice);
          const tpRewardPct = position.avgPrice > 0 ? (tpPoints / position.avgPrice) * 100 : 0;
          
          // RR ratio
          const riskPerUnit = slPrice ? Math.abs(position.avgPrice - slPrice) : 0;
          const rewardPerUnit = Math.abs(currentTpPrice - position.avgPrice);
          const rrText = riskPerUnit > 0 ? `  RR 1:${(rewardPerUnit / riskPerUnit).toFixed(2)}` : '';
          
          const tpText = `TP  ${formatPrice(currentTpPrice)}`;
          const tpSubText = `+₹${Math.round(tpReward)}  ${tpPoints.toFixed(2)}pts  ${tpRewardPct.toFixed(2)}%${rrText}`;
          
          drawLineLabel(ctx, labelAreaX, tpY, tpText, tpSubText, COLORS.tpGreen, '#9ca3af', 'tp', position.id, newHitRegions, rightEdge, isHoveredTP || !!isDraggingTpThis);
          
          // Add drag hit region
          newHitRegions.push({ positionId: position.id, type: 'tp', y: tpY, dragCursor: true });
        }
      }

      // ═══════════════════════════════════════════════
      // LIVE DRAGGING TOOLTIP
      // ═══════════════════════════════════════════════
      if (draggingRef.current && draggingRef.current.positionId === position.id) {
        const { type, currentPrice } = draggingRef.current;
        const dragY = priceToY(currentPrice);
        
        if (dragY != null) {
          const isSL = type === 'sl';
          const refPrice = position.avgPrice;
          const risk = Math.abs(refPrice - currentPrice) * position.qty;
          const points = Math.abs(refPrice - currentPrice);
          const riskPct = refPrice > 0 ? (points / refPrice) * 100 : 0;
          
          // Live metrics box
          const tooltipText = isSL
            ? `SL  ${formatPrice(currentPrice)}   Risk ₹${Math.round(risk)}   ${riskPct.toFixed(2)}%   ${points.toFixed(2)} pts`
            : `TP  ${formatPrice(currentPrice)}   Reward ₹${Math.round(risk)}   ${riskPct.toFixed(2)}%   ${points.toFixed(2)} pts`;

          const boxW = 380;
          const boxH = 28;
          const boxX = 50;
          const boxY = dragY - boxH - 6;

          ctx.save();
          ctx.fillStyle = isSL ? 'rgba(220, 38, 38, 0.95)' : 'rgba(22, 163, 74, 0.95)';
          roundRect(ctx, boxX, boxY, boxW, boxH, 4);
          ctx.fill();

          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px "Inter", "SF Pro", monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText(tooltipText, boxX + 10, boxY + boxH / 2);
          ctx.restore();
        }
      }
    });

    hitRegionsRef.current = newHitRegions;
  }, [positions, priceToY, series, chart]);

  // Draw a right-side label for a price line
  function drawLineLabel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    mainText: string,
    subText: string,
    mainColor: string,
    subColor: string,
    type: 'entry' | 'sl' | 'tp',
    positionId: string,
    hitRegions: HitRegion[],
    rightEdge: number,
    hovered: boolean
  ) {
    const padding = 8;
    const lineH = 17;
    const totalH = lineH * 2 + padding * 2;
    const mainFontSize = 11;
    const subFontSize = 10;

    // Measure widths
    ctx.save();
    ctx.font = `bold ${mainFontSize}px "Inter", monospace`;
    const mainW = ctx.measureText(mainText).width;
    ctx.font = `${subFontSize}px "Inter", monospace`;
    const subW = ctx.measureText(subText).width;
    ctx.restore();

    const boxW = Math.max(mainW, subW) + padding * 2 + 28; // +28 for X button
    const boxX = rightEdge - boxW - 4;
    const boxY = y - totalH / 2;

    // Background
    ctx.save();
    ctx.fillStyle = hovered ? 'rgba(15, 18, 30, 0.98)' : COLORS.labelBg;
    roundRect(ctx, boxX, boxY, boxW, totalH, 4);
    ctx.fill();

    // Border
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = hovered ? 1.5 : 1;
    ctx.setLineDash([]);
    roundRect(ctx, boxX, boxY, boxW, totalH, 4);
    ctx.stroke();

    // Main text
    ctx.fillStyle = mainColor;
    ctx.font = `bold ${mainFontSize}px "Inter", monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(mainText, boxX + padding, boxY + padding);

    // Sub text
    ctx.fillStyle = subColor;
    ctx.font = `${subFontSize}px "Inter", monospace`;
    ctx.fillText(subText, boxX + padding, boxY + padding + lineH);

    // X button
    const xBtnX = boxX + boxW - 22;
    const xBtnY = boxY + totalH / 2 - 8;
    const xBtnSize = 16;

    if (hovered) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      roundRect(ctx, xBtnX, xBtnY, xBtnSize, xBtnSize, 3);
      ctx.fill();
    }

    ctx.fillStyle = hovered ? '#fff' : '#6b7280';
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('✕', xBtnX + xBtnSize / 2, xBtnY + xBtnSize / 2);
    ctx.textAlign = 'left';

    // Hit region for the label
    hitRegions.push({ positionId, type, y });

    // Hit region for X button
    const closeBtnType = `close_${type}` as 'close_entry' | 'close_sl' | 'close_tp';
    hitRegions.push({ positionId, type: closeBtnType, y });

    ctx.restore();
  }

  // RAF render loop
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      render();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [render]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

  // Mouse event handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const HIT_TOLERANCE = 8; // px

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (draggingRef.current) {
        // Update drag price
        const price = yToPrice(my);
        if (price != null) {
          draggingRef.current.currentY = my;
          draggingRef.current.currentPrice = price;
          onDragMove(price);
        }
        canvas.style.cursor = 'ns-resize';
        return;
      }

      // Check hit regions
      let found: HitRegion | null = null;
      for (const region of hitRegionsRef.current) {
        if (Math.abs(my - region.y) < HIT_TOLERANCE) {
          found = region;
          break;
        }
      }

      hoveredRef.current = found;

      if (found?.dragCursor) {
        canvas.style.cursor = 'ns-resize';
      } else if (found) {
        canvas.style.cursor = 'pointer';
      } else {
        canvas.style.cursor = '';
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;

      if (e.button !== 0) return;

      for (const region of hitRegionsRef.current) {
        if (Math.abs(my - region.y) < 8) {
          if (region.type === 'sl' || region.type === 'tp') {
            e.preventDefault();
            e.stopPropagation();

            const price = yToPrice(my) ?? 0;
            draggingRef.current = {
              positionId: region.positionId,
              type: region.type,
              currentY: my,
              currentPrice: price,
            };
            onDragStart(region.positionId, region.type, price, e);
            canvas.style.cursor = 'ns-resize';
            return;
          }
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (draggingRef.current) {
        const { positionId, type, currentPrice } = draggingRef.current;
        onDragEnd(positionId, type, currentPrice);
        draggingRef.current = null;
        canvas.style.cursor = '';
      }
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const region of hitRegionsRef.current) {
        if (Math.abs(my - region.y) < 8) {
          if (region.type === 'close_entry') {
            onClose(region.positionId);
            return;
          }
          if (region.type === 'close_sl' || region.type === 'close_tp') {
            // Clear SL or TP
            onClose(region.positionId);
            return;
          }
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;

      for (const region of hitRegionsRef.current) {
        if (Math.abs(my - region.y) < 8) {
          if (region.type === 'entry' || region.type === 'sl' || region.type === 'tp') {
            e.preventDefault();
            onContextMenu(region.positionId, region.type, e.clientX, e.clientY);
            return;
          }
        }
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);

    // Global mouse up (in case mouse released outside canvas)
    const globalMouseUp = () => {
      if (draggingRef.current) {
        const { positionId, type, currentPrice } = draggingRef.current;
        onDragEnd(positionId, type, currentPrice);
        draggingRef.current = null;
        canvas.style.cursor = '';
      }
    };
    window.addEventListener('mouseup', globalMouseUp);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mouseup', globalMouseUp);
    };
  }, [yToPrice, onDragStart, onDragMove, onDragEnd, onClose, onContextMenu]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: positions.length > 0 ? 'auto' : 'none',
        zIndex: 10,
      }}
    />
  );
}
