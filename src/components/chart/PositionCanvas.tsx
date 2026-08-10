/**
 * POSITION CANVAS — SL/TP drag + direct placement mode
 *
 * Key behaviors:
 *  1. Entry line always drawn for open positions.
 *  2. SL line drawn when p.stopLoss > 0 — red dashed, draggable.
 *  3. TP line drawn when p.takeProfit > 0 — green dashed, draggable.
 *  4. When no SL exists: +SL button on entry badge enters placement mode.
 *     Mouse follows chart; a guide line tracks the cursor price.
 *     Release → snapToTick → validate direction → attachStopLoss().
 *  5. When no TP exists: same for +TP.
 *  6. ESC cancels placement mode.
 *  7. tickSize prop used to snap all prices.
 *  8. No React state mutations during RAF — all mutable state in refs.
 */

import { useEffect, useRef } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { Position } from '@/types';
import { formatPrice } from '@/utils/helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PositionVisual {
  position: Position;
  slPrice?: number;
  tpPrice?: number;
  ltp: number;
}

interface Props {
  chart: any;
  series: ISeriesApi<any> | null;
  containerRef: React.RefObject<HTMLDivElement>;
  positions: PositionVisual[];
  tickSize: number;
  onDragStart: (pid: string, type: 'sl' | 'tp', price: number, e: MouseEvent) => void;
  onDragMove:  (price: number) => void;
  onDragEnd:   (pid: string, type: 'sl' | 'tp', price: number) => void;
  onClose:     (pid: string) => void;
  onPartialClose:    (pid: string, qty: number) => void;
  onReversePosition: (pid: string) => void;
  onMoveBreakeven:   (pid: string) => void;
  onContextMenu: (pid: string, type: 'entry' | 'sl' | 'tp', x: number, y: number) => void;
}

interface HR {
  pid: string;
  role: 'sl_drag' | 'tp_drag' | 'close_pos' | 'add_sl' | 'add_tp' | 'entry';
  y: number;
  x1?: number; x2?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LONG_COL  = '#2962ff';
const SHORT_COL = '#f7525f';
const SL_COL    = '#ef4444';
const TP_COL    = '#22c55e';
const LABEL_BG  = 'rgba(13,15,24,0.95)';
const TEXT_DIM  = '#6b7280';
const FONT_B    = 'bold 11px "Inter",ui-sans-serif,sans-serif';
const HIT       = 14;   // hit tolerance px — intentionally generous for drag UX

// Placement-mode guide colors
const SL_GUIDE  = 'rgba(239,68,68,0.85)';
const TP_GUIDE  = 'rgba(34,197,94,0.85)';
const INVALID_COL = 'rgba(251,191,36,0.9)';   // amber = invalid placement

// ── Helpers ───────────────────────────────────────────────────────────────────

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function pnlStr(val: number, sym: string): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? '+' : '-';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000)       return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Snap price to nearest valid tick */
function snapTick(price: number, tick: number): number {
  if (!tick || tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

/** Return true if SL placement is valid for the given side */
function isValidSL(slPrice: number, entryPrice: number, isLong: boolean): boolean {
  return isLong ? slPrice < entryPrice : slPrice > entryPrice;
}

/** Return true if TP placement is valid for the given side */
function isValidTP(tpPrice: number, entryPrice: number, isLong: boolean): boolean {
  return isLong ? tpPrice > entryPrice : tpPrice < entryPrice;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PositionCanvas({
  series, containerRef, positions, tickSize,
  onDragStart, onDragMove, onDragEnd,
  onClose, onPartialClose, onReversePosition, onMoveBreakeven, onContextMenu,
}: Props) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  // ── All mutable state in refs — never stale ─────────────────────────────
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const posRef    = useRef<PositionVisual[]>([]);
  const tickRef   = useRef<number>(0.05);
  const hitsRef   = useRef<HR[]>([]);
  const hovRef    = useRef<HR | null>(null);
  const dragRef   = useRef<{ pid: string; type: 'sl'|'tp'; livePrice: number } | null>(null);

  // Placement mode: user clicked +SL or +TP, mouse now controls the guide line
  // before they release to commit
  const placeRef  = useRef<{
    pid: string;
    type: 'sl' | 'tp';
    livePrice: number;
    valid: boolean;
  } | null>(null);

  // Callback refs — always current, never cause effect re-runs
  const cbDragEnd   = useRef(onDragEnd);
  const cbDragMove  = useRef(onDragMove);
  const cbDragStart = useRef(onDragStart);
  const cbClose     = useRef(onClose);
  const cbCtx       = useRef(onContextMenu);

  seriesRef.current = series;
  posRef.current    = positions;
  tickRef.current   = tickSize;
  cbDragEnd.current   = onDragEnd;
  cbDragMove.current  = onDragMove;
  cbDragStart.current = onDragStart;
  cbClose.current     = onClose;
  cbCtx.current       = onContextMenu;

  // ── Coordinate helpers ──────────────────────────────────────────────────
  const p2y = (price: number): number | null => {
    const s = seriesRef.current;
    if (!s) return null;
    return s.priceToCoordinate(price) ?? null;
  };
  const y2p = (y: number): number | null => {
    const s = seriesRef.current;
    if (!s) return null;
    return s.coordinateToPrice(y) ?? null;
  };

  // ── RENDER LOOP ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current;
    if (!el) return;

    const render = () => {
      const ctx = el.getContext('2d');
      if (!ctx || !seriesRef.current) return;

      const W = el.width, H = el.height;
      ctx.clearRect(0, 0, W, H);

      const newHits: HR[] = [];
      const RE = W - 72; // right edge before price scale

      posRef.current.forEach(({ position: pos, slPrice: slP, tpPrice: tpP, ltp }) => {
        const ey = p2y(pos.avgPrice);
        if (ey == null || ey < -50 || ey > H + 50) return;

        const isLong = pos.side === 'LONG' || pos.buyQty > pos.sellQty;
        const entryCol = isLong ? LONG_COL : SHORT_COL;

        // Live drag overrides
        const d = dragRef.current;
        const sl = (d?.pid === pos.id && d.type === 'sl') ? d.livePrice : (slP ?? 0);
        const tp = (d?.pid === pos.id && d.type === 'tp') ? d.livePrice : (tpP ?? 0);
        const hasSL = sl > 0, hasTP = tp > 0;

        // Live placement overrides (placement mode active for this position)
        const pl = placeRef.current;
        const placeSL = pl?.pid === pos.id && pl.type === 'sl' ? pl.livePrice : null;
        const placeTP = pl?.pid === pos.id && pl.type === 'tp' ? pl.livePrice : null;

        // Zone fills — only for committed (real) SL/TP
        if (hasSL) {
          const sy = p2y(sl);
          if (sy != null) {
            ctx.fillStyle = 'rgba(239,68,68,0.07)';
            ctx.fillRect(0, Math.min(ey, sy), RE, Math.abs(ey - sy));
          }
        }
        if (hasTP) {
          const ty = p2y(tp);
          if (ty != null) {
            ctx.fillStyle = 'rgba(34,197,94,0.07)';
            ctx.fillRect(0, Math.min(ey, ty), RE, Math.abs(ey - ty));
          }
        }

        // ── SL line (committed) ──────────────────────────────────────────
        if (hasSL) {
          const syRaw = p2y(sl);
          if (syRaw != null) {
            const sy = Math.max(4, Math.min(H - 4, syRaw));
            const act = d?.pid === pos.id && d.type === 'sl';
            const hov = hovRef.current?.pid === pos.id && hovRef.current.role === 'sl_drag';
            drawHandle(ctx, sy, RE, SL_COL, act || hov);
            drawTag(ctx, sy, RE, `SL  ${formatPrice(sl)}`, SL_COL, pos.id, 'sl_drag', newHits, act || hov);
            newHits.push({ pid: pos.id, role: 'sl_drag', y: sy });
          }
        }

        // ── TP line (committed) ──────────────────────────────────────────
        if (hasTP) {
          const tyRaw = p2y(tp);
          if (tyRaw != null) {
            const ty = Math.max(4, Math.min(H - 4, tyRaw));
            const act = d?.pid === pos.id && d.type === 'tp';
            const hov = hovRef.current?.pid === pos.id && hovRef.current.role === 'tp_drag';
            drawHandle(ctx, ty, RE, TP_COL, act || hov);
            drawTag(ctx, ty, RE, `TP  ${formatPrice(tp)}`, TP_COL, pos.id, 'tp_drag', newHits, act || hov);
            newHits.push({ pid: pos.id, role: 'tp_drag', y: ty });
          }
        }

        // ── Placement-mode guide line (SL) ──────────────────────────────
        if (placeSL != null) {
          const valid = isValidSL(placeSL, pos.avgPrice, isLong);
          const guideY = p2y(placeSL);
          if (guideY != null) {
            const col = valid ? SL_GUIDE : INVALID_COL;
            const clamped = Math.max(4, Math.min(H - 4, guideY));
            // Full-width dashed guide
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(0, clamped); ctx.lineTo(RE, clamped); ctx.stroke();
            ctx.setLineDash([]);
            // Circle handle
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(18, clamped, 7, 0, Math.PI * 2); ctx.fill();
            // Grip lines
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
            [-2.5, 0, 2.5].forEach(o => {
              ctx.beginPath(); ctx.moveTo(12, clamped + o); ctx.lineTo(24, clamped + o); ctx.stroke();
            });
            // Floating tooltip
            const risk = Math.abs(pos.avgPrice - placeSL) * pos.qty;
            const pts  = Math.abs(pos.avgPrice - placeSL);
            const label = valid
              ? `SET SL  ${formatPrice(placeSL)}  |  Risk ${pnlStr(-risk, pos.symbol)}  |  ${pts.toFixed(2)} pts`
              : `INVALID  ${formatPrice(placeSL)}  —  SL must be ${isLong ? 'BELOW' : 'ABOVE'} entry`;
            ctx.save();
            rrect(ctx, 36, clamped - 24, 460, 20, 3);
            ctx.fillStyle = valid ? 'rgba(239,68,68,0.93)' : 'rgba(251,191,36,0.93)';
            ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace';
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.fillText(label, 46, clamped - 14);
            ctx.restore();
            ctx.restore();
          }
        }

        // ── Placement-mode guide line (TP) ──────────────────────────────
        if (placeTP != null) {
          const valid = isValidTP(placeTP, pos.avgPrice, isLong);
          const guideY = p2y(placeTP);
          if (guideY != null) {
            const col = valid ? TP_GUIDE : INVALID_COL;
            const clamped = Math.max(4, Math.min(H - 4, guideY));
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(0, clamped); ctx.lineTo(RE, clamped); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(18, clamped, 7, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
            [-2.5, 0, 2.5].forEach(o => {
              ctx.beginPath(); ctx.moveTo(12, clamped + o); ctx.lineTo(24, clamped + o); ctx.stroke();
            });
            const reward = Math.abs(placeTP - pos.avgPrice) * pos.qty;
            const pts    = Math.abs(placeTP - pos.avgPrice);
            const label  = valid
              ? `SET TP  ${formatPrice(placeTP)}  |  Reward ${pnlStr(reward, pos.symbol)}  |  ${pts.toFixed(2)} pts`
              : `INVALID  ${formatPrice(placeTP)}  —  TP must be ${isLong ? 'ABOVE' : 'BELOW'} entry`;
            ctx.save();
            rrect(ctx, 36, clamped - 24, 460, 20, 3);
            ctx.fillStyle = valid ? 'rgba(34,197,94,0.93)' : 'rgba(251,191,36,0.93)';
            ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace';
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.fillText(label, 46, clamped - 14);
            ctx.restore();
            ctx.restore();
          }
        }

        // ── Entry line ───────────────────────────────────────────────────
        ctx.save();
        ctx.strokeStyle = entryCol; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(RE, ey); ctx.stroke();
        ctx.restore();

        // ── Entry badge ──────────────────────────────────────────────────
        const pnl = (isLong ? ltp - pos.avgPrice : pos.avgPrice - ltp) * pos.qty;
        drawBadge(ctx, ey, RE, `${isLong ? 'LONG' : 'SHORT'} ${pos.qty}`,
          pnlStr(pnl, pos.symbol), entryCol, pnl >= 0 ? TP_COL : SL_COL,
          pos.id, newHits, !hasSL, !hasTP);

        // ── Drag tooltip (existing SL/TP drag) ───────────────────────────
        if (d?.pid === pos.id) {
          const dy = p2y(d.livePrice);
          if (dy != null) {
            const dist = Math.abs(pos.avgPrice - d.livePrice) * pos.qty;
            const txt = d.type === 'sl'
              ? `SL ${formatPrice(d.livePrice)}  Risk ${pnlStr(-dist, pos.symbol)}`
              : `TP ${formatPrice(d.livePrice)}  Reward ${pnlStr(dist, pos.symbol)}`;
            ctx.save();
            rrect(ctx, 46, dy - 22, 340, 20, 3);
            ctx.fillStyle = d.type === 'sl' ? 'rgba(239,68,68,0.93)' : 'rgba(34,197,94,0.93)';
            ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace';
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.fillText(txt, 56, dy - 12);
            ctx.restore();
          }
        }
      });

      hitsRef.current = newHits;
      // Enable pointer events when positions present OR in placement mode
      el.style.pointerEvents = (posRef.current.length > 0 || placeRef.current != null) ? 'auto' : 'none';
    };

    let on = true;
    const loop = () => { if (!on) return; render(); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => { on = false; cancelAnimationFrame(raf.current); };
  }, []);

  // ── RESIZE ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current, ct = containerRef.current;
    if (!el || !ct) return;
    const resize = () => {
      const r = ct.getBoundingClientRect();
      // NO DPR scaling — priceToCoordinate returns CSS pixels
      el.width  = Math.round(r.width);
      el.height = Math.round(r.height);
      el.style.width  = `${r.width}px`;
      el.style.height = `${r.height}px`;
      const ctx = el.getContext('2d');
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(ct);
    return () => ro.disconnect();
  }, []);

  // ── MOUSE EVENTS ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current;
    if (!el) return;

    const find = (mx: number, my: number): HR | null => {
      // Priority 1: buttons with exact x bounds
      for (const h of hitsRef.current) {
        if (Math.abs(my - h.y) > HIT) continue;
        if (h.x1 != null && h.x2 != null && mx >= h.x1 - 4 && mx <= h.x2 + 4) return h;
      }
      // Priority 2: SL/TP drag — full line width
      for (const h of hitsRef.current) {
        if ((h.role === 'sl_drag' || h.role === 'tp_drag') && Math.abs(my - h.y) <= HIT) return h;
      }
      // Priority 3: entry
      for (const h of hitsRef.current) {
        if (h.role === 'entry' && Math.abs(my - h.y) <= HIT) return h;
      }
      return null;
    };

    // ── Placement-mode mouse tracking ────────────────────────────────────
    const onWindowMovePlacement = (e: MouseEvent) => {
      if (!placeRef.current) return;
      const r = el.getBoundingClientRect();
      const rawPrice = y2p(e.clientY - r.top);
      if (rawPrice == null) return;
      const snapped = snapTick(rawPrice, tickRef.current);
      const pl = placeRef.current;
      const vis = posRef.current.find(p => p.position.id === pl.pid);
      if (!vis) return;
      const isLong = vis.position.side === 'LONG' || vis.position.buyQty > vis.position.sellQty;
      const valid = pl.type === 'sl'
        ? isValidSL(snapped, vis.position.avgPrice, isLong)
        : isValidTP(snapped, vis.position.avgPrice, isLong);
      pl.livePrice = snapped;
      pl.valid = valid;
      document.body.style.cursor = 'crosshair';
    };

    const onWindowUpPlacement = (e: MouseEvent) => {
      if (!placeRef.current) return;
      const pl = placeRef.current;
      if (!pl.valid) {
        // Invalid placement — cancel silently
        placeRef.current = null;
        document.body.style.cursor = '';
        return;
      }
      const { pid, type, livePrice } = pl;
      placeRef.current = null;
      document.body.style.cursor = '';
      // Commit via same onDragEnd path — PositionManager handles API call
      cbDragEnd.current(pid, type, livePrice);
    };

    // ── Regular hover ────────────────────────────────────────────────────
    const onCanvasMove = (e: MouseEvent) => {
      // If in placement mode, cursor is handled by onWindowMovePlacement
      if (placeRef.current || dragRef.current) return;
      const r = el.getBoundingClientRect();
      const h = find(e.clientX - r.left, e.clientY - r.top);
      hovRef.current = h;
      el.style.cursor = (h?.role === 'sl_drag' || h?.role === 'tp_drag') ? 'ns-resize'
        : h ? 'pointer' : '';
    };

    // ── Existing drag tracking ────────────────────────────────────────────
    const onWindowMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const r = el.getBoundingClientRect();
      const raw = y2p(e.clientY - r.top);
      if (raw != null) {
        // Snap to tick so tooltip always shows the exact price that will be committed
        const snapped = snapTick(raw, tickRef.current);
        dragRef.current.livePrice = snapped;
        cbDragMove.current(snapped);
      }
      document.body.style.cursor = 'ns-resize';
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // If in placement mode, mousedown is not needed — we commit on mouseup
      if (placeRef.current) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h = find(mx, my);
      if (!h) return;
      if (h.role === 'sl_drag' || h.role === 'tp_drag') {
        e.preventDefault(); e.stopPropagation();
        const type = h.role === 'sl_drag' ? 'sl' : 'tp';
        const price = y2p(my) ?? 0;
        dragRef.current = { pid: h.pid, type, livePrice: price };
        cbDragStart.current(h.pid, type, price, e);
        document.body.style.cursor = 'ns-resize';
        return;
      }
      e.stopPropagation();
    };

    const onWindowUp = () => {
      if (!dragRef.current) return;
      const { pid, type, livePrice } = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = '';
      el.style.cursor = '';
      cbDragEnd.current(pid, type, livePrice);
    };

    const onClick = (e: MouseEvent) => {
      // Placement mode: a click anywhere outside the canvas can cancel — handled via ESC
      if (dragRef.current) return;
      const r = el.getBoundingClientRect();
      const h = find(e.clientX - r.left, e.clientY - r.top);
      if (!h) return;

      if (h.role === 'close_pos') { cbClose.current(h.pid); return; }

      // +SL / +TP: enter placement mode
      if (h.role === 'add_sl' || h.role === 'add_tp') {
        const vis = posRef.current.find(p => p.position.id === h.pid);
        if (!vis) return;
        const type = h.role === 'add_sl' ? 'sl' : 'tp';
        const isLong = vis.position.side === 'LONG' || vis.position.buyQty > vis.position.sellQty;
        // Start at a reasonable price offset from entry
        const s = seriesRef.current;
        let startPrice: number;
        if (s) {
          const entryY = s.priceToCoordinate(vis.position.avgPrice);
          if (entryY != null) {
            // 60px below entry for SL-long / above for SL-short, opposite for TP
            const offset = type === 'sl'
              ? (isLong ? entryY + 60 : entryY - 60)
              : (isLong ? entryY - 60 : entryY + 60);
            startPrice = snapTick(
              s.coordinateToPrice(offset) ?? (isLong
                ? (type === 'sl' ? vis.position.avgPrice * 0.98 : vis.position.avgPrice * 1.02)
                : (type === 'sl' ? vis.position.avgPrice * 1.02 : vis.position.avgPrice * 0.98)),
              tickRef.current
            );
          } else {
            startPrice = isLong
              ? (type === 'sl' ? vis.position.avgPrice * 0.98 : vis.position.avgPrice * 1.02)
              : (type === 'sl' ? vis.position.avgPrice * 1.02 : vis.position.avgPrice * 0.98);
          }
        } else {
          startPrice = isLong
            ? (type === 'sl' ? vis.position.avgPrice * 0.98 : vis.position.avgPrice * 1.02)
            : (type === 'sl' ? vis.position.avgPrice * 1.02 : vis.position.avgPrice * 0.98);
        }
        placeRef.current = {
          pid: h.pid,
          type,
          livePrice: snapTick(startPrice, tickRef.current),
          valid: true,
        };
        el.style.pointerEvents = 'auto';
        document.body.style.cursor = 'crosshair';
      }
    };

    const onCtx = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const h = find(e.clientX - r.left, e.clientY - r.top);
      if (!h) return;
      if (h.role === 'entry' || h.role === 'sl_drag' || h.role === 'tp_drag') {
        e.preventDefault();
        cbCtx.current(h.pid,
          h.role === 'sl_drag' ? 'sl' : h.role === 'tp_drag' ? 'tp' : 'entry',
          e.clientX, e.clientY);
      }
    };

    // ESC cancels both drag and placement mode
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (placeRef.current) {
          placeRef.current = null;
          document.body.style.cursor = '';
          el.style.cursor = '';
        }
        if (dragRef.current) {
          // Revert drag
          dragRef.current = null;
          document.body.style.cursor = '';
          el.style.cursor = '';
        }
      }
    };

    el.addEventListener('mousemove',   onCanvasMove);
    el.addEventListener('mousedown',   onDown);
    el.addEventListener('click',       onClick);
    el.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mousemove', onWindowMovePlacement);
    window.addEventListener('mouseup',   onWindowUp);
    window.addEventListener('mouseup',   onWindowUpPlacement);
    window.addEventListener('keydown',   onKeyDown);

    return () => {
      el.removeEventListener('mousemove',   onCanvasMove);
      el.removeEventListener('mousedown',   onDown);
      el.removeEventListener('click',       onClick);
      el.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mousemove', onWindowMovePlacement);
      window.removeEventListener('mouseup',   onWindowUp);
      window.removeEventListener('mouseup',   onWindowUpPlacement);
      window.removeEventListener('keydown',   onKeyDown);
    };
  }, []);

  // ── DRAWING HELPERS ───────────────────────────────────────────────────

  function drawHandle(ctx: CanvasRenderingContext2D, y: number, RE: number, col: string, active: boolean) {
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = active ? 2 : 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(RE, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(18, y, active ? 8 : 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    [-2.5, 0, 2.5].forEach(o => { ctx.beginPath(); ctx.moveTo(12, y + o); ctx.lineTo(24, y + o); ctx.stroke(); });
    ctx.restore();
  }

  function drawTag(
    ctx: CanvasRenderingContext2D, y: number, RE: number,
    txt: string, col: string, pid: string, role: HR['role'], newHits: HR[], active: boolean
  ) {
    const H = 22, PAD = 8, CW = 18;
    ctx.save();
    ctx.font = FONT_B;
    const tw = ctx.measureText(txt).width;
    const BW = tw + PAD * 2 + CW + 2, BX = RE - BW - 2, BY = y - H / 2;
    rrect(ctx, BX, BY, BW, H, 3); ctx.fillStyle = LABEL_BG; ctx.fill();
    rrect(ctx, BX, BY, BW, H, 3); ctx.strokeStyle = col; ctx.lineWidth = active ? 1.5 : 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(txt, BX + PAD, y);
    const cx = BX + BW - CW + 1;
    ctx.fillStyle = active ? '#e2e8f0' : TEXT_DIM; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 7, y);
    ctx.restore();
    newHits.push({ pid, role, y, x1: cx, x2: cx + 14 });
  }

  function drawBadge(
    ctx: CanvasRenderingContext2D, y: number, RE: number,
    side: string, pnl: string, sCol: string, pCol: string,
    pid: string, newHits: HR[], needSL: boolean, needTP: boolean
  ) {
    const H = 22, PAD = 8, CW = 20;
    ctx.save(); ctx.font = FONT_B;
    const sw = ctx.measureText(side).width, pw = ctx.measureText(pnl).width;
    const BW = PAD + sw + PAD + pw + PAD + (needSL ? 30 : 0) + (needTP ? 30 : 0) + CW;
    const BX = RE - BW - 4, BY = y - H / 2;
    rrect(ctx, BX, BY, BW, H, 3); ctx.fillStyle = LABEL_BG; ctx.fill();
    rrect(ctx, BX, BY, BW, H, 3); ctx.strokeStyle = sCol; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    // Side badge
    rrect(ctx, BX, BY, sw + PAD * 2, H, 3); ctx.fillStyle = sCol; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(side, BX + PAD, y);
    // P&L
    ctx.fillStyle = pCol; ctx.fillText(pnl, BX + sw + PAD * 2 + PAD, y);
    // +SL / +TP buttons — prominent when missing
    let bx = BX + sw + PAD * 2 + pw + PAD * 2;
    if (needSL) {
      rrect(ctx, bx, BY + 2, 26, H - 4, 2);
      ctx.fillStyle = 'rgba(239,68,68,0.25)'; ctx.fill();
      rrect(ctx, bx, BY + 2, 26, H - 4, 2);
      ctx.strokeStyle = SL_COL; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = SL_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+SL', bx + 13, y);
      newHits.push({ pid, role: 'add_sl', y, x1: bx, x2: bx + 26 }); bx += 30;
    }
    if (needTP) {
      rrect(ctx, bx, BY + 2, 26, H - 4, 2);
      ctx.fillStyle = 'rgba(34,197,94,0.25)'; ctx.fill();
      rrect(ctx, bx, BY + 2, 26, H - 4, 2);
      ctx.strokeStyle = TP_COL; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = TP_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+TP', bx + 13, y);
      newHits.push({ pid, role: 'add_tp', y, x1: bx, x2: bx + 26 }); bx += 30;
    }
    // Close ✕
    const cx = BX + BW - CW + 2;
    ctx.fillStyle = TEXT_DIM; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('✕', cx + 7, y);
    newHits.push({ pid, role: 'close_pos', y, x1: cx, x2: cx + 14 });
    ctx.restore();
    newHits.push({ pid, role: 'entry', y });
  }

  return (
    <canvas ref={cvs} style={{
      position: 'absolute', top: 0, left: 0,
      zIndex: 20,
      pointerEvents: 'none', // toggled in RAF loop
    }} />
  );
}
