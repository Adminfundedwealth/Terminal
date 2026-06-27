import { useState } from 'react';
import { Plus, Trash2, Edit2, Save, X, Image, Tag, AlertCircle, BookOpen } from 'lucide-react';
import { useJournalStore, type JournalEntry } from '@/store/journalStore';
import { cn } from '@/utils/helpers';

const EMOTIONS: JournalEntry['emotion'][] = ['confident', 'neutral', 'fearful', 'greedy', 'disciplined'];
const PHASES: { value: JournalEntry['tradePhase']; label: string }[] = [
  { value: 'before', label: 'Before Trade' },
  { value: 'during', label: 'During Trade' },
  { value: 'after', label: 'After Trade' },
];

const COMMON_TAGS = ['momentum', 'breakout', 'scalp', 'swing', 'reversal', 'trend', 'gap', 'news', 'overtraded', 'revenge'];

export function JournalPanel() {
  const { entries, addEntry, updateEntry, deleteEntry } = useJournalStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [filterPhase, setFilterPhase] = useState<'all' | JournalEntry['tradePhase']>('all');
  const [filterTag, setFilterTag] = useState('');
  const [form, setForm] = useState({
    symbol: '',
    side: 'BUY' as 'BUY' | 'SELL',
    notes: '',
    emotion: 'neutral' as JournalEntry['emotion'],
    rating: 3 as 1 | 2 | 3 | 4 | 5,
    pnl: 0,
    lessons: '',
    mistakes: '',
    tags: [] as string[],
    screenshotUrl: '',
    tradePhase: 'after' as JournalEntry['tradePhase'],
  });
  const [tagInput, setTagInput] = useState('');

  const handleSave = () => {
    if (!form.notes.trim()) return;
    if (editId) {
      updateEntry(editId, { ...form, date: new Date().toISOString().split('T')[0] });
      setEditId(null);
    } else {
      addEntry({ ...form, date: new Date().toISOString().split('T')[0] });
    }
    resetForm();
    setIsAdding(false);
  };

  const resetForm = () => {
    setForm({ symbol: '', side: 'BUY', notes: '', emotion: 'neutral', rating: 3, pnl: 0, lessons: '', mistakes: '', tags: [], screenshotUrl: '', tradePhase: 'after' });
    setTagInput('');
  };

  const startEdit = (entry: JournalEntry) => {
    setForm({
      symbol: entry.symbol,
      side: entry.side,
      notes: entry.notes,
      emotion: entry.emotion,
      rating: entry.rating,
      pnl: entry.pnl || 0,
      lessons: entry.lessons || '',
      mistakes: entry.mistakes || '',
      tags: entry.tags || [],
      screenshotUrl: entry.screenshotUrl || '',
      tradePhase: entry.tradePhase || 'after',
    });
    setEditId(entry.id);
    setIsAdding(true);
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !form.tags.includes(t)) {
      setForm({ ...form, tags: [...form.tags, t] });
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
  };

  const filteredEntries = entries.filter((e) => {
    if (filterPhase !== 'all' && (e.tradePhase || 'after') !== filterPhase) return false;
    if (filterTag && !(e.tags || []).includes(filterTag)) return false;
    return true;
  });

  // Collect all tags used
  const allTags = Array.from(new Set(entries.flatMap((e) => e.tags || [])));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-bold text-fw-text">Trade Journal ({filteredEntries.length})</span>
          {/* Phase Filter */}
          <div className="flex items-center gap-0.5">
            {[{ value: 'all', label: 'All' }, ...PHASES].map((p) => (
              <button
                key={p.value}
                onClick={() => setFilterPhase(p.value as any)}
                className={cn('px-2 py-0.5 text-[10px] rounded', filterPhase === p.value ? 'bg-fw-accent text-white' : 'text-fw-text-secondary hover:bg-fw-hover')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Tag filter */}
          {allTags.length > 0 && (
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="bg-fw-bg border border-fw-border rounded text-[10px] px-1.5 py-0.5 text-fw-text"
            >
              <option value="">All Tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        <button onClick={() => { setIsAdding(!isAdding); setEditId(null); resetForm(); }} className="flex items-center gap-1 px-2 py-1 text-[11px] bg-fw-accent text-white rounded hover:brightness-110">
          <Plus size={12} /> New Entry
        </button>
      </div>

      {/* Add/Edit Form */}
      {isAdding && (
        <div className="px-3 py-2 border-b border-fw-border bg-fw-bg/50 space-y-2 max-h-[300px] overflow-y-auto">
          {/* Row 1: Symbol, Side, P&L, Phase */}
          <div className="grid grid-cols-4 gap-2">
            <input placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
            <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as any })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text">
              <option value="BUY">BUY</option><option value="SELL">SELL</option>
            </select>
            <input type="number" placeholder="P&L" value={form.pnl || ''} onChange={(e) => setForm({ ...form, pnl: parseFloat(e.target.value) || 0 })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text font-mono outline-none focus:border-fw-accent" />
            <select value={form.tradePhase} onChange={(e) => setForm({ ...form, tradePhase: e.target.value as any })} className="bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text">
              {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {/* Notes */}
          <textarea placeholder="Trade notes / rationale..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-fw-bg border border-fw-border rounded text-[11px] px-2 py-1.5 text-fw-text outline-none focus:border-fw-accent resize-none" />

          {/* Mistakes */}
          <div className="relative">
            <AlertCircle size={10} className="absolute left-2 top-2.5 text-red-400" />
            <input placeholder="Mistakes made..." value={form.mistakes} onChange={(e) => setForm({ ...form, mistakes: e.target.value })} className="w-full bg-fw-bg border border-fw-border rounded text-[11px] pl-6 pr-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
          </div>

          {/* Lessons */}
          <div className="relative">
            <BookOpen size={10} className="absolute left-2 top-2.5 text-fw-accent" />
            <input placeholder="Lessons learned..." value={form.lessons} onChange={(e) => setForm({ ...form, lessons: e.target.value })} className="w-full bg-fw-bg border border-fw-border rounded text-[11px] pl-6 pr-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
          </div>

          {/* Screenshot URL */}
          <div className="relative">
            <Image size={10} className="absolute left-2 top-2.5 text-fw-text-secondary" />
            <input placeholder="Screenshot URL (paste link)..." value={form.screenshotUrl} onChange={(e) => setForm({ ...form, screenshotUrl: e.target.value })} className="w-full bg-fw-bg border border-fw-border rounded text-[11px] pl-6 pr-2 py-1.5 text-fw-text outline-none focus:border-fw-accent" />
          </div>

          {/* Emotions */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-fw-text-secondary">Emotion:</span>
            {EMOTIONS.map((em) => (
              <button key={em} onClick={() => setForm({ ...form, emotion: em })} className={cn('px-2 py-0.5 text-[10px] rounded capitalize', form.emotion === em ? 'bg-fw-accent text-white' : 'bg-fw-bg text-fw-text-secondary border border-fw-border')}>{em}</button>
            ))}
          </div>

          {/* Rating */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-fw-text-secondary">Rating:</span>
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} onClick={() => setForm({ ...form, rating: r as any })} className={cn('w-6 h-6 text-[11px] rounded', form.rating === r ? 'bg-fw-accent text-white' : 'bg-fw-bg text-fw-text-secondary border border-fw-border')}>{r}</button>
            ))}
          </div>

          {/* Tags */}
          <div className="flex items-center gap-2 flex-wrap">
            <Tag size={10} className="text-fw-text-secondary" />
            {form.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-fw-accent/15 text-fw-accent rounded border border-fw-accent/30">
                {tag}
                <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-red-400"><X size={8} /></button>
              </span>
            ))}
            <input
              placeholder="+ tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); } }}
              className="bg-fw-bg border border-fw-border rounded text-[10px] px-2 py-0.5 text-fw-text outline-none w-16 focus:border-fw-accent"
            />
            {/* Quick tag suggestions */}
            {COMMON_TAGS.filter((t) => !form.tags.includes(t)).slice(0, 4).map((t) => (
              <button key={t} onClick={() => addTag(t)} className="text-[9px] text-fw-text-muted hover:text-fw-accent">+{t}</button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-fw-accent text-white rounded"><Save size={11} /> {editId ? 'Update' : 'Save'}</button>
            <button onClick={() => { setIsAdding(false); setEditId(null); }} className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-fw-text-secondary border border-fw-border rounded"><X size={11} /> Cancel</button>
          </div>
        </div>
      )}

      {/* Entries List */}
      <div className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-fw-text-secondary">
            {entries.length === 0 ? 'No journal entries yet. Click "New Entry" to start.' : 'No entries match filters.'}
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div key={entry.id} className="px-3 py-2 border-b border-fw-border/50 hover:bg-fw-hover/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-[9px] font-bold px-1.5 py-0.5 rounded uppercase',
                    (entry.tradePhase || 'after') === 'before' ? 'bg-yellow-900/30 text-yellow-400' :
                    (entry.tradePhase || 'after') === 'during' ? 'bg-blue-900/30 text-blue-400' :
                    'bg-green-900/30 text-green-400'
                  )}>
                    {(entry.tradePhase || 'after').toUpperCase()}
                  </span>
                  <span className="text-[12px] font-semibold text-fw-text">{entry.symbol || '—'}</span>
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', entry.side === 'BUY' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400')}>{entry.side}</span>
                  <span className="text-[10px] text-fw-text-secondary capitalize">{entry.emotion}</span>
                  <span className="text-[10px] text-fw-text-secondary">{'★'.repeat(entry.rating)}</span>
                </div>
                <div className="flex items-center gap-1">
                  {entry.pnl !== undefined && entry.pnl !== 0 && <span className={cn('text-[11px] font-mono', (entry.pnl || 0) >= 0 ? 'text-green' : 'text-red')}>₹{entry.pnl?.toLocaleString()}</span>}
                  <button onClick={() => startEdit(entry)} className="p-1 text-fw-text-secondary hover:text-fw-text"><Edit2 size={11} /></button>
                  <button onClick={() => deleteEntry(entry.id)} className="p-1 text-fw-text-secondary hover:text-red-400"><Trash2 size={11} /></button>
                </div>
              </div>
              <p className="text-[11px] text-fw-text-secondary mt-1">{entry.notes}</p>
              {entry.mistakes && <p className="text-[10px] text-red-400 mt-0.5">⚠ {entry.mistakes}</p>}
              {entry.lessons && <p className="text-[10px] text-fw-accent mt-0.5">💡 {entry.lessons}</p>}
              {entry.screenshotUrl && (
                <a href={entry.screenshotUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline mt-0.5">
                  <Image size={9} /> Screenshot
                </a>
              )}
              {/* Tags */}
              {entry.tags && entry.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  {entry.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 text-[9px] bg-fw-bg border border-fw-border rounded text-fw-text-secondary">{t}</span>
                  ))}
                </div>
              )}
              <span className="text-[9px] text-fw-text-secondary/50">{entry.date}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
