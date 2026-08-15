/**
 * ONE-STEP RISK MANAGEMENT PANEL
 *
 * Admin → Risk Management → 1-Step
 *
 * Displays and edits all 1-Step risk profile rules.
 * All values sourced from onestep_risk_profile table (single row).
 * Admin changes are persisted immediately and take effect on the next order.
 *
 * Features:
 *  - View all current 1-Step risk rules (eval + funded)
 *  - Edit any rule inline and save
 *  - View full audit log of every rule change
 *  - View all 1-Step accounts with their current status
 *
 * Flash, Instant, and 2-Step are completely unaffected by this panel.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, RefreshCw, Save, Clock, Users, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Edit3, X, Activity,
} from 'lucide-react';
import {
  adminGetOneStepProfile,
  adminUpdateOneStepProfile,
  adminGetOneStepAudit,
  adminGetOneStepAccounts,
  type OneStepRiskProfile,
  type OneStepAuditEntry,
} from '@/services/api';
import { cn, formatPrice } from '@/utils/helpers';
import { useToast } from '@/components/ToastProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldMeta {
  key: keyof OneStepRiskProfile;
  label: string;
  type: 'number' | 'boolean' | 'text' | 'segments';
  unit?: string;
  section: 'shared' | 'eval' | 'funded' | 'markets' | 'meta';
  description?: string;
  min?: number;
  max?: number;
  step?: number;
}

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELD_DEFS: FieldMeta[] = [
  // ── Shared (eval + funded) ──────────────────────────────────────────────
  { key: 'daily_loss_pct',                  label: 'Daily Drawdown',              type: 'number',   unit: '%',  section: 'shared', description: 'Max loss per day as % of start-of-day balance', min: 0.1, max: 20, step: 0.1 },
  { key: 'max_drawdown_pct',                label: 'Max Drawdown (Static)',        type: 'number',   unit: '%',  section: 'shared', description: 'Max total drawdown from initial balance', min: 0.1, max: 30, step: 0.1 },
  { key: 'max_open_positions',              label: 'Max Open Positions',           type: 'number',   unit: '',   section: 'shared', description: 'Maximum concurrent open positions', min: 1, max: 200, step: 1 },
  { key: 'leverage_max',                    label: 'Max Leverage',                 type: 'number',   unit: 'x',  section: 'shared', description: 'Maximum leverage multiplier (e.g. 30 = 1:30)', min: 1, max: 200, step: 1 },
  { key: 'max_position_size_pct',           label: 'Max Position Size',            type: 'number',   unit: '%',  section: 'shared', description: 'Max total notional exposure as % of balance', min: 1, max: 100, step: 0.5 },
  { key: 'daily_profit_cap_pct',            label: 'Daily Profit Cap',             type: 'number',   unit: '%',  section: 'shared', description: 'New opens blocked when daily profit reaches this %', min: 0.1, max: 50, step: 0.1 },
  { key: 'daily_profit_cap_cooldown_hours', label: 'Profit Cap Cooldown',          type: 'number',   unit: 'h',  section: 'shared', description: 'Hours to wait after profit cap is hit before trading resumes', min: 0, max: 48, step: 0.5 },
  { key: 'max_risk_per_trade_pct',          label: 'Max Risk / Trade',             type: 'number',   unit: '%',  section: 'shared', description: 'Max risk per trade (SL-based when SL provided)', min: 0.1, max: 20, step: 0.1 },
  { key: 'consistency_rule_pct',            label: 'Consistency Rule',             type: 'number',   unit: '%',  section: 'shared', description: "Max single day's profit as % of total profit", min: 1, max: 100, step: 1 },
  // ── Markets ─────────────────────────────────────────────────────────────
  { key: 'allowed_segments',               label: 'Allowed Segments',             type: 'segments', unit: '',   section: 'markets', description: 'Comma-separated list: NSE, NFO, BFO, CDS, MCX' },
  { key: 'trading_hours_start',            label: 'Trading Hours Start',          type: 'text',     unit: 'IST',section: 'markets', description: 'Start time in IST (HH:MM)' },
  { key: 'trading_hours_end',              label: 'Trading Hours End',            type: 'text',     unit: 'IST',section: 'markets', description: 'End time in IST (HH:MM)' },
  { key: 'overnight_allowed',              label: 'Overnight Allowed',            type: 'boolean',  unit: '',   section: 'markets', description: 'Allow positions to be held overnight' },
  { key: 'weekend_allowed',               label: 'Weekend Trading',              type: 'boolean',  unit: '',   section: 'markets', description: 'Allow trading on weekends' },
  { key: 'holiday_restriction',            label: 'Holiday Restriction',          type: 'boolean',  unit: '',   section: 'markets', description: 'Block trading on NSE market holidays' },
  // ── Evaluation ──────────────────────────────────────────────────────────
  { key: 'profit_target_pct',              label: 'Profit Target',               type: 'number',   unit: '%',  section: 'eval', description: 'Profit target to pass evaluation (0 = none)', min: 0, max: 50, step: 0.5 },
  { key: 'min_trading_days_eval',          label: 'Min Trading Days (Eval)',      type: 'number',   unit: 'days', section: 'eval', description: 'Minimum trading days required to pass evaluation', min: 1, max: 90, step: 1 },
  { key: 'time_limit_days',               label: 'Time Limit',                  type: 'number',   unit: 'days', section: 'eval', description: 'Max calendar days for evaluation (0 = unlimited)', min: 0, max: 365, step: 1 },
  // ── Funded ──────────────────────────────────────────────────────────────
  { key: 'min_trading_days_funded',        label: 'Min Trading Days (Funded)',    type: 'number',   unit: 'days', section: 'funded', description: 'Minimum trading days per payout period', min: 1, max: 90, step: 1 },
  { key: 'payout_threshold_pct',           label: 'Payout Threshold',            type: 'number',   unit: '%',  section: 'funded', description: 'Min profit % required to request first payout', min: 0.1, max: 30, step: 0.1 },
  { key: 'profit_split_initial_pct',       label: 'Profit Split (Initial)',       type: 'number',   unit: '%',  section: 'funded', description: 'Trader profit split before payout threshold is met', min: 1, max: 100, step: 1 },
  { key: 'profit_split_scaled_pct',        label: 'Profit Split (After Threshold)', type: 'number', unit: '%',  section: 'funded', description: 'Trader profit split after payout threshold is satisfied once', min: 1, max: 100, step: 1 },
];

const SECTION_LABELS: Record<string, string> = {
  shared:  'Shared Rules (Evaluation + Funded)',
  eval:    'Evaluation Phase',
  funded:  'Funded Phase',
  markets: 'Markets & Trading Hours',
};

const ALL_SEGMENTS = ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="col-span-full flex items-center gap-2 mt-2 mb-1">
      <div className="h-px flex-1 bg-fw-border/40" />
      <span className="text-[11px] font-bold uppercase tracking-widest text-fw-text-muted px-2">{label}</span>
      <div className="h-px flex-1 bg-fw-border/40" />
    </div>
  );
}

function RuleRow({
  field,
  value,
  editKey,
  editValue,
  onStartEdit,
  onEditChange,
  onSave,
  onCancel,
  saving,
}: {
  field: FieldMeta;
  value: any;
  editKey: string | null;
  editValue: string;
  onStartEdit: (key: string, val: string) => void;
  onEditChange: (val: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const isEditing = editKey === field.key;

  const displayValue = () => {
    if (field.type === 'boolean') return value ? 'Yes' : 'No';
    if (field.type === 'segments') return Array.isArray(value) ? value.join(', ') : String(value);
    if (field.unit) return `${value}${field.unit}`;
    return String(value ?? '—');
  };

  const valueColor = () => {
    if (field.type === 'boolean') return value ? 'text-green-400' : 'text-red-400';
    return 'text-fw-accent';
  };

  return (
    <div className={cn(
      'flex items-center justify-between gap-3 px-3 py-2 rounded-md border transition-colors',
      isEditing
        ? 'bg-fw-accent/5 border-fw-accent/30'
        : 'bg-[#0c0e14] border-fw-border/30 hover:border-fw-border/60'
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-fw-text truncate">{field.label}</div>
        {field.description && (
          <div className="text-[11px] text-fw-text-muted mt-0.5 truncate">{field.description}</div>
        )}
      </div>

      {isEditing ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {field.type === 'boolean' ? (
            <select
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              className="h-7 w-24 bg-fw-bg border border-fw-accent/50 rounded px-2 text-[12px] text-fw-text outline-none focus:border-fw-accent"
              autoFocus
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : field.type === 'segments' ? (
            <input
              type="text"
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              placeholder="NSE, NFO, BFO, CDS, MCX"
              className="h-7 w-44 bg-fw-bg border border-fw-accent/50 rounded px-2 text-[12px] font-mono text-fw-text outline-none focus:border-fw-accent"
              autoFocus
            />
          ) : (
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              className="h-7 w-24 bg-fw-bg border border-fw-accent/50 rounded px-2 text-[12px] font-mono text-fw-text outline-none focus:border-fw-accent"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
            />
          )}
          <button
            onClick={onSave}
            disabled={saving}
            className="h-7 px-2 rounded bg-fw-accent text-white text-[11px] font-bold disabled:opacity-50 hover:brightness-110"
          >
            {saving ? '…' : <Save size={11} />}
          </button>
          <button
            onClick={onCancel}
            className="h-7 px-1.5 rounded bg-fw-bg border border-fw-border text-fw-text-muted hover:text-fw-text"
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn('font-mono font-bold text-[13px]', valueColor())}>
            {displayValue()}
          </span>
          <button
            onClick={() => onStartEdit(field.key, field.type === 'segments'
              ? (Array.isArray(value) ? value.join(', ') : String(value))
              : String(value)
            )}
            className="p-1 rounded hover:bg-fw-hover text-fw-text-muted hover:text-fw-accent transition-colors"
            title={`Edit ${field.label}`}
          >
            <Edit3 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type PanelTab = 'rules' | 'accounts' | 'audit';

export function OneStepRiskPanel() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<PanelTab>('rules');
  const [profile, setProfile] = useState<OneStepRiskProfile | null>(null);
  const [audit, setAudit] = useState<OneStepAuditEntry[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Load profile ────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetOneStepProfile();
      setProfile(res.profile);
    } catch (err: any) {
      showToast({ type: 'danger', title: '1-Step Profile Error', message: err?.message ?? 'Failed to load profile' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await adminGetOneStepAudit(100);
      setAudit(res.audit);
    } catch { /* non-critical */ }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await adminGetOneStepAccounts();
      setAccounts(res.accounts);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (tab === 'audit') loadAudit(); }, [tab, loadAudit]);
  useEffect(() => { if (tab === 'accounts') loadAccounts(); }, [tab, loadAccounts]);

  // ── Edit helpers ────────────────────────────────────────────────────────
  const handleStartEdit = (key: string, val: string) => {
    setEditKey(key);
    setEditValue(val);
  };

  const handleCancelEdit = () => {
    setEditKey(null);
    setEditValue('');
  };

  const handleSave = async () => {
    if (!editKey || !profile) return;
    const field = FIELD_DEFS.find(f => f.key === editKey);
    if (!field) return;

    // Parse value to correct type
    let parsed: any;
    if (field.type === 'boolean') {
      parsed = editValue === 'true';
    } else if (field.type === 'number') {
      parsed = parseFloat(editValue);
      if (isNaN(parsed)) {
        showToast({ type: 'warning', title: 'Invalid Value', message: 'Please enter a valid number.' });
        return;
      }
    } else if (field.type === 'segments') {
      parsed = editValue.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const invalid = parsed.filter((s: string) => !ALL_SEGMENTS.includes(s));
      if (invalid.length > 0) {
        showToast({ type: 'warning', title: 'Invalid Segments', message: `Unknown segments: ${invalid.join(', ')}. Allowed: ${ALL_SEGMENTS.join(', ')}` });
        return;
      }
    } else {
      parsed = editValue;
    }

    setSaving(true);
    try {
      const res = await adminUpdateOneStepProfile({ [editKey]: parsed } as Partial<OneStepRiskProfile>);
      setProfile(res.profile);
      setEditKey(null);
      setEditValue('');
      showToast({ type: 'success', title: '1-Step Rule Updated', message: `${field.label} → ${editValue}${field.unit ?? ''}` });
      // Refresh audit in background
      loadAudit();
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Save Failed', message: err?.message ?? 'Could not update rule' });
    } finally {
      setSaving(false);
    }
  };

  // ── Grouped fields ──────────────────────────────────────────────────────
  const fieldsBySection = FIELD_DEFS.reduce<Record<string, FieldMeta[]>>((acc, f) => {
    if (!acc[f.section]) acc[f.section] = [];
    acc[f.section].push(f);
    return acc;
  }, {});

  const sectionOrder: Array<keyof typeof SECTION_LABELS> = ['shared', 'eval', 'funded', 'markets'];

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#0d0f15] to-[#0b0d12]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border bg-[#0a0c12] flex-shrink-0">
        <Shield size={14} className="text-fw-accent" />
        <span className="text-[13px] font-bold text-fw-text">1-Step Risk Management</span>
        <span className="text-[11px] text-fw-text-muted ml-1">— Admin Only</span>
        <div className="flex-1" />
        {profile?.updated_at && (
          <span className="text-[11px] text-fw-text-muted flex items-center gap-1">
            <Clock size={10} /> Last updated: {new Date(profile.updated_at).toLocaleString('en-IN')}
          </span>
        )}
        <button
          onClick={() => { loadProfile(); if (tab === 'audit') loadAudit(); if (tab === 'accounts') loadAccounts(); }}
          className={cn('p-1.5 rounded hover:bg-fw-hover text-fw-text-secondary', loading && 'animate-spin')}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 border-b border-fw-border/50 bg-[#0a0c12] flex-shrink-0 px-1">
        {([
          { id: 'rules' as PanelTab,    label: 'Risk Rules',  icon: <Shield size={11} /> },
          { id: 'accounts' as PanelTab, label: 'Accounts',    icon: <Users size={11} /> },
          { id: 'audit' as PanelTab,    label: 'Audit Log',   icon: <Activity size={11} /> },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold border-b-2 transition-colors',
              tab === t.id
                ? 'border-fw-accent text-fw-accent'
                : 'border-transparent text-fw-text-muted hover:text-fw-text'
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">

        {/* ── Rules tab ── */}
        {tab === 'rules' && (
          <div>
            {loading && !profile && (
              <div className="flex items-center justify-center py-10 text-fw-text-muted text-[13px]">
                Loading 1-Step profile…
              </div>
            )}
            {profile && (
              <div>
                {/* Warning banner */}
                <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-md bg-yellow-900/10 border border-yellow-800/30">
                  <AlertTriangle size={13} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[12px] text-yellow-300/80">
                    Changes apply immediately to all active 1-Step accounts. Flash, Instant, and 2-Step accounts are unaffected.
                  </span>
                </div>

                {sectionOrder.map(section => (
                  <div key={section}>
                    <SectionHeader label={SECTION_LABELS[section]} />
                    <div className="grid grid-cols-1 gap-1.5 mb-2">
                      {(fieldsBySection[section] || []).map(field => (
                        <RuleRow
                          key={field.key}
                          field={field}
                          value={(profile as any)[field.key]}
                          editKey={editKey}
                          editValue={editValue}
                          onStartEdit={handleStartEdit}
                          onEditChange={setEditValue}
                          onSave={handleSave}
                          onCancel={handleCancelEdit}
                          saving={saving}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Accounts tab ── */}
        {tab === 'accounts' && (
          <div>
            {accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-fw-text-muted">
                <Users size={24} className="opacity-30" />
                <span className="text-[13px]">No 1-Step accounts found</span>
              </div>
            ) : (
              <table className="fw-table w-full">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Trader</th>
                    <th>Balance</th>
                    <th>Phase</th>
                    <th>Split</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc: any) => (
                    <tr key={acc.id} className="hover:bg-fw-hover/10">
                      <td>
                        <span className="font-mono text-[13px] font-semibold text-fw-text">{acc.accountCode}</span>
                      </td>
                      <td>
                        <div className="text-[13px] text-fw-text">{acc.trader?.display_name ?? '—'}</div>
                        <div className="text-[11px] text-fw-text-muted">{acc.trader?.email ?? ''}</div>
                      </td>
                      <td className="font-mono text-[13px] tabular-nums text-fw-text-secondary">
                        ₹{formatPrice(acc.balance)}
                      </td>
                      <td>
                        <span className="text-[12px] text-fw-text capitalize">
                          {acc.challenge?.type ?? '—'} {acc.challenge?.phase ? `/ ${acc.challenge.phase}` : ''}
                        </span>
                      </td>
                      <td>
                        <span className={cn(
                          'font-mono font-bold text-[13px]',
                          acc.effectiveSplitPct >= 90 ? 'text-green-400' : 'text-fw-accent'
                        )}>
                          {acc.effectiveSplitPct}%
                        </span>
                      </td>
                      <td>
                        <span className={cn(
                          'px-1.5 py-0.5 text-[11px] font-bold uppercase rounded border',
                          acc.status === 'active'   ? 'bg-green-900/25 text-green-400 border-green-800/40'
                          : acc.status === 'locked'  ? 'bg-yellow-900/25 text-yellow-400 border-yellow-800/40'
                          : acc.status === 'breached'? 'bg-red-900/25 text-red-400 border-red-800/40'
                          : 'bg-fw-bg text-fw-text-muted border-fw-border'
                        )}>
                          {acc.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Audit tab ── */}
        {tab === 'audit' && (
          <div>
            {audit.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-fw-text-muted">
                <Activity size={24} className="opacity-30" />
                <span className="text-[13px]">No audit entries yet</span>
              </div>
            ) : (
              <table className="fw-table w-full">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Rule</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Changed By</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map(entry => {
                    const fieldDef = FIELD_DEFS.find(f => f.key === entry.rule_name);
                    const label = fieldDef?.label ?? entry.rule_name;
                    const unit  = fieldDef?.unit ?? '';
                    const oldV  = entry.old_value?.value ?? '—';
                    const newV  = entry.new_value?.value;
                    return (
                      <tr key={entry.id} className="hover:bg-fw-hover/10">
                        <td className="font-mono text-[11px] text-fw-text-muted whitespace-nowrap">
                          {new Date(entry.changed_at).toLocaleString('en-IN')}
                        </td>
                        <td className="text-[13px] text-fw-text font-medium">{label}</td>
                        <td className="font-mono text-[12px] text-red-400/80">
                          {typeof oldV === 'boolean' ? (oldV ? 'Yes' : 'No')
                            : Array.isArray(oldV) ? oldV.join(', ')
                            : `${oldV}${unit}`}
                        </td>
                        <td className="font-mono text-[12px] text-green-400">
                          {typeof newV === 'boolean' ? (newV ? 'Yes' : 'No')
                            : Array.isArray(newV) ? newV.join(', ')
                            : `${newV}${unit}`}
                        </td>
                        <td className="text-[11px] text-fw-text-muted font-mono truncate max-w-[120px]">
                          {entry.changed_by}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
