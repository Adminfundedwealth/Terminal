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
    <header className="bg-gradient-to-b from-[#0e1018] to-[#0c0e14] border-b border-fw-border flex select-none">
      <div className="flex items-center px-4 h-[46px] w-full gap-3">

        {/* Brand */}
        <div data-brand className="flex items-center gap-2.5 mr-4 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center flex-shrink-0" style={{ boxShadow: '0 0 10px rgba(139,92,246,0.4)' }}>
            <img src="/logo.png" alt="FW" className="w-7 h-7 object-contain" />
          </div>
          <div className="flex flex-col leading-tight items-center">
            <span className="text-[14px] font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">FUNDEDWEALTH</span>
            <span className="text-[10px] font-bold tracking-[0.3em] text-slate-400 text-center">TERMINAL</span>
          </div>
        </div>

        {/* Market status */}
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-semibold flex-shrink-0',
          marketStatus === 'OPEN'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        )}>
          <div className={cn('w-2 h-2 rounded-full', marketStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
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
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <AccountSelector />
          <div className="flex items-center bg-fw-bg rounded border border-fw-border p-0.5">
            {([{ value: 'dark' as Theme, label: 'D' }, { value: 'fw-blue' as Theme, label: 'B' }]).map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={cn('px-2 py-0.5 rounded text-[12px] font-bold', theme === t.value ? 'bg-fw-accent text-white' : 'text-fw-text-muted hover:text-fw-text')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => setBottomTab('alerts')} className="p-1.5 rounded hover:bg-fw-hover text-slate-400 hover:text-fw-text transition-colors" title="Alerts">
            <Bell size={15} />
          </button>
          <button onClick={() => setSearchOpen(true)} className="p-1.5 rounded hover:bg-fw-hover text-slate-400 hover:text-fw-text transition-colors" title="Search (Ctrl+K)">
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
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-semibold uppercase tracking-wide transition-all',
        active
          ? 'bg-fw-accent/15 text-fw-accent border border-fw-accent/40'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
