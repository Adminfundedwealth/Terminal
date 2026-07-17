/**
 * SETTINGS PANEL
 * 
 * Terminal preferences: theme, default order config, hotkeys, notifications.
 * Opens as a modal overlay from the Sidebar Settings button.
 */

import { useState } from 'react';
import { X, Moon, Palette, Bell, Keyboard, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/utils/helpers';
import type { Theme } from '@/types';

interface SettingsPanelProps {
  onClose: () => void;
}

const THEMES: { value: Theme; label: string; color: string }[] = [
  { value: 'dark', label: 'Dark', color: '#1a1d28' },
  { value: 'fw-blue', label: 'FW Blue', color: '#0d1a40' },
];

const HOTKEYS = [
  { key: 'Ctrl + K', action: 'Open Search' },
  { key: 'B', action: 'Buy (Order Panel focused)' },
  { key: 'S', action: 'Sell (Order Panel focused)' },
  { key: 'Esc', action: 'Close modal / Cancel' },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme, panels } = useAppStore();
  const [activeTab, setActiveTab] = useState<'appearance' | 'orders' | 'hotkeys' | 'notifications'>('appearance');
  const [defaultQty, setDefaultQty] = useState(1);
  const [defaultProduct, setDefaultProduct] = useState('MIS');
  const [confirmOrders, setConfirmOrders] = useState(true);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [riskToasts, setRiskToasts] = useState(true);

  const tabs: { id: typeof activeTab; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
    { id: 'orders', label: 'Orders', icon: <ChevronDown size={13} /> },
    { id: 'hotkeys', label: 'Hotkeys', icon: <Keyboard size={13} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={13} /> },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12141f] border border-fw-border rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-fw-border/60 flex-shrink-0">
          <div>
            <h2 className="text-[14px] font-black text-fw-text">Settings</h2>
            <p className="text-[13px] text-fw-text-muted mt-0.5">Terminal preferences</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-fw-hover text-fw-text-secondary hover:text-fw-text transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-fw-border/40 px-5 pt-2 flex-shrink-0 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[13px] font-bold rounded-t-md transition-all border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'text-fw-accent border-fw-accent bg-fw-accent/5'
                  : 'text-fw-text-muted border-transparent hover:text-fw-text-secondary'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Appearance */}
          {activeTab === 'appearance' && (
            <div className="flex flex-col gap-5">
              <SettingSection title="Theme">
                <div className="flex gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTheme(t.value)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-[14px] font-bold transition-all',
                        theme === t.value
                          ? 'border-fw-accent bg-fw-accent/10 text-fw-accent'
                          : 'border-fw-border text-fw-text-muted hover:border-fw-text-muted hover:text-fw-text'
                      )}
                    >
                      <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: t.color }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </SettingSection>

              <SettingSection title="Panel Defaults" description="Which panels are visible on startup">
                <div className="text-[13px] text-fw-text-muted bg-fw-bg/60 rounded-lg px-3 py-2 border border-fw-border/40">
                  Panel visibility is saved automatically when you toggle panels from the top bar.
                </div>
              </SettingSection>
            </div>
          )}

          {/* Orders */}
          {activeTab === 'orders' && (
            <div className="flex flex-col gap-5">
              <SettingSection title="Default Quantity">
                <input
                  type="number"
                  min={1}
                  value={defaultQty}
                  onChange={(e) => setDefaultQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-28 h-9 bg-[#0e1018] border border-fw-border rounded-md font-mono text-[13px] font-bold text-fw-text px-3 outline-none focus:border-fw-accent tabular-nums"
                />
              </SettingSection>

              <SettingSection title="Default Product Type">
                <div className="flex gap-2">
                  {['MIS', 'NRML', 'CNC'].map((p) => (
                    <button
                      key={p}
                      onClick={() => setDefaultProduct(p)}
                      className={cn(
                        'px-4 py-2 rounded-lg border text-[13px] font-bold transition-all',
                        defaultProduct === p
                          ? 'border-fw-accent bg-fw-accent/10 text-fw-accent'
                          : 'border-fw-border text-fw-text-muted hover:text-fw-text'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </SettingSection>

              <SettingSection title="Order Confirmation">
                <ToggleRow
                  label="Show confirmation dialog before placing orders"
                  checked={confirmOrders}
                  onChange={setConfirmOrders}
                />
              </SettingSection>
            </div>
          )}

          {/* Hotkeys */}
          {activeTab === 'hotkeys' && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-fw-text-muted">Default keyboard shortcuts</p>
              <div className="rounded-lg border border-fw-border/40 overflow-hidden">
                {HOTKEYS.map((hk, i) => (
                  <div
                    key={hk.key}
                    className={cn(
                      'flex items-center justify-between px-4 py-3 text-[14px]',
                      i > 0 && 'border-t border-fw-border/30'
                    )}
                  >
                    <span className="text-fw-text-secondary">{hk.action}</span>
                    <kbd className="px-2 py-1 bg-[#0e1018] border border-fw-border rounded text-[14px] font-mono font-bold text-fw-text-secondary">
                      {hk.key}
                    </kbd>
                  </div>
                ))}
              </div>
              <p className="text-[14px] text-fw-text-muted">Custom hotkey remapping coming soon.</p>
            </div>
          )}

          {/* Notifications */}
          {activeTab === 'notifications' && (
            <div className="flex flex-col gap-5">
              <SettingSection title="Risk Alerts">
                <ToggleRow
                  label="Show risk threshold warnings (80% / 90%)"
                  checked={riskToasts}
                  onChange={setRiskToasts}
                />
              </SettingSection>

              <SettingSection title="Sound">
                <ToggleRow
                  label="Play sound on critical risk alerts"
                  checked={soundAlerts}
                  onChange={setSoundAlerts}
                />
              </SettingSection>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-fw-border/40 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[14px] font-bold bg-fw-bg border border-fw-border text-fw-text-secondary hover:text-fw-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-[14px] font-bold text-fw-text">{title}</p>
        {description && <p className="text-[13px] text-fw-text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer group">
      <span className="text-[14px] text-fw-text-secondary group-hover:text-fw-text transition-colors">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
          checked ? 'bg-fw-accent' : 'bg-fw-border'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </button>
    </label>
  );
}
