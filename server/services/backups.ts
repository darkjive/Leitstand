import { spawn, execFile } from 'child_process';
import { mkdir, readdir, readFile, rm, stat, statfs, writeFile, open } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type {
  BackupOverview,
  BackupPreset,
  BackupState,
  BackupTarget,
  BackupTierStatus,
} from '../../shared/types.js';

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = process.env.BACKUP_SCRIPTS_DIR || join(homedir(), 'Dev/_scripts');
const STATE_DIR = process.env.BACKUP_STATE_DIR || join(homedir(), '.local/state/backup-scripts');
const LOG_DIR = join(SCRIPTS_DIR, 'backup-logs');
const RUN_TIER = join(SCRIPTS_DIR, 'backup-scripts/run-tier.sh');
const DROPIN_ROOT = join(homedir(), '.config/systemd/user');
const MEDIA = '/run/media/a';
const LOG_RE = /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.log$/;
const DAY_MS = 86_400_000;
const CACHE_DURATION = 5000;

const TIERS = [
  {
    id: 'tier0',
    label: 'Tier 0 · Home',
    logPrefix: 'tier0-home-',
    maxAgeDays: 14,
    targets: [`${MEDIA}/data`],
  },
  {
    id: 'tier1',
    label: 'Tier 1 · Wichtige Daten',
    logPrefix: 'tier1-',
    maxAgeDays: 7,
    targets: [`${MEDIA}/WD_BLACK`, `${MEDIA}/Elements`],
  },
  {
    id: 'tier2',
    label: 'Tier 2 · Design + Dev',
    logPrefix: 'tier2-',
    maxAgeDays: 14,
    targets: [`${MEDIA}/WD_BLACK`],
  },
  {
    id: 'tier3',
    label: 'Tier 3 · Windows',
    logPrefix: 'tier3-',
    maxAgeDays: 30,
    targets: [`${MEDIA}/WD_BLACK`, `${MEDIA}/system`],
  },
] as const;

type TierDef = (typeof TIERS)[number];

// Fixed whitelist: the UI never passes free text into the systemd drop-in.
const SCHEDULES: Record<Exclude<BackupPreset, 'off'>, string> = {
  daily: '*-*-* 03:00',
  weekly: 'Sun 03:30',
  monthly: '*-*-01 04:00',
};

export class BackupError extends Error {
  status: 400 | 409 | 500;
  constructor(message: string, status: 400 | 409 | 500) {
    super(message);
    this.status = status;
  }
}

function findTier(id: string): TierDef {
  const tier = TIERS.find(t => t.id === id);
  if (!tier) throw new BackupError('Unknown tier', 400);
  return tier;
}

interface StateFile {
  state: 'running' | 'ok' | 'failed';
  pid?: number;
  started: string;
  finished?: string;
  duration_s?: number;
  exit?: number;
  errors?: number;
  log?: string;
}

async function readState(id: string): Promise<StateFile | null> {
  try {
    return JSON.parse(await readFile(join(STATE_DIR, `${id}.json`), 'utf8')) as StateFile;
  } catch {
    return null;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** "tier1-2026-08-29_12-30.log" → ISO-like local timestamp. */
function logStarted(file: string): string {
  const m = file.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.log$/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:00` : '';
}

async function tailOf(path: string, bytes: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

/** Rough verdict from a log's last lines (history entries and runs before status files existed). */
async function logVerdict(file: string): Promise<boolean | null> {
  try {
    const tail = await tailOf(join(LOG_DIR, file), 4096);
    if (/Alle Backups erfolgreich|Backup (erfolgreich|abgeschlossen)|✅ (Home|Windows)/.test(tail))
      return true;
    if (/Fehler aufgetreten|fehlgeschlagen|nicht gemountet|nicht verfügbar/.test(tail))
      return false;
    return null;
  } catch {
    return null;
  }
}

async function logFiles(prefix: string): Promise<string[]> {
  try {
    const names = await readdir(LOG_DIR);
    return names
      .filter(n => LOG_RE.test(n) && n.startsWith(prefix) && /^\d{4}-/.test(n.slice(prefix.length)))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function targetInfo(path: string): Promise<BackupTarget> {
  let mounted = false;
  try {
    await execFileAsync('mountpoint', ['-q', path]);
    mounted = true;
  } catch {
    /* not a mountpoint */
  }
  if (!mounted) return { path, mounted };
  try {
    const s = await statfs(path);
    return { path, mounted, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { path, mounted };
  }
}

function dropInPath(id: string): string {
  return join(DROPIN_ROOT, `backup@${id}.timer.d/schedule.conf`);
}

async function readSchedule(id: string): Promise<BackupTierStatus['schedule']> {
  let preset: BackupPreset = 'off';
  try {
    const conf = await readFile(dropInPath(id), 'utf8');
    const cal = conf.match(/^OnCalendar=(.+)$/m)?.[1]?.trim();
    preset = (Object.entries(SCHEDULES).find(([, v]) => v === cal)?.[0] as BackupPreset) ?? 'off';
  } catch {
    /* no drop-in → off */
  }
  const schedule: BackupTierStatus['schedule'] = { preset };
  if (preset === 'off') return schedule;
  try {
    const { stdout } = await execFileAsync('systemctl', [
      '--user',
      'show',
      `backup@${id}.timer`,
      '-p',
      'NextElapseUSecRealtime',
      '-p',
      'LastTriggerUSec',
    ]);
    for (const line of stdout.split('\n')) {
      const [k, ...rest] = line.split('=');
      const v = rest.join('=').trim();
      if (!v || v === 'n/a') continue;
      const date = new Date(v.replace(/^\w{3} /, '').replace(/ [A-Z]{3,5}$/, ''));
      if (isNaN(date.getTime())) continue;
      if (k === 'NextElapseUSecRealtime') schedule.nextRun = date.toISOString();
      if (k === 'LastTriggerUSec') schedule.lastTrigger = date.toISOString();
    }
  } catch {
    /* systemd unavailable → schedule without times */
  }
  return schedule;
}

async function buildTier(def: TierDef): Promise<BackupTierStatus> {
  const [saved, files, targets, schedule] = await Promise.all([
    readState(def.id),
    logFiles(def.logPrefix),
    Promise.all(def.targets.map(targetInfo)),
    readSchedule(def.id),
  ]);

  let run = saved;
  let state: BackupState = 'never';
  if (run) {
    state = run.state;
    // A killed run (reboot, SIGKILL) never reaches the EXIT trap.
    if (run.state === 'running' && !pidAlive(run.pid)) state = 'failed';
  } else if (files[0]) {
    // Only for runs from before status files existed; drop once every tier has a JSON.
    const ok = await logVerdict(files[0]);
    state = ok === false ? 'failed' : 'ok';
    run = {
      state: state === 'failed' ? 'failed' : 'ok',
      started: logStarted(files[0]),
      log: join(LOG_DIR, files[0]),
    };
  }

  let ageDays: number | undefined;
  if (run) {
    const ref = Date.parse(run.finished ?? run.started);
    if (!isNaN(ref)) ageDays = Math.floor((Date.now() - ref) / DAY_MS);
  }
  if (state === 'ok' && ageDays !== undefined && ageDays > def.maxAgeDays) state = 'stale';

  const history = await Promise.all(
    files.slice(0, 10).map(async file => ({
      file,
      started: logStarted(file),
      ok: await logVerdict(file),
    }))
  );
  // The newest log belongs to the live run: the end marker is not there yet.
  if (state === 'running' && history[0]) history[0].ok = null;

  return {
    id: def.id,
    label: def.label,
    state,
    lastRun: run
      ? {
          started: run.started,
          finished: run.finished,
          durationS: run.duration_s,
          exit: run.exit,
          errors: run.errors,
          log: run.log,
        }
      : undefined,
    ageDays,
    maxAgeDays: def.maxAgeDays,
    targets,
    schedule,
    history,
  };
}

let lastFetch: { data: BackupOverview; timestamp: number } | null = null;
let fetchPromise: Promise<BackupOverview> | null = null;

export async function getBackupOverview(): Promise<BackupOverview> {
  if (lastFetch && Date.now() - lastFetch.timestamp < CACHE_DURATION) return lastFetch.data;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const available = await stat(RUN_TIER).then(
        () => true,
        () => false
      );
      const tiers = await Promise.all(TIERS.map(buildTier));
      const data: BackupOverview = { tiers, scriptsDir: SCRIPTS_DIR, available };
      lastFetch = { data, timestamp: Date.now() };
      return data;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

function invalidate() {
  lastFetch = null;
}

export async function startBackup(id: string): Promise<void> {
  findTier(id);
  const saved = await readState(id);
  if (saved?.state === 'running' && pidAlive(saved.pid)) {
    throw new BackupError('Backup is already running', 409);
  }
  const child = spawn('bash', [RUN_TIER, id], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
  invalidate();
}

export async function stopBackup(id: string): Promise<void> {
  findTier(id);
  const saved = await readState(id);
  if (saved?.state !== 'running' || !pidAlive(saved.pid)) {
    throw new BackupError('Backup is not running', 409);
  }
  try {
    process.kill(-saved.pid!, 'SIGTERM');
  } catch {
    process.kill(saved.pid!, 'SIGTERM');
  }
  invalidate();
}

async function systemctl(...args: string[]): Promise<void> {
  await execFileAsync('systemctl', ['--user', ...args]);
}

export async function setSchedule(id: string, preset: BackupPreset): Promise<void> {
  findTier(id);
  if (preset !== 'off' && !(preset in SCHEDULES)) throw new BackupError('Invalid preset', 400);
  try {
    await systemctl('cat', `backup@${id}.timer`);
  } catch {
    throw new BackupError('Timer units missing, run _scripts/systemd/install.sh', 500);
  }
  if (preset === 'off') {
    await systemctl('disable', '--now', `backup@${id}.timer`).catch(() => undefined);
    await rm(join(DROPIN_ROOT, `backup@${id}.timer.d`), { recursive: true, force: true });
  } else {
    await mkdir(join(DROPIN_ROOT, `backup@${id}.timer.d`), { recursive: true });
    await writeFile(dropInPath(id), `[Timer]\nOnCalendar=\nOnCalendar=${SCHEDULES[preset]}\n`);
    await systemctl('daemon-reload');
    await systemctl('enable', `backup@${id}.timer`);
    await systemctl('restart', `backup@${id}.timer`);
  }
  await systemctl('daemon-reload');
  invalidate();
}

export async function readBackupLog(file: string, lines = 400): Promise<string[]> {
  if (!LOG_RE.test(file)) throw new BackupError('Invalid log file', 400);
  let text: string;
  try {
    text = await tailOf(join(LOG_DIR, file), 256 * 1024);
  } catch {
    throw new BackupError('Log not found', 400);
  }
  // rsync progress2 rewrites the line with \r: only the last segment is current.
  return text
    .split('\n')
    .map(l => l.slice(l.lastIndexOf('\r') + 1))
    .slice(-lines);
}
