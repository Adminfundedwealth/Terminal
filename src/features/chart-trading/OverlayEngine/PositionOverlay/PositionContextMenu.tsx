/**
 * PositionContextMenu — Right-click context menu for overlay lines
 *
 * Appears on right-click of entry, SL, or TP lines on the chart.
 * Fully decoupled from the canvas renderer — uses standard React/DOM.
 *
 * SAFETY: Destructive actions (Close, Partial Close, Reverse) require an
 * inline confirmation step before the broker API is called.
 * An in-flight ref prevents double-submission.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  exitPosition,
  partialClosePosition,
  reversePosition,
  breakEvenPosition,
  attachStopLoss,
  attachTakeProfit,
} from '@/services/api';
import { useTradingStore } from '@/store/tradingStore';

interface Props {
  positionId: string;
  lineType: 'entry' | 'sl' | 'tp';
  x: number;
  y: number;
  onClose: () => void;
}

// Which action needs a confirmation step before executing
type PendingConfirm = {
  label: string;
  fn: () => Promise<unknown>;
};

export function PositionContextMenu({ positionId, lineType, x, y, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useTradingStore((s) => s.positions.find((p) => p.id === positionId));

  // In-flight guard — set to true while a request is running; prevents double-submit
  const inFlightRef = useRef(false);

  // Pending confirmation state — null = no confirmation needed yet
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Close on outside click or ESC
  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pending) {
          // Escape from confirmation → back to menu (don't close whole menu)
          setPending(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', clickHandler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', clickHandler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose, pending]);

  // Execute a confirmed action with in-flight guard
  const execute = useCallback(
    (fn: () => Promise<unknown>) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      fn()
        .catch((err) => console.error('[ContextMenu]', err))
        .finally(() => {
          inFlightRef.current = false;
          onClose();
        });
    },
    [onClose]
  );

  // For actions that need confirmation: show inline confirm step
  const requestConfirm = useCallback((label: string, fn: () => Promise<unknown>) => {
    setPending({ label, fn });
  }, []);

  // Safe non-destructive run (no confirmation needed — e.g. Copy Price)
  const runDirect = useCallback(
    (fn: () => Promise<unknown>) => {
      if (inFlightRef.current) return;
      execute(fn);
    },
    [execute]
  );

  const sym = position?.symbol ?? '';
  const qty = position ? Math.abs(position.qty) : 1;
  const side = position ? (position.qty > 0 ? 'LONG' : 'SHORT') : '';

  // ── Confirmation sub-view ─────────────────────────────────────────────────
  if (pending) {
    return (
      <div
        ref={menuRef}
        className="fixed z-[9999] rounded-lg shadow-2xl overflow-hidden text-[12px] py-3 px-3 flex flex-col gap-3"
        style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 110), background: '#0d1117', border: '1px solid #262a36', minWidth: 220 }}
      >
        <p className="text-[12px] text-[#c9d1d9] leading-snug">{pending.label}</p>
        <div className="flex gap-2">
          <button
            className="flex-1 py-1.5 rounded text-[11px] font-bold bg-[#1e2330] text-[#9ca3af] hover:text-[#c9d1d9] transition-colors"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
          <button
            className="flex-1 py-1.5 rounded text-[11px] font-black bg-red-700 hover:bg-red-600 text-white transition-colors"
            onClick={() => { setPending(null); execute(pending.fn); }}
          >
            Confirm
          </button>
        </div>
      </div>
    );
  }

  // ── Menu items ────────────────────────────────────────────────────────────

  type MenuItem = {
    label: string;
    icon: string;
    danger?: boolean;
    action: () => void;
  };

  const entryItems: MenuItem[] = [
    {
      label: 'Close Position',
      icon: '✕',
      danger: true,
      action: () => requestConfirm(
        `Close ${side} ${sym} × ${qty}?`,
        () => exitPosition(positionId)
      ),
    },
    {
      label: 'Close 25%',
      icon: '◔',
      action: () => requestConfirm(
        `Close 25% of ${sym} (${Math.max(1, Math.floor(qty * 0.25))} qty)?`,
        () => partialClosePosition(positionId, Math.max(1, Math.floor(qty * 0.25)))
      ),
    },
    {
      label: 'Close 50%',
      icon: '◑',
      action: () => requestConfirm(
        `Close 50% of ${sym} (${Math.max(1, Math.floor(qty * 0.5))} qty)?`,
        () => partialClosePosition(positionId, Math.max(1, Math.floor(qty * 0.5)))
      ),
    },
    {
      label: 'Close 75%',
      icon: '◕',
      action: () => requestConfirm(
        `Close 75% of ${sym} (${Math.max(1, Math.floor(qty * 0.75))} qty)?`,
        () => partialClosePosition(positionId, Math.max(1, Math.floor(qty * 0.75)))
      ),
    },
    {
      label: 'Move to Break Even',
      icon: '↔',
      action: () => runDirect(() => breakEvenPosition(positionId)),
    },
    {
      label: 'Reverse Position',
      icon: '⇅',
      action: () => requestConfirm(
        `Reverse ${side} ${sym}? This closes current and opens opposite side.`,
        () => reversePosition(positionId)
      ),
    },
    {
      label: 'Copy Price',
      icon: '⎘',
      action: () => {
        navigator.clipboard.writeText(String(position?.avgPrice ?? '')).catch(() => {});
        onClose();
      },
    },
  ];

  const slItems: MenuItem[] = [
    {
      label: 'Remove Stop Loss',
      icon: '✕',
      danger: true,
      action: () => requestConfirm(
        `Remove Stop Loss on ${sym}?`,
        () => attachStopLoss(positionId, 0)
      ),
    },
    {
      label: 'Move to Break Even',
      icon: '↔',
      action: () => runDirect(() => breakEvenPosition(positionId)),
    },
    {
      label: 'Copy Price',
      icon: '⎘',
      action: () => {
        navigator.clipboard.writeText(String(position?.stopLoss ?? '')).catch(() => {});
        onClose();
      },
    },
  ];

  const tpItems: MenuItem[] = [
    {
      label: 'Remove Take Profit',
      icon: '✕',
      danger: true,
      action: () => requestConfirm(
        `Remove Take Profit on ${sym}?`,
        () => attachTakeProfit(positionId, 0)
      ),
    },
    {
      label: 'Copy Price',
      icon: '⎘',
      action: () => {
        navigator.clipboard.writeText(String(position?.takeProfit ?? '')).catch(() => {});
        onClose();
      },
    },
  ];

  const items = lineType === 'entry' ? entryItems : lineType === 'sl' ? slItems : tpItems;

  const safeX = Math.min(x, window.innerWidth - 210);
  const safeY = Math.min(y, window.innerHeight - items.length * 32 - 20);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] rounded-lg shadow-2xl overflow-hidden text-[12px] py-1"
      style={{ left: safeX, top: safeY, background: '#0d1117', border: '1px solid #262a36' }}
    >
      <div className="px-3 py-1 text-[10px] text-[#4b5563] font-semibold uppercase tracking-widest border-b border-[#1e2330] mb-1">
        {lineType === 'entry' ? 'Position' : lineType === 'sl' ? 'Stop Loss' : 'Take Profit'}
      </div>
      {items.map((item, i) => (
        <button
          key={i}
          className={[
            'w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors text-left',
            item.danger
              ? 'text-[#ef4444] hover:bg-[#ef444410]'
              : 'text-[#c9d1d9] hover:bg-[#1e2330]',
          ].join(' ')}
          onClick={item.action}
        >
          <span className="w-4 text-center text-[11px]">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
