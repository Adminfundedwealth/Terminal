/**
 * POSITION CANVAS — TradeLocker-style interactive overlay
 *
 * Key behaviors:
 *  - Entry line always visible with live P&L label
 *  - SL line visible when set — red dashed, draggable handle on LEFT
 *  - TP line visible when set — green dashed, draggable handle on LEFT
 *  - Ghost SL/TP buttons on entry label when SL/TP not set (click to place)
 *  - Hover over handle → ns-resize cursor
 *  - Drag handle → live line moves with mouse → release → API update
 *  - Close (✕) button on every label
 *  - 60 FPS RAF loop — zero React state during drag
 */

import { useEffect, useRef, useCallback } from 'react';
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
  type: 'entry' | 'sl' | 'tp' | 'close_entry' | 'close_sl' | 'close_tp' | 'add_sl' | 'add_tp';
  y: number;
  /** x range for button hit testing */
  x1?: number;
  x2?: number;
  dragCursor?: boolean;
}

const C = {
  entry: '#2962ff',
  long: '#2962ff',
  short: '#f7525f',
  sl: '#ef4444',
  slZone: 'rgba(239,68,68,0.07)',
  tp: '#22c55e',
  tpZone: 'rgba(34,197,94,0.07)',
  labelBg: 'rgba(8,10,18,0.94)',
  labelBgHover: 'rgba(14,17,28,0.98)',
  textPrimary: '#e2e8f0',
  textMuted: '#6b7280',
  profit: '#22c55e',
  loss: '#ef4444',
  closeBtnIdle: '#6b7280',
  closeBtnHover: '#e2e8f0',
  addBtnBg: 'rgba(255,255,255,0.08)',
  addBtnBgHover: 'rgba(255,255,255,0.16)',
  dragTooltipSL: 'rgba(239,68,68,0.92)',
  dragTooltipTP: 'rgba(34,197,94,0.92)',
} as const;

const FONT_BOLD = 'bold 11px "Inter",ui-sans-serif,monospace';
const FONT_REG  = '10px "Inter",ui-sans-serif,monospace';
const HIT = 10;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr);
  ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

function fmtMoney(val: number): string {
  const s = val >= 0 ? '+' : '-';
  const a = Math.abs(val);
  if (a >= 10000000) return `${s}₹${(a/10000000).toFixed(1)}Cr`;
  if (a >= 100000)   return `${s}₹${(a/100000).toFixed(1)}L`;
  if (a >= 1000)     return `${s}₹${(a/1000).toFixed(1)}K`;
  return `${s}₹${Math.round(a)}`;
}

function fmtUSD(val: number): string {
  const s = val >= 0 ? '+' : '-';
  const a = Math.abs(val);
  if (a >= 1000000) return `${s}$${(a/1000000).toFixed(2)}M`;
  if (a >= 1000)    return `${s}$${(a/1000).toFixed(2)}K`;
  return `${s}$${a.toFixed(2)}`;
}

function fmtPnl(val: number, symbol: string): string {
  // Use USD formatting for crypto/forex symbols that contain USD
  const useUSD = /USD|EUR|GBP|JPY|BTC|ETH/i.test(symbol);
  return useUSD ? fmtUSD(val) : fmtMoney(val);
}


export function PositionCanvas({
  chart, series, containerRef, positions,
  onDragStart, onDragMove, onDragEnd,
  onClose, onPartialClose, onReversePosition, onMoveBreakeven, onContextMenu,
}: PositionCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const hitRef      = useRef<HitRegion[]>([]);
  const hoveredRef  = useRef<HitRegion | null>(null);
  const posRef      = useRef(positions);
  posRef.current    = positions;

  // Internal canvas-level drag (no React state)
  const cdragRef = useRef<{
    positionId: string;
    type: 'sl' | 'tp';
    currentY: number;
    currentPrice: number;
  } | null>(null);

  const priceToY = useCallback((price: number) => {
    if (!series) return null;
    return series.priceToCoordinate(price) ?? null;
  }, [series]);

  const yToPrice = useCallback((y: number) => {
    if (!series) return null;
    return series.coordinateToPrice(y) ?? null;
  }, [series]);


  // ─── Main render ────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !series) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.clearRect(0, 0, W, H);

    const hits: HitRegion[] = [];
    // Price scale is ~72px wide on right — chart line ends before it
    const RE = W - 72;          // right edge of line
    const LAX = RE - 240;       // label area start X

    posRef.current.forEach(({ position, slPrice, tpPrice, ltp, isDraggingSlThis, isDraggingTpThis }) => {
      const entryY = priceToY(position.avgPrice);
      if (entryY == null) return;

      const isLong = position.side === 'LONG' || position.buyQty > position.sellQty;
      const entryColor = isLong ? C.long : C.short;

      // Live drag override
      const csl = (isDraggingSlThis && cdragRef.current) ? cdragRef.current.currentPrice : slPrice;
      const ctp = (isDraggingTpThis && cdragRef.current) ? cdragRef.current.currentPrice : tpPrice;

      // ── Zone fills ──────────────────────────────────────────────────────────
      if (csl && csl > 0) {
        const sy = priceToY(csl);
        if (sy != null) {
          ctx.fillStyle = C.slZone;
          ctx.fillRect(0, Math.min(entryY, sy), RE, Math.abs(entryY - sy));
        }
      }
      if (ctp && ctp > 0) {
        const ty = priceToY(ctp);
        if (ty != null) {
          ctx.fillStyle = C.tpZone;
          ctx.fillRect(0, Math.min(entryY, ty), RE, Math.abs(entryY - ty));
        }
      }

      // ── SL line + handle ────────────────────────────────────────────────────
      if (csl && csl > 0) {
        const sy = priceToY(csl);
        if (sy != null) {
          const hov = hoveredRef.current?.positionId === position.id &&
                      (hoveredRef.current?.type === 'sl' || hoveredRef.current?.type === 'close_sl');
          const active = isDraggingSlThis || hov;
          // Dashed line
          ctx.save();
          ctx.strokeStyle = C.sl;
          ctx.lineWidth = active ? 2 : 1.5;
          ctx.setLineDash([7, 4]);
          ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(RE, sy); ctx.stroke();
          // Handle circle on left
          ctx.setLineDash([]);
          ctx.fillStyle = C.sl;
          ctx.beginPath(); ctx.arc(22, sy, active ? 8 : 6, 0, Math.PI * 2); ctx.fill();
          // Grip lines
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
          [-2.5, 0, 2.5].forEach(o => {
            ctx.beginPath(); ctx.moveTo(16, sy + o); ctx.lineTo(28, sy + o); ctx.stroke();
          });
          ctx.restore();
          // Label
          drawLabel(ctx, LAX, RE, sy, `SL  ${formatPrice(csl)}`,
            (() => { const r = Math.abs(position.avgPrice - csl) * position.qty; const p = Math.abs(position.avgPrice - csl); return `${fmtPnl(-r, position.symbol)}  ${p.toFixed(2)} pts`; })(),
            C.sl, C.textMuted, position.id, 'sl', 'close_sl', hits, active);
          hits.push({ positionId: position.id, type: 'sl', y: sy, dragCursor: true });
        }
      }

      // ── TP line + handle ────────────────────────────────────────────────────
      if (ctp && ctp > 0) {
        const ty = priceToY(ctp);
        if (ty != null) {
          const hov = hoveredRef.current?.positionId === position.id &&
                      (hoveredRef.current?.type === 'tp' || hoveredRef.current?.type === 'close_tp');
          const active = isDraggingTpThis || hov;
          ctx.save();
          ctx.strokeStyle = C.tp;
          ctx.lineWidth = active ? 2 : 1.5;
          ctx.setLineDash([7, 4]);
          ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(RE, ty); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = C.tp;
          ctx.beginPath(); ctx.arc(22, ty, active ? 8 : 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
          [-2.5, 0, 2.5].forEach(o => {
            ctx.beginPath(); ctx.moveTo(16, ty + o); ctx.lineTo(28, ty + o); ctx.stroke();
          });
          ctx.restore();
          const riskPts = csl ? Math.abs(position.avgPrice - csl) : 0;
          const rewPts  = Math.abs(ctp - position.avgPrice);
          const rrStr   = riskPts > 0 ? `  RR 1:${(rewPts/riskPts).toFixed(1)}` : '';
          const rew = rewPts * position.qty;
          drawLabel(ctx, LAX, RE, ty, `TP  ${formatPrice(ctp)}`,
            `${fmtPnl(rew, position.symbol)}  ${rewPts.toFixed(2)} pts${rrStr}`,
            C.tp, C.textMuted, position.id, 'tp', 'close_tp', hits, active);
          hits.push({ positionId: position.id, type: 'tp', y: ty, dragCursor: true });
        }
      }


      // ── Entry line ──────────────────────────────────────────────────────────
      const hovEntry = hoveredRef.current?.positionId === position.id &&
                       hoveredRef.current?.type === 'entry';
      ctx.save();
      ctx.strokeStyle = entryColor;
      ctx.lineWidth = hovEntry ? 2 : 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, entryY); ctx.lineTo(RE, entryY); ctx.stroke();
      ctx.restore();

      // ── Entry label with P&L + +SL / +TP buttons ───────────────────────────
      const pnlPer  = isLong ? ltp - position.avgPrice : position.avgPrice - ltp;
      const pnl     = pnlPer * position.qty;
      const pnlColor = pnl >= 0 ? C.profit : C.loss;
      const arrow    = pnl >= 0 ? '▲' : '▼';
      const sideStr  = isLong ? 'BUY' : 'SELL';
      const mainTxt  = `${sideStr}  ${position.qty}  @${formatPrice(position.avgPrice)}`;
      const pnlTxt   = `${fmtPnl(pnl, position.symbol)} ${arrow}`;
      const hasSL = !!(csl && csl > 0);
      const hasTP = !!(ctp && ctp > 0);
      drawEntryLabel(ctx, LAX, RE, entryY, mainTxt, pnlTxt,
        entryColor, pnlColor, position.id, hits, hovEntry, hasSL, hasTP);
      hits.push({ positionId: position.id, type: 'entry', y: entryY });

      // ── Live drag tooltip ───────────────────────────────────────────────────
      if (cdragRef.current && cdragRef.current.positionId === position.id) {
        const { type: dt, currentPrice: dp } = cdragRef.current;
        const dy = priceToY(dp);
        if (dy != null) {
          const dist = Math.abs(position.avgPrice - dp);
          const val  = dist * position.qty;
          const pct  = position.avgPrice > 0 ? (dist / position.avgPrice) * 100 : 0;
          const txt  = dt === 'sl'
            ? `SL  ${formatPrice(dp)}   Risk ${fmtPnl(-val, position.symbol)}   ${pct.toFixed(2)}%   ${dist.toFixed(2)} pts`
            : `TP  ${formatPrice(dp)}   Reward ${fmtPnl(val, position.symbol)}   ${pct.toFixed(2)}%   ${dist.toFixed(2)} pts`;
          const bw = 440, bh = 26, bx = 50, by = dy - bh - 8;
          ctx.save();
          rr(ctx, bx, by, bw, bh, 4);
          ctx.fillStyle = dt === 'sl' ? C.dragTooltipSL : C.dragTooltipTP;
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px "Inter",monospace';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillText(txt, bx + 10, by + bh / 2);
          ctx.restore();
        }
      }
    });

    hitRef.current = hits;
  }, [series, priceToY]);


  // ─── Label drawing helpers ──────────────────────────────────────────────────
  function drawLabel(
    ctx: CanvasRenderingContext2D,
    lax: number, RE: number, y: number,
    main: string, sub: string,
    mainCol: string, subCol: string,
    pid: string,
    type: 'sl' | 'tp', closeType: 'close_sl' | 'close_tp',
    hits: HitRegion[], active: boolean
  ) {
    const PAD = 7, LH = 16, BH = LH * 2 + PAD * 2, CW = 20;
    ctx.save();
    ctx.font = FONT_BOLD; const mw = ctx.measureText(main).width;
    ctx.font = FONT_REG;  const sw = ctx.measureText(sub).width;
    const BW = Math.max(mw, sw) + PAD * 2 + CW + 4;
    const BX = RE - BW - 4, BY = y - BH / 2;
    rr(ctx, BX, BY, BW, BH, 4);
    ctx.fillStyle = active ? C.labelBgHover : C.labelBg; ctx.fill();
    rr(ctx, BX, BY, BW, BH, 4);
    ctx.strokeStyle = mainCol; ctx.lineWidth = active ? 1.5 : 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = mainCol; ctx.font = FONT_BOLD; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(main, BX + PAD, BY + PAD);
    ctx.fillStyle = subCol; ctx.font = FONT_REG;
    ctx.fillText(sub, BX + PAD, BY + PAD + LH);
    // Close button
    const cx = BX + BW - CW, cy = BY + BH / 2 - 8;
    if (active) { rr(ctx, cx, cy, 16, 16, 3); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(); }
    ctx.fillStyle = active ? C.closeBtnHover : C.closeBtnIdle;
    ctx.font = 'bold 10px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 8, cy + 8);
    ctx.restore();
    hits.push({ positionId: pid, type, y });
    hits.push({ positionId: pid, type: closeType, y, x1: cx, x2: cx + 16 });
  }

  function drawEntryLabel(
    ctx: CanvasRenderingContext2D,
    lax: number, RE: number, y: number,
    main: string, pnl: string,
    mainCol: string, pnlCol: string,
    pid: string, hits: HitRegion[], active: boolean,
    hasSL: boolean, hasTP: boolean
  ) {
    const PAD = 7, LH = 16, BH = LH * 2 + PAD * 2, CW = 20;
    // Extra width for +SL / +TP buttons when not set
    const btnW = (!hasSL || !hasTP) ? 36 : 0;
    ctx.save();
    ctx.font = FONT_BOLD; const mw = ctx.measureText(main).width;
    ctx.font = FONT_BOLD; const pw = ctx.measureText(pnl).width;
    const BW = Math.max(mw, pw) + PAD * 2 + CW + 4 + btnW;
    const BX = RE - BW - 4, BY = y - BH / 2;
    rr(ctx, BX, BY, BW, BH, 4);
    ctx.fillStyle = active ? C.labelBgHover : C.labelBg; ctx.fill();
    rr(ctx, BX, BY, BW, BH, 4);
    ctx.strokeStyle = mainCol; ctx.lineWidth = active ? 1.5 : 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = mainCol; ctx.font = FONT_BOLD; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(main, BX + PAD, BY + PAD);
    ctx.fillStyle = pnlCol; ctx.font = FONT_BOLD;
    ctx.fillText(pnl, BX + PAD, BY + PAD + LH);
    // +SL button
    let btnX = BX + Math.max(mw, pw) + PAD * 2;
    if (!hasSL) {
      rr(ctx, btnX, BY + PAD, 28, BH - PAD * 2, 3);
      ctx.fillStyle = C.addBtnBg; ctx.fill();
      ctx.fillStyle = C.sl; ctx.font = 'bold 9px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('+SL', btnX + 14, BY + BH / 2);
      hits.push({ positionId: pid, type: 'add_sl', y, x1: btnX, x2: btnX + 28 });
      btnX += 32;
    }
    if (!hasTP) {
      rr(ctx, btnX, BY + PAD, 28, BH - PAD * 2, 3);
      ctx.fillStyle = C.addBtnBg; ctx.fill();
      ctx.fillStyle = C.tp; ctx.font = 'bold 9px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('+TP', btnX + 14, BY + BH / 2);
      hits.push({ positionId: pid, type: 'add_tp', y, x1: btnX, x2: btnX + 28 });
      btnX += 32;
    }
    // Close button
    const cx = BX + BW - CW, cy = BY + BH / 2 - 8;
    if (active) { rr(ctx, cx, cy, 16, 16, 3); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(); }
    ctx.fillStyle = active ? C.closeBtnHover : C.closeBtnIdle;
    ctx.font = 'bold 10px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 8, cy + 8);
    hits.push({ positionId: pid, type: 'close_entry', y, x1: cx, x2: cx + 16 });
    ctx.restore();
  }


  // ─── RAF loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    const loop = () => { if (!running) return; render(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [render]);

  // ─── Resize ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = container.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
      canvas.width  = Math.round(r.width  * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width  = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (ctx) ctx.scale(dpr, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);


  // ─── Mouse events ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const findHit = (mx: number, my: number): HitRegion | null => {
      for (const h of hitRef.current) {
        const yOk = Math.abs(my - h.y) < HIT;
        if (!yOk) continue;
        if (h.x1 != null && h.x2 != null) {
          if (mx >= h.x1 && mx <= h.x2) return h;
        } else {
          return h;
        }
      }
      return null;
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (cdragRef.current) {
        const p = yToPrice(my);
        if (p != null) { cdragRef.current.currentY = my; cdragRef.current.currentPrice = p; onDragMove(p); }
        canvas.style.cursor = 'ns-resize';
        return;
      }
      const h = findHit(mx, my);
      hoveredRef.current = h;
      canvas.style.cursor = h?.dragCursor ? 'ns-resize' : h ? 'pointer' : '';
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const h = findHit(mx, my);
      if (!h) return;
      if (h.type === 'sl' || h.type === 'tp') {
        e.preventDefault(); e.stopPropagation();
        const p = yToPrice(my) ?? 0;
        cdragRef.current = { positionId: h.positionId, type: h.type, currentY: my, currentPrice: p };
        onDragStart(h.positionId, h.type, p, e);
        canvas.style.cursor = 'ns-resize';
        return;
      }
      if (h.type === 'close_entry' || h.type === 'close_sl' || h.type === 'close_tp' ||
          h.type === 'add_sl' || h.type === 'add_tp' || h.type === 'entry') {
        e.stopPropagation();
      }
    };

    const onUp = () => {
      if (cdragRef.current) {
        const { positionId, type, currentPrice } = cdragRef.current;
        onDragEnd(positionId, type, currentPrice);
        cdragRef.current = null;
        canvas.style.cursor = '';
      }
    };

    const onClick = (e: MouseEvent) => {
      if (cdragRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const h = findHit(mx, my);
      if (!h) return;
      if (h.type === 'close_entry') { onClose(h.positionId); return; }
      if (h.type === 'close_sl' || h.type === 'close_tp') { onClose(h.positionId); return; }
      if (h.type === 'add_sl' || h.type === 'add_tp') {
        // Place SL/TP 2% away from entry as default starting point
        const vis = posRef.current.find(p => p.position.id === h.positionId);
        if (!vis) return;
        const entry = vis.position.avgPrice;
        const isLong = vis.position.side === 'LONG' || vis.position.buyQty > vis.position.sellQty;
        if (h.type === 'add_sl') {
          const defaultSL = isLong ? entry * 0.98 : entry * 1.02;
          onDragEnd(h.positionId, 'sl', defaultSL);
        } else {
          const defaultTP = isLong ? entry * 1.02 : entry * 0.98;
          onDragEnd(h.positionId, 'tp', defaultTP);
        }
      }
    };

    const onCtx = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const h = findHit(mx, my);
      if (!h) return;
      if (h.type === 'entry' || h.type === 'sl' || h.type === 'tp') {
        e.preventDefault();
        onContextMenu(h.positionId, h.type as 'entry' | 'sl' | 'tp', e.clientX, e.clientY);
      }
    };

    const globalUp = () => {
      if (cdragRef.current) {
        const { positionId, type, currentPrice } = cdragRef.current;
        onDragEnd(positionId, type, currentPrice);
        cdragRef.current = null;
        canvas.style.cursor = '';
      }
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onCtx);
    window.addEventListener('mouseup', globalUp);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mouseup', globalUp);
    };
  }, [yToPrice, onDragStart, onDragMove, onDragEnd, onClose, onContextMenu]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        zIndex: 20,   // above SVG drawing overlay (z-15)
        pointerEvents: positions.length > 0 ? 'auto' : 'none',
      }}
    />
  );
}
