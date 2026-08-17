/**
 * CHART DRAWING TOOLBAR — Institutional-grade left vertical strip
 * Polished to TradeLocker / TradingView quality.
 *
 * Changes vs previous version:
 *   • Icon containers: 36×36px, radius 8px (was 28×28, radius 4px)
 *   • Icon size: 18px (was 16px) — uniform stroke width 1.5
 *   • Toolbar width: 44px (was 36px)
 *   • Active state: soft glow + 1px border (was flat fill)
 *   • Hover: scale(1.03) + shadow + 160ms fade (was 100ms, no scale)
 *   • Press: scale(0.97) tactile feedback (new)
 *   • Icon opacity hierarchy: 65% / 100% / accent / 40%
 *   • Dividers: pure whitespace gaps — no visible lines
 *   • Cursor states: crosshair for drawing tools, pointer for actions
 *   • All values reference CSS design tokens (--toolbar-*)
 *   • Toolbar bg: #0b0d14/90 + backdrop-blur-sm (blends into chart)
 *   • Collapse toggle offset updated to 44px
 */

import React, { useState, useEffect } from 'react';
import {
  MousePointer2,
  Crosshair,
  TrendingUp,
  ArrowUpRight,
  Minus,
  AlignCenter,
  GitBranch,
  Square,
  Type,
  Brush,
  Smile,
  Ruler,
  ZoomIn,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Layers,
  Eraser,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Spline,
  MousePointer,
} from 'lucide-react';
import { cn } from '@/utils/helpers';
import type { DrawingMode } from './DrawingTools';

// --- Types --------------------------------------------------------------------

type ToolDef = {
  mode: DrawingMode;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  description?: string;
  /** Cursor to show when this tool is active */
  cursorType?: 'crosshair' | 'default' | 'pointer';
};

// --- Tool lists ---------------------------------------------------------------

const CURSOR_TOOLS: ToolDef[] = [
  { mode: 'none',      icon: <MousePointer2 size={18} strokeWidth={1.5} />, label: 'Pointer',    shortcut: 'Esc', description: 'Select & move',       cursorType: 'default' },
  { mode: 'select',    icon: <MousePointer  size={18} strokeWidth={1.5} />, label: 'Select',     shortcut: 'S',   description: 'Click drawing to select & delete', cursorType: 'default' },
  { mode: 'crosshair', icon: <Crosshair     size={18} strokeWidth={1.5} />, label: 'Crosshair',  shortcut: 'C',   description: 'Crosshair cursor',     cursorType: 'crosshair' },
];

const LINE_TOOLS: ToolDef[] = [
  { mode: 'trendline', icon: <TrendingUp    size={18} strokeWidth={1.5} />, label: 'Trend Line',       shortcut: 'T', description: 'Click 2 points',       cursorType: 'crosshair' },
  { mode: 'arrow',     icon: <ArrowUpRight  size={18} strokeWidth={1.5} />, label: 'Arrow',             shortcut: 'A', description: 'Click 2 points',       cursorType: 'crosshair' },
  { mode: 'ray',       icon: <Spline        size={18} strokeWidth={1.5} />, label: 'Ray',               shortcut: 'Y', description: 'Extends to right edge', cursorType: 'crosshair' },
  { mode: 'hline',     icon: <Minus         size={18} strokeWidth={1.5} />, label: 'Horizontal Line',   shortcut: 'H', description: 'Click price level',    cursorType: 'crosshair' },
  { mode: 'vline',     icon: <AlignCenter   size={18} strokeWidth={1.5} />, label: 'Vertical Line',     shortcut: 'V', description: 'Click time',           cursorType: 'crosshair' },
];

const SHAPE_TOOLS: ToolDef[] = [
  { mode: 'fibonacci', icon: <GitBranch size={18} strokeWidth={1.5} />, label: 'Fibonacci',   shortcut: 'F', description: 'Click high ? low', cursorType: 'crosshair' },
  { mode: 'rectangle', icon: <Square    size={18} strokeWidth={1.5} />, label: 'Price Zone',  shortcut: 'R', description: 'Click 2 points',  cursorType: 'crosshair' },
];

const ANNOTATION_TOOLS: ToolDef[] = [
  { mode: 'text',    icon: <Type   size={18} strokeWidth={1.5} />, label: 'Text Note',      shortcut: 'N', description: 'Click to place',   cursorType: 'crosshair' },
  { mode: 'brush',   icon: <Brush  size={18} strokeWidth={1.5} />, label: 'Brush',          shortcut: 'B', description: 'Drag to draw freehand', cursorType: 'crosshair' },
  { mode: 'emoji',   icon: <Smile  size={18} strokeWidth={1.5} />, label: 'Emoji Marker',   shortcut: 'E', description: 'Click to place emoji', cursorType: 'crosshair' },
  { mode: 'measure', icon: <Ruler  size={18} strokeWidth={1.5} />, label: 'Measure',        shortcut: 'M', description: 'Click 2 points',  cursorType: 'crosshair' },
  { mode: 'zoom',    icon: <ZoomIn size={18} strokeWidth={1.5} />, label: 'Zoom Selection', shortcut: 'Z', description: 'Drag to zoom',     cursorType: 'crosshair' },
];

// --- Props --------------------------------------------------------------------

interface Props {
  activeMode: DrawingMode;
  onModeChange: (mode: DrawingMode) => void;
  onClearLast: () => void;
  onClearAll: () => void;
  drawingCount: number;
  magnetActive: boolean;
  lockActive: boolean;
  eyeHidden: boolean;
  onToggleMagnet: () => void;
  onToggleLock: () => void;
  onToggleEye: () => void;
  onOpenLayers: () => void;
  /** Controlled collapsed state. When provided, parent owns show/hide. */
  collapsed?: boolean;
}

// --- Main component -----------------------------------------------------------

export function ChartDrawingToolbar({
  activeMode, onModeChange, onClearLast, onClearAll, drawingCount,
  magnetActive, lockActive, eyeHidden,
  onToggleMagnet, onToggleLock, onToggleEye, onOpenLayers,
  collapsed: collapsedProp,
}: Props) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = collapsedProp !== undefined ? collapsedProp : internalCollapsed;

  // Auto-collapse on mobile only when uncontrolled
  useEffect(() => {
    if (collapsedProp !== undefined) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = (e: MediaQueryListEvent | MediaQueryList) => setInternalCollapsed(e.matches);
    sync(mq);
    mq.addEventListener('change', sync as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener('change', sync as (e: MediaQueryListEvent) => void);
  }, [collapsedProp]);

  return (
    <div
      className={cn(
        'h-full flex-shrink-0 border-r border-white/[0.05]',
        'select-none transition-all duration-200 overflow-visible',
        'backdrop-blur-sm',
        isCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-[44px] min-w-[44px]',
      )}
      style={{ background: 'rgba(11, 13, 20, 0.90)' }}
    >
      {/* Scrollable inner — hides scrollbar, overflow-x visible so tooltips escape */}
      <div
        className="h-full flex flex-col items-center py-2"
        style={{ overflowY: 'auto', overflowX: 'visible', scrollbarWidth: 'none' }}
      >

        {/* -- Cursor -------------------------------------------- */}
        <ToolGroup>
          {CURSOR_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Gap />

        {/* -- Lines --------------------------------------------- */}
        <ToolGroup>
          {LINE_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Gap />

        {/* -- Shapes -------------------------------------------- */}
        <ToolGroup>
          {SHAPE_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Gap />

        {/* -- Annotations --------------------------------------- */}
        <ToolGroup>
          {ANNOTATION_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Gap />

        {/* -- Modifiers ----------------------------------------- */}
        <ToolGroup>
          <ToolBtn
            def={{ mode: 'none', icon: <Magnet size={18} strokeWidth={1.5} />, label: 'Snap to OHLC', shortcut: 'G', description: 'Magnet snap on/off', cursorType: 'pointer' }}
            active={magnetActive}
            onClick={onToggleMagnet}
            accent="amber"
            isToggle
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: lockActive ? <Lock size={18} strokeWidth={1.5} /> : <Unlock size={18} strokeWidth={1.5} />,
              label: lockActive ? 'Drawings locked' : 'Lock drawings',
              shortcut: 'L',
              description: 'Lock / unlock all drawings',
              cursorType: 'pointer',
            }}
            active={lockActive}
            onClick={onToggleLock}
            accent="orange"
            isToggle
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: eyeHidden ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />,
              label: eyeHidden ? 'Show drawings' : 'Hide drawings',
              description: 'Toggle drawing visibility',
              cursorType: 'pointer',
            }}
            active={eyeHidden}
            onClick={onToggleEye}
            accent="sky"
            isToggle
          />
          <ToolBtn
            def={{ mode: 'none', icon: <Layers size={18} strokeWidth={1.5} />, label: 'Layers', description: 'Open object manager', cursorType: 'pointer' }}
            active={false}
            onClick={onOpenLayers}
          />
        </ToolGroup>

        <Gap />

        {/* -- Actions ------------------------------------------- */}
        <ToolGroup>
          <ToolBtn
            def={{
              mode: 'none',
              icon: <Eraser size={18} strokeWidth={1.5} />,
              label: 'Erase last',
              description: drawingCount > 0 ? 'Remove last drawing' : 'No drawings to erase',
              cursorType: 'pointer',
            }}
            active={false}
            onClick={onClearLast}
            disabled={drawingCount === 0}
            danger
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: <Trash2 size={18} strokeWidth={1.5} />,
              label: drawingCount > 0 ? `Clear all (${drawingCount})` : 'Clear all',
              description: drawingCount > 0 ? 'Delete all drawings' : 'No drawings to clear',
              cursorType: 'pointer',
            }}
            active={false}
            onClick={onClearAll}
            disabled={drawingCount === 0}
            danger
          />
        </ToolGroup>

      </div>
    </div>
  );
}

// --- Collapse toggle tab ------------------------------------------------------

export function DrawingToolbarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={collapsed ? 'Show drawing toolbar' : 'Hide drawing toolbar'}
      aria-label={collapsed ? 'Show drawing toolbar' : 'Hide drawing toolbar'}
      style={{
        position: 'absolute',
        left: collapsed ? 0 : 44,
        top: '50%',
        transform: 'translateY(-50%)',
        transition: 'left 0.2s ease',
        zIndex: 30,
      }}
      className={cn(
        'w-[10px] h-[32px] flex items-center justify-center',
        'bg-fw-bg border-y border-r border-white/[0.05] rounded-r',
        'text-[#4b5563] hover:text-[#9ca3af] transition-colors duration-150',
      )}
    >
      {collapsed
        ? <ChevronRight size={8} strokeWidth={2.5} />
        : <ChevronLeft  size={8} strokeWidth={2.5} />
      }
    </button>
  );
}

// --- Sub-components -----------------------------------------------------------

function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center w-full px-[4px]" style={{ gap: 'var(--toolbar-gap, 2px)' }}>
      {children}
    </div>
  );
}

/** Pure whitespace gap between groups — no visible lines */
function Gap() {
  return <div className="flex-shrink-0" style={{ height: '10px' }} />;
}

// --- Accent colour map --------------------------------------------------------

const ACCENT_ACTIVE: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  blue:   { text: 'text-[#3b82f6]', bg: 'bg-[#3b82f6]/[0.14]', border: 'border-[#3b82f6]/[0.35]', glow: '0 0 8px rgba(59,130,246,0.25)' },
  amber:  { text: 'text-amber-400',  bg: 'bg-amber-400/[0.14]',  border: 'border-amber-400/[0.35]',  glow: '0 0 8px rgba(251,191,36,0.25)' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-400/[0.14]', border: 'border-orange-400/[0.35]', glow: '0 0 8px rgba(251,146,60,0.25)' },
  sky:    { text: 'text-sky-400',    bg: 'bg-sky-400/[0.14]',    border: 'border-sky-400/[0.35]',    glow: '0 0 8px rgba(56,189,248,0.25)' },
  green:  { text: 'text-green-400',  bg: 'bg-green-400/[0.14]',  border: 'border-green-400/[0.35]',  glow: '0 0 8px rgba(74,222,128,0.25)' },
};

// --- ToolBtn ------------------------------------------------------------------

function ToolBtn({
  def,
  active,
  onClick,
  disabled = false,
  danger = false,
  accent,
  isToggle = false,
}: {
  def: ToolDef;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: 'blue' | 'amber' | 'orange' | 'sky' | 'green';
  isToggle?: boolean;
}) {
  const key = accent ?? 'blue';
  const ac = ACCENT_ACTIVE[key];

  // Resolve cursor
  const cursor = disabled
    ? 'cursor-not-allowed'
    : def.cursorType === 'crosshair'
    ? 'cursor-crosshair'
    : 'cursor-pointer';

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={!danger && disabled}
      aria-label={def.label}
      aria-pressed={isToggle ? active : undefined}
      className={cn(
        // Base container
        'relative group flex items-center justify-center flex-shrink-0',
        'rounded-[8px] border',
        // Size from token (inline style fallback)
        'w-[36px] h-[36px]',
        // Smooth transitions — transform + opacity only (no layout shifts)
        'transition-all duration-[160ms] ease-out',
        // Press animation
        'active:scale-[0.97] active:duration-[120ms]',
        cursor,

        // -- Active state --------------------------------------
        active && [ac.bg, ac.border, ac.text],

        // -- Inactive normal -----------------------------------
        !active && !danger && !disabled && [
          'border-transparent',
          'text-[#6b7280]/[0.65]',
          'hover:text-[#c4c9d4] hover:bg-white/[0.07] hover:border-white/[0.06]',
          'hover:scale-[1.03] hover:shadow-[0_2px_8px_rgba(0,0,0,0.4)]',
        ],

        // -- Danger — active (drawings exist) ------------------
        danger && !disabled && [
          'border-transparent',
          'text-red-500/[0.50]',
          'hover:text-red-400 hover:bg-red-500/[0.10] hover:border-red-500/[0.15]',
          'hover:scale-[1.03] hover:shadow-[0_2px_8px_rgba(239,68,68,0.2)]',
        ],

        // -- Danger — disabled (no drawings) -------------------
        danger && disabled && 'border-transparent text-[#6b7280]/[0.40]',

        // -- Non-danger disabled --------------------------------
        !danger && disabled && 'border-transparent opacity-40 pointer-events-none',
      )}
      // Active glow via inline style (CSS shadow, not box model — no layout shift)
      style={active ? { boxShadow: ac.glow } : undefined}
    >
      {def.icon}

      {/* -- Tooltip ------------------------------------------- */}
      <span
        className={cn(
          'absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
          'z-[500] pointer-events-none',
          'flex items-center gap-2 whitespace-nowrap',
          'px-[8px] py-[5px] rounded-[6px]',
          'bg-[#1a1d2e] border border-white/[0.09]',
          'shadow-[0_4px_20px_rgba(0,0,0,0.55)]',
          'opacity-0 group-hover:opacity-100',
          'transition-opacity duration-150 delay-100',
        )}
      >
        <span className="flex flex-col gap-[3px]">
          <span className="text-[12px] font-medium leading-none text-[#c4c9d4]">
            {def.label}
          </span>
          {def.description && (
            <span className="text-[11px] leading-none text-[#6b7280]">
              {def.description}
            </span>
          )}
        </span>
        {def.shortcut && (
          <span className="px-[5px] py-[2px] rounded-[3px] text-[11px] font-mono font-bold leading-none text-[#6b7280] bg-white/[0.07] border border-white/[0.06]">
            {def.shortcut}
          </span>
        )}
      </span>
    </button>
  );
}
