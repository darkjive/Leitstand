import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Archive, ExternalLink, Inbox, Plus, X } from 'lucide-react';
import type { MoiraStatus, MoiraTask } from '../../shared/types';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';
import { useSettingJSON } from '../lib/settings';

const COLUMNS: { status: MoiraStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'Offen', color: 'var(--sig-grey)' },
  { status: 'doing', label: 'In Arbeit', color: 'var(--sig-blue)' },
  { status: 'review', label: 'Review', color: 'var(--sig-yellow)' },
  { status: 'done', label: 'Erledigt', color: 'var(--sig-green)' },
];
const POLL_MS = 3000;
const CATEGORY_COLORS = 10;

// Stable colour per project name from the design-system category palette.
const projectColor = (name: string) => {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % CATEGORY_COLORS;
  return `var(--cat-${hash + 1})`;
};

function NewTaskDialog({
  projects,
  onClose,
  onCreated,
}: {
  projects: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/moira/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, project, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Request failed');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="ds-dialog" onClose={onClose}>
      <form className="ds-dialog-body" onSubmit={submit}>
        <h3 className="ds-dialog-title">Neue Idee</h3>
        <p className="ds-dialog-text">
          Roh festhalten genügt. Claude formuliert die Idee sauber und plant sie mit /moira-new.
        </p>
        <label className="flex flex-col gap-1">
          <span className="ds-label">Titel</span>
          <input
            className="ds-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">Projekt</span>
          <input
            className="ds-input"
            list="moira-projects"
            value={project}
            onChange={e => setProject(e.target.value)}
            maxLength={100}
          />
          <datalist id="moira-projects">
            {projects.map(p => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">Idee</span>
          <textarea
            className="ds-input"
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={20000}
          />
        </label>
        <p className="ds-dialog-error">{error}</p>
        <div className="ds-dialog-actions">
          <button type="button" className="ds-btn" onClick={() => ref.current?.close()}>
            Abbrechen
          </button>
          <button type="submit" className={`ds-btn primary ${saving ? 'busy' : ''}`}>
            Festhalten
          </button>
        </div>
      </form>
    </dialog>
  );
}

// Plan steps are `- [ ]` / `- [x]` lines under `## Plan`; Claude ticks them off while implementing.
const planProgress = (body: string) => {
  const plan = body.split(/^## Plan\b.*$/m)[1]?.split(/^## /m)[0] ?? '';
  const boxes = plan.match(/^\s*- \[[ xX]\]/gm) ?? [];
  const done = boxes.filter(b => !b.endsWith('[ ]')).length;
  return { done, total: boxes.length };
};

const PlanProgress = ({ body, color }: { body: string; color: string }) => {
  const { done, total } = planProgress(body);
  if (total === 0) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-text-muted">
      <span
        className="ds-progress flex-1"
        style={{ '--v': done / total, '--c': color } as React.CSSProperties}
      >
        <span />
      </span>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
};

const ProjectChip = ({ name }: { name: string }) => (
  <span className="ds-chip" style={{ '--c': projectColor(name) } as React.CSSProperties}>
    {name}
  </span>
);

export function MoiraBoard() {
  const [tasks, setTasks] = useState<MoiraTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hidden, setHidden] = useSettingJSON<MoiraStatus[]>('moira-hidden-columns', []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<MoiraStatus | null>(null);
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

  const drop = async (status: MoiraStatus) => {
    const task = tasks.find(t => t.file === dragging);
    setDragging(null);
    setDropTarget(null);
    if (!task || task.status === status) return;
    setTasks(prev => prev.map(t => (t.file === task.file ? { ...t, status } : t)));
    if (await post(task.file, 'status', { status })) etag.current = '';
    await load();
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
  const shownColumns = COLUMNS.filter(c => !hidden.includes(c.status));
  const detail = tasks.find(t => t.file === selected);

  if (error && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
    );
  }

  if (detail) {
    const index = COLUMNS.findIndex(c => c.status === detail.status);
    const col = COLUMNS[index];
    return (
      <div className="flex flex-col h-full gap-3 min-h-0">
        <div className="flex items-start gap-2">
          <button className="ds-btn sm icon" onClick={() => setSelected(null)} aria-label="Zurück">
            <X />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-text">{detail.title}</div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-text-muted">
              <span className="ds-chip" style={{ '--c': col.color } as React.CSSProperties}>
                {col.label}
              </span>
              {detail.idea && <span className="ds-badge warn">Idee</span>}
              {detail.project && <ProjectChip name={detail.project} />}
              <span>
                {detail.number} · {detail.created}
              </span>
            </div>
          </div>
          <button
            className="ds-btn sm icon"
            disabled={busy || index === 0}
            onClick={() => move(detail, -1)}
            aria-label="Status zurück"
          >
            <ArrowLeft />
          </button>
          <button
            className="ds-btn sm icon"
            disabled={busy || index === COLUMNS.length - 1}
            onClick={() => move(detail, 1)}
            aria-label="Status vor"
          >
            <ArrowRight />
          </button>
          {detail.preview && (
            <button
              className="ds-btn sm icon"
              disabled={busy}
              onClick={() => openPreview(detail)}
              aria-label="Vorschau"
            >
              <ExternalLink />
            </button>
          )}
          <button
            className="ds-btn sm icon"
            disabled={busy}
            onClick={() => archive(detail)}
            aria-label="Archivieren"
          >
            <Archive />
          </button>
        </div>
        <PlanProgress body={detail.body} color={col.color} />
        <pre className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap text-sm text-text-dim bg-elevated border border-line rounded-lg p-3">
          {detail.body}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-center gap-2">
        <select
          className="ds-select"
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
        <span className="text-xs text-text-muted">{visible.length} Aufgaben</span>
        <div className="flex items-center gap-1 ml-2" role="group" aria-label="Spalten">
          {COLUMNS.map(col => {
            const shown = !hidden.includes(col.status);
            return (
              <button
                key={col.status}
                aria-pressed={shown}
                onClick={() =>
                  setHidden(shown ? [...hidden, col.status] : hidden.filter(s => s !== col.status))
                }
                className={`ds-chip cursor-pointer ${shown ? '' : 'empty'}`}
                style={{ '--c': shown ? col.color : undefined } as React.CSSProperties}
              >
                {col.label}
              </button>
            );
          })}
        </div>
        <button className="ds-btn sm primary ml-auto" onClick={() => setCreating(true)}>
          <Plus />
          Idee
        </button>
      </div>
      <div
        className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-(--cols) gap-3 @4xl:flex-1 @4xl:min-h-0"
        style={
          { '--cols': `repeat(${shownColumns.length || 1}, minmax(0, 1fr))` } as React.CSSProperties
        }
      >
        {shownColumns.map(col => {
          const items = visible.filter(t => t.status === col.status);
          const isTarget = dropTarget === col.status;
          return (
            <div
              key={col.status}
              onDragOver={e => {
                e.preventDefault();
                setDropTarget(col.status);
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
              }}
              onDrop={e => {
                e.preventDefault();
                drop(col.status);
              }}
              className={`flex flex-col gap-2 p-2 min-w-0 rounded-lg border bg-bg-sidebar transition-colors @4xl:min-h-0 ${
                isTarget ? 'border-accent bg-hover' : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2 px-1 py-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: col.color }}
                  aria-hidden="true"
                />
                <span className="text-sm font-semibold text-text">{col.label}</span>
                <span className="ds-badge">{items.length}</span>
              </div>
              <div className="flex flex-col gap-2 @4xl:overflow-auto @4xl:min-h-0">
                {items.map(t => (
                  <button
                    key={t.file}
                    draggable
                    onDragStart={() => setDragging(t.file)}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    onClick={() => setSelected(t.file)}
                    className={`flex flex-col gap-2 p-3 text-left rounded-md border border-line bg-elevated shadow-sm cursor-grab transition hover:border-line-strong hover:shadow-md active:cursor-grabbing ${
                      dragging === t.file ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <span className="flex-1 text-sm font-medium text-text line-clamp-2">
                        {t.title}
                      </span>
                      {t.idea && <span className="ds-badge warn">Idee</span>}
                    </span>
                    {t.status !== 'done' && <PlanProgress body={t.body} color={col.color} />}
                    <span className="flex items-center gap-2 min-w-0 text-xs text-text-muted">
                      {t.project && <ProjectChip name={t.project} />}
                      <span className="ml-auto whitespace-nowrap">
                        {t.number} · {t.created}
                      </span>
                    </span>
                  </button>
                ))}
                {col.status === 'todo' && (
                  <button
                    className="ds-btn sm ghost justify-start text-text-muted"
                    onClick={() => setCreating(true)}
                  >
                    <Plus />
                    Idee hinzufügen
                  </button>
                )}
                {items.length === 0 && (
                  <div className="flex flex-col items-center gap-1 py-6 text-xs text-text-muted border border-dashed border-line rounded-md">
                    <Inbox className="w-5 h-5" />
                    Keine Aufgaben
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {creating && (
        <NewTaskDialog
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            etag.current = '';
            load();
          }}
        />
      )}
    </div>
  );
}
