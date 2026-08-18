import React from 'react';
import { Search, Bell, Home, BarChart3, TrendingUp, Activity, LineChart, Diamond, DollarSign, Sun, Moon, PieChart } from 'lucide-react';
import { useAppStore, type Workspace } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/utils/helpers';
import { AccountSelector } from './AccountSelector';

const STORAGE_KEY = 'fundedwealth-terminal-theme';

const LIGHT_FORCE_ID = 'fw-light-force';

function applyLightModeForce(enable: boolean) {
  let el = document.getElementById(LIGHT_FORCE_ID) as HTMLStyleElement | null;
  if (enable) {
    if (!el) {
      el = document.createElement('style');
      el.id = LIGHT_FORCE_ID;
      document.head.appendChild(el);
    }
    el.textContent = `
      html[data-theme="light"] * {
        --tw-bg-opacity: 1 !important;
      }
      html[data-theme="light"] [class*="bg-"][class*="#0"],
      html[data-theme="light"] [class*="bg-"][class*="#1"],
      html[data-theme="light"] [class*="bg-"][class*="#2"] {
        background-color: var(--fw-surface-2) !important;
        background-image: none !important;
      }
      html[data-theme="light"] header,
      html[data-theme="light"] [class*="bg-fw-surface"] {
        background-color: var(--fw-surface) !important;
      }
      html[data-theme="light"] [class*="bg-fw-bg"] {
        background-color: var(--fw-bg) !important;
      }
      html[data-theme="light"] [class*="bg-gradient"] {
        background-image: none !important;
        background-color: var(--fw-surface-2) !important;
      }
      html[data-theme="light"] [style*="linear-gradient"] {
        background: var(--fw-surface-2) !important;
      }
      html[data-theme="light"] [style*="background"][style*="rgb(1"],
      html[data-theme="light"] [style*="background"][style*="rgb(0"],
      html[data-theme="light"] [style*="background: #0"],
      html[data-theme="light"] [style*="background: #1"],
      html[data-theme="light"] [style*="background:#0"],
      html[data-theme="light"] [style*="background:#1"] {
        background: var(--fw-surface-2) !important;
      }
      /* Protect BUY/SELL buttons and semantic colors - do NOT override these */
      html[data-theme="light"] .bg-fw-green { background-color: var(--fw-green) !important; }
      html[data-theme="light"] .bg-fw-red { background-color: var(--fw-red) !important; }
      html[data-theme="light"] .bg-fw-accent { background-color: var(--fw-accent) !important; }
      html[data-theme="light"] .bg-white { background-color: #ffffff !important; }
      html[data-theme="light"] .bg-transparent { background-color: transparent !important; }
      html[data-theme="light"] .bg-current { background-color: currentColor !important; }
      html[data-theme="light"] .bg-fw-hover { background-color: var(--fw-hover) !important; }
      html[data-theme="light"] .bg-fw-border { background-color: var(--fw-border) !important; }
      /* Keep text readable — force dark text on light backgrounds */
      html[data-theme="light"] .text-fw-text { color: var(--fw-text) !important; }
      html[data-theme="light"] .text-fw-text-secondary { color: var(--fw-text-secondary) !important; }
      html[data-theme="light"] .text-fw-text-muted { color: var(--fw-text-muted) !important; }
      html[data-theme="light"] .text-white { color: #111827 !important; }
      /* But keep white text ON colored button backgrounds */
      html[data-theme="light"] [class*="bg-fw-green"] .text-white,
      html[data-theme="light"] [class*="bg-fw-red"] .text-white,
      html[data-theme="light"] [class*="bg-fw-accent"] .text-white,
      html[data-theme="light"] [class*="bg-green-"] .text-white,
      html[data-theme="light"] [class*="bg-red-"] .text-white,
      html[data-theme="light"] [class*="bg-emerald-"] .text-white,
      html[data-theme="light"] [class*="bg-blue-"] .text-white,
      html[data-theme="light"] button[style*="linear-gradient(180deg, #16"] .text-white,
      html[data-theme="light"] button[style*="linear-gradient(180deg, #7f"] .text-white,
      html[data-theme="light"] button[style*="background"] span {
        color: white !important;
      }
      /* BUY/SELL buttons have inline style backgrounds - protect them */
      html[data-theme="light"] button[style*="linear-gradient(180deg, #166534"] {
        background: linear-gradient(180deg, #166534 0%, #16a34a 50%, #15803d 100%) !important;
      }
      html[data-theme="light"] button[style*="linear-gradient(180deg, #7f1d1d"] {
        background: linear-gradient(180deg, #7f1d1d 0%, #dc2626 50%, #b91c1c 100%) !important;
      }
    `;
  } else {
    if (el) el.remove();
  }
}

// Apply on load if already light
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('fundedwealth-terminal-theme');
    if (stored === 'light') {
      // Defer to after DOM ready
      setTimeout(() => applyLightModeForce(true), 50);
    }
  } catch {}
}

export function TopBar() {
  const { setSearchOpen, setBottomTab } = useAppStore();
  const marketStatus = useMarketStore((s) => s.marketStatus);

  const [isLight, setIsLight] = React.useState(
    () => document.documentElement.getAttribute('data-theme') === 'light'
  );

  // Keep in sync if toggled from another source
  React.useEffect(() => {
    const handler = () => setIsLight(document.documentElement.getAttribute('data-theme') === 'light');
    window.addEventListener('fw:theme-changed', handler);
    return () => window.removeEventListener('fw:theme-changed', handler);
  }, []);

  const toggleTheme = () => {
    const next = isLight ? 'dark' : 'light';
    // Apply CSS variable theme via themeStore (this also sets/removes data-theme attribute)
    const themeId = next === 'light' ? 'light-pro' : 'dark-pro';
    useThemeStore.getState().applyTheme(themeId);
    // Also persist in legacy storage key for FOUC prevention in main.tsx
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    setIsLight(next === 'light');
    // Force-override all dark backgrounds via runtime style injection
    applyLightModeForce(next === 'light');
    window.dispatchEvent(new CustomEvent('fw:theme-changed'));
  };

  return (
    <header className="bg-fw-surface border-b border-fw-border flex select-none">
      <div className="flex items-center px-4 h-[48px] w-full gap-3">

        {/* Brand */}
        <div data-brand className="flex items-center gap-2.5 mr-4 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center flex-shrink-0" style={{ boxShadow: '0 0 10px rgba(139,92,246,0.3)' }}>
            <img src="/logo.png" alt="FW" className="w-7 h-7 object-contain" />
          </div>
          <div className="flex flex-col leading-tight items-center">
            <span className="text-[15px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">FUNDEDWEALTH</span>
            <span className="text-[11px] font-bold tracking-[0.3em] text-fw-text-muted text-center">TERMINAL</span>
          </div>
        </div>

        {/* Market status */}
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-semibold flex-shrink-0 border',
          marketStatus === 'OPEN'
            ? 'bg-fw-green/10 text-fw-green border-fw-green/20'
            : 'bg-fw-red/10 text-fw-red border-fw-red/20'
        )}>
          <div className={cn('w-2 h-2 rounded-full', marketStatus === 'OPEN' ? 'bg-fw-green animate-pulse' : 'bg-fw-red')} />
          {marketStatus === 'OPEN' ? 'LIVE' : 'CLOSED'}
        </div>

        <div className="w-px h-5 bg-fw-border/50 mx-1 flex-shrink-0" />

        {/* ── PRIMARY NAVIGATION ── */}
        <nav className="flex items-center gap-1 flex-shrink-0">
          <NavLink ws="home"     label="HOME"     icon={<Home size={13} />} />
          <NavLink ws="index"    label="INDEX"    icon={<BarChart3 size={13} />} />
          <NavLink ws="stocks"   label="STOCKS"   icon={<TrendingUp size={13} />} />
          <NavLink ws="options"  label="OPTION"   icon={<Activity size={13} />} />
          <NavLink ws="futures"  label="FUTURES"  icon={<LineChart size={13} />} />
          <NavLink ws="etf"      label="ETF"      icon={<PieChart size={13} />} />
          <NavLink ws="mcx"      label="MCX"      icon={<Diamond size={13} />} />
          <NavLink ws="cds"      label="CDS"      icon={<DollarSign size={13} />} />
          <div className="w-px h-5 bg-fw-border/40 mx-1.5" />
          <NavLink ws="ord"      label="ORD" />
          <NavLink ws="wl"       label="WL" />
          <NavLink ws="dom"      label="DOM" />
          <NavLink ws="btm"      label="BTM" />
          <NavLink ws="calendar" label="CALENDAR" />
        </nav>

        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AccountSelector />

          {/* Dark / Light toggle */}
          <button
            onClick={toggleTheme}
            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-fw-border bg-fw-bg hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text transition-all text-[12px] font-medium"
          >
            {isLight ? <Moon size={14} /> : <Sun size={14} />}
            {isLight ? 'Dark' : 'Light'}
          </button>

          <button onClick={() => setBottomTab('alerts')} className="p-1.5 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors" title="Alerts">
            <Bell size={15} />
          </button>
          <button onClick={() => setSearchOpen(true)} className="p-1.5 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-text transition-colors" title="Search (Ctrl+K)">
            <Search size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({ ws, label, icon }: { ws: Workspace; label: string; icon?: React.ReactNode }) {
  const { activeWorkspace, setActiveWorkspace } = useAppStore();
  const active = activeWorkspace === ws;
  return (
    <button
      onClick={() => setActiveWorkspace(ws)}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-semibold uppercase tracking-wide transition-all',
        active
          ? 'bg-fw-accent/15 text-fw-accent border border-fw-accent/40'
          : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover border border-transparent'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
