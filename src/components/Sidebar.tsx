import { 
  LayoutDashboard, BarChart3, TrendingUp, LineChart, Activity, Diamond, DollarSign,
  Search, Bell, ScanLine, PieChart, BookOpen, Settings, Wifi, WifiOff, Bot, Users, User, LogOut, Home
} from 'lucide-react';
import { useAppStore, type Workspace } from '@/store/appStore';
import { useMarketStore } from '@/store/marketStore';
import { cn } from '@/utils/helpers';
import { useState } from 'react';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProfilePanel } from '@/components/ProfilePanel';
import { logout } from '@/hooks/useAuth';

const DASHBOARD_URL = (import.meta as any).env?.VITE_FW_DASHBOARD_URL || 'https://fundedwealth.com';

const WORKSPACES: { id: Workspace; icon: React.ReactNode; label: string; color: string }[] = [
  { id: 'home',     icon: <Home size={18} />,       label: 'Home',     color: '#7C3AED' },
  { id: 'index',    icon: <BarChart3 size={18} />,   label: 'Index',    color: '#2962ff' },
  { id: 'stocks',   icon: <TrendingUp size={18} />,  label: 'Stocks',   color: '#26a69a' },
  { id: 'futures',  icon: <LineChart size={18} />,   label: 'Futures',  color: '#ff9800' },
  { id: 'options',  icon: <Activity size={18} />,    label: 'Options',  color: '#ab47bc' },
  { id: 'mcx',     icon: <Diamond size={18} />,     label: 'MCX',     color: '#f59e0b' },
  { id: 'cds',     icon: <DollarSign size={18} />,  label: 'CDS',     color: '#06b6d4' },
];

export function Sidebar() {
  const { activeWorkspace, setActiveWorkspace, setSearchOpen, setBottomTab } = useAppStore();
  const marketStatus = useMarketStore((s) => s.marketStatus);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <>
    <div className="w-[48px] min-w-[48px] h-full bg-[#08090e] border-r border-fw-border/60 flex flex-col items-center py-2 select-none flex-shrink-0">

      {/* Dashboard */}
      <SidebarBtn
        icon={<LayoutDashboard size={16} />}
        label="Dashboard"
        active={false}
        onClick={() => window.open(DASHBOARD_URL, '_blank', 'noopener,noreferrer')}
      />

      {/* Divider */}
      <div className="w-6 h-px bg-fw-border/30 my-1.5" />

      {/* Workspace Icons */}
      <div className="flex flex-col items-center gap-0.5 w-full px-1">
        {WORKSPACES.map((ws) => (
          <button
            key={ws.id}
            onClick={() => setActiveWorkspace(ws.id)}
            title={ws.label}
            className={cn(
              'w-9 h-8 flex items-center justify-center rounded-md transition-all relative group',
              activeWorkspace === ws.id
                ? 'bg-fw-hover/80 text-fw-text'
                : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover/40'
            )}
          >
            {ws.icon}
            {activeWorkspace === ws.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full" style={{ backgroundColor: ws.color }} />
            )}
            <div className="absolute left-full ml-2 px-2 py-1 bg-[#1a1d28] border border-fw-border rounded-md text-[14px] text-fw-text whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
              {ws.label}
            </div>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-6 h-px bg-fw-border/30 my-1.5" />

      {/* Tools */}
      <div className="flex flex-col items-center gap-0.5 w-full px-1">
        <SidebarBtn icon={<Search size={15} />} label="Search (Ctrl+K)" onClick={() => setSearchOpen(true)} />
        <SidebarBtn icon={<ScanLine size={15} />} label="Scanner" onClick={() => setBottomTab('scanner')} />
        <SidebarBtn icon={<Bell size={15} />} label="Alerts" onClick={() => setBottomTab('alerts')} />
        <SidebarBtn icon={<BookOpen size={15} />} label="Journal" onClick={() => setBottomTab('journal')} />
        <SidebarBtn icon={<PieChart size={15} />} label="Analytics" onClick={() => setBottomTab('analytics')} />
        <SidebarBtn icon={<Bot size={15} />} label="Insights (Rule-based analysis)" onClick={() => setBottomTab('ai')} />
        <SidebarBtn icon={<Users size={15} />} label="Accounts" onClick={() => setBottomTab('accounts')} />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection Status */}
      <div className="mb-1.5">
        <div className={cn(
          'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
          marketStatus === 'OPEN' ? 'text-emerald-400' : 'text-red-400/70'
        )} title={marketStatus === 'OPEN' ? 'Connected — Market Open' : 'Market Closed'}>
          {marketStatus === 'OPEN' ? <Wifi size={14} /> : <WifiOff size={14} />}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="pt-1.5 border-t border-fw-border/30 w-full flex flex-col items-center gap-0.5">
        <SidebarBtn icon={<User size={15} />} label="Profile" onClick={() => setShowProfile(true)} />
        <SidebarBtn icon={<Settings size={15} />} label="Settings" onClick={() => setShowSettings(true)} />
        <SidebarBtn icon={<LogOut size={15} />} label="Logout" onClick={() => logout()} />
      </div>
    </div>

    {/* Modals */}
    {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
    </>
  );
}

function SidebarBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'w-9 h-8 flex items-center justify-center rounded-md transition-all relative group',
        active ? 'bg-fw-hover/80 text-fw-text' : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover/40'
      )}
    >
      {icon}
      <div className="absolute left-full ml-2 px-2 py-1 bg-[#1a1d28] border border-fw-border rounded-md text-[14px] text-fw-text whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
        {label}
      </div>
    </button>
  );
}
