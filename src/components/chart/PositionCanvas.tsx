/**
 * POSITION CANVAS — SL/TP drag that actually works
 *
 * Root cause of all previous failures:
 *   useCallback(y2p, [series]) + useEffect([..., y2p]) = stale closure
 *   When series changes, y2p gets a new reference, effect re-runs,
 *   re-registers handlers — but during a fast drag the closure still
 *   holds the OLD y2p. Fix: store series in a ref, read it directly.
 *
 * Design:
 *  - seriesRef always points to the live series
 *  - All coordinate math reads seriesRef.current directly — never stale
 *  - Drag state in dragRef — zero React state during drag
 *  - window mousemove/mouseup so drag works outside the canvas bounds
 */

import { useEffect, useRef } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
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

interface HR {
  pid: string;
  role: 'sl_drag' | 'tp_drag' | 'close_pos' | 'add_sl' | 'add_tp' | 'entry';
  y: number;
  x1?: number; x2?: number;
}

// Colors
const LONG_COL = '#2962ff';
const SHORT_COL = '#f7525f';
const SL_COL = '#ef4444';
const TP_COL = '#22c55e';
const LABEL_BG = 'rgba(13,15,24,0.95)';
const TEXT_DIM = '#6b7280';
const FONT_B = 'bold 11px "Inter",ui-sans-serif,sans-serif';
const HIT = 10;   // hit tolerance in CSS pixels

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function pnlStr(val: number, sym: string): string {
  const isUSD = /USD|EUR|GBP|BTC|ETH|USDT|CRYPTO/i.test(sym);
  const sign = val >= 0 ? '+' : '';
  if (isUSD) return `${sign}$${val.toFixed(2)}`;
  const abs = Math.abs(val), s = val >= 0 ? '+' : '-';
  if (abs >= 100000) return `${s}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${s}₹${(abs / 1000).toFixed(1)}K`;
  return `${s}₹${Math.round(abs)}`;
}

export function PositionCanvas({
  series, containerRef, positions,
  onDragStart, onDragMove, onDragEnd,
  onClose, onPartialClose, onReversePosition, onMoveBreakeven, onContextMenu,
}: Props) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  // ── All mutable state in refs — never stale ──────────────────────────────
  const seriesRef   = useRef<ISeriesApi<any> | null>(null);
  const posRef      = useRef<PositionVisual[]>([]);
  const hitsRef     = useRef<HR[]>([]);
  const hovRef      = useRef<HR | null>(null);
  const dragRef     = useRef<{ pid: string; type: 'sl'|'tp'; livePrice: number } | null>(null);

  // Callback refs — always current, never cause effect re-runs
  const cbDragEnd   = useRef(onDragEnd);
  const cbDragMove  = useRef(onDragMove);
  const cbDragStart = useRef(onDragStart);
  const cbClose     = useRef(onClose);
  const cbCtx       = useRef(onContextMenu);

  // Keep all refs current every render
  seriesRef.current = series;
  posRef.current    = positions;
  cbDragEnd.current   = onDragEnd;
  cbDragMove.current  = onDragMove;
  cbDragStart.current = onDragStart;
  cbClose.current     = onClose;
  cbCtx.current       = onContextMenu;

  // ── Coordinate helpers — always read from ref ────────────────────────────
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

  // ── RENDER LOOP ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current;
    if (!el) return;

    const render = () => {
      const ctx = el.getContext('2d');
      if (!ctx || !seriesRef.current) return;

      // Canvas is sized in CSS pixels (no DPR scaling) so width/height = CSS pixels directly
      const W = el.width, H = el.height;
      ctx.clearRect(0, 0, W, H);

      const newHits: HR[] = [];
      const RE = W - 72; // right edge before price scale

      posRef.current.forEach(({ position: pos, slPrice: slP, tpPrice: tpP, ltp }) => {
        const ey = p2y(pos.avgPrice);
        if (ey == null) return;

        const isLong = pos.side === 'LONG' || pos.buyQty > pos.sellQty;
        const entryCol = isLong ? LONG_COL : SHORT_COL;

        // Live drag overrides
        const d = dragRef.current;
        const sl = (d?.pid === pos.id && d.type === 'sl') ? d.livePrice : (slP ?? 0);
        const tp = (d?.pid === pos.id && d.type === 'tp') ? d.livePrice : (tpP ?? 0);
        const hasSL = sl > 0, hasTP = tp > 0;

        // Zone fills
        if (hasSL) { const sy = p2y(sl); if (sy != null) { ctx.fillStyle = 'rgba(239,68,68,0.07)'; ctx.fillRect(0, Math.min(ey, sy), RE, Math.abs(ey - sy)); } }
        if (hasTP) { const ty = p2y(tp); if (ty != null) { ctx.fillStyle = 'rgba(34,197,94,0.07)'; ctx.fillRect(0, Math.min(ey, ty), RE, Math.abs(ey - ty)); } }

        // SL line
        if (hasSL) {
          const sy = p2y(sl)!;
          const act = d?.pid === pos.id && d.type === 'sl';
          const hov = hovRef.current?.pid === pos.id && hovRef.current.role === 'sl_drag';
          drawHandle(ctx, sy, RE, SL_COL, act || hov);
          drawTag(ctx, sy, RE, `SL  ${formatPrice(sl)}`, SL_COL, pos.id, 'sl_drag', newHits, act || hov);
          newHits.push({ pid: pos.id, role: 'sl_drag', y: sy });
        }

        // TP line
        if (hasTP) {
          const ty = p2y(tp)!;
          const act = d?.pid === pos.id && d.type === 'tp';
          const hov = hovRef.current?.pid === pos.id && hovRef.current.role === 'tp_drag';
          drawHandle(ctx, ty, RE, TP_COL, act || hov);
          drawTag(ctx, ty, RE, `TP  ${formatPrice(tp)}`, TP_COL, pos.id, 'tp_drag', newHits, act || hov);
          newHits.push({ pid: pos.id, role: 'tp_drag', y: ty });
        }

        // Entry line
        ctx.save();
        ctx.strokeStyle = entryCol; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(RE, ey); ctx.stroke();
        ctx.restore();

        // Entry badge
        const pnl = (isLong ? ltp - pos.avgPrice : pos.avgPrice - ltp) * pos.qty;
        drawBadge(ctx, ey, RE, `${isLong ? 'LONG' : 'SHORT'} ${pos.qty}`,
          pnlStr(pnl, pos.symbol), entryCol, pnl >= 0 ? TP_COL : SL_COL,
          pos.id, newHits, !hasSL, !hasTP);

        // Drag tooltip
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
      el.style.pointerEvents = posRef.current.length > 0 ? 'auto' : 'none';
    };

    let on = true;
    const loop = () => { if (!on) return; render(); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => { on = false; cancelAnimationFrame(raf.current); };
  }, []); // ← empty deps — render reads everything from refs, never stale

  // ── RESIZE ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cvs.current, ct = containerRef.current;
    if (!el || !ct) return;
    const resize = () => {
      const r = ct.getBoundingClientRect();
      // NO DPR scaling — priceToCoordinate returns CSS pixels,
      // mouse events return CSS pixels, canvas must match CSS pixels exactly.
      el.width  = Math.round(r.width);
      el.height = Math.round(r.height);
      el.style.width  = `${r.width}px`;
      el.style.height = `${r.height}px`;
      // Reset any transform that may have accumulated
      const ctx = el.getContext('2d');
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(ct);
    return () => ro.disconnect();
  }, []); // ← empty deps

  // ── MOUSE EVENTS ─────────────────────────────────────────────────────────
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

    const onCanvasMove = (e: MouseEvent) => {
      if (dragRef.current) return;
      const r = el.getBoundingClientRect();
      const h = find(e.clientX - r.left, e.clientY - r.top);
      hovRef.current = h;
      el.style.cursor = (h?.role === 'sl_drag' || h?.role === 'tp_drag') ? 'ns-resize'
        : h ? 'pointer' : '';
    };

    const onWindowMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const r = el.getBoundingClientRect();
      const p = y2p(e.clientY - r.top);
      console.log('[POS] drag move clientY=', e.clientY, 'canvasY=', (e.clientY - r.top).toFixed(0), 'price=', p?.toFixed(2) ?? 'null');
      if (p != null) {
        dragRef.current.livePrice = p;
        cbDragMove.current(p);
      }
      document.body.style.cursor = 'ns-resize';
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      console.log('[POS] mousedown canvas mx=', mx.toFixed(0), 'my=', my.toFixed(0),
        'hits=', hitsRef.current.map(h => `${h.role}@y${h.y.toFixed(0)}`).join(','),
        'pointerEvents=', el.style.pointerEvents,
        'canvasRect top=', r.top.toFixed(0), 'containerRect top=', (containerRef.current?.getBoundingClientRect().top ?? 0).toFixed(0));
      const h = find(mx, my);
      console.log('[POS] hit=', h?.role ?? 'none');
      if (!h) return;
      if (h.role === 'sl_drag' || h.role === 'tp_drag') {
        e.preventDefault(); e.stopPropagation();
        const type = h.role === 'sl_drag' ? 'sl' : 'tp';
        const price = y2p(my) ?? 0;
        console.log('[POS] DRAG START', type, 'price=', price);
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
      if (dragRef.current) return;
      const r = el.getBoundingClientRect();
      const h = find(e.clientX - r.left, e.clientY - r.top);
      if (!h) return;
      if (h.role === 'close_pos') { cbClose.current(h.pid); return; }
      if (h.role === 'add_sl' || h.role === 'add_tp') {
        const vis = posRef.current.find(p => p.position.id === h.pid);
        if (!vis) return;
        const entry = vis.position.avgPrice;
        const isLong = vis.position.side === 'LONG' || vis.position.buyQty > vis.position.sellQty;
        cbDragEnd.current(h.pid,
          h.role === 'add_sl' ? 'sl' : 'tp',
          h.role === 'add_sl' ? (isLong ? entry * 0.98 : entry * 1.02)
                              : (isLong ? entry * 1.04 : entry * 0.96)
        );
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

    el.addEventListener('mousemove',    onCanvasMove);
    el.addEventListener('mousedown',    onDown);
    el.addEventListener('click',        onClick);
    el.addEventListener('contextmenu',  onCtx);
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup',   onWindowUp);

    return () => {
      el.removeEventListener('mousemove',    onCanvasMove);
      el.removeEventListener('mousedown',    onDown);
      el.removeEventListener('click',        onClick);
      el.removeEventListener('contextmenu',  onCtx);
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup',   onWindowUp);
    };
  }, []); // ← empty deps — all callbacks read from refs, never stale

  // ── DRAWING HELPERS ──────────────────────────────────────────────────────
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

  function drawTag(ctx: CanvasRenderingContext2D, y: number, RE: number,
    txt: string, col: string, pid: string, role: HR['role'], newHits: HR[], active: boolean) {
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

  function drawBadge(ctx: CanvasRenderingContext2D, y: number, RE: number,
    side: string, pnl: string, sCol: string, pCol: string,
    pid: string, newHits: HR[], needSL: boolean, needTP: boolean) {
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
    // +SL / +TP
    let bx = BX + sw + PAD * 2 + pw + PAD * 2;
    if (needSL) {
      rrect(ctx, bx, BY + 3, 26, H - 6, 2); ctx.fillStyle = 'rgba(239,68,68,0.18)'; ctx.fill();
      ctx.fillStyle = SL_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+SL', bx + 13, y);
      newHits.push({ pid, role: 'add_sl', y, x1: bx, x2: bx + 26 }); bx += 30;
    }
    if (needTP) {
      rrect(ctx, bx, BY + 3, 26, H - 6, 2); ctx.fillStyle = 'rgba(34,197,94,0.18)'; ctx.fill();
      ctx.fillStyle = TP_COL; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+TP', bx + 13, y);
      newHits.push({ pid, role: 'add_tp', y, x1: bx, x2: bx + 26 }); bx += 30;
    }
    // ✕
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
