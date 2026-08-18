/**
 * POSITION CONTEXT MENU
 * 
 * Right-click context menu for position management on chart lines.
 * Matches professional terminal behavior (MT5, cTrader, TradeLocker).
 */

import { useEffect, useRef } from 'react';

interface PositionContextMenuProps {
  x: number;
  y: number;
  positionId: string;
  type: 'entry' | 'sl' | 'tp';
  onClose: () => void;
  onClosePosition: () => void;
  onClosePartial: (pct: number) => void;
  onReversePosition: () => void;
  onMoveBreakeven: () => void;
  onTrailingStop: () => void;
  onModify: () => void;
  onCopyPrice: () => void;
}

export function PositionContextMenu({
  x, y, positionId, type,
  onClose, onClosePosition, onClosePartial, onReversePosition,
  onMoveBreakeven, onTrailingStop, onModify, onCopyPrice,
}: PositionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  const menuItems = type === 'entry' ? [
    { label: 'Modify Position', icon: '✏️', onClick: onModify },
    { label: 'Close Position', icon: '✕', onClick: onClosePosition, danger: true },
    { type: 'divider' },
    { label: 'Close 25%', icon: '◔', onClick: () => onClosePartial(25) },
    { label: 'Close 50%', icon: '◑', onClick: () => onClosePartial(50) },
    { label: 'Close 75%', icon: '◕', onClick: () => onClosePartial(75) },
    { type: 'divider' },
    { label: 'Move to Break Even', icon: '↔', onClick: onMoveBreakeven },
    { label: 'Trailing Stop', icon: '📌', onClick: onTrailingStop },
    { label: 'Reverse Position', icon: '⇅', onClick: onReversePosition },
    { type: 'divider' },
    { label: 'Copy Price', icon: '⎘', onClick: onCopyPrice },
  ] : type === 'sl' ? [
    { label: 'Modify Stop Loss', icon: '✏️', onClick: onModify },
    { label: 'Remove Stop Loss', icon: '✕', onClick: onClose, danger: true },
    { type: 'divider' },
    { label: 'Move to Break Even', icon: '↔', onClick: onMoveBreakeven },
    { label: 'Enable Trailing Stop', icon: '📌', onClick: onTrailingStop },
    { type: 'divider' },
    { label: 'Copy Price', icon: '⎘', onClick: onCopyPrice },
  ] : [
    { label: 'Modify Take Profit', icon: '✏️', onClick: onModify },
    { label: 'Remove Take Profit', icon: '✕', onClick: onClose, danger: true },
    { type: 'divider' },
    { label: 'Reverse on Target Hit', icon: '⇅', onClick: onReversePosition },
    { type: 'divider' },
    { label: 'Copy Price', icon: '⎘', onClick: onCopyPrice },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-fw-surface border border-fw-border rounded-lg shadow-2xl py-1 min-w-[200px] text-sm"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {menuItems.map((item, i) => (
        item.type === 'divider' ? (
          <div key={i} className="h-px bg-fw-border my-1" />
        ) : (
          <button
            key={i}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-fw-surface-2 transition-colors text-left
              ${item.danger ? 'text-red-400 hover:text-red-300' : 'text-fw-text-secondary'}`}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            <span className="text-[13px] w-4 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        )
      ))}
    </div>
  );
}
