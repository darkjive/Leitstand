import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, Clock, FileText, HardDriveDownload, Play, Square } from 'lucide-react';
import type {
  BackupOverview,
  BackupPreset,
  BackupState,
  BackupTierStatus,
} from '../../shared/types';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

const POLL_IDLE_MS = 15_000;
const POLL_RUNNING_MS = 2000;
const LOG_ERROR_RE = /❌|fehlgeschlagen|failed|error|rsync:/i;

const STATE_BADGE: Record<BackupState, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'good' },
  stale: { label: 'VERALTET', cls: 'warn' },
  failed: { label: 'FEHLER', cls: 'bad' },
  running: { label: 'LÄUFT', cls: 'info' },
  never: { label: 'NIE', cls: 'warn' },
};
const STATE_RANK: BackupState[] = ['failed', 'stale', 'never', 'running', 'ok'];

const PRESETS: { value: BackupPreset; label: string }[] = [
  { value: 'off', label: 'Aus' },
  { value: 'daily', label: 'Täglich, 03:00' },
  { value: 'weekly', label: 'Wöchentlich, So 03:30' },
  { value: 'monthly', label: 'Monatlich, am 1. um 04:00' },
];
const PRESET_SHORT: Record<BackupPreset, string> = {
  off: 'Kein Zeitplan',
  daily: 'Täglich',
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
};

const fmtAge = (days?: number) =>
  days === undefined ? 'noch nie' : days === 0 ? 'heute' : `vor ${days} d`;
const fmtDuration = (s?: number) => {
  if (s === undefined) return '';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};
const fmtDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const fmtGb = (b: number) => `${Math.round(b / 1e9)} GB`;
const diskName = (path: string) => path.split('/').pop() ?? path;

async function call(path: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await apiFetch(path, init);
    if (!res.ok) throw new Error((await res.json()).error ?? 'Request failed');
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Request failed');
    return false;
  }
}

function LogDialog({ tier, onClose }: { tier: BackupTierStatus; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [file, setFile] = useState(tier.history[0]?.file ?? '');
  const [lines, setLines] = useState<string[]>([]);
  const live = tier.state === 'running' && file === tier.history[0]?.file;

  useEffect(() => ref.current?.showModal(), []);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/backups/logs/${encodeURIComponent(file)}`);
        if (!res.ok) throw new Error();
        const data: { lines: string[] } = await res.json();
        if (!cancelled) setLines(data.lines);
      } catch {
        if (!cancelled) setLines(['Log konnte nicht geladen werden']);
      }
    };
    load();
    if (!live) return () => void (cancelled = true);
    const id = setInterval(load, POLL_RUNNING_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [file, live]);

  useEffect(() => {
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [lines]);

  return (
    <dialog
      ref={ref}
      className="ds-dialog"
      style={{ width: 'min(64rem, calc(100% - var(--space-6)))' }}
      onClose={onClose}
    >
      <div className="ds-dialog-body">
        <h3 className="ds-dialog-title">{tier.label} · Log</h3>
        {tier.history.length === 0 ? (
          <p className="ds-dialog-text">Noch keine Logs vorhanden.</p>
        ) : (
          <div className="flex flex-col @md:flex-row gap-3 min-h-0">
            <div className="flex flex-row md:flex-col gap-1 overflow-auto md:w-44 shrink-0">
              {tier.history.map(h => (
                <button
                  key={h.file}
                  type="button"
                  className={`ds-btn sm ${h.file === file ? 'active' : ''}`}
                  onClick={() => setFile(h.file)}
                >
                  <span className="flex-1 text-left">{fmtDate(h.started)}</span>
                  <span
                    className={`ds-badge ${h.ok === true ? 'good' : h.ok === false ? 'bad' : 'info'}`}
                  >
                    {h.ok === true ? 'OK' : h.ok === false ? 'FEHLER' : '…'}
                  </span>
                </button>
              ))}
            </div>
            <pre
              ref={preRef}
              className="flex-1 min-w-0 overflow-auto font-mono text-xs p-3 rounded-md bg-elevated"
              style={{ height: '50vh', margin: 0 }}
            >
              {lines.map((l, i) => (
                <div key={i} style={LOG_ERROR_RE.test(l) ? { color: 'var(--bad)' } : undefined}>
                  {l || ' '}
                </div>
              ))}
            </pre>
          </div>
        )}
        <div className="ds-dialog-actions">
          <button type="button" className="ds-btn" onClick={() => ref.current?.close()}>
            Schließen
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ConfirmDialog({
  tier,
  action,
  onClose,
  onDone,
}: {
  tier: BackupTierStatus;
  action: 'run' | 'stop';
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  const confirm = async () => {
    setBusy(true);
    const ok = await call(`/api/backups/${tier.id}/${action}`, { method: 'POST' });
    setBusy(false);
    if (ok) onDone();
    ref.current?.close();
  };

  return (
    <dialog ref={ref} className="ds-dialog" onClose={onClose}>
      <div className="ds-dialog-body">
        <h3 className="ds-dialog-title">
          {tier.label} {action === 'run' ? 'starten' : 'abbrechen'}?
        </h3>
        <p className="ds-dialog-text">
          {action === 'run'
            ? 'Das Backup spiegelt die Quellen mit Löschen (rsync --delete) auf die Zielplatten und kann lange dauern.'
            : 'Der laufende rsync wird beendet. Das Ziel bleibt in einem Zwischenzustand, bis der nächste Lauf fertig ist.'}
        </p>
        <div className="ds-dialog-actions">
          <button type="button" className="ds-btn" onClick={() => ref.current?.close()}>
            Zurück
          </button>
          <button
            type="button"
            className={`ds-btn ${action === 'run' ? 'primary' : 'danger'} ${busy ? 'busy' : ''}`}
            onClick={confirm}
          >
            {action === 'run' ? 'Starten' : 'Abbrechen'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ScheduleDialog({
  tier,
  onClose,
  onDone,
}: {
  tier: BackupTierStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState<BackupPreset>(tier.schedule.preset);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  const save = async () => {
    setBusy(true);
    const ok = await call(`/api/backups/${tier.id}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });
    setBusy(false);
    if (ok) onDone();
    ref.current?.close();
  };

  return (
    <dialog ref={ref} className="ds-dialog" onClose={onClose}>
      <div className="ds-dialog-body">
        <h3 className="ds-dialog-title">{tier.label} · Zeitplan</h3>
        <p className="ds-dialog-text">
          Verpasste Läufe (Rechner aus) werden beim nächsten Start nachgeholt.
        </p>
        <select
          className="ds-select"
          value={preset}
          onChange={e => setPreset(e.target.value as BackupPreset)}
        >
          {PRESETS.map(p => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="ds-dialog-actions">
          <button type="button" className="ds-btn" onClick={() => ref.current?.close()}>
            Abbrechen
          </button>
          <button type="button" className={`ds-btn primary ${busy ? 'busy' : ''}`} onClick={save}>
            Speichern
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function BackupWidget() {
  const [data, setData] = useState<BackupOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: 'run' | 'stop' } | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/backups');
      if (!res.ok) throw new Error('Failed to fetch backups');
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // The script writes its status file a moment after spawn; reload once more.
  const reloadSoon = useCallback(() => {
    load();
    setTimeout(load, 1000);
  }, [load]);

  const anyRunning = data?.tiers.some(t => t.state === 'running') ?? false;
  useEffect(() => {
    load();
    const id = setInterval(load, anyRunning ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [load, anyRunning]);

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent animate-pulse">Loading backups...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <AlertCircle className="w-12 h-12 mb-2" style={{ color: 'var(--bad)' }} />
        <div className="text-sm" style={{ color: 'var(--bad)' }}>
          {error || 'Failed to load backups'}
        </div>
        <button onClick={load} className="ds-btn mt-4">
          Retry
        </button>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <HardDriveDownload className="w-12 h-12 text-text-muted mb-2" />
        <div className="text-sm text-text-muted">Backup-Skripte nicht gefunden</div>
        <div className="text-xs text-text-muted mt-2">{data.scriptsDir}</div>
      </div>
    );
  }

  const worst = [...data.tiers].sort(
    (a, b) => STATE_RANK.indexOf(a.state) - STATE_RANK.indexOf(b.state)
  )[0];
  const oldest = data.tiers.reduce<number | undefined>(
    (max, t) => (t.ageDays === undefined ? max : Math.max(max ?? 0, t.ageDays)),
    undefined
  );
  const tierOf = (id: string | null) => data.tiers.find(t => t.id === id);
  const confirmTier = tierOf(confirm?.id ?? null);
  const logTier = tierOf(logId);
  const scheduleTier = tierOf(scheduleId);

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`ds-badge ${STATE_BADGE[worst.state].cls}`}>
          {STATE_BADGE[worst.state].label}
        </span>
        <span className="text-sm text-text-muted">
          {oldest === undefined ? 'Noch kein Backup gelaufen' : `Ältestes Backup ${fmtAge(oldest)}`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2">
        {data.tiers.map(t => {
          const badge = STATE_BADGE[t.state];
          const running = t.state === 'running';
          return (
            <div key={t.id} className="ds-item">
              <div className="ds-item-main">
                <div className="ds-item-title">{t.label}</div>
                <div className="ds-item-meta">
                  <span>{fmtAge(t.ageDays)}</span>
                  {t.lastRun?.durationS !== undefined && (
                    <span>{fmtDuration(t.lastRun.durationS)}</span>
                  )}
                  <span className="hidden @md:inline">
                    {PRESET_SHORT[t.schedule.preset]}
                    {t.schedule.nextRun && ` · nächster ${fmtDate(t.schedule.nextRun)}`}
                  </span>
                </div>
                <div className="hidden @md:flex flex-wrap items-center gap-2">
                  {t.targets.map(tg => {
                    const used =
                      tg.totalBytes && tg.freeBytes !== undefined
                        ? 1 - tg.freeBytes / tg.totalBytes
                        : undefined;
                    return (
                      <span key={tg.path} className="flex items-center gap-2 text-xs">
                        <span
                          className="ds-chip"
                          style={
                            {
                              '--c': tg.mounted ? 'var(--good)' : 'var(--bad)',
                            } as React.CSSProperties
                          }
                        >
                          {diskName(tg.path)}
                          {!tg.mounted && ' fehlt'}
                        </span>
                        {used !== undefined && (
                          <span className="flex items-center gap-1">
                            <span
                              className={`ds-progress ${used > 0.9 ? 'over' : ''}`}
                              style={{ '--v': used, width: '4rem' } as React.CSSProperties}
                            >
                              <span />
                            </span>
                            <span className="text-text-muted">{fmtGb(tg.freeBytes!)} frei</span>
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="ds-item-end">
                <span className={`ds-badge ${badge.cls}`}>{badge.label}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="ds-btn sm icon"
                    title={running ? 'Abbrechen' : 'Starten'}
                    onClick={() => setConfirm({ id: t.id, action: running ? 'stop' : 'run' })}
                  >
                    {running ? <Square /> : <Play />}
                  </button>
                  <button
                    type="button"
                    className="ds-btn sm icon"
                    title="Log"
                    onClick={() => setLogId(t.id)}
                  >
                    <FileText />
                  </button>
                  <button
                    type="button"
                    className="ds-btn sm icon"
                    title="Zeitplan"
                    onClick={() => setScheduleId(t.id)}
                  >
                    <Clock />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {confirm && confirmTier && (
        <ConfirmDialog
          tier={confirmTier}
          action={confirm.action}
          onClose={() => setConfirm(null)}
          onDone={reloadSoon}
        />
      )}
      {logTier && <LogDialog tier={logTier} onClose={() => setLogId(null)} />}
      {scheduleTier && (
        <ScheduleDialog
          tier={scheduleTier}
          onClose={() => setScheduleId(null)}
          onDone={reloadSoon}
        />
      )}
    </div>
  );
}
