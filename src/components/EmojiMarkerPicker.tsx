/**
 * EMOJI MARKER PICKER
 * Small floating picker with 12 trading annotation icons.
 * Returns selected emoji string via onSelect.
 */

import React from 'react';
import { X } from 'lucide-react';

const EMOJIS = [
  { emoji: '🚀', label: 'Rocket / Breakout' },
  { emoji: '⚠️', label: 'Warning / Risk' },
  { emoji: '💰', label: 'Profit target' },
  { emoji: '🛑', label: 'Stop loss' },
  { emoji: '📍', label: 'Pin / Level' },
  { emoji: '📈', label: 'Bullish' },
  { emoji: '📉', label: 'Bearish' },
  { emoji: '🔔', label: 'Alert' },
  { emoji: '💡', label: 'Idea' },
  { emoji: '✅', label: 'Entry' },
  { emoji: '❌', label: 'Exit' },
  { emoji: '🎯', label: 'Target' },
];

interface Props {
  x: number;
  y: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiMarkerPicker({ x, y, onSelect, onClose }: Props) {
  return (
    <div
      className="fixed z-[300] bg-fw-surface-2 border border-fw-border rounded-lg shadow-2xl p-2"
      style={{ left: x, top: y, minWidth: 160 }}
    >
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[13px] font-semibold text-fw-text-muted uppercase tracking-wide">Annotation</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text">
          <X size={10} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {EMOJIS.map(({ emoji, label }) => (
          <button
            key={emoji}
            title={label}
            onClick={() => onSelect(emoji)}
            className="w-8 h-8 flex items-center justify-center rounded text-base hover:bg-fw-hover transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
