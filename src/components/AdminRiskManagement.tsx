/**
 * ADMIN RISK MANAGEMENT — Centralized Profile Editor
 *
 * Provides a tabbed UI to view and edit the risk profile for each account type:
 *   Flash | Instant | 1-Step | 2-Step
 *
 * Each tab shows:
 *   - Current profile values (live from DB)
 *   - Editable fields (inline number/bool/text inputs)
 *   - Save button (PUT to backend, cache invalidated immediately)
 *   - Audit log (last 50 changes)
 *
 * Backend routes (all require founder auth):
 *   GET/PUT /api/admin/flash/profile    GET /api/admin/flash/audit
 *   GET/PUT /api/admin/instant/profile  GET /api/admin/instant/audit
 *   GET/PUT /api/admin/onestep/profile  GET /api/admin/onestep/audit
 *   GET/PUT /api/admin/twostep/profile  GET /api/admin/twostep/audit
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Save, AlertTriangle, CheckCircle, History, ChevronDown, ChevronUp, Zap, TrendingUp, BarChart2, Layers } from 'lucide-react';
import {
  adminGetFlashProfile, adminUpdateFlashProfile, adminGetFlashAudit,
  adminGetInstantProfile, adminUpdateInstantProfile, adminGetInstantAudit,
  adminGetOneStepProfile, adminUpdateOneStepProfile, adminGetOneStepAudit,
  adminGetTwoStepProfile, adminUpdateTwoStepProfile, adminGetTwoStepAudit,
} from '@/services/api';
import { cn } from '@/utils/helpers';
import { useToast } from '@/components/ToastProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldType = 'number' | 'boolean' | 'time' | 'segments' | 'text';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  description?: string;
  phase?: string; // for grouped display in 2-Step / 1-Step
}

// ─── Field Definitions ────────────────────────────────────────────────────────

const FLASH_FIELDS: FieldDef[] = [
  { key: 'duration_hours',         label: 'Duration',            type: 'number',   unit: 'h',    description: '24h challenge window from first position' },
  { key: 'per_position_loss_pct',  label: 'Per-Position Loss',   type: 'number',   unit: '%',    description: 'Max loss per single position' },
  { key: 'max_drawdown_pct',       label: 'Max Drawdown',        type: 'number',   unit: '%',    description: 'Max total drawdown from peak' },
  { key: 'max_open_positions',     label: 'Max Positions',       type: 'number',               description: 'Max simultaneously open positions' },
  { key: 'leverage_max',           label: 'Max Leverage',        type: 'number',   unit: 'x',   description: 'Max leverage multiplier' },
  { key: 'profit_target_pct',      label: 'Profit Target',       type: 'number',   unit: '%',   description: '0 = no target' },
  { key: 'profit_split_pct',       label: 'Profit Split',        type: 'number',   unit: '%',   description: 'Trader share of profits' },
  { key: 'payout_threshold_pct',   label: 'Payout Threshold',    type: 'number',   unit: '%',   description: 'Minimum profit % to request payout' },
  { key: 'consistency_rule_pct',   label: 'Consistency Rule',    type: 'number',   unit: '%',   description: 'Max single-day % of total profit' },
  { key: 'trading_hours_start',    label: 'Trading Start',       type: 'time',                  description: 'IST start time (HH:MM)' },
  { key: 'trading_hours_end',      label: 'Trading End',         type: 'time',                  description: 'IST end time (HH:MM)' },
  { key: 'overnight_allowed',      label: 'Overnight Allowed',   type: 'boolean',               description: 'Allow holding positions overnight' },
  { key: 'weekend_allowed',        label: 'Weekend Allowed',     type: 'boolean',               description: 'Allow trading on weekends' },
  { key: 'holiday_restriction',    label: 'Block Holidays',      type: 'boolean',               description: 'Block trading on NSE holidays' },
  { key: 'allowed_segments',       label: 'Allowed Segments',    type: 'segments',              description: 'Exchange segments permitted' },
];

const INSTANT_FIELDS: FieldDef[] = [
  { key: 'daily_loss_pct',                   label: 'Daily Loss Limit',       type: 'number',  unit: '%' },
  { key: 'max_drawdown_pct',                 label: 'Max Drawdown',           type: 'number',  unit: '%' },
  { key: 'max_open_positions',               label: 'Max Positions',          type: 'number' },
  { key: 'leverage_max',                     label: 'Max Leverage',           type: 'number',  unit: 'x' },
  { key: 'max_position_size_pct',            label: 'Max Position Size',      type: 'number',  unit: '%' },
  { key: 'profit_target_pct',                label: 'Profit Target',          type: 'number',  unit: '%',  description: '0 = no target' },
  { key: 'profit_split_pct',                 label: 'Profit Split',           type: 'number',  unit: '%',  description: 'Flat 80% from day 1' },
  { key: 'payout_threshold_pct',             label: 'Payout Threshold',       type: 'number',  unit: '%' },
  { key: 'min_trading_days',                 label: 'Min Trading Days',       type: 'number',  unit: 'd' },
  { key: 'consistency_rule_pct',             label: 'Consistency Rule',       type: 'number',  unit: '%' },
  { key: 'daily_profit_cap_pct',             label: 'Daily Profit Cap',       type: 'number',  unit: '%' },
  { key: 'daily_profit_cap_cooldown_hours',  label: 'Cap Cooldown',           type: 'number',  unit: 'h' },
  { key: 'risk_per_idea_pct',                label: 'Risk per Idea',          type: 'number',  unit: '%' },
  { key: 'risk_per_idea_window_min',         label: 'Idea Window',            type: 'number',  unit: 'min' },
  { key: 'inactivity_close_days',            label: 'Inactivity Close',       type: 'number',  unit: 'd' },
  { key: 'trading_hours_start',              label: 'Trading Start',          type: 'time' },
  { key: 'trading_hours_end',                label: 'Trading End',            type: 'time' },
  { key: 'overnight_allowed',                label: 'Overnight Allowed',      type: 'boolean' },
  { key: 'weekend_allowed',                  label: 'Weekend Allowed',        type: 'boolean' },
  { key: 'holiday_restriction',              label: 'Block Holidays',         type: 'boolean' },
  { key: 'allowed_segments',                 label: 'Allowed Segments',       type: 'segments' },
];

const ONESTEP_FIELDS: FieldDef[] = [
  // Evaluation
  { key: 'e_profit_target_pct',        label: 'Profit Target',       type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_daily_loss_pct',           label: 'Daily Loss Limit',    type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_max_drawdown_pct',         label: 'Max Drawdown',        type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_min_trading_days',         label: 'Min Trading Days',    type: 'number', unit: 'd',  phase: 'Evaluation' },
  { key: 'e_max_open_positions',       label: 'Max Positions',       type: 'number',              phase: 'Evaluation' },
  { key: 'e_max_position_size_pct',    label: 'Max Position Size',   type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_max_risk_per_trade_pct',   label: 'Risk per Trade',      type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_daily_profit_cap_pct',     label: 'Daily Profit Cap',    type: 'number', unit: '%',  phase: 'Evaluation' },
  { key: 'e_leverage_max',             label: 'Max Leverage',        type: 'number', unit: 'x',  phase: 'Evaluation' },
  // Funded
  { key: 'f_profit_target_pct',        label: 'Profit Target',       type: 'number', unit: '%',  phase: 'Funded', description: '0 = no target' },
  { key: 'f_daily_loss_pct',           label: 'Daily Loss Limit',    type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_max_drawdown_pct',         label: 'Max Drawdown',        type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_min_trading_days',         label: 'Min Trading Days',    type: 'number', unit: 'd',  phase: 'Funded' },
  { key: 'f_max_open_positions',       label: 'Max Positions',       type: 'number',              phase: 'Funded' },
  { key: 'f_max_position_size_pct',    label: 'Max Position Size',   type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_max_risk_per_trade_pct',   label: 'Risk per Trade',      type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_daily_profit_cap_pct',     label: 'Daily Profit Cap',    type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_leverage_max',             label: 'Max Leverage',        type: 'number', unit: 'x',  phase: 'Funded' },
  { key: 'f_consistency_rule_pct',     label: 'Consistency Rule',    type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_profit_split_initial_pct', label: 'Split (initial)',     type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_profit_split_scaled_pct',  label: 'Split (after 1st)',   type: 'number', unit: '%',  phase: 'Funded' },
  { key: 'f_payout_threshold_pct',     label: 'Payout Threshold',    type: 'number', unit: '%',  phase: 'Funded' },
  // Shared
  { key: 'trading_hours_start',        label: 'Trading Start',       type: 'time',                phase: 'Shared' },
  { key: 'trading_hours_end',          label: 'Trading End',         type: 'time',                phase: 'Shared' },
  { key: 'overnight_allowed',          label: 'Overnight Allowed',   type: 'boolean',             phase: 'Shared' },
  { key: 'weekend_allowed',            label: 'Weekend Allowed',     type: 'boolean',             phase: 'Shared' },
  { key: 'holiday_restriction',        label: 'Block Holidays',      type: 'boolean',             phase: 'Shared' },
  { key: 'inactivity_close_days',      label: 'Inactivity Close',    type: 'number', unit: 'd',  phase: 'Shared' },
  { key: 'allowed_segments',           label: 'Allowed Segments',    type: 'segments',            phase: 'Shared' },
];

const TWOSTEP_FIELDS: FieldDef[] = [
  // Phase 1
  { key: 'p1_profit_target_pct',        label: 'Profit Target',     type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_daily_loss_pct',           label: 'Daily Loss Limit',  type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_max_drawdown_pct',         label: 'Max Drawdown',      type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_min_trading_days',         label: 'Min Trading Days',  type: 'number', unit: 'd', phase: 'Phase 1' },
  { key: 'p1_max_open_positions',       label: 'Max Positions',     type: 'number',             phase: 'Phase 1' },
  { key: 'p1_max_position_size_pct',    label: 'Max Position Size', type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_max_risk_per_trade_pct',   label: 'Risk per Trade',    type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_daily_profit_cap_pct',     label: 'Daily Profit Cap',  type: 'number', unit: '%', phase: 'Phase 1' },
  { key: 'p1_leverage_max',             label: 'Max Leverage',      type: 'number', unit: 'x', phase: 'Phase 1' },
  // Phase 2
  { key: 'p2_profit_target_pct',        label: 'Profit Target',     type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_daily_loss_pct',           label: 'Daily Loss Limit',  type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_max_drawdown_pct',         label: 'Max Drawdown',      type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_min_trading_days',         label: 'Min Trading Days',  type: 'number', unit: 'd', phase: 'Phase 2' },
  { key: 'p2_max_open_positions',       label: 'Max Positions',     type: 'number',             phase: 'Phase 2' },
  { key: 'p2_max_position_size_pct',    label: 'Max Position Size', type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_max_risk_per_trade_pct',   label: 'Risk per Trade',    type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_daily_profit_cap_pct',     label: 'Daily Profit Cap',  type: 'number', unit: '%', phase: 'Phase 2' },
  { key: 'p2_leverage_max',             label: 'Max Leverage',      type: 'number', unit: 'x', phase: 'Phase 2' },
  // Funded
  { key: 'f_profit_target_pct',         label: 'Profit Target',     type: 'number', unit: '%', phase: 'Funded', description: '0 = no target' },
  { key: 'f_daily_loss_pct',            label: 'Daily Loss Limit',  type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_max_drawdown_pct',          label: 'Max Drawdown',      type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_min_trading_days',          label: 'Min Trading Days',  type: 'number', unit: 'd', phase: 'Funded' },
  { key: 'f_max_open_positions',        label: 'Max Positions',     type: 'number',             phase: 'Funded' },
  { key: 'f_max_position_size_pct',     label: 'Max Position Size', type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_max_risk_per_trade_pct',    label: 'Risk per Trade',    type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_daily_profit_cap_pct',      label: 'Daily Profit Cap',  type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_leverage_max',              label: 'Max Leverage',      type: 'number', unit: 'x', phase: 'Funded' },
  { key: 'f_consistency_rule_pct',      label: 'Consistency Rule',  type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_profit_split_initial_pct',  label: 'Split (initial)',   type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_profit_split_scaled_pct',   label: 'Split (after 1st)', type: 'number', unit: '%', phase: 'Funded' },
  { key: 'f_payout_threshold_pct',      label: 'Payout Threshold',  type: 'number', unit: '%', phase: 'Funded' },
  // Shared
  { key: 'trading_hours_start',         label: 'Trading Start',     type: 'time',               phase: 'Shared' },
  { key: 'trading_hours_end',           label: 'Trading End',       type: 'time',               phase: 'Shared' },
  { key: 'overnight_allowed',           label: 'Overnight Allowed', type: 'boolean',            phase: 'Shared' },
  { key: 'weekend_allowed',             label: 'Weekend Allowed',   type: 'boolean',            phase: 'Shared' },
  { key: 'holiday_restriction',         label: 'Block Holidays',    type: 'boolean',            phase: 'Shared' },
  { key: 'inactivity_close_days',       label: 'Inactivity Close',  type: 'number', unit: 'd', phase: 'Shared' },
  { key: 'allowed_segments',            label: 'Allowed Segments',  type: 'segments',           phase: 'Shared' },
];

// ─── Field Input ──────────────────────────────────────────────────────────────

function FieldInput({
  field, value, onChange,
}: { field: FieldDef; value: any; onChange: (key: string, val: any) => void }) {
  if (field.type === 'boolean') {
    return (
      <button
        onClick={() => onChange(field.key, !value)}
        className={cn(
          'px-2.5 py-1 text-[12px] font-bold rounded border transition-colors',
          value
            ? 'bg-green-900/30 border-green-700/50 text-green-400'
            : 'bg-red-900/20 border-red-700/40 text-red-400'
        )}
      >
        {value ? 'YES' : 'NO'}
      </button>
    );
  }

  if (field.type === 'segments') {
    const arr: string[] = Array.isArray(value) ? value : [];
    const ALL_SEGS = ['NSE', 'NFO', 'BFO', 'MCX', 'CDS', 'BSE'];
    return (
      <div className="flex flex-wrap gap-1">
        {ALL_SEGS.map(seg => (
          <button
            key={seg}
            onClick={() => {
              const next = arr.includes(seg) ? arr.filter(s => s !== seg) : [...arr, seg];
              onChange(field.key, next);
            }}
            className={cn(
              'px-1.5 py-0.5 text-[11px] font-bold rounded border transition-colors',
              arr.includes(seg)
                ? 'bg-fw-accent/20 border-fw-accent/50 text-fw-accent'
                : 'bg-fw-bg border-fw-border text-fw-text-muted'
            )}
          >
            {seg}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={e => {
        const raw = e.target.value;
        if (field.type === 'number') {
          onChange(field.key, raw === '' ? '' : parseFloat(raw));
        } else {
          onChange(field.key, raw);
        }
      }}
      className="bg-fw-bg border border-fw-border rounded px-2 py-1 text-[13px] text-fw-text font-mono w-24 outline-none focus:border-fw-accent text-right"
    />
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

function FieldRow({
  field, original, draft, isDirty, onChange,
}: {
  field: FieldDef;
  original: any;
  draft: any;
  isDirty: boolean;
  onChange: (key: string, val: any) => void;
}) {
  return (
    <tr className={cn('group', isDirty && 'bg-yellow-900/10')}>
      <td className="py-1.5 pr-2">
        <div className="text-[13px] text-fw-text font-medium">{field.label}</div>
        {field.description && (
          <div className="text-[11px] text-fw-text-muted mt-0.5">{field.description}</div>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        <span className={cn('font-mono text-[12px]', isDirty ? 'line-through text-fw-text-muted' : 'text-fw-text-secondary')}>
          {Array.isArray(original) ? original.join(', ') : String(original ?? '—')}
          {field.unit && !Array.isArray(original) && <span className="text-fw-text-muted ml-0.5">{field.unit}</span>}
        </span>
      </td>
      <td className="py-1.5 text-right">
        <FieldInput field={field} value={draft} onChange={onChange} />
        {field.unit && field.type !== 'segments' && field.type !== 'boolean' && (
          <span className="text-[11px] text-fw-text-muted ml-1">{field.unit}</span>
        )}
      </td>
      <td className="py-1.5 pl-2 w-4">
        {isDirty && <span className="text-yellow-400 text-[14px]">●</span>}
      </td>
    </tr>
  );
}

// ─── Phase Group ─────────────────────────────────────────────────────────────

function PhaseGroup({
  phase, fields, original, draft, dirtyKeys, onChange,
}: {
  phase: string;
  fields: FieldDef[];
  original: Record<string, any>;
  draft: Record<string, any>;
  dirtyKeys: Set<string>;
  onChange: (key: string, val: any) => void;
}) {
  const [open, setOpen] = useState(true);
  const dirtyCount = fields.filter(f => dirtyKeys.has(f.key)).length;

  const phaseColors: Record<string, string> = {
    'Evaluation': 'text-blue-400 border-blue-800/40',
    'Phase 1':    'text-blue-400 border-blue-800/40',
    'Phase 2':    'text-purple-400 border-purple-800/40',
    'Funded':     'text-green-400 border-green-800/40',
    'Shared':     'text-fw-text-muted border-fw-border',
  };

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-left',
          'bg-fw-bg/50 hover:bg-fw-hover/20 transition-colors',
          phaseColors[phase] ?? 'text-fw-text-muted border-fw-border'
        )}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <span className="text-[12px] font-bold uppercase tracking-wide">{phase}</span>
        {dirtyCount > 0 && (
          <span className="ml-auto text-[11px] bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded font-bold">
            {dirtyCount} pending
          </span>
        )}
      </button>
      {open && (
        <table className="w-full mt-1">
          <thead>
            <tr>
              <th className="text-left text-[11px] text-fw-text-muted font-medium py-1 pr-2 w-[40%]">Rule</th>
              <th className="text-right text-[11px] text-fw-text-muted font-medium py-1 pr-2 w-[25%]">Current</th>
              <th className="text-right text-[11px] text-fw-text-muted font-medium py-1 w-[30%]">Edit</th>
              <th className="w-4" />
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <FieldRow
                key={f.key}
                field={f}
                original={original[f.key]}
                draft={draft[f.key]}
                isDirty={dirtyKeys.has(f.key)}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

function AuditLog({ entries }: { entries: any[] }) {
  if (!entries.length) {
    return <div className="text-[13px] text-fw-text-muted italic py-4 text-center">No changes recorded yet.</div>;
  }
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {entries.map((e, i) => (
        <div key={i} className="flex items-start gap-2 text-[12px] bg-fw-bg border border-fw-border/30 rounded px-2.5 py-1.5">
          <div className="flex-1 min-w-0">
            <span className="font-mono font-semibold text-fw-text">{e.rule_name}</span>
            {e.phase && <span className="ml-1.5 text-[10px] text-fw-text-muted uppercase">[{e.phase}]</span>}
            <span className="text-fw-text-muted ml-2">
              {e.old_value != null ? String(e.old_value?.value ?? e.old_value) : '—'}
              {' → '}
            </span>
            <span className="text-fw-accent">{String(e.new_value?.value ?? e.new_value)}</span>
          </div>
          <div className="text-right text-fw-text-muted flex-shrink-0">
            <div>{e.changed_by?.slice(0, 8) ?? '—'}</div>
            <div>{e.changed_at ? new Date(e.changed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Profile Panel ────────────────────────────────────────────────────────────

interface ProfilePanelProps {
  label: string;
  fields: FieldDef[];
  getProfile: () => Promise<{ success: boolean; profile: any }>;
  updateProfile: (updates: Record<string, any>) => Promise<{ success: boolean; profile: any; message: string }>;
  getAudit: (limit?: number) => Promise<{ success: boolean; audit: any[] }>;
  hasPhases: boolean;
}

function ProfilePanel({ label, fields, getProfile, updateProfile, getAudit, hasPhases }: ProfilePanelProps) {
  const { showToast } = useToast();
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProfile();
      setProfile(res.profile);
      setDraft({ ...res.profile });
    } catch (err: any) {
      showToast({ type: 'danger', title: `${label} Load Error`, message: err?.message ?? 'Failed to load profile' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const handleChange = (key: string, val: any) => {
    setDraft(d => ({ ...d, [key]: val }));
  };

  const dirtyKeys = new Set<string>(
    profile ? fields.filter(f => JSON.stringify(draft[f.key]) !== JSON.stringify(profile[f.key])).map(f => f.key) : []
  );

  const handleSave = async () => {
    if (dirtyKeys.size === 0) {
      showToast({ type: 'warning', title: 'No Changes', message: 'No fields have been modified.' });
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      for (const key of dirtyKeys) updates[key] = draft[key];
      const res = await updateProfile(updates);
      setProfile(res.profile);
      setDraft({ ...res.profile });
      showToast({ type: 'success', title: `${label} Updated`, message: res.message });
    } catch (err: any) {
      showToast({ type: 'danger', title: 'Save Failed', message: err?.message ?? 'Could not save profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleShowAudit = async () => {
    if (!showAudit) {
      setLoadingAudit(true);
      try {
        const res = await getAudit(50);
        setAuditEntries(res.audit || []);
      } catch {
        setAuditEntries([]);
      } finally {
        setLoadingAudit(false);
      }
    }
    setShowAudit(v => !v);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-fw-text-muted text-[13px]">
        Loading {label} profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-40 text-red-400 text-[13px]">
        Failed to load {label} profile.
      </div>
    );
  }

  // Group fields by phase if needed
  const phases = hasPhases
    ? [...new Set(fields.map(f => f.phase ?? 'Other'))]
    : ['all'];

  return (
    <div className="flex flex-col gap-3">
      {/* Action bar */}
      <div className="flex items-center gap-2 sticky top-0 z-10 bg-[#0d0f15] py-1.5 border-b border-fw-border/40">
        <span className="text-[13px] text-fw-text-muted">
          {dirtyKeys.size > 0
            ? <span className="text-yellow-400 font-bold">{dirtyKeys.size} unsaved change{dirtyKeys.size !== 1 ? 's' : ''}</span>
            : <span className="text-green-500/80">All saved</span>
          }
        </span>
        <div className="flex-1" />
        <button
          onClick={load}
          className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-bold rounded bg-fw-bg border border-fw-border text-fw-text-secondary hover:bg-fw-hover transition-colors"
          title="Reload from database"
        >
          <RefreshCw size={11} /> Reload
        </button>
        <button
          onClick={handleShowAudit}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 text-[12px] font-bold rounded border transition-colors',
            showAudit ? 'bg-blue-900/30 border-blue-700/40 text-blue-400' : 'bg-fw-bg border-fw-border text-fw-text-secondary hover:bg-fw-hover'
          )}
        >
          <History size={11} /> {showAudit ? 'Hide Log' : 'Audit Log'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || dirtyKeys.size === 0}
          className={cn(
            'flex items-center gap-1 px-3 py-1 text-[12px] font-bold rounded border transition-colors',
            dirtyKeys.size > 0
              ? 'bg-fw-accent/20 border-fw-accent/50 text-fw-accent hover:bg-fw-accent/30'
              : 'bg-fw-bg border-fw-border text-fw-text-muted opacity-40 cursor-not-allowed'
          )}
        >
          <Save size={11} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Audit log */}
      {showAudit && (
        <div className="border border-fw-border/40 rounded-md p-2.5 bg-[#0a0c12]">
          <div className="text-[12px] font-bold text-fw-text-muted uppercase mb-2">Change History</div>
          {loadingAudit ? (
            <div className="text-[12px] text-fw-text-muted py-2 text-center">Loading…</div>
          ) : (
            <AuditLog entries={auditEntries} />
          )}
        </div>
      )}

      {/* Fields — grouped by phase or flat */}
      {hasPhases ? (
        phases.map(phase => {
          const phaseFields = fields.filter(f => (f.phase ?? 'Other') === phase);
          return (
            <PhaseGroup
              key={phase}
              phase={phase}
              fields={phaseFields}
              original={profile}
              draft={draft}
              dirtyKeys={dirtyKeys}
              onChange={handleChange}
            />
          );
        })
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[11px] text-fw-text-muted font-medium py-1 pr-2 w-[40%]">Rule</th>
              <th className="text-right text-[11px] text-fw-text-muted font-medium py-1 pr-2 w-[25%]">Current</th>
              <th className="text-right text-[11px] text-fw-text-muted font-medium py-1 w-[30%]">Edit</th>
              <th className="w-4" />
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <FieldRow
                key={f.key}
                field={f}
                original={profile[f.key]}
                draft={draft[f.key]}
                isDirty={dirtyKeys.has(f.key)}
                onChange={handleChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type RiskTab = 'flash' | 'instant' | 'onestep' | 'twostep';

const TABS: { id: RiskTab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'flash',   label: 'Flash',   icon: <Zap size={12} />,       color: 'text-yellow-400' },
  { id: 'instant', label: 'Instant', icon: <TrendingUp size={12} />, color: 'text-green-400' },
  { id: 'onestep', label: '1-Step',  icon: <BarChart2 size={12} />,  color: 'text-blue-400' },
  { id: 'twostep', label: '2-Step',  icon: <Layers size={12} />,     color: 'text-purple-400' },
];

export function AdminRiskManagement() {
  const [activeTab, setActiveTab] = useState<RiskTab>('flash');

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#0d0f15] to-[#0b0d12]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fw-border bg-[#0a0c12] flex-shrink-0">
        <AlertTriangle size={14} className="text-orange-400" />
        <span className="text-[13px] font-bold text-fw-text">Admin — Risk Management</span>
        <span className="ml-1 text-[11px] text-fw-text-muted">Changes are live immediately · All writes are audited</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-fw-border/50 bg-[#0a0c12] flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-bold transition-colors',
              activeTab === tab.id
                ? `bg-fw-hover/40 border border-fw-border ${tab.color}`
                : 'text-fw-text-muted hover:text-fw-text hover:bg-fw-hover/20'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-auto px-3 py-2">
        {activeTab === 'flash' && (
          <ProfilePanel
            label="Flash"
            fields={FLASH_FIELDS}
            getProfile={adminGetFlashProfile}
            updateProfile={adminUpdateFlashProfile}
            getAudit={adminGetFlashAudit}
            hasPhases={false}
          />
        )}
        {activeTab === 'instant' && (
          <ProfilePanel
            label="Instant"
            fields={INSTANT_FIELDS}
            getProfile={adminGetInstantProfile}
            updateProfile={adminUpdateInstantProfile}
            getAudit={adminGetInstantAudit}
            hasPhases={false}
          />
        )}
        {activeTab === 'onestep' && (
          <ProfilePanel
            label="1-Step"
            fields={ONESTEP_FIELDS}
            getProfile={adminGetOneStepProfile}
            updateProfile={adminUpdateOneStepProfile}
            getAudit={adminGetOneStepAudit}
            hasPhases={true}
          />
        )}
        {activeTab === 'twostep' && (
          <ProfilePanel
            label="2-Step"
            fields={TWOSTEP_FIELDS}
            getProfile={adminGetTwoStepProfile}
            updateProfile={adminUpdateTwoStepProfile}
            getAudit={adminGetTwoStepAudit}
            hasPhases={true}
          />
        )}
      </div>
    </div>
  );
}
