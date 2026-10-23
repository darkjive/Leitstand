import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Archive, ExternalLink, X } from 'lucide-react';
import type { MoiraStatus, MoiraTask } from '../../shared/types';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

const COLUMNS: { status: MoiraStatus; label: string }[] = [
  { status: 'todo', label: 'Offen' },
  { status: 'doing', label: 'In Arbeit' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Erledigt' },
];
const POLL_MS = 3000;

export function MoiraBoard() {
  const [tasks, setTasks] = useState<MoiraTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const etag = useRef('');

  const load = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const headers: Record<string, string> = etag.current ? { 'If-None-Match': etag.current } : {};
      const res = await apiFetch('/api/moira/tasks', { headers });
      if (res.status === 304) return;
      if (!res.ok) throw new Error('Failed to load Moira tasks');
      etag.current = res.headers.get('ETag') ?? '';
      setTasks(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [load]);

  const post = async (file: string, action: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/moira/tasks/${file}/${action}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      return data;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const move = async (task: MoiraTask, delta: number) => {
    const next = COLUMNS[COLUMNS.findIndex(c => c.status === task.status) + delta];
    if (next && (await post(task.file, 'status', { status: next.status }))) await load();
  };

  const archive = async (task: MoiraTask) => {
    if (await post(task.file, 'archive')) {
      setSelected(null);
      await load();
    }
  };

  const openPreview = async (task: MoiraTask) => {
    toast('Starte Vorschau …', 'info');
    const data = await post(task.file, 'preview');
    if (data?.url) window.open(data.url, '_blank');
  };

  const projects = [...new Set(tasks.map(t => t.project).filter(Boolean))].sort();
  const visible = tasks.filter(t => !project || t.project === project);
  const detail = tasks.find(t => t.file === selected);

  if (error && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
    );
  }

  if (detail) {
    const index = COLUMNS.findIndex(c => c.status === detail.status);
    return (
      <div className="flex flex-col h-full gap-2 min-h-0">
        <div className="flex items-start gap-2">
          <button className="ds-btn" onClick={() => setSelected(null)} aria-label="Zurück">
            <X className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-accent text-sm truncate">
              {detail.number} {detail.title}
            </div>
            <div className="text-text-dim text-xs">
              {detail.project} · {detail.created} · {COLUMNS[index].label}
            </div>
          </div>
          <button
            className="ds-btn"
            disabled={busy || index === 0}
            onClick={() => move(detail, -1)}
            aria-label="Status zurück"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            className="ds-btn"
            disabled={busy || index === COLUMNS.length - 1}
            onClick={() => move(detail, 1)}
            aria-label="Status vor"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          {detail.preview && (
            <button
              className="ds-btn"
              disabled={busy}
              onClick={() => openPreview(detail)}
              aria-label="Vorschau"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <button
            className="ds-btn"
            disabled={busy}
            onClick={() => archive(detail)}
            aria-label="Archivieren"
          >
            <Archive className="w-4 h-4" />
          </button>
        </div>
        <pre className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap text-xs text-text-dim">
          {detail.body}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2 min-h-0">
      <select
        className="bg-bg text-text border border-line text-xs p-1 self-start"
        value={project}
        onChange={e => setProject(e.target.value)}
        aria-label="Projekt"
      >
        <option value="">Alle Projekte</option>
        {projects.map(p => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-2 @4xl:flex-1 @4xl:min-h-0">
        {COLUMNS.map(col => {
          const items = visible.filter(t => t.status === col.status);
          return (
            <div key={col.status} className="flex flex-col @4xl:min-h-0 min-w-0">
              <div className="text-text-dim text-xs mb-1">
                {col.label} ({items.length})
              </div>
              <div className="flex flex-col gap-1 @4xl:overflow-auto @4xl:min-h-0">
                {items.map(t => (
                  <button
                    key={t.file}
                    onClick={() => setSelected(t.file)}
                    className="text-left border border-line p-1 hover:border-accent"
                  >
                    <div className="text-xs text-text truncate">
                      {t.number} {t.title}
                    </div>
                    {t.project && <div className="text-xs text-accent truncate">{t.project}</div>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
