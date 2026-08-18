/**
 * DragConfirmDialog
 *
 * Compact confirmation that appears after SL/TP drag release.
 * Positioned near the dropped line.
 *
 * Keyboard: Enter = Confirm, Escape = Cancel
 *
 * Design: minimal, dark, non-intrusive.
 */

import { useEffect, useRef } from 'react';
import type { DragConfirmation } from '../types';

interface Props {
  confirmation: DragConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(2);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}

export function DragConfirmDialog({ confirmation, onConfirm, onCancel }: Props) {
  const { target, originalPrice, newPrice, x, y } = confirmation;
  const isSL = target === 'sl';
  const color = isSL ? '#ef4444' : '#22c55e';
  const label = isSL ? 'Stop Loss' : 'Take Profit';
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Auto-focus confirm button
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  // Keep dialog in viewport
  const safeX = Math.min(Math.max(x, 100), window.innerWidth - 280);
  const safeY = Math.min(Math.max(y, 60), window.innerHeight - 120);

  return (
    <div
      className="fixed z-[9990] select-none"
      style={{ left: safeX - 130, top: safeY + 16 }}
    >
      <div
        className="flex flex-col gap-2 rounded-lg shadow-2xl p-3"
        style={{
          background: 'rgba(8, 10, 18, 0.97)',
          border: `1px solid ${color}40`,
          minWidth: 260,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          <span className="text-[11px] font-semibold text-fw-text tracking-wide">
            Modify {label}
          </span>
        </div>

        {/* Price change */}
        <div className="flex items-center gap-2 text-[11px] text-fw-text-muted">
          <span
            className="font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}
          >
            {formatPrice(originalPrice)}
          </span>
          <span className="text-[10px]">→</span>
          <span
            className="font-mono font-bold px-1.5 py-0.5 rounded"
            style={{ background: `${color}15`, color }}
          >
            {formatPrice(newPrice)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            ref={confirmRef}
            className="flex-1 rounded px-3 py-1 text-[11px] font-semibold text-white transition-colors focus:outline-none focus:ring-1"
            style={{
              background: color,
              boxShadow: `0 0 0 0 ${color}`,
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = `0 0 0 2px ${color}40`; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
            onClick={onConfirm}
          >
            Confirm
          </button>
          <button
            className="flex-1 rounded px-3 py-1 text-[11px] font-semibold text-fw-text-muted hover:text-fw-text transition-colors focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] text-fw-text-muted text-center">
          Enter to confirm · Esc to cancel
        </p>
      </div>
    </div>
  );
}
