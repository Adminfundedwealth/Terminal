import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/utils/helpers';
import { Save, Trash2, Check, Layout } from 'lucide-react';

interface ChartTemplate {
  id: string;
  name: string;
  timeframe: string;
  chartType: string;
  indicators: string[];
  chartLayout: string;
  createdAt: string;
}

const STORAGE_KEY = 'fw-chart-templates';

function loadTemplates(): ChartTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTemplates(templates: ChartTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/**
 * Chart Templates Panel
 * Save and restore chart configurations (timeframe, type, indicators, layout).
 * Persisted locally + syncs to layouts table on server.
 */
export function ChartTemplatesPanel() {
  const { timeframe, chartType, chartLayout, setTimeframe, setChartType, setChartLayout } = useAppStore();
  const [templates, setTemplates] = useState<ChartTemplate[]>(loadTemplates());
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { saveTemplates(templates); }, [templates]);

  const handleSave = () => {
    if (!newName.trim()) { setToast('Enter a name'); setTimeout(() => setToast(''), 2000); return; }
    const tpl: ChartTemplate = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      timeframe,
      chartType,
      chartLayout,
      indicators: [], // Will be populated when indicator state is tracked
      createdAt: new Date().toISOString(),
    };
    setTemplates([tpl, ...templates]);
    setNewName('');
    setToast('Template saved');
    setTimeout(() => setToast(''), 2000);

    // Persist to server (async, fire-and-forget)
    fetch('/api/chart-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(tpl),
    }).catch(() => {});
  };

  const handleLoad = (tpl: ChartTemplate) => {
    setTimeframe(tpl.timeframe as any);
    setChartType(tpl.chartType as any);
    setChartLayout(tpl.chartLayout as any);
    setToast(`Loaded: ${tpl.name}`);
    setTimeout(() => setToast(''), 2000);
  };

  const handleDelete = (id: string) => {
    setTemplates(templates.filter(t => t.id !== id));
  };

  return (
    <div className="h-full flex flex-col bg-[#0c0e14]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-[#10121a] flex-shrink-0">
        <span className="text-[12px] font-bold text-fw-text">Chart Templates</span>
        <span className="text-[10px] text-fw-text-muted">{templates.length} saved</span>
      </div>

      {/* Save new */}
      <div className="px-3 py-2 border-b border-fw-border flex items-center gap-2 flex-shrink-0">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Template name..."
          className="flex-1 bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent"
        />
        <button onClick={handleSave} className="flex items-center gap-1 px-2 py-1.5 text-[10px] bg-fw-accent text-white rounded font-bold hover:brightness-110">
          <Save size={10} /> Save Current
        </button>
      </div>

      {/* Current state */}
      <div className="px-3 py-1.5 border-b border-fw-border/30 flex items-center gap-3 text-[10px] text-fw-text-muted flex-shrink-0">
        <span>Current: <b className="text-fw-text">{timeframe}m</b></span>
        <span><b className="text-fw-text capitalize">{chartType}</b></span>
        <span>Layout: <b className="text-fw-text">{chartLayout}</b></span>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto">
        {templates.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-fw-text-muted">
            No templates saved. Save your current chart settings.
          </div>
        ) : (
          templates.map(tpl => (
            <div key={tpl.id} className="flex items-center justify-between px-3 py-2 border-b border-fw-border/30 hover:bg-fw-hover/30 group">
              <div className="flex items-center gap-2">
                <Layout size={12} className="text-fw-accent" />
                <div>
                  <div className="text-[12px] font-semibold text-fw-text">{tpl.name}</div>
                  <div className="text-[10px] text-fw-text-muted">
                    {tpl.timeframe}m · {tpl.chartType} · {tpl.chartLayout}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleLoad(tpl)} className="p-1.5 rounded hover:bg-green-900/30 text-green transition-colors" title="Load">
                  <Check size={12} />
                </button>
                <button onClick={() => handleDelete(tpl.id)} className="p-1.5 rounded hover:bg-red-900/30 text-red-400 transition-colors" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {toast && <div className="px-3 py-1.5 border-t border-fw-border text-[11px] text-fw-accent bg-fw-accent/5">{toast}</div>}
    </div>
  );
}
