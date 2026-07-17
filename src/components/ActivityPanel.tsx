import { useState, useEffect } from 'react';
import { apiService } from '@/services/api';
import { cn } from '@/utils/helpers';
import { Activity, Shield, AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';

interface RiskEvent {
  id: string;
  event_type: string;
  severity: string;
  rule_type: string | null;
  threshold_value: number | null;
  actual_value: number | null;
  metadata: Record<string, any>;
  created_at: string;
}

interface AuditEntry {
  id: string;
  audit_type: string;
  order_id: string | null;
  all_passed: boolean;
  checks_run: string[];
  rejection_reason: string | null;
  created_at: string;
}

export function ActivityPanel() {
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<'risk' | 'audit'>('risk');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [re, au] = await Promise.all([
        apiService.get<RiskEvent[]>('/account/risk-events').catch(() => []),
        apiService.get<AuditEntry[]>('/account/audits').catch(() => []),
      ]);
      setRiskEvents(re || []);
      setAudits(au || []);
    } finally { setLoading(false); }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sub-header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-fw-border/30 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => setActiveView('risk')} className={cn('px-2 py-0.5 text-xs font-bold rounded', activeView === 'risk' ? 'bg-fw-accent/15 text-fw-accent' : 'text-fw-text-secondary hover:text-fw-text')}>
            Risk Events
          </button>
          <button onClick={() => setActiveView('audit')} className={cn('px-2 py-0.5 text-xs font-bold rounded', activeView === 'audit' ? 'bg-fw-accent/15 text-fw-accent' : 'text-fw-text-secondary hover:text-fw-text')}>
            Execution Audit
          </button>
        </div>
        <div className="flex-1" />
        <button onClick={refresh} className={cn('p-1 rounded hover:bg-fw-hover text-fw-text-secondary', loading && 'animate-spin')}>
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeView === 'risk' ? (
          riskEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-fw-text-secondary">
              <Shield size={24} className="opacity-20" />
              <span className="text-sm">No risk events recorded</span>
              <span className="text-xs text-fw-text-secondary/60">Events appear when risk thresholds are triggered</span>
            </div>
          ) : (
            <table className="fw-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Severity</th>
                  <th>Rule</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {riskEvents.map(ev => (
                  <tr key={ev.id}>
                    <td className="font-mono text-sm text-fw-text-secondary tabular-nums">{new Date(ev.created_at).toLocaleTimeString()}</td>
                    <td className="text-fw-text text-base">{ev.event_type.replace(/_/g, ' ')}</td>
                    <td>
                      <span className={cn('px-1.5 py-0.5 text-xs font-bold rounded', ev.severity === 'critical' ? 'bg-red-900/20 text-red-400' : ev.severity === 'warning' ? 'bg-yellow-900/20 text-yellow-400' : 'bg-blue-900/20 text-blue-400')}>
                        {ev.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-fw-text-secondary text-sm">{ev.rule_type || '—'}</td>
                    <td className="text-fw-text-secondary text-xs max-w-[200px] truncate">{ev.metadata?.symbol || ev.metadata?.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          audits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-fw-text-secondary">
              <Activity size={24} className="opacity-20" />
              <span className="text-sm">No audit entries</span>
              <span className="text-xs text-fw-text-secondary/60">Audit trail populates as orders flow through the system</span>
            </div>
          ) : (
            <table className="fw-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Checks</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {audits.map(au => (
                  <tr key={au.id}>
                    <td className="font-mono text-sm text-fw-text-secondary tabular-nums">{new Date(au.created_at).toLocaleTimeString()}</td>
                    <td className="text-fw-text text-base">{au.audit_type.replace(/_/g, ' ')}</td>
                    <td>
                      {au.all_passed ? (
                        <span className="flex items-center gap-1 text-xs text-green"><CheckCircle size={10} /> Pass</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red"><XCircle size={10} /> Fail</span>
                      )}
                    </td>
                    <td className="text-fw-text-secondary text-xs">{(au.checks_run || []).join(', ')}</td>
                    <td className="text-red-400/70 text-xs max-w-[180px] truncate">{au.rejection_reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
