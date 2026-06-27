import { useState, useEffect } from 'react';
import { Save, FolderOpen, Trash2, Star, Copy } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

interface ChartTemplate {
  id: string;
  name: string;
  indicators: string[];
  timeframe: string;
  chartType: string;
  drawingToolsEnabled: boolean;
  createdAt: string;
  isFavorite: boolean;
}

const STORAGE_KEY = 'fw-chart-templates';

export function ChartTemplates({ onClose }: { onClose?: () => void }) {
  const [templates, setTemplates] = useState<ChartTemplate[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [newName, setNewName] = useState('');
  const store = useAppStore();

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setTemplates(JSON.parse(saved)); } catch {}
    }
  }, []);

  function persist(list: ChartTemplate[]) {
    setTemplates(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function saveTemplate() {
    if (!newName.trim()) return;

    const template: ChartTemplate = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      indicators: (store as any).activeIndicators || [],
      timeframe: (store as any).activeTimeframe || '5',
      chartType: (store as any).chartType || 'candlestick',
      drawingToolsEnabled: true,
      createdAt: new Date().toISOString(),
      isFavorite: false,
    };

    persist([template, ...templates]);
    setNewName('');
    setShowSave(false);
  }

  function loadTemplate(t: ChartTemplate) {
    const setState = useAppStore.setState as any;
    setState({
      activeIndicators: t.indicators,
      activeTimeframe: t.timeframe,
      chartType: t.chartType,
    });
    onClose?.();
  }

  function deleteTemplate(id: string) {
    persist(templates.filter(t => t.id !== id));
  }

  function toggleFavorite(id: string) {
    persist(templates.map(t => t.id === id ? { ...t, isFavorite: !t.isFavorite } : t));
  }

  function duplicateTemplate(t: ChartTemplate) {
    const copy = { ...t, id: crypto.randomUUID(), name: `${t.name} (copy)`, createdAt: new Date().toISOString() };
    persist([copy, ...templates]);
  }

  const sortedTemplates = [...templates].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return b.isFavorite ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex flex-col bg-fw-surface border border-fw-border rounded-lg shadow-xl w-80 max-h-96">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-fw-border">
        <span className="text-xs font-bold text-fw-text uppercase tracking-wide">Chart Templates</span>
        <button
          onClick={() => setShowSave(!showSave)}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-fw-accent text-white hover:bg-fw-accent-hover"
        >
          <Save className="w-3 h-3" /> Save Current
        </button>
      </div>

      {/* Save Form */}
      {showSave && (
        <div className="px-4 py-2 border-b border-fw-border flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Template name..."
            className="fw-input flex-1 text-xs !py-1.5"
            onKeyDown={e => e.key === 'Enter' && saveTemplate()}
            autoFocus
          />
          <button onClick={saveTemplate} className="text-[10px] px-3 py-1.5 bg-fw-accent text-white rounded">Save</button>
        </div>
      )}

      {/* Template List */}
      <div className="flex-1 overflow-y-auto">
        {sortedTemplates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-fw-text-muted">
            <FolderOpen className="w-6 h-6 mb-2 opacity-40" />
            <span className="text-xs">No templates saved</span>
          </div>
        )}
        {sortedTemplates.map(t => (
          <div key={t.id} className="flex items-center gap-2 px-4 py-2 hover:bg-fw-hover border-b border-fw-border/30 group">
            <button onClick={() => toggleFavorite(t.id)}>
              <Star className={`w-3 h-3 ${t.isFavorite ? 'text-fw-yellow fill-fw-yellow' : 'text-fw-text-muted'}`} />
            </button>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadTemplate(t)}>
              <div className="text-xs font-bold text-fw-text truncate">{t.name}</div>
              <div className="text-[10px] text-fw-text-muted">
                {t.timeframe} • {t.chartType} • {t.indicators.length} indicators
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => duplicateTemplate(t)} className="p-1 rounded hover:bg-fw-surface-2">
                <Copy className="w-3 h-3 text-fw-text-muted" />
              </button>
              <button onClick={() => deleteTemplate(t.id)} className="p-1 rounded hover:bg-fw-surface-2">
                <Trash2 className="w-3 h-3 text-red" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
