import { watch } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { mkdir, readdir, readFile, rename, stat, writeFile, open } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { MoiraStatus, MoiraTask } from '../../shared/types.js';

// Same files and format as Moira/src/moira/store.py, so TUI and widget stay interchangeable.
const TASK_DIR = process.env.MOIRA_DIR || join(homedir(), '.local/share/moira/tasks');
const ARCHIVE_DIR = join(TASK_DIR, 'archive');
const PROJECTS_DIR = join(homedir(), 'Dev');
const STATUSES: readonly MoiraStatus[] = ['todo', 'doing', 'review', 'done'];
const FILE_RE = /^\d{3}-[a-z0-9-]+\.md$/;

export function isTaskFile(name: string): boolean {
  return FILE_RE.test(name);
}

async function parseTask(file: string): Promise<MoiraTask> {
  const text = await readFile(join(TASK_DIR, file), 'utf-8');
  const meta: Record<string, string> = {};
  let body = text;
  if (text.startsWith('---\n') && text.slice(4).includes('\n---')) {
    const rest = text.slice(4);
    const end = rest.indexOf('\n---');
    body = rest.slice(end + 4).replace(/^\n+/, '');
    for (const line of rest.slice(0, end).split('\n')) {
      const i = line.indexOf(':');
      if (i >= 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const status = STATUSES.find(s => s === meta.status) ?? 'todo';
  return {
    file,
    number: file.split('-', 1)[0],
    title: meta.title || file.replace(/\.md$/, ''),
    status,
    project: meta.project ?? '',
    created: meta.created ?? '',
    body,
    preview: meta.preview ?? '',
    previewCmd: meta.preview_cmd ?? '',
  };
}

async function saveTask(task: MoiraTask): Promise<void> {
  let head = `title: ${task.title}\nstatus: ${task.status}\nproject: ${task.project}\ncreated: ${task.created}`;
  if (task.preview) head += `\npreview: ${task.preview}`;
  if (task.previewCmd) head += `\npreview_cmd: ${task.previewCmd}`;
  await writeFile(join(TASK_DIR, task.file), `---\n${head}\n---\n\n${task.body.trim()}\n`, 'utf-8');
}

let cache: { tasks: MoiraTask[]; etag: string } | null = null;
let watching = false;
let debounce: NodeJS.Timeout | undefined;

function startWatching() {
  if (watching) return;
  try {
    watch(TASK_DIR, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        cache = null;
      }, 200);
    });
    watching = true;
  } catch {
    // Directory missing: retry on next request, no cache invalidation until then.
  }
}

export async function listTasks(): Promise<{ tasks: MoiraTask[]; etag: string }> {
  if (cache) return cache;
  let names: string[] = [];
  try {
    names = (await readdir(TASK_DIR)).filter(isTaskFile);
  } catch {
    // no board yet
  }
  startWatching();
  const stamps = await Promise.all(
    names.map(async n => `${n}:${(await stat(join(TASK_DIR, n))).mtimeMs}`)
  );
  const tasks = (await Promise.all(names.map(parseTask))).sort(
    (a, b) => a.created.localeCompare(b.created) || a.file.localeCompare(b.file)
  );
  const etag = `"${createHash('sha1').update(stamps.join('|')).digest('hex')}"`;
  cache = { tasks, etag };
  return cache;
}

async function findTask(file: string): Promise<MoiraTask> {
  if (!isTaskFile(file)) throw new Error('Invalid task file');
  return parseTask(file);
}

export async function setStatus(file: string, status: MoiraStatus): Promise<void> {
  const task = await findTask(file);
  task.status = status;
  await saveTask(task);
  cache = null;
}

export async function archiveTask(file: string): Promise<void> {
  if (!isTaskFile(file)) throw new Error('Invalid task file');
  await mkdir(ARCHIVE_DIR, { recursive: true });
  await rename(join(TASK_DIR, file), join(ARCHIVE_DIR, file));
  cache = null;
}

// Mirrors Moira's reachable_url: loopback hosts are tried as 127.0.0.1, localhost and [::1].
async function reachableUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  const candidates = loopback.includes(parsed.hostname)
    ? ['127.0.0.1', 'localhost', '[::1]'].map(h => {
        const u = new URL(url);
        u.hostname = h;
        return u.toString();
      })
    : [url];
  for (const c of candidates) {
    try {
      await fetch(c, { signal: AbortSignal.timeout(1500) });
      return c;
    } catch {
      // try next
    }
  }
  return null;
}

/** Start the preview server if needed (not stopped again), return the reachable URL. */
export async function startPreview(file: string): Promise<string> {
  const task = await findTask(file);
  if (!task.preview) throw new Error('No preview set');
  let target = await reachableUrl(task.preview);
  if (target) return target;
  if (!task.previewCmd) throw new Error(`${task.preview} is not reachable`);

  const log = join(TASK_DIR, '..', `preview-${task.project || 'task'}.log`);
  const out = await open(log, 'w');
  const child = spawn(task.previewCmd, {
    shell: true,
    cwd: join(PROJECTS_DIR, task.project),
    detached: true,
    stdio: ['ignore', out.fd, out.fd],
  });
  child.unref();
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + 90_000;
  while (!(target = await reachableUrl(task.preview))) {
    if (exited) throw new Error(`Preview server exited, see ${log}`);
    if (Date.now() > deadline) throw new Error(`Preview server did not start, see ${log}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  await out.close();
  return target;
}
