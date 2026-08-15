import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * THEME ENGINE STORE
 * 
 * Full CSS-variable-based theme system with:
 * - 4 built-in presets (Dark Pro, Light Pro, Midnight Blue, High Contrast)
 * - Density modes (compact, normal, comfortable)
 * - Trading profiles (scalper, intraday, swing, options-trader)
 * - Custom theme creation/validation
 * - Server sync (fire-and-forget, retry on next load)
 * 
 * All theme changes are applied via CSS custom property injection (no React re-renders).
 */

export type DensityMode = 'compact' | 'normal' | 'comfortable';
export type FontSize = 'xs' | 'sm' | 'md' | 'lg';
export type TradingProfile = 'scalper' | 'intraday' | 'swing' | 'options-trader' | 'custom';

export interface ThemeConfig {
  id: string;
  name: string;
  isSystem: boolean;
  colors: {
    bg: string;
    surface: string;
    surface2: string;
    border: string;
    borderLight: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentHover: string;
    green: string;
    greenDim: string;
    red: string;
    redDim: string;
    panel: string;
    hover: string;
    selected: string;
    yellow: string;
    cyan: string;
    purple: string;
    orange: string;
  };
}

// ─── Built-in Theme Presets ───────────────────────────────────────────────────

const DARK_PRO: ThemeConfig = {
  id: 'dark-pro',
  name: 'Dark Pro',
  isSystem: true,
  colors: {
    bg: '#0f1118', surface: '#181b25', surface2: '#1e2230', border: '#262a36', borderLight: '#2f3444',
    text: '#f1f5f9', textSecondary: '#cbd5e1', textMuted: '#94a3b8',
    accent: '#3b82f6', accentHover: '#2563eb',
    green: '#22c55e', greenDim: 'rgba(34,197,94,0.12)', red: '#ef4444', redDim: 'rgba(239,68,68,0.12)',
    panel: '#181b25', hover: '#1f2332', selected: '#252a3a',
    yellow: '#f59e0b', cyan: '#06b6d4', purple: '#8b5cf6', orange: '#f97316',
  },
};

const MIDNIGHT_BLUE: ThemeConfig = {
  id: 'midnight-blue',
  name: 'Midnight Blue',
  isSystem: true,
  colors: {
    bg: '#131722', surface: '#1e222d', surface2: '#252a37', border: '#2a2e39', borderLight: '#363a45',
    text: '#f1f5f9', textSecondary: '#cbd5e1', textMuted: '#94a3b8',
    accent: '#2962ff', accentHover: '#1e50e6',
    green: '#26a69a', greenDim: 'rgba(38,166,154,0.12)', red: '#ef5350', redDim: 'rgba(239,83,80,0.12)',
    panel: '#1e222d', hover: '#2a2e39', selected: '#323741',
    yellow: '#f59e0b', cyan: '#06b6d4', purple: '#7c3aed', orange: '#f97316',
  },
};

const LIGHT_PRO: ThemeConfig = {
  id: 'light-pro',
  name: 'Light Pro',
  isSystem: true,
  colors: {
    bg: '#f8f9fa', surface: '#ffffff', surface2: '#f1f3f5', border: '#dee2e6', borderLight: '#ced4da',
    text: '#212529', textSecondary: '#495057', textMuted: '#868e96',
    accent: '#2962ff', accentHover: '#1e50e6',
    green: '#0ca678', greenDim: 'rgba(12,166,120,0.08)', red: '#e03131', redDim: 'rgba(224,49,49,0.08)',
    panel: '#ffffff', hover: '#f1f3f5', selected: '#e9ecef',
    yellow: '#f08c00', cyan: '#0891b2', purple: '#7048e8', orange: '#e8590c',
  },
};

const HIGH_CONTRAST: ThemeConfig = {
  id: 'high-contrast',
  name: 'High Contrast',
  isSystem: true,
  colors: {
    bg: '#000000', surface: '#0a0a0a', surface2: '#141414', border: '#333333', borderLight: '#444444',
    text: '#ffffff', textSecondary: '#cccccc', textMuted: '#888888',
    accent: '#00aaff', accentHover: '#0088cc',
    green: '#00ff88', greenDim: 'rgba(0,255,136,0.15)', red: '#ff3333', redDim: 'rgba(255,51,51,0.15)',
    panel: '#0a0a0a', hover: '#1a1a1a', selected: '#222222',
    yellow: '#ffcc00', cyan: '#00e5ff', purple: '#aa55ff', orange: '#ff8800',
  },
};

const SYSTEM_THEMES: ThemeConfig[] = [DARK_PRO, MIDNIGHT_BLUE, LIGHT_PRO, HIGH_CONTRAST];

// ─── Density Spacing ──────────────────────────────────────────────────────────

const DENSITY_VARS: Record<DensityMode, Record<string, string>> = {
  compact: { '--fw-spacing-xs': '2px', '--fw-spacing-sm': '4px', '--fw-spacing-md': '6px', '--fw-spacing-lg': '8px', '--fw-spacing-xl': '12px', '--fw-font-size-base': '13px', '--fw-line-height': '1.3' },
  normal: { '--fw-spacing-xs': '4px', '--fw-spacing-sm': '6px', '--fw-spacing-md': '8px', '--fw-spacing-lg': '12px', '--fw-spacing-xl': '16px', '--fw-font-size-base': '14px', '--fw-line-height': '1.4' },
  comfortable: { '--fw-spacing-xs': '6px', '--fw-spacing-sm': '8px', '--fw-spacing-md': '12px', '--fw-spacing-lg': '16px', '--fw-spacing-xl': '24px', '--fw-font-size-base': '15px', '--fw-line-height': '1.5' },
};

// ─── Trading Profile Presets ──────────────────────────────────────────────────

const PROFILE_PRESETS: Record<TradingProfile, { density: DensityMode; fontSize: FontSize }> = {
  scalper: { density: 'compact', fontSize: 'sm' },
  intraday: { density: 'normal', fontSize: 'md' },
  swing: { density: 'comfortable', fontSize: 'md' },
  'options-trader': { density: 'normal', fontSize: 'sm' },
  custom: { density: 'normal', fontSize: 'md' },
};

// ─── Store Interface ──────────────────────────────────────────────────────────

interface ThemeState {
  activeThemeId: string;
  densityMode: DensityMode;
  fontSize: FontSize;
  activeProfile: TradingProfile;
  customThemes: ThemeConfig[];

  // Actions
  applyTheme: (themeId: string) => void;
  setDensity: (mode: DensityMode) => void;
  setFontSize: (size: FontSize) => void;
  setProfile: (profile: TradingProfile) => void;
  createCustomTheme: (config: Omit<ThemeConfig, 'id' | 'isSystem'>) => string | null;
  deleteCustomTheme: (id: string) => void;
  getAllThemes: () => ThemeConfig[];
  getActiveTheme: () => ThemeConfig;
}

/**
 * Apply theme colors as CSS custom properties on document root.
 * This avoids React re-renders — all components use CSS variables.
 */
function injectThemeCSS(config: ThemeConfig) {
  const root = document.documentElement;
  const { colors } = config;

  // Batch all CSS property updates within a single frame
  root.style.setProperty('--fw-bg', colors.bg);
  root.style.setProperty('--fw-surface', colors.surface);
  root.style.setProperty('--fw-surface-2', colors.surface2);
  root.style.setProperty('--fw-border', colors.border);
  root.style.setProperty('--fw-border-light', colors.borderLight);
  root.style.setProperty('--fw-text', colors.text);
  root.style.setProperty('--fw-text-secondary', colors.textSecondary);
  root.style.setProperty('--fw-text-muted', colors.textMuted);
  root.style.setProperty('--fw-accent', colors.accent);
  root.style.setProperty('--fw-accent-hover', colors.accentHover);
  root.style.setProperty('--fw-green', colors.green);
  root.style.setProperty('--fw-green-dim', colors.greenDim);
  root.style.setProperty('--fw-red', colors.red);
  root.style.setProperty('--fw-red-dim', colors.redDim);
  root.style.setProperty('--fw-panel', colors.panel);
  root.style.setProperty('--fw-hover', colors.hover);
  root.style.setProperty('--fw-selected', colors.selected);
  root.style.setProperty('--fw-yellow', colors.yellow);
  root.style.setProperty('--fw-cyan', colors.cyan);
  root.style.setProperty('--fw-purple', colors.purple);
  root.style.setProperty('--fw-orange', colors.orange);

  // Remove data-theme attribute — CSS variables handle everything now
  root.removeAttribute('data-theme');
}

function injectDensityCSS(mode: DensityMode) {
  const root = document.documentElement;
  const vars = DENSITY_VARS[mode];
  Object.entries(vars).forEach(([prop, val]) => root.style.setProperty(prop, val));
  root.dataset.density = mode;
}

function isValidCSSColor(color: string): boolean {
  if (!color) return false;
  // Accept hex, rgb, rgba, hsl, hsla, named colors
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return true;
  if (/^rgba?\(/.test(color)) return true;
  if (/^hsla?\(/.test(color)) return true;
  // Named color check via DOM
  const s = new Option().style;
  s.color = color;
  return s.color !== '';
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      activeThemeId: 'dark-pro',
      densityMode: 'normal',
      fontSize: 'md',
      activeProfile: 'intraday',
      customThemes: [],

      applyTheme: (themeId) => {
        const all = get().getAllThemes();
        let theme = all.find(t => t.id === themeId);
        if (!theme) {
          // Fallback to Dark Pro on invalid/corrupt
          theme = DARK_PRO;
          themeId = 'dark-pro';
        }
        injectThemeCSS(theme);
        set({ activeThemeId: themeId });

        // Persist to localStorage done by zustand/persist
        // Server sync (fire-and-forget with 5s timeout)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        fetch('/api/persistence/themes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: theme.name, colors: theme.colors }),
          signal: controller.signal,
        }).catch(() => {}).finally(() => clearTimeout(timeoutId));
      },

      setDensity: (mode) => {
        injectDensityCSS(mode);
        set({ densityMode: mode });
      },

      setFontSize: (size) => {
        const sizeMap: Record<FontSize, string> = { xs: '13px', sm: '14px', md: '14px', lg: '15px' };
        document.documentElement.style.setProperty('--fw-font-size-base', sizeMap[size]);
        set({ fontSize: size });
      },

      setProfile: (profile) => {
        const preset = PROFILE_PRESETS[profile];
        get().setDensity(preset.density);
        get().setFontSize(preset.fontSize);
        set({ activeProfile: profile });
      },

      createCustomTheme: (config) => {
        // Validation
        if (!config.name || config.name.length < 1 || config.name.length > 50) return null;
        const existing = get().customThemes.find(t => t.name === config.name);
        if (existing) return null;

        // Validate all colors
        const colorValues = Object.values(config.colors);
        for (const c of colorValues) {
          if (!isValidCSSColor(c)) return null;
        }

        const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
        const newTheme: ThemeConfig = { ...config, id, isSystem: false };
        set((s) => ({ customThemes: [...s.customThemes, newTheme] }));
        return id;
      },

      deleteCustomTheme: (id) => {
        set((s) => ({
          customThemes: s.customThemes.filter(t => t.id !== id),
          activeThemeId: s.activeThemeId === id ? 'dark-pro' : s.activeThemeId,
        }));
        if (get().activeThemeId === 'dark-pro') {
          injectThemeCSS(DARK_PRO);
        }
      },

      getAllThemes: () => [...SYSTEM_THEMES, ...get().customThemes],

      getActiveTheme: () => {
        const all = get().getAllThemes();
        return all.find(t => t.id === get().activeThemeId) || DARK_PRO;
      },
    }),
    {
      name: 'fw-theme-engine-v1',
      partialize: (state) => ({
        activeThemeId: state.activeThemeId,
        densityMode: state.densityMode,
        fontSize: state.fontSize,
        activeProfile: state.activeProfile,
        customThemes: state.customThemes,
      }),
    }
  )
);

// Apply theme on module load (rehydration from localStorage)
if (typeof window !== 'undefined') {
  // Small delay to let zustand persist middleware hydrate
  setTimeout(() => {
    const state = useThemeStore.getState();
    const all = [...SYSTEM_THEMES, ...state.customThemes];
    const theme = all.find(t => t.id === state.activeThemeId) || DARK_PRO;
    injectThemeCSS(theme);
    injectDensityCSS(state.densityMode);
  }, 0);
}
