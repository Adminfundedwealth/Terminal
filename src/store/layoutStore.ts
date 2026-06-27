import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * LAYOUT ENGINE STORE
 * 
 * Manages workspace layouts with:
 * - Dock panel widths (clamped 200-600px)
 * - Bottom panel height (clamped 150px to 50% viewport)
 * - Auto-collapse on viewport < 1024px
 * - Saved layout presets with full panel state
 * - Chart layout modes (1/2h/2v/4)
 * - Workspace restoration per account
 */

export type ChartLayoutMode = '1-chart' | '2-chart-h' | '2-chart-v' | '4-chart';

export interface DockState {
  collapsed: boolean;
  width: number;
}

export interface BottomPanelState {
  collapsed: boolean;
  height: number;
  activeTab: string;
}

export interface LayoutPreset {
  id: string;
  name: string;
  chartLayout: ChartLayoutMode;
  leftDock: DockState;
  rightDock: DockState;
  bottomPanel: BottomPanelState;
  createdAt: string;
}

interface LayoutState {
  // Current state
  chartLayout: ChartLayoutMode;
  leftDock: DockState;
  rightDock: DockState;
  bottomPanel: BottomPanelState;
  viewportWidth: number;
  isAutoCollapsed: boolean;
  savedLayouts: LayoutPreset[];

  // Actions
  setChartLayout: (mode: ChartLayoutMode) => void;
  setLeftDockWidth: (width: number) => void;
  setRightDockWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  toggleBottomPanel: () => void;
  setBottomTab: (tab: string) => void;
  updateViewport: (width: number) => void;
  saveCurrentLayout: (name: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  resetToDefault: () => void;
}

// Constraints
const MIN_DOCK_WIDTH = 200;
const MAX_DOCK_WIDTH = 600;
const MIN_BOTTOM_HEIGHT = 150;
const AUTO_COLLAPSE_BREAKPOINT = 1024;

function clampDockWidth(w: number): number {
  return Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, w));
}

function clampBottomHeight(h: number): number {
  const maxH = typeof window !== 'undefined' ? window.innerHeight * 0.5 : 500;
  return Math.max(MIN_BOTTOM_HEIGHT, Math.min(maxH, h));
}

const DEFAULT_STATE = {
  chartLayout: '1-chart' as ChartLayoutMode,
  leftDock: { collapsed: false, width: 260 },
  rightDock: { collapsed: false, width: 300 },
  bottomPanel: { collapsed: false, height: 200, activeTab: 'positions' },
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
      isAutoCollapsed: false,
      savedLayouts: [],

      setChartLayout: (mode) => set({ chartLayout: mode }),

      setLeftDockWidth: (width) => {
        const clamped = clampDockWidth(width);
        set((s) => ({ leftDock: { ...s.leftDock, width: clamped } }));
      },

      setRightDockWidth: (width) => {
        const clamped = clampDockWidth(width);
        set((s) => ({ rightDock: { ...s.rightDock, width: clamped } }));
      },

      setBottomHeight: (height) => {
        const clamped = clampBottomHeight(height);
        set((s) => ({ bottomPanel: { ...s.bottomPanel, height: clamped } }));
      },

      toggleLeftDock: () => set((s) => ({
        leftDock: { ...s.leftDock, collapsed: !s.leftDock.collapsed },
      })),

      toggleRightDock: () => set((s) => ({
        rightDock: { ...s.rightDock, collapsed: !s.rightDock.collapsed },
      })),

      toggleBottomPanel: () => set((s) => ({
        bottomPanel: { ...s.bottomPanel, collapsed: !s.bottomPanel.collapsed },
      })),

      setBottomTab: (tab) => set((s) => ({
        bottomPanel: { ...s.bottomPanel, activeTab: tab, collapsed: false },
      })),

      updateViewport: (width) => {
        const shouldAutoCollapse = width < AUTO_COLLAPSE_BREAKPOINT;
        const current = get();
        
        if (shouldAutoCollapse && !current.isAutoCollapsed) {
          // Auto-collapse docks
          set({
            viewportWidth: width,
            isAutoCollapsed: true,
            leftDock: { ...current.leftDock, collapsed: true },
            rightDock: { ...current.rightDock, collapsed: true },
          });
        } else if (!shouldAutoCollapse && current.isAutoCollapsed) {
          // Restore docks
          set({
            viewportWidth: width,
            isAutoCollapsed: false,
            leftDock: { ...current.leftDock, collapsed: false },
            rightDock: { ...current.rightDock, collapsed: false },
          });
        } else {
          set({ viewportWidth: width });
        }
      },

      saveCurrentLayout: (name) => {
        const { chartLayout, leftDock, rightDock, bottomPanel, savedLayouts } = get();
        if (savedLayouts.length >= 20) return; // Max 20 layouts per user

        const preset: LayoutPreset = {
          id: crypto.randomUUID(),
          name,
          chartLayout,
          leftDock: { ...leftDock },
          rightDock: { ...rightDock },
          bottomPanel: { ...bottomPanel },
          createdAt: new Date().toISOString(),
        };

        set({ savedLayouts: [preset, ...savedLayouts] });

        // Persist to server (fire-and-forget)
        fetch('/api/persistence/layouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            layout_type: 'custom',
            panel_config: { chartLayout, leftDock, rightDock, bottomPanel },
            chart_config: { chartLayout },
            sidebar_collapsed: leftDock.collapsed,
            bottom_panel_height: bottomPanel.height,
            watchlist_width: leftDock.width,
            order_panel_width: rightDock.width,
          }),
        }).catch(() => {});
      },

      loadLayout: (id) => {
        const layout = get().savedLayouts.find(l => l.id === id);
        if (!layout) return;

        set({
          chartLayout: layout.chartLayout,
          leftDock: { ...layout.leftDock },
          rightDock: { ...layout.rightDock },
          bottomPanel: { ...layout.bottomPanel },
        });
      },

      deleteLayout: (id) => {
        set((s) => ({ savedLayouts: s.savedLayouts.filter(l => l.id !== id) }));
      },

      resetToDefault: () => set({ ...DEFAULT_STATE }),
    }),
    {
      name: 'fw-layout-engine-v1',
      partialize: (state) => ({
        chartLayout: state.chartLayout,
        leftDock: state.leftDock,
        rightDock: state.rightDock,
        bottomPanel: state.bottomPanel,
        savedLayouts: state.savedLayouts,
      }),
    }
  )
);

// ─── ResizeObserver Hook Integration ──────────────────────────────────────────

let resizeObserverSetup = false;

export function initLayoutObserver() {
  if (resizeObserverSetup || typeof window === 'undefined') return;
  resizeObserverSetup = true;

  const updateViewport = () => useLayoutStore.getState().updateViewport(window.innerWidth);
  
  // Initial check
  updateViewport();
  
  // ResizeObserver on body for viewport changes
  const observer = new ResizeObserver(() => updateViewport());
  observer.observe(document.body);
  
  // Also listen to window resize as fallback
  window.addEventListener('resize', updateViewport);
}
