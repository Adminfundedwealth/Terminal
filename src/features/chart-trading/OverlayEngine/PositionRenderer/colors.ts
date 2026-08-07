/**
 * OverlayEngine — Color Palette
 *
 * Single source of truth for all overlay colors.
 * Dark-theme optimized, minimal, professional.
 */

export const OVERLAY_COLORS = {
  // ─── Lines ───────────────────────────────────────────────────────────────
  /** Entry line — solid blue */
  entry: '#2962ff',
  /** Entry line — BUY  */
  long: '#2962ff',
  /** Entry line — SELL */
  short: '#f7525f',

  /** Stop Loss line */
  sl: '#ef4444',
  /** Stop Loss risk zone fill */
  slZone: 'rgba(239, 68, 68, 0.07)',
  /** Stop Loss drag handle */
  slHandle: '#ef4444',

  /** Take Profit line */
  tp: '#22c55e',
  /** Take Profit reward zone fill */
  tpZone: 'rgba(34, 197, 94, 0.07)',
  /** Take Profit drag handle */
  tpHandle: '#22c55e',

  // ─── Labels ──────────────────────────────────────────────────────────────
  /** Label background */
  labelBg: 'rgba(8, 10, 18, 0.94)',
  /** Label background — hovered */
  labelBgHover: 'rgba(14, 17, 28, 0.98)',

  /** Primary text */
  textPrimary: '#e2e8f0',
  /** Muted / secondary text */
  textMuted: '#6b7280',

  /** Profit P&L text */
  pnlProfit: '#22c55e',
  /** Loss P&L text */
  pnlLoss: '#ef4444',

  // ─── Entry marker (▲ BUY / ▼ SELL on execution candle) ──────────────────
  markerBuy: '#2962ff',
  markerSell: '#f7525f',

  // ─── Close button ─────────────────────────────────────────────────────────
  closeBtnText: '#9ca3af',
  closeBtnHover: '#e2e8f0',
  closeBtnHoverBg: 'rgba(255, 255, 255, 0.12)',

  // ─── Drag tooltip ─────────────────────────────────────────────────────────
  dragTooltipSL: 'rgba(239, 68, 68, 0.92)',
  dragTooltipTP: 'rgba(34, 197, 94, 0.92)',
} as const;
