import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, Bell, BellOff, Volume2, VolumeX, MessageSquare } from 'lucide-react';
import { useJournalStore, type PriceAlert, type AlertNotifyMethod } from '@/store/journalStore';
import { useMarketStore } from '@/store/marketStore';
import { useAppStore } from '@/store/appStore';
import { cn, formatPrice } from '@/utils/helpers';

// Simple toast notification system
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string) {
  let container = document.getElementById('fw-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fw-toast-container';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'background:#1e222d;border:1px solid #2a2e39;border-left:3px solid #3b82f6;color:#e1e4eb;padding:10px 16px;border-radius:8px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:slideIn 0.2s ease-out;max-width:320px;pointer-events:auto;';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Sound alert
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio not available
  }
}

export function AlertsPanel() {
  const { alerts, addAlert, deleteAlert, toggleAlert, triggerAlert, updateAlertLtp } = useJournalStore();
  const quotes = useMarketStore((s) => s.quotes);
  const { activeSymbol } = useAppStore();
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({
    symbol: '',
    token: '',
    condition: 'above' as PriceAlert['condition'],
    price: 0,
    notifyVia: ['popup', 'toast'] as AlertNotifyMethod[],
  });

  // Check alerts on every quote update — supports cross_above, cross_below
  useEffect(() => {
    alerts.forEach((alert) => {
      if (!alert.active || alert.triggered) return;
      const quote = quotes[alert.token];
      if (!quote) return;

      const ltp = quote.ltp;
      const prevLtp = alert.lastLtp;
      let shouldTrigger = false;

      if (alert.condition === 'above' && ltp >= alert.price) shouldTrigger = true;
      if (alert.condition === 'below' && ltp <= alert.price) shouldTrigger = true;
      if (alert.condition === 'cross_above' && prevLtp !== undefined && prevLtp < alert.price && ltp >= alert.price) shouldTrigger = true;
      if (alert.condition === 'cross_below' && prevLtp !== undefined && prevLtp > alert.price && ltp <= alert.price) shouldTrigger = true;

      // Store current LTP for crossing detection
      if (ltp !== prevLtp) {
        updateAlertLtp(alert.id, ltp);
      }

      if (shouldTrigger) {
        triggerAlert(alert.id);

        const msg = `🔔 ${alert.symbol}: Price ${alert.condition.replace('_', ' ')} ₹${formatPrice(alert.price)} — LTP: ₹${formatPrice(ltp)}`;

        // Popup notification
        if (alert.notifyVia.includes('popup')) {
          if (Notification.permission === 'granted') {
            new Notification(`Alert: ${alert.symbol}`, { body: msg, icon: '/favicon.png' });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
          }
        }

        // Sound
        if (alert.notifyVia.includes('sound')) {
          playAlertSound();
        }

        // Toast
        if (alert.notifyVia.includes('toast')) {
          showToast(msg);
        }
      }
    });
  }, [quotes]);

  const handleAdd = () => {
    if (!form.symbol || !form.price) return;
    addAlert({
      symbol: form.symbol,
      token: form.token,
      condition: form.condition,
      price: form.price,
      notifyVia: form.notifyVia,
      lastLtp: quotes[form.token]?.ltp,
    });
    setForm({ symbol: '', token: '', condition: 'above', price: 0, notifyVia: ['popup', 'toast'] });
    setIsAdding(false);
  };

  const prefill = () => {
    if (activeSymbol) {
      const q = quotes[activeSymbol.token];
      setForm({ symbol: activeSymbol.symbol, token: activeSymbol.token, condition: 'above', price: q?.ltp || 0, notifyVia: ['popup', 'toast', 'sound'] });
    }
    setIsAdding(true);
  };

  const toggleNotifyMethod = (method: AlertNotifyMethod) => {
    setForm((f) => ({
      ...f,
      notifyVia: f.notifyVia.includes(method)
        ? f.notifyVia.filter((m) => m !== method)
        : [...f.notifyVia, method],
    }));
  };

  const activeAlerts = alerts.filter((a) => a.active && !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border">
        <span className="text-[12px] font-bold text-fw-text">Price Alerts ({activeAlerts.length} active)</span>
        <button onClick={prefill} className="flex items-center gap-1 px-2 py-1 text-[11px] bg-fw-accent text-white rounded hover:brightness-110">
          <Plus size={12} /> New Alert
        </button>
      </div>

      {isAdding && (
        <div className="px-3 py-2 border-b border-fw-border bg-fw-bg/50 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as any })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text">
              <option value="above">Price Above</option>
              <option value="below">Price Below</option>
              <option value="cross_above">Crosses Above</option>
              <option value="cross_below">Crosses Below</option>
            </select>
            <input type="number" placeholder="Price" value={form.price || ''} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text font-mono outline-none focus:border-fw-accent" step={0.05} />
          </div>
          {/* Notification Methods */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-fw-text-secondary">Notify via:</span>
            <NotifyToggle label="Popup" icon={<Bell size={11} />} active={form.notifyVia.includes('popup')} onClick={() => toggleNotifyMethod('popup')} />
            <NotifyToggle label="Sound" icon={<Volume2 size={11} />} active={form.notifyVia.includes('sound')} onClick={() => toggleNotifyMethod('sound')} />
            <NotifyToggle label="Toast" icon={<MessageSquare size={11} />} active={form.notifyVia.includes('toast')} onClick={() => toggleNotifyMethod('toast')} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1.5 text-[11px] bg-fw-accent text-white rounded">Create Alert</button>
            <button onClick={() => setIsAdding(false)} className="px-3 py-1.5 text-[11px] text-fw-text-secondary border border-fw-border rounded">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {activeAlerts.length > 0 && (
          <div className="px-3 py-1.5">
            <span className="text-[10px] text-fw-text-secondary uppercase font-semibold">Active</span>
            {activeAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onDelete={() => deleteAlert(alert.id)} onToggle={() => toggleAlert(alert.id)} quote={quotes[alert.token]} />
            ))}
          </div>
        )}
        {triggeredAlerts.length > 0 && (
          <div className="px-3 py-1.5">
            <span className="text-[10px] text-fw-text-secondary uppercase font-semibold">Triggered</span>
            {triggeredAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onDelete={() => deleteAlert(alert.id)} onToggle={() => {}} quote={quotes[alert.token]} />
            ))}
          </div>
        )}
        {alerts.length === 0 && (
          <div className="flex items-center justify-center h-full text-[12px] text-fw-text-secondary">No alerts. Click "New Alert" to create one.</div>
        )}
      </div>
    </div>
  );
}

function NotifyToggle({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors',
        active ? 'bg-fw-accent/20 border-fw-accent text-fw-accent' : 'border-fw-border text-fw-text-secondary'
      )}
    >
      {icon} {label}
    </button>
  );
}

function AlertRow({ alert, onDelete, onToggle, quote }: { alert: PriceAlert; onDelete: () => void; onToggle: () => void; quote?: any }) {
  const conditionLabel = alert.condition.replace('_', ' ');
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-fw-border/30">
      <div className="flex items-center gap-2">
        {alert.triggered ? <Bell size={12} className="text-fw-accent" /> : alert.active ? <Bell size={12} className="text-green" /> : <BellOff size={12} className="text-fw-text-secondary" />}
        <span className="text-[12px] font-medium text-fw-text">{alert.symbol}</span>
        <span className="text-[10px] text-fw-text-secondary capitalize">{conditionLabel}</span>
        <span className="text-[12px] font-mono text-fw-text">₹{formatPrice(alert.price)}</span>
        {/* Notify icons */}
        <div className="flex items-center gap-0.5">
          {alert.notifyVia?.includes('popup') && <Bell size={9} className="text-fw-text-muted" />}
          {alert.notifyVia?.includes('sound') && <Volume2 size={9} className="text-fw-text-muted" />}
          {alert.notifyVia?.includes('toast') && <MessageSquare size={9} className="text-fw-text-muted" />}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {quote && <span className="text-[10px] font-mono text-fw-text-secondary">LTP: ₹{formatPrice(quote.ltp)}</span>}
        {alert.triggered && <span className="text-[9px] text-fw-accent">✓ triggered</span>}
        {!alert.triggered && (
          <button onClick={onToggle} className="p-1 text-fw-text-secondary hover:text-fw-text" title={alert.active ? 'Disable' : 'Enable'}>
            {alert.active ? <Volume2 size={11} /> : <VolumeX size={11} />}
          </button>
        )}
        <button onClick={onDelete} className="p-1 text-fw-text-secondary hover:text-red-400"><Trash2 size={11} /></button>
      </div>
    </div>
  );
}
