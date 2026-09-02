import { useEffect, useState } from 'react';
import { Check, Pencil, Save, Trash2 } from 'lucide-react';
import { useLayoutStore } from '@/store/layoutStore';

export function LayoutManager() {
  const { savedLayouts, hydrateLayouts, saveCurrentLayout, loadLayout, renameLayout, deleteLayout } = useLayoutStore();
  const [name, setName] = useState('My Workspace');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { hydrateLayouts().catch(() => setMessage('Unable to load saved layouts')); }, [hydrateLayouts]);

  const save = async () => {
    try {
      await saveCurrentLayout(name);
      setMessage('Workspace saved');
    } catch { setMessage('Workspace could not be saved'); }
  };

  const rename = async (id: string) => {
    try {
      await renameLayout(id, editingName);
      setEditingId(null);
      setMessage('Workspace renamed');
    } catch { setMessage('Workspace could not be renamed'); }
  };

  const remove = async (id: string) => {
    try {
      await deleteLayout(id);
      setMessage('Workspace deleted');
    } catch { setMessage('Workspace could not be deleted'); }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          aria-label="Workspace name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="flex-1 h-9 bg-fw-surface-2 border border-fw-border rounded-md text-[13px] text-fw-text px-3 outline-none focus:border-fw-accent"
        />
        <button onClick={save} title="Save workspace" className="flex items-center gap-1.5 px-3 h-9 rounded-md bg-fw-accent text-white text-[13px] font-bold">
          <Save size={13} /> Save
        </button>
      </div>
      {message && <p className="text-[12px] text-fw-text-muted" role="status">{message}</p>}
      {savedLayouts.length === 0 ? (
        <p className="text-[13px] text-fw-text-muted">No saved workspaces</p>
      ) : (
        <div className="flex flex-col border border-fw-border/40 rounded-lg overflow-hidden">
          {savedLayouts.map((layout) => (
            <div key={layout.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-fw-border/30">
              {editingId === layout.id ? (
                <input aria-label={`Rename ${layout.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} className="flex-1 h-8 bg-fw-surface-2 border border-fw-border rounded px-2 text-[13px] text-fw-text" autoFocus />
              ) : <span className="flex-1 text-[13px] font-semibold text-fw-text truncate">{layout.name}</span>}
              <button onClick={() => editingId === layout.id ? rename(layout.id) : loadLayout(layout.id)} title={editingId === layout.id ? 'Save name' : 'Load workspace'} className="p-1.5 text-fw-accent hover:bg-fw-accent/10 rounded">
                {editingId === layout.id ? <Check size={14} /> : <span className="text-[11px] font-bold">Load</span>}
              </button>
              <button onClick={() => { setEditingId(layout.id); setEditingName(layout.name); }} title="Rename workspace" className="p-1.5 text-fw-text-muted hover:text-fw-text rounded"><Pencil size={14} /></button>
              <button onClick={() => remove(layout.id)} title="Delete workspace" className="p-1.5 text-red-400 hover:bg-red-900/20 rounded"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}