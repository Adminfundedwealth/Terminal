/**
 * OverlayEngine — Geometry Utilities
 *
 * Canvas drawing primitives used throughout the renderer.
 */

/**
 * Draw a rounded rectangle path. Does not stroke or fill — caller decides.
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const clampedR = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + clampedR, y);
  ctx.lineTo(x + w - clampedR, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + clampedR);
  ctx.lineTo(x + w, y + h - clampedR);
  ctx.quadraticCurveTo(x + w, y + h, x + w - clampedR, y + h);
  ctx.lineTo(x + clampedR, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - clampedR);
  ctx.lineTo(x, y + clampedR);
  ctx.quadraticCurveTo(x, y, x + clampedR, y);
  ctx.closePath();
}

/**
 * Draw three horizontal grip lines inside a drag handle circle.
 */
export function drawGripLines(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string = 'rgba(255,255,255,0.8)'
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let offset = -2; offset <= 2; offset += 2) {
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + offset);
    ctx.lineTo(cx + 4, cy + offset);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Measure text width using the current ctx font.
 */
export function measureText(ctx: CanvasRenderingContext2D, text: string): number {
  return ctx.measureText(text).width;
}
