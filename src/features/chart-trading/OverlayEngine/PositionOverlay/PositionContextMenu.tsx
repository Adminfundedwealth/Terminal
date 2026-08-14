/**
 * PositionContextMenu — Right-click context menu for overlay lines
 *
 * Appears on right-click of entry, SL, or TP lines on the chart.
 * Fully decoupled from the canvas renderer — uses standard React/DOM.
 */

import { useEffect, useRef, useCallback } from 'react';
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

interface MenuItem {
  label: string;
  icon: string;
  danger?: boolean;
  divider?: boolean;
  action: () => void;
}

export function PositionContextMenu({ positionId, lineType, x, y, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useTradingStore((s) => s.positions.find((p) => p.id === positionId));

  // Close on outside click or ESC
  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', clickHandler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', clickHandler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      fn().catch((err) => console.error('[ContextMenu]', err));
      onClose();
    },
    [onClose]
  );

  const items: MenuItem[] = lineType === 'entry'
    ? [
        { label: 'Close Position', icon: '✕', danger: true, action: () => run(() => exitPosition(positionId)) },
        { label: 'Close 25%', icon: '◔', action: () => run(() => partialClosePosition(positionId, Math.max(1, Math.floor((position?.qty ?? 1) * 0.25)))) },
        { label: 'Close 50%', icon: '◑', action: () => run(() => partialClosePosition(positionId, Math.max(1, Math.floor((position?.qty ?? 1) * 0.5)))) },
        { label: 'Close 75%', icon: '◕', action: () => run(() => partialClosePosition(positionId, Math.max(1, Math.floor((position?.qty ?? 1) * 0.75)))) },
        { label: 'Move to Break Even', icon: '↔', action: () => run(() => breakEvenPosition(positionId)) },
        { label: 'Reverse Position', icon: '⇅', action: () => run(() => reversePosition(positionId)) },
        { label: 'Copy Price', icon: '⎘', action: () => { navigator.clipboard.writeText(String(position?.avgPrice ?? '')).catch(() => {}); onClose(); } },
      ]
    : lineType === 'sl'
    ? [
        { label: 'Remove Stop Loss', icon: '✕', danger: true, action: () => run(() => attachStopLoss(positionId, 0)) },
        { label: 'Move to Break Even', icon: '↔', action: () => run(() => breakEvenPosition(positionId)) },
        { label: 'Copy Price', icon: '⎘', action: () => { navigator.clipboard.writeText(String(position?.stopLoss ?? '')).catch(() => {}); onClose(); } },
      ]
    : [
        { label: 'Remove Take Profit', icon: '✕', danger: true, action: () => run(() => attachTakeProfit(positionId, 0)) },
        { label: 'Copy Price', icon: '⎘', action: () => { navigator.clipboard.writeText(String(position?.takeProfit ?? '')).catch(() => {}); onClose(); } },
      ];

  // Keep in viewport
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
