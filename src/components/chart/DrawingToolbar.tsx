/**
 * DRAWING TOOLBAR — TradingView-style floating toolbar
 *
 * Appears directly above/below a drawing when clicked in pointer mode.
 * Exact replica of TradingView's inline toolbar:
 *
 *   ⠿  ⊞  ✏️[color]  🪣[style]  — 2px  ⊙  🔓  🗑  ···
 *
 * One-click: no mode switching required. Click any drawing → toolbar appears.
 * Dismiss: click elsewhere or press Escape.
 */

import { useEffect, useRef, useState } from 'react';
import {
  GripVertical, LayoutTemplate, Pencil, PaintBucket, Lock, Unlock,
  Trash2, MoreHorizontal, Settings2, Eye, EyeOff, Copy, Minus
} from 'lucide-react';

export interface DrawingToolbarProps {
  drawingId: number;
  drawingType: string;
  x: number;           // screen X (from clientX)
  y: number;           // screen Y (from clientY)
  color: string;
  lineWidth: number;
  lineStyle: number;   // 0=solid 1=dashed 2=dotted
  isLocked: boolean;
  isHidden: boolean;
  onColorChange: (id: number, color: string) => void;
  onLineWidthChange: (id: number, w: number) => void;
  onLineStyleChange: (id: number, s: number) => void;
  onLockToggle: (id: number) => void;
  onVisibilityToggle: (id: number) => void;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#2962ff', '#06b6d4', '#00bcd4', '#26a69a',
  '#f59e0b', '#f97316', '#ef4444', '#e91e63',
  '#8b5cf6', '#a78bfa', '#22c55e', '#ffffff',
];

const LINE_WIDTHS = [1, 2, 3, 4];

const LINE_STYLES = [
  { value: 0, label: '—', title: 'Solid' },
  { value: 1, label: '- -', title: 'Dashed' },
  { value: 2, label: '···', title: 'Dotted' },
];

export function DrawingToolbar({
  drawingId, drawingType,
  x, y,
  color, lineWidth, lineStyle,
  isLocked, isHidden,
  onColorChange, onLineWidthChange, onLineStyleChange,
  onLockToggle, onVisibilityToggle,
  onDuplicate, onDelete, onClose,
}: DrawingToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showWidthPicker, setShowWidthPicker] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Close on outside click or Escape
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Smart position — keep in viewport, prefer above the click
  const TOOLBAR_H = 44;
  const TOOLBAR_W = 360;
  const top = y - TOOLBAR_H - 12 < 8 ? y + 20 : y - TOOLBAR_H - 12;
  const left = Math.max(8, Math.min(x - TOOLBAR_W / 2, window.innerWidth - TOOLBAR_W - 8));

  const lineStyleSymbol = lineStyle === 0 ? '—' : lineStyle === 1 ? '╌' : '┈';

  return (
    <div
      ref={ref}
      className="fixed z-[600] select-none"
      style={{ top, left }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Main toolbar row */}
      <div className="flex items-center h-[38px] bg-[#1a1d2e] border border-fw-border rounded-xl shadow-2xl overflow-visible px-1 gap-0.5">

        {/* ⠿ Drag grip — cosmetic */}
        <div className="flex items-center justify-center w-7 h-full cursor-grab text-[#4b5563] hover:text-[#9ca3af] transition-colors">
          <GripVertical size={14} strokeWidth={1.5} />
        </div>

        <Divider />

        {/* ⊞ Object tree / template */}
        <ToolBtn title="Add to template" onClick={() => {}}>
          <LayoutTemplate size={14} strokeWidth={1.5} />
        </ToolBtn>

        <Divider />

        {/* ✏️ Color picker */}
        <div className="relative">
          <button
            title="Line color"
            className="flex flex-col items-center justify-center w-8 h-[34px] rounded-lg hover:bg-[#262a3e] transition-colors gap-0.5 px-1"
            onClick={() => { setShowColorPicker(v => !v); setShowWidthPicker(false); setShowStylePicker(false); setShowMore(false); }}
          >
            <Pencil size={14} strokeWidth={1.5} className="text-[#c9d1d9]" />
            <div className="w-5 h-[3px] rounded-full" style={{ backgroundColor: color }} />
          </button>
          {showColorPicker && (
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-fw-surface border border-fw-border rounded-xl shadow-2xl p-3 z-[700] w-[148px]">
              <div className="grid grid-cols-4 gap-1.5">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: c === color ? '#fff' : 'transparent',
                    }}
                    onClick={() => { onColorChange(drawingId, c); setShowColorPicker(false); }}
                  />
                ))}
              </div>
              {/* Custom color */}
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="color"
                  value={color}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                  onChange={e => onColorChange(drawingId, e.target.value)}
                />
                <span className="text-[11px] text-[#6b7280]">Custom</span>
              </div>
            </div>
          )}
        </div>

        {/* 🪣 Line style picker */}
        <div className="relative">
          <button
            title="Line style"
            className="flex flex-col items-center justify-center w-8 h-[34px] rounded-lg hover:bg-[#262a3e] transition-colors gap-0.5 px-1"
            onClick={() => { setShowStylePicker(v => !v); setShowColorPicker(false); setShowWidthPicker(false); setShowMore(false); }}
          >
            <PaintBucket size={14} strokeWidth={1.5} className="text-[#c9d1d9]" />
            <span className="text-[10px] text-[#6b7280] leading-none font-mono">{lineStyleSymbol}</span>
          </button>
          {showStylePicker && (
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-fw-surface border border-fw-border rounded-xl shadow-2xl p-2 z-[700] w-[100px]">
              {LINE_STYLES.map(s => (
                <button
                  key={s.value}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-[#262a3e] transition-colors ${lineStyle === s.value ? 'text-[#2962ff]' : 'text-[#c9d1d9]'}`}
                  onClick={() => { onLineStyleChange(drawingId, s.value); setShowStylePicker(false); }}
                >
                  <span className="font-mono text-[15px] w-6">{s.label}</span>
                  <span className="text-[11px] text-[#6b7280]">{s.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* — Line width */}
        <div className="relative">
          <button
            title="Line width"
            className="flex items-center gap-1 px-2 h-[34px] rounded-lg hover:bg-[#262a3e] transition-colors text-[#c9d1d9]"
            onClick={() => { setShowWidthPicker(v => !v); setShowColorPicker(false); setShowStylePicker(false); setShowMore(false); }}
          >
            <Minus size={14} strokeWidth={2} />
            <span className="text-[12px] font-medium tabular-nums">{lineWidth}px</span>
          </button>
          {showWidthPicker && (
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-fw-surface border border-fw-border rounded-xl shadow-2xl p-2 z-[700] w-[80px]">
              {LINE_WIDTHS.map(w => (
                <button
                  key={w}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#262a3e] transition-colors ${lineWidth === w ? 'text-[#2962ff]' : 'text-[#c9d1d9]'}`}
                  onClick={() => { onLineWidthChange(drawingId, w); setShowWidthPicker(false); }}
                >
                  <div className="flex-1 rounded-full bg-current" style={{ height: w + 1 }} />
                  <span className="text-[11px]">{w}px</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* ⊙ Settings */}
        <ToolBtn title="Settings" onClick={() => {}}>
          <Settings2 size={14} strokeWidth={1.5} />
        </ToolBtn>

        {/* 🔓 Lock / Unlock */}
        <ToolBtn
          title={isLocked ? 'Unlock drawing' : 'Lock drawing'}
          onClick={() => onLockToggle(drawingId)}
          active={isLocked}
        >
          {isLocked
            ? <Lock size={14} strokeWidth={1.5} className="text-[#f59e0b]" />
            : <Unlock size={14} strokeWidth={1.5} />
          }
        </ToolBtn>

        {/* 🗑 Delete */}
        <ToolBtn
          title="Delete drawing (Del)"
          onClick={() => { onDelete(drawingId); onClose(); }}
          danger
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </ToolBtn>

        {/* ··· More */}
        <div className="relative">
          <ToolBtn title="More options" onClick={() => { setShowMore(v => !v); setShowColorPicker(false); setShowWidthPicker(false); setShowStylePicker(false); }}>
            <MoreHorizontal size={14} strokeWidth={1.5} />
          </ToolBtn>
          {showMore && (
            <div className="absolute top-full mt-2 right-0 bg-fw-surface border border-fw-border rounded-xl shadow-2xl py-1 z-[700] w-[170px]">
              <MenuItem icon={<Eye size={13} />} label={isHidden ? 'Show drawing' : 'Hide drawing'} onClick={() => { onVisibilityToggle(drawingId); setShowMore(false); }} />
              <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { onDuplicate(drawingId); setShowMore(false); onClose(); }} />
              <div className="h-px bg-[#2d3048] my-1" />
              <MenuItem icon={<Trash2 size={13} />} label="Delete" onClick={() => { onDelete(drawingId); setShowMore(false); onClose(); }} danger />
            </div>
          )}
        </div>
      </div>

      {/* Tiny pointer triangle */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          bottom: top < y ? -6 : 'auto',
          top: top >= y ? -6 : 'auto',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          ...(top < y
            ? { borderTop: '6px solid #2d3048' }
            : { borderBottom: '6px solid #2d3048' }
          ),
        }}
      />
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────

function Divider() {
  return <div className="w-px h-5 bg-[#2d3048] mx-0.5 flex-shrink-0" />;
}

function ToolBtn({
  children, title, onClick, active = false, danger = false,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        'flex items-center justify-center w-8 h-[34px] rounded-lg transition-colors',
        danger
          ? 'text-[#ef4444] hover:bg-red-500/15'
          : active
          ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
          : 'text-[#9ca3af] hover:bg-[#262a3e] hover:text-[#e2e8f0]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon, label, onClick, danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[#262a3e] transition-colors ${danger ? 'text-[#ef4444]' : 'text-[#c9d1d9]'}`}
    >
      <span className={danger ? 'text-[#ef4444]' : 'text-[#6b7280]'}>{icon}</span>
      {label}
    </button>
  );
}
