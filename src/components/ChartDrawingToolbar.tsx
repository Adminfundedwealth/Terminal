/**
 * CHART DRAWING TOOLBAR — TradingView-style left vertical strip
 *
 * Groups (top → bottom):
 *   Cursor  →  Lines  →  Shapes  →  Annotations  →  Modifiers  →  Actions
 *
 * Features
 *   • Collapsible via controlled `collapsed` prop + DrawingToolbarToggle tab
 *   • Auto-collapses on mobile (≤640 px) when uncontrolled
 *   • Vertically scrollable on short viewports (scrollbar hidden)
 *   • Rich tooltips (label + description + shortcut badge) to the right
 *   • Active tool: accent-tinted bg + icon colour
 *   • Toggle buttons (magnet, lock, eye): amber / orange / sky accent
 *   • Danger buttons (erase, trash): red, disabled when no drawings
 *   • aria-label + aria-pressed for accessibility
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
} from 'lucide-react';
import { cn } from '@/utils/helpers';
import type { DrawingMode } from './DrawingTools';

// ─── Shared type ─────────────────────────────────────────────────────────────

type ToolDef = {
  mode: DrawingMode;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  description?: string;
};

// ─── Static tool lists ────────────────────────────────────────────────────────

const CURSOR_TOOLS: ToolDef[] = [
  { mode: 'none',      icon: <MousePointer2 size={16} strokeWidth={1.5} />, label: 'Pointer',    shortcut: 'Esc', description: 'Select & move' },
  { mode: 'crosshair', icon: <Crosshair     size={16} strokeWidth={1.5} />, label: 'Crosshair',  shortcut: 'C',   description: 'Crosshair cursor' },
];

const LINE_TOOLS: ToolDef[] = [
  { mode: 'trendline', icon: <TrendingUp    size={16} strokeWidth={1.5} />, label: 'Trend Line',       shortcut: 'T', description: 'Click 2 points' },
  { mode: 'arrow',     icon: <ArrowUpRight  size={16} strokeWidth={1.5} />, label: 'Arrow',             shortcut: 'A', description: 'Click 2 points' },
  { mode: 'ray',       icon: <Spline        size={16} strokeWidth={1.5} />, label: 'Ray',               shortcut: 'Y', description: 'Extends to right edge' },
  { mode: 'hline',     icon: <Minus         size={16} strokeWidth={1.5} />, label: 'Horizontal Line',   shortcut: 'H', description: 'Click price level' },
  { mode: 'vline',     icon: <AlignCenter   size={16} strokeWidth={1.5} />, label: 'Vertical Line',     shortcut: 'V', description: 'Click time' },
];

const SHAPE_TOOLS: ToolDef[] = [
  { mode: 'fibonacci', icon: <GitBranch size={16} strokeWidth={1.5} />, label: 'Fibonacci',   shortcut: 'F', description: 'Click high → low' },
  { mode: 'rectangle', icon: <Square    size={16} strokeWidth={1.5} />, label: 'Price Zone',  shortcut: 'R', description: 'Click 2 points' },
];

const ANNOTATION_TOOLS: ToolDef[] = [
  { mode: 'text',    icon: <Type   size={16} strokeWidth={1.5} />, label: 'Text Note',     shortcut: 'N', description: 'Click to place' },
  { mode: 'brush',   icon: <Brush  size={16} strokeWidth={1.5} />, label: 'Brush',         shortcut: 'B', description: 'Drag to draw freehand' },
  { mode: 'emoji',   icon: <Smile  size={16} strokeWidth={1.5} />, label: 'Emoji Marker',  shortcut: 'E', description: 'Click to place emoji' },
  { mode: 'measure', icon: <Ruler  size={16} strokeWidth={1.5} />, label: 'Measure',       shortcut: 'M', description: 'Click 2 points' },
  { mode: 'zoom',    icon: <ZoomIn size={16} strokeWidth={1.5} />, label: 'Zoom Selection',shortcut: 'Z', description: 'Drag to zoom' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

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

  // Outer shell: controls width + visibility transition
  // overflow-visible so tooltips escape; inner handles vertical scroll
  return (
    <div
      className={cn(
        'h-full flex-shrink-0 bg-[#0e1017] border-r border-white/[0.06]',
        'select-none transition-all duration-200 overflow-visible',
        isCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-[36px] min-w-[36px]',
      )}
    >
      {/* Scrollable inner — hides scrollbar, allows overflow on x so tooltips show */}
      <div
        className="h-full flex flex-col items-center py-1.5"
        style={{ overflowY: 'auto', overflowX: 'visible', scrollbarWidth: 'none' }}
      >

        {/* ── Cursor ─────────────────────────────────────────── */}
        <ToolGroup>
          {CURSOR_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Divider />

        {/* ── Lines ──────────────────────────────────────────── */}
        <ToolGroup>
          {LINE_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Divider />

        {/* ── Shapes ─────────────────────────────────────────── */}
        <ToolGroup>
          {SHAPE_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Divider />

        {/* ── Annotations ────────────────────────────────────── */}
        <ToolGroup>
          {ANNOTATION_TOOLS.map(t => (
            <ToolBtn key={t.mode} def={t} active={activeMode === t.mode} onClick={() => onModeChange(t.mode)} />
          ))}
        </ToolGroup>

        <Divider />

        {/* ── Modifiers ──────────────────────────────────────── */}
        <ToolGroup>
          <ToolBtn
            def={{ mode: 'none', icon: <Magnet size={16} strokeWidth={1.5} />, label: 'Snap to OHLC', shortcut: 'G', description: 'Magnet snap on/off' }}
            active={magnetActive}
            onClick={onToggleMagnet}
            accent="amber"
            isToggle
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: lockActive ? <Lock size={16} strokeWidth={1.5} /> : <Unlock size={16} strokeWidth={1.5} />,
              label: lockActive ? 'Drawings locked' : 'Lock drawings',
              shortcut: 'L',
              description: 'Lock / unlock all drawings',
            }}
            active={lockActive}
            onClick={onToggleLock}
            accent="orange"
            isToggle
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: eyeHidden ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />,
              label: eyeHidden ? 'Show drawings' : 'Hide drawings',
              description: 'Toggle drawing visibility',
            }}
            active={eyeHidden}
            onClick={onToggleEye}
            accent="sky"
            isToggle
          />
          <ToolBtn
            def={{ mode: 'none', icon: <Layers size={16} strokeWidth={1.5} />, label: 'Layers', description: 'Open object manager' }}
            active={false}
            onClick={onOpenLayers}
          />
        </ToolGroup>

        <Divider />

        {/* ── Actions ────────────────────────────────────────── */}
        <ToolGroup>
          <ToolBtn
            def={{ mode: 'none', icon: <Eraser size={16} strokeWidth={1.5} />, label: 'Erase last', description: 'Remove last drawing' }}
            active={false}
            onClick={onClearLast}
            disabled={drawingCount === 0}
            danger
          />
          <ToolBtn
            def={{
              mode: 'none',
              icon: <Trash2 size={16} strokeWidth={1.5} />,
              label: drawingCount > 0 ? `Clear all (${drawingCount})` : 'Clear all',
              description: 'Delete all drawings',
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

// ─── Collapse toggle tab ──────────────────────────────────────────────────────
// Render inside the same `position: relative` container as ChartDrawingToolbar.
// It hugs the right edge of the toolbar and slides with it.

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
        left: collapsed ? 0 : 36,
        top: '50%',
        transform: 'translateY(-50%)',
        transition: 'left 0.2s ease',
        zIndex: 30,
      }}
      className={cn(
        'w-[10px] h-[32px] flex items-center justify-center',
        'bg-[#0e1017] border-y border-r border-white/[0.06] rounded-r',
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-px w-full px-[4px]">
      {children}
    </div>
  );
}

function Divider() {
  return <div className="w-[20px] h-px bg-white/[0.07] my-[5px] flex-shrink-0" />;
}

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
  const ACCENT: Record<string, string> = {
    blue:   'text-[#2962ff] bg-[#2962ff]/15',
    amber:  'text-amber-400  bg-amber-400/15',
    orange: 'text-orange-400 bg-orange-400/15',
    sky:    'text-sky-400    bg-sky-400/15',
    green:  'text-green-400  bg-green-400/15',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={def.label}
      aria-pressed={isToggle ? active : undefined}
      className={cn(
        'relative group',
        'w-[28px] h-[28px] flex items-center justify-center rounded-[4px]',
        'flex-shrink-0 transition-colors duration-100',
        // active state
        active  && (ACCENT[accent ?? 'blue']),
        // normal inactive
        !active && !danger && !disabled && 'text-[#6b7280] hover:text-[#c4c9d4] hover:bg-white/[0.07]',
        // danger
        danger  && !disabled && 'text-red-500/50 hover:text-red-400 hover:bg-red-500/10',
        // disabled
        disabled && 'opacity-20 cursor-default pointer-events-none',
      )}
    >
      {def.icon}

      {/* Tooltip — absolutely positioned to the right, z-500 escapes any stacking context */}
      <span
        className={cn(
          'absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
          'z-[500] pointer-events-none',
          'flex items-center gap-2 whitespace-nowrap',
          'px-[8px] py-[5px] rounded-[5px]',
          'bg-[#1a1d2e] border border-white/[0.09]',
          'shadow-[0_4px_20px_rgba(0,0,0,0.55)]',
          'opacity-0 group-hover:opacity-100',
          'transition-opacity duration-150 delay-75',
        )}
      >
        <span className="flex flex-col gap-[3px]">
          <span className="text-[13px] font-medium leading-none text-[#c4c9d4]">
            {def.label}
          </span>
          {def.description && (
            <span className="text-[13px] leading-none text-[#6b7280]">
              {def.description}
            </span>
          )}
        </span>
        {def.shortcut && (
          <span className="px-[5px] py-[2px] rounded-[3px] text-[13px] font-mono font-bold leading-none text-[#6b7280] bg-white/[0.07] border border-white/[0.06]">
            {def.shortcut}
          </span>
        )}
      </span>
    </button>
  );
}
