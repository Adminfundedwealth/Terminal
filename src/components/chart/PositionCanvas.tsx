/**
 * POSITION CANVAS
 *
 * Self-contained 60 FPS canvas overlay.
 * Drag state lives ENTIRELY in this component via refs.
 * Parent (PositionManager) only passes position data and callbacks.
 * Parent never needs to know about drag state mid-flight.
 *
 * TradeLocker-style label: compact single-line badge
 *   [LONG 50 @ 344.70]  [-₹2.50 ▼]  [SL] [TP] [×]
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { Position } from '@/types';
import { formatPrice } from '@/utils/helpers';

export interface PositionVisual {
  position: Position;
  slPrice?: number;
  tpPrice?: number;
  ltp: number;
  // NOT used for drag — canvas owns drag internally
  isDraggingSlThis?: boolean;
  isDraggingTpThis?: boolean;
}

interface Props {
  chart: any;
  series: ISeriesApi<any> | null;
  containerRef: React.RefObject<HTMLDivElement>;
  positions: PositionVisual[];
  onDragStart: (pid: string, type: 'sl' | 'tp', price: number, e: MouseEvent) => void;
  onDragMove:  (price: number) => void;
  onDragEnd:   (pid: string, type: 'sl' | 'tp', price: number) => void;
  onClose:     (pid: string) => void;
  onPartialClose:    (pid: string, qty: number) => void;
  onReversePosition: (pid: string) => void;
  onMoveBreakeven:   (pid: string) => void;
  onContextMenu: (pid: string, type: 'entry' | 'sl' | 'tp', x: number, y: number) => void;
}

// Hit region
interface HR {
  pid: string;
  role: 'sl_drag' | 'tp_drag' | 'close_pos' | 'add_sl' | 'add_tp' | 'entry';
  y: number;
  x1?: number; x2?: number;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const LONG_COL  = '#2962ff';
const SHORT_COL = '#f7525f';
const SL_COL    = '#ef4444';
const TP_COL    = '#22c55e';
const SL_ZONE   = 'rgba(239,68,68,0.06)';
const TP_ZONE   = 'rgba(34,197,94,0.06)';
const LABEL_BG  = 'rgba(13,15,24,0.95)';
const TEXT_DIM  = '#6b7280';
const FONT      = '11px "Inter",ui-sans-serif,sans-serif';
const FONT_B    = 'bold 11px "Inter",ui-sans-serif,sans-serif';
const HIT_PX    = 12;   // hit tolerance pixels

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
}

function pnlStr(val: number, sym: string): string {
  const isUSD = /USD|EUR|GBP|BTC|ETH|USDT/i.test(sym);
  const sign  = val >= 0 ? '+' : '';
  if (isUSD) return `${sign}$${val.toFixed(2)}`;
  const abs = Math.abs(val);
  const s   = val >= 0 ? '+' : '-';
  if (abs >= 100000) return `${s}₹${(abs/100000).toFixed(1)}L`;
  if (abs >= 1000)   return `${s}₹${(abs/1000).toFixed(1)}K`;
  return `${s}₹${Math.round(abs)}`;
}

export function PositionCanvas({ series, containerRef, positions,
  onDragStart, onDragMove, onDragEnd, onClose, onContextMenu,
  onPartialClose, onReversePosition, onMoveBreakeven }: Props) {

  const cvs   = useRef<HTMLCanvasElement>(null);
  const raf   = useRef(0);
  const hits  = useRef<HR[]>([]);
  const hov   = useRef<HR | null>(null);
  const posR  = useRef(positions);
  posR.current = positions;

  // ── DRAG STATE — owned here, never in parent ──────────────────────────────
  const drag = useRef<{
    pid: string; type: 'sl' | 'tp';
    startPrice: number; livePrice: number; liveY: number;
  } | null>(null);

  const p2y = useCallback((price: number) =>
    series ? (series.priceToCoordinate(price) ?? null) : null, [series]);

  const y2p = useCallback((y: number) =>
    series ? (series.coordinateToPrice(y) ?? null) : null, [series]);

  // ─── RENDER ────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const el  = cvs.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !series) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = el.width  / dpr;
    const H   = el.height / dpr;
    ctx.clearRect(0, 0, W, H);

    const newHits: HR[] = [];
    const RE = W - 72;   // right edge (before price scale)

    posR.current.forEach(({ position: pos, slPrice: slP, tpPrice: tpP, ltp }) => {
      const ey = p2y(pos.avgPrice);
      if (ey == null) return;

      const isLong    = pos.side === 'LONG' || pos.buyQty > pos.sellQty;
      const entryCol  = isLong ? LONG_COL : SHORT_COL;

      // Drag overrides — read directly from drag ref
      const sl = (drag.current?.pid === pos.id && drag.current.type === 'sl')
        ? drag.current.livePrice : (slP ?? 0);
      const tp = (drag.current?.pid === pos.id && drag.current.type === 'tp')
        ? drag.current.livePrice : (tpP ?? 0);

      const hasSL = sl > 0;
      const hasTP = tp > 0;

      // ── Zone fills ─────────────────────────────────────────────────────────
      if (hasSL) {
        const sy = p2y(sl);
        if (sy != null) {
          ctx.fillStyle = SL_ZONE;
          ctx.fillRect(0, Math.min(ey, sy), RE, Math.abs(ey - sy));
        }
      }
      if (hasTP) {
        const ty = p2y(tp);
        if (ty != null) {
          ctx.fillStyle = TP_ZONE;
          ctx.fillRect(0, Math.min(ey, ty), RE, Math.abs(ey - ty));
        }
      }

      // ── SL line ────────────────────────────────────────────────────────────
      if (hasSL) {
        const sy  = p2y(sl)!;
        const act = drag.current?.pid === pos.id && drag.current.type === 'sl';
        const hovered = hov.current?.pid === pos.id && hov.current.role === 'sl_drag';
        drawDragLine(ctx, sy, RE, SL_COL, act || hovered);
        drawLineLabel(ctx, sy, RE, `SL  ${formatPrice(sl)}`, SL_COL, pos.id, 'sl_drag', newHits, act || hovered);
        newHits.push({ pid: pos.id, role: 'sl_drag', y: sy });
      }

      // ── TP line ────────────────────────────────────────────────────────────
      if (hasTP) {
        const ty  = p2y(tp)!;
        const act = drag.current?.pid === pos.id && drag.current.type === 'tp';
        const hovered = hov.current?.pid === pos.id && hov.current.role === 'tp_drag';
        drawDragLine(ctx, ty, RE, TP_COL, act || hovered);
        drawLineLabel(ctx, ty, RE, `TP  ${formatPrice(tp)}`, TP_COL, pos.id, 'tp_drag', newHits, act || hovered);
        newHits.push({ pid: pos.id, role: 'tp_drag', y: ty });
      }

      // ── Entry line ─────────────────────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = entryCol;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, ey); ctx.lineTo(RE, ey);
      ctx.stroke();
      ctx.restore();

      // ── Compact entry label — TradeLocker style ─────────────────────────────
      const pnlPer = isLong ? ltp - pos.avgPrice : pos.avgPrice - ltp;
      const pnl    = pnlPer * pos.qty;
      const pnlC   = pnl >= 0 ? TP_COL : SL_COL;
      const pnlTxt = pnlStr(pnl, pos.symbol);
      const sideTxt = `${isLong ? 'LONG' : 'SHORT'} ${pos.qty}`;
      drawEntryBadge(ctx, ey, RE, sideTxt, pnlTxt, entryCol, pnlC, pos.id,
        newHits, !hasSL, !hasTP);

      // ── Live drag tooltip ──────────────────────────────────────────────────
      if (drag.current?.pid === pos.id) {
        const dp  = drag.current.livePrice;
        const dy  = p2y(dp);
        const isSL = drag.current.type === 'sl';
        if (dy != null) {
          const dist = Math.abs(pos.avgPrice - dp);
          const val  = dist * pos.qty;
          const txt  = isSL
            ? `SL ${formatPrice(dp)}  Risk ${pnlStr(-val, pos.symbol)}  ${dist.toFixed(2)} pts`
            : `TP ${formatPrice(dp)}  Reward ${pnlStr(val, pos.symbol)}  ${dist.toFixed(2)} pts`;
          ctx.save();
          rrect(ctx, 46, dy - 22, 380, 20, 3);
          ctx.fillStyle = isSL ? 'rgba(239,68,68,0.93)' : 'rgba(34,197,94,0.93)';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px "Inter",monospace';
          ctx.textBaseline = 'middle';
          ctx.textAlign    = 'left';
          ctx.fillText(txt, 56, dy - 12);
          ctx.restore();
        }
      }
    });

    hits.current = newHits;
  }, [series, p2y]);

  // ── Draw dashed line + drag handle circle ──────────────────────────────────
  function drawDragLine(ctx: CanvasRenderingContext2D, y: number, RE: number,
    col: string, active: boolean) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = active ? 2 : 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(42, y); ctx.lineTo(RE, y); ctx.stroke();
    ctx.setLineDash([]);
    // Handle circle
    const r = active ? 9 : 7;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(20, y, r, 0, Math.PI * 2); ctx.fill();
    // Grip lines
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    [-2.5, 0, 2.5].forEach(o => {
      ctx.beginPath(); ctx.moveTo(14, y + o); ctx.lineTo(26, y + o); ctx.stroke();
    });
    ctx.restore();
  }

  // ── Draw compact SL/TP label ───────────────────────────────────────────────
  function drawLineLabel(ctx: CanvasRenderingContext2D, y: number, RE: number,
    txt: string, col: string, pid: string, role: HR['role'],
    newHits: HR[], active: boolean) {
    const H  = 22, PAD = 8, CW = 18;
    ctx.save();
    ctx.font = FONT_B;
    const tw = ctx.measureText(txt).width;
    const BW = tw + PAD * 2 + CW + 2;
    const BX = RE - BW - 2;
    const BY = y - H / 2;
    rrect(ctx, BX, BY, BW, H, 3);
    ctx.fillStyle = LABEL_BG; ctx.fill();
    rrect(ctx, BX, BY, BW, H, 3);
    ctx.strokeStyle = col; ctx.lineWidth = active ? 1.5 : 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(txt, BX + PAD, y);
    // ✕
    const cx = BX + BW - CW + 1;
    ctx.fillStyle = active ? '#e2e8f0' : TEXT_DIM;
    ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 7, y);
    ctx.restore();
    newHits.push({ pid, role, y, x1: cx, x2: cx + 14 });
  }

  // ── Draw compact entry badge — TradeLocker style ───────────────────────────
  function drawEntryBadge(ctx: CanvasRenderingContext2D, y: number, RE: number,
    sideTxt: string, pnlTxt: string, entryCol: string, pnlCol: string,
    pid: string, newHits: HR[], needSL: boolean, needTP: boolean) {
    const H = 22, PAD = 8;
    ctx.save();
    ctx.font = FONT_B;
    const sw = ctx.measureText(sideTxt).width;
    const pw = ctx.measureText(pnlTxt).width;
    // badge segments: [side] [pnl] [+SL?] [+TP?] [×]
    const slW  = needSL ? 28 : 0;
    const tpW  = needTP ? 28 : 0;
    const CW   = 20;
    const BW   = PAD + sw + PAD + pw + PAD + slW + tpW + CW;
    const BX   = RE - BW - 4;
    const BY   = y - H / 2;

    // Background
    rrect(ctx, BX, BY, BW, H, 3);
    ctx.fillStyle = LABEL_BG; ctx.fill();
    rrect(ctx, BX, BY, BW, H, 3);
    ctx.strokeStyle = entryCol; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();

    // Side text — colored badge segment
    ctx.fillStyle = entryCol;
    rrect(ctx, BX, BY, sw + PAD * 2, H, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = FONT_B; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(sideTxt, BX + PAD, y);

    // P&L text
    ctx.fillStyle = pnlCol;
    ctx.font = FONT_B; ctx.textAlign = 'left';
    ctx.fillText(pnlTxt, BX + sw + PAD * 2 + PAD, y);

    // +SL button
    let bx = BX + sw + PAD * 2 + pw + PAD * 2;
    if (needSL) {
      rrect(ctx, bx, BY + 3, 26, H - 6, 2);
      ctx.fillStyle = 'rgba(239,68,68,0.18)'; ctx.fill();
      ctx.fillStyle = SL_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+SL', bx + 13, y);
      newHits.push({ pid, role: 'add_sl', y, x1: bx, x2: bx + 26 });
      bx += 30;
    }
    if (needTP) {
      rrect(ctx, bx, BY + 3, 26, H - 6, 2);
      ctx.fillStyle = 'rgba(34,197,94,0.18)'; ctx.fill();
      ctx.fillStyle = TP_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+TP', bx + 13, y);
      newHits.push({ pid, role: 'add_tp', y, x1: bx, x2: bx + 26 });
      bx += 30;
    }

    // ✕ close button
    const cx = BX + BW - CW + 2;
    ctx.fillStyle = TEXT_DIM; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 7, y);
    newHits.push({ pid, role: 'close_pos', y, x1: cx, x2: cx + 14 });

    ctx.restore();
    newHits.push({ pid, role: 'entry', y });
  }

  // ─── RAF ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let on = true;
    const loop = () => { if (!on) return; render(); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => { on = false; cancelAnimationFrame(raf.current); };
  }, [render]);

  // ─── Resize ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current, ct = containerRef.current;
    if (!el || !ct) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r   = ct.getBoundingClientRect();
      const ctx = el.getContext('2d');
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
      el.width  = Math.round(r.width  * dpr);
      el.height = Math.round(r.height * dpr);
      el.style.width  = `${r.width}px`;
      el.style.height = `${r.height}px`;
      if (ctx) ctx.scale(dpr, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(ct);
    return () => ro.disconnect();
  }, [containerRef]);

  // ─── Mouse ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current;
    if (!el) return;

    const find = (mx: number, my: number): HR | null => {
      // Prioritise drag handles — they have no x1/x2
      for (const h of hits.current) {
        if (Math.abs(my - h.y) > HIT_PX) continue;
        if (h.role === 'sl_drag' || h.role === 'tp_drag') {
          // Handle circle is at x=20 ± 12
          if (mx <= 40) return h;
        }
      }
      // Then check button regions (x1/x2 defined)
      for (const h of hits.current) {
        if (Math.abs(my - h.y) > HIT_PX) continue;
        if (h.x1 != null && h.x2 != null && mx >= h.x1 && mx <= h.x2) return h;
      }
      // Finally any line region
      for (const h of hits.current) {
        if (Math.abs(my - h.y) > HIT_PX) continue;
        return h;
      }
      return null;
    };

    const onMove = (e: MouseEvent) => {
      const r  = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag.current) {
        const p = y2p(my);
        if (p != null) { drag.current.liveY = my; drag.current.livePrice = p; onDragMove(p); }
        el.style.cursor = 'ns-resize';
        return;
      }
      const h = find(mx, my);
      hov.current = h;
      el.style.cursor = (h?.role === 'sl_drag' || h?.role === 'tp_drag') ? 'ns-resize'
                      : h ? 'pointer' : '';
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const r  = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h  = find(mx, my);
      if (!h) return;
      if (h.role === 'sl_drag' || h.role === 'tp_drag') {
        e.preventDefault(); e.stopPropagation();
        const type  = h.role === 'sl_drag' ? 'sl' : 'tp';
        const price = y2p(my) ?? 0;
        drag.current = { pid: h.pid, type, startPrice: price, livePrice: price, liveY: my };
        onDragStart(h.pid, type, price, e);
        el.style.cursor = 'ns-resize';
        return;
      }
      e.stopPropagation();
    };

    const finish = () => {
      if (!drag.current) return;
      const { pid, type, livePrice } = drag.current;
      drag.current = null;
      el.style.cursor = '';
      onDragEnd(pid, type, livePrice);
    };

    const onClick = (e: MouseEvent) => {
      if (drag.current) return;
      const r  = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h  = find(mx, my);
      if (!h) return;
      if (h.role === 'close_pos') { onClose(h.pid); return; }
      if (h.role === 'add_sl' || h.role === 'add_tp') {
        const vis = posR.current.find(p => p.position.id === h.pid);
        if (!vis) return;
        const entry  = vis.position.avgPrice;
        const isLong = vis.position.side === 'LONG' || vis.position.buyQty > vis.position.sellQty;
        if (h.role === 'add_sl')
          onDragEnd(h.pid, 'sl', isLong ? entry * 0.98 : entry * 1.02);
        else
          onDragEnd(h.pid, 'tp', isLong ? entry * 1.04 : entry * 0.96);
      }
    };

    const onCtx = (e: MouseEvent) => {
      const r  = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h  = find(mx, my);
      if (!h) return;
      if (h.role === 'entry' || h.role === 'sl_drag' || h.role === 'tp_drag') {
        e.preventDefault();
        const lt = h.role === 'sl_drag' ? 'sl' : h.role === 'tp_drag' ? 'tp' : 'entry';
        onContextMenu(h.pid, lt, e.clientX, e.clientY);
      }
    };

    el.addEventListener('mousemove',    onMove);
    el.addEventListener('mousedown',    onDown);
    el.addEventListener('mouseup',      finish);
    el.addEventListener('click',        onClick);
    el.addEventListener('contextmenu',  onCtx);
    window.addEventListener('mouseup',  finish);
    return () => {
      el.removeEventListener('mousemove',   onMove);
      el.removeEventListener('mousedown',   onDown);
      el.removeEventListener('mouseup',     finish);
      el.removeEventListener('click',       onClick);
      el.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mouseup', finish);
    };
  }, [y2p, onDragStart, onDragMove, onDragEnd, onClose, onContextMenu]);

  return (
    <canvas ref={cvs} style={{
      position: 'absolute', top: 0, left: 0,
      zIndex: 20,
      pointerEvents: positions.length > 0 ? 'auto' : 'none',
    }} />
  );
}
