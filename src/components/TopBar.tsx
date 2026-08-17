import React from 'react';
import { Search, Bell, Home, BarChart3, TrendingUp, Activity, LineChart, Diamond, DollarSign, Sun, Moon, PieChart } from 'lucide-react';
import { useAppStore, type Workspace } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/utils/helpers';
import { AccountSelector } from './AccountSelector';

const STORAGE_KEY = 'fundedwealth-terminal-theme';

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
