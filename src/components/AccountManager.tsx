import { useState } from 'react';
import { Users, Plus, Trash2, Power, Copy, Settings, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useFounderStore, type CopyMode, type SlaveAccount, type AccountExposure } from '@/store/founderStore';
import { cn } from '@/utils/helpers';

/**
 * Account Manager Panel — Multi-Account / Master-Slave Configuration
 * 
 * Provides:
 * - Master account selection
 * - Slave account management with copy ratios
 * - Copy mode configuration (mirror / proportional / fixed-lot)
 * - Enable/disable per slave
 * - Exposure aggregation view
 * 
 * BACKEND STATUS: No /api/founder/* endpoints exist.
 * Config is persisted locally via founderStore (localStorage).
 * Order replication calls /api/orders with slave accountId.
 */
export function AccountManager() {
  const {
    config, exposures, exposureLoading,
    setMasterAccount, clearMasterAccount, addSlaveAccount, removeSlaveAccount,
    updateSlaveAccount, setCopyMode, toggleActive, toggleSlaveEnabled, refreshExposures,
  } = useFounderStore();

  const [showAddSlave, setShowAddSlave] = useState(false);
  const [newSlave, setNewSlave] = useState({ accountId: '', name: '', copyRatio: 1, fixedLots: 1 });
  const [activeView, setActiveView] = useState<'config' | 'exposure'>('config');

  const handleAddSlave = () => {
    if (!newSlave.accountId.trim() || !newSlave.name.trim()) return;
    addSlaveAccount({
      accountId: newSlave.accountId.trim(),
      name: newSlave.name.trim(),
      copyRatio: newSlave.copyRatio,
      fixedLots: newSlave.fixedLots,
      enabled: true,
    });
    setNewSlave({ accountId: '', name: '', copyRatio: 1, fixedLots: 1 });
    setShowAddSlave(false);
  };

  return (
    <div className="h-full flex flex-col bg-fw-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-fw-cyan" />
          <span className="text-[12px] font-bold text-fw-text">Account Manager</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveView('config')}
            className={cn('text-[10px] px-2 py-1 rounded', activeView === 'config' ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover')}
          >
            Config
          </button>
          <button
            onClick={() => { setActiveView('exposure'); refreshExposures(); }}
            className={cn('text-[10px] px-2 py-1 rounded', activeView === 'exposure' ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover')}
          >
            Exposure
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeView === 'config' ? (
          <ConfigView
            config={config}
            showAddSlave={showAddSlave}
            setShowAddSlave={setShowAddSlave}
            newSlave={newSlave}
            setNewSlave={setNewSlave}
            onAddSlave={handleAddSlave}
            onSetMaster={setMasterAccount}
            onClearMaster={clearMasterAccount}
            onRemoveSlave={removeSlaveAccount}
            onUpdateSlave={updateSlaveAccount}
            onSetCopyMode={setCopyMode}
            onToggleActive={toggleActive}
            onToggleSlaveEnabled={toggleSlaveEnabled}
          />
        ) : (
          <ExposureView exposures={exposures} loading={exposureLoading} onRefresh={refreshExposures} />
        )}
      </div>

      {/* No backend warning */}
      <div className="px-3 py-1.5 border-t border-fw-border flex-shrink-0 bg-fw-cyan/5">
        <span className="text-[9px] text-fw-cyan">
          ℹ Config stored locally. No /api/founder endpoint — replication dispatches to /api/orders per slave.
        </span>
      </div>
    </div>
  );
}

// ─── Config View ──────────────────────────────────────────────────────────────

function ConfigView({
  config, showAddSlave, setShowAddSlave, newSlave, setNewSlave,
  onAddSlave, onSetMaster, onClearMaster, onRemoveSlave, onUpdateSlave,
  onSetCopyMode, onToggleActive, onToggleSlaveEnabled,
}: {
  config: { masterAccountId: string | null; slaves: SlaveAccount[]; copyMode: CopyMode; isActive: boolean };
  showAddSlave: boolean;
  setShowAddSlave: (v: boolean) => void;
  newSlave: { accountId: string; name: string; copyRatio: number; fixedLots: number };
  setNewSlave: (v: any) => void;
  onAddSlave: () => void;
  onSetMaster: (id: string) => void;
  onClearMaster: () => void;
  onRemoveSlave: (id: string) => void;
  onUpdateSlave: (id: string, u: Partial<SlaveAccount>) => void;
  onSetCopyMode: (m: CopyMode) => void;
  onToggleActive: () => void;
  onToggleSlaveEnabled: (id: string) => void;
}) {
  const [masterInput, setMasterInput] = useState('');

  return (
    <div className="p-3 space-y-3">
      {/* Active Toggle */}
      <div className="flex items-center justify-between p-3 bg-fw-bg border border-fw-border rounded">
        <div className="flex items-center gap-2">
          <Power size={14} className={config.isActive ? 'text-green' : 'text-fw-text-muted'} />
          <div>
            <div className="text-[11px] font-bold text-fw-text">Copy Trading</div>
            <div className="text-[10px] text-fw-text-muted">{config.isActive ? 'Active — orders will replicate' : 'Inactive — no replication'}</div>
          </div>
        </div>
        <button
          onClick={onToggleActive}
          className={cn('w-10 h-5 rounded-full transition-colors relative', config.isActive ? 'bg-green' : 'bg-fw-border')}
        >
          <div className={cn('absolute w-4 h-4 rounded-full bg-white top-0.5 transition-all', config.isActive ? 'left-5.5' : 'left-0.5')} style={{ left: config.isActive ? '22px' : '2px' }} />
        </button>
      </div>

      {/* Master Account */}
      <div className="p-3 bg-fw-bg border border-fw-border rounded">
        <div className="text-[10px] text-fw-text-muted uppercase font-bold mb-2">Master Account</div>
        {config.masterAccountId ? (
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-mono font-bold text-fw-text">{config.masterAccountId}</span>
            <button onClick={onClearMaster} className="text-[10px] text-red-400 hover:text-red">Remove</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={masterInput}
              onChange={e => setMasterInput(e.target.value)}
              placeholder="Account ID"
              className="flex-1 bg-fw-surface border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent"
            />
            <button
              onClick={() => { if (masterInput.trim()) { onSetMaster(masterInput.trim()); setMasterInput(''); } }}
              className="px-3 py-1.5 text-[10px] bg-fw-accent text-white rounded font-bold"
            >
              Set
            </button>
          </div>
        )}
      </div>

      {/* Copy Mode */}
      <div className="p-3 bg-fw-bg border border-fw-border rounded">
        <div className="text-[10px] text-fw-text-muted uppercase font-bold mb-2">Copy Mode</div>
        <div className="flex gap-1">
          {(['mirror', 'proportional', 'fixed-lot'] as CopyMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onSetCopyMode(mode)}
              className={cn(
                'flex-1 py-1.5 text-[10px] rounded capitalize font-medium border transition-all',
                config.copyMode === mode ? 'border-fw-accent bg-fw-accent/10 text-fw-accent' : 'border-fw-border text-fw-text-secondary hover:border-fw-text-muted'
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="text-[9px] text-fw-text-muted mt-1.5">
          {config.copyMode === 'mirror' && 'Same qty as master'}
          {config.copyMode === 'proportional' && 'Master qty × copy ratio (rounded down to lot size)'}
          {config.copyMode === 'fixed-lot' && 'Fixed qty per slave regardless of master size'}
        </div>
      </div>

      {/* Slave Accounts */}
      <div className="p-3 bg-fw-bg border border-fw-border rounded">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-fw-text-muted uppercase font-bold">Slave Accounts ({config.slaves.length})</div>
          <button onClick={() => setShowAddSlave(!showAddSlave)} className="flex items-center gap-1 text-[10px] text-fw-accent hover:text-fw-accent-hover">
            <Plus size={10} /> Add
          </button>
        </div>

        {/* Add Slave Form */}
        {showAddSlave && (
          <div className="mb-3 p-2 border border-fw-border rounded bg-fw-surface space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={newSlave.accountId} onChange={e => setNewSlave({ ...newSlave, accountId: e.target.value })} placeholder="Account ID" className="bg-fw-bg border border-fw-border rounded text-[10px] px-2 py-1.5 text-fw-text outline-none" />
              <input value={newSlave.name} onChange={e => setNewSlave({ ...newSlave, name: e.target.value })} placeholder="Name" className="bg-fw-bg border border-fw-border rounded text-[10px] px-2 py-1.5 text-fw-text outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-fw-text-muted">Copy Ratio</label>
                <input type="number" step="0.1" min="0.1" value={newSlave.copyRatio} onChange={e => setNewSlave({ ...newSlave, copyRatio: parseFloat(e.target.value) || 1 })} className="w-full bg-fw-bg border border-fw-border rounded text-[10px] px-2 py-1.5 text-fw-text font-mono outline-none" />
              </div>
              <div>
                <label className="text-[9px] text-fw-text-muted">Fixed Lots</label>
                <input type="number" min="1" value={newSlave.fixedLots} onChange={e => setNewSlave({ ...newSlave, fixedLots: parseInt(e.target.value) || 1 })} className="w-full bg-fw-bg border border-fw-border rounded text-[10px] px-2 py-1.5 text-fw-text font-mono outline-none" />
              </div>
            </div>
            <button onClick={onAddSlave} className="w-full py-1.5 text-[10px] bg-fw-accent text-white rounded font-bold">Add Slave Account</button>
          </div>
        )}

        {/* Slave List */}
        {config.slaves.length === 0 ? (
          <div className="text-[11px] text-fw-text-muted text-center py-4">No slave accounts configured</div>
        ) : (
          <div className="space-y-1.5">
            {config.slaves.map(slave => (
              <div key={slave.accountId} className="flex items-center justify-between p-2 border border-fw-border/50 rounded hover:bg-fw-hover/30">
                <div className="flex items-center gap-2">
                  <StatusDot status={slave.lastSyncStatus} />
                  <div>
                    <div className="text-[11px] font-semibold text-fw-text">{slave.name}</div>
                    <div className="text-[9px] text-fw-text-muted font-mono">{slave.accountId}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-fw-text-secondary font-mono">
                    {config.copyMode === 'proportional' ? `${slave.copyRatio}x` : config.copyMode === 'fixed-lot' ? `${slave.fixedLots} lots` : 'mirror'}
                  </span>
                  <button onClick={() => onToggleSlaveEnabled(slave.accountId)} className={cn('w-7 h-4 rounded-full transition-colors relative', slave.enabled ? 'bg-green' : 'bg-fw-border')}>
                    <div className="absolute w-3 h-3 rounded-full bg-white top-0.5 transition-all" style={{ left: slave.enabled ? '14px' : '2px' }} />
                  </button>
                  <button onClick={() => onRemoveSlave(slave.accountId)} className="p-1 text-red-400/60 hover:text-red-400"><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Exposure View ────────────────────────────────────────────────────────────

function ExposureView({ exposures, loading, onRefresh }: { exposures: AccountExposure[]; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-fw-text">Portfolio Exposure</div>
        <button onClick={onRefresh} className={cn('p-1 rounded hover:bg-fw-hover text-fw-text-secondary', loading && 'animate-spin')}>
          <RefreshCw size={12} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-20 text-fw-text-muted text-[11px]">Loading exposures...</div>
      )}

      {!loading && exposures.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
          <AlertCircle size={24} className="text-fw-text-muted/40" />
          <div className="text-[11px] text-fw-text-muted">No exposure data available.</div>
          <div className="text-[10px] text-fw-text-muted">
            Backend endpoint /api/founder/exposures not configured. Exposure aggregation requires server-side implementation.
          </div>
        </div>
      )}

      {!loading && exposures.length > 0 && (
        <div className="space-y-1.5">
          {exposures.map(exp => (
            <div key={exp.accountId} className="p-2 bg-fw-bg border border-fw-border rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-fw-text">{exp.accountName}</span>
                <span className={cn('text-[11px] font-mono', exp.totalMtm >= 0 ? 'text-green' : 'text-red')}>
                  ₹{exp.totalMtm.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-fw-text-muted">
                <span>Positions: {exp.totalPositions}</span>
                <span>Exposure: ₹{exp.netExposure.toLocaleString('en-IN')}</span>
                <span>Margin: ₹{exp.marginUsed.toLocaleString('en-IN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: SlaveAccount['lastSyncStatus'] }) {
  const colors = { ok: 'bg-green', error: 'bg-red', pending: 'bg-yellow-400', idle: 'bg-fw-text-muted' };
  return <div className={cn('w-2 h-2 rounded-full', colors[status])} />;
}
