import { Search, Bell, Home, BarChart3, TrendingUp, Activity, LineChart, Diamond, DollarSign } from 'lucide-react';
import { useAppStore, type Workspace } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { cn } from '@/utils/helpers';
import { AccountSelector } from './AccountSelector';
import type { Theme } from '@/types';

export function TopBar() {
  const { theme, setTheme, setSearchOpen, setBottomTab } = useAppStore();
  const marketStatus = useMarketStore((s) => s.marketStatus);

  return (
    <header className="bg-gradient-to-b from-[#0e1018] to-[#0c0e14] border-b border-fw-border flex flex-col select-none overflow-hidden">
      <div className="flex items-center px-3 h-[40px] gap-2">

        {/* Brand */}
        <div data-brand className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-md overflow-hidden bg-white flex items-center justify-center flex-shrink-0" style={{ boxShadow: '0 0 8px rgba(139,92,246,0.4)' }}>
            <img src="/logo.png" alt="FW" className="w-6 h-6 object-contain" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[11px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">FUNDEDWEALTH</span>
            <span className="text-[9px] font-bold tracking-[0.25em] text-fw-accent/70">TERMINAL</span>
          </div>
        </div>

        {/* Market status dot */}
        <div className={cn('fw-badge flex-shrink-0', marketStatus === 'OPEN' ? 'fw-badge-green' : 'fw-badge-red')}>
          <div className={cn('w-1.5 h-1.5 rounded-full', marketStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
          {marketStatus === 'OPEN' ? 'LIVE' : 'CLOSED'}
        </div>

        <div className="w-px h-4 bg-fw-border/40 mx-1 flex-shrink-0" />

        {/* ── PRIMARY NAVIGATION ── */}
        <nav className="flex items-center gap-0.5 flex-shrink-0">
          <NavLink ws="home"     label="HOME"     icon={<Home size={11} />} />
          <NavLink ws="index"    label="INDEX"    icon={<BarChart3 size={11} />} />
          <NavLink ws="stocks"   label="STOCKS"   icon={<TrendingUp size={11} />} />
          <NavLink ws="options"  label="OPTION"   icon={<Activity size={11} />} />
          <NavLink ws="futures"  label="FUTURES"  icon={<LineChart size={11} />} />
          <NavLink ws="mcx"      label="MCX"      icon={<Diamond size={11} />} />
          <NavLink ws="cds"      label="CDS"      icon={<DollarSign size={11} />} />
          <div className="w-px h-4 bg-fw-border/30 mx-1" />
          <NavLink ws="ord"      label="ORD" />
          <NavLink ws="wl"       label="WL" />
          <NavLink ws="dom"      label="DOM" />
          <NavLink ws="btm"      label="BTM" />
          <NavLink ws="calendar" label="CAL" />
        </nav>

        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <AccountSelector />
          <div className="flex items-center bg-fw-bg rounded border border-fw-border p-0.5">
            {([{ value: 'dark' as Theme, label: 'D' }, { value: 'fw-blue' as Theme, label: 'B' }]).map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={cn('px-1.5 py-0.5 rounded text-[11px] font-bold', theme === t.value ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => setBottomTab('alerts')} className="p-1 rounded hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text transition-colors" title="Alerts">
            <Bell size={13} />
          </button>
          <button onClick={() => setSearchOpen(true)} className="p-1 rounded hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text" title="Search (Ctrl+K)">
            <Search size={13} />
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
        'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider transition-all',
        active
          ? 'bg-fw-accent/15 text-fw-accent border border-fw-accent/30'
          : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/40 border border-transparent'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
