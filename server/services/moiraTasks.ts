import { watch } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { mkdir, readdir, readFile, rename, stat, writeFile, open } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import type { MoiraActivity, MoiraStatus, MoiraTask } from '../../shared/types.js';

// Same files and format as Moira/src/moira/store.py, so TUI and widget stay interchangeable.
const TASK_DIR = process.env.MOIRA_DIR || join(homedir(), '.local/share/moira/tasks');
const ARCHIVE_DIR = join(TASK_DIR, 'archive');
const ACTIVITY_DIR = join(TASK_DIR, '..', 'activity');
const PROJECTS_DIR = join(homedir(), 'Dev');
const STATUSES: readonly MoiraStatus[] = ['todo', 'doing', 'review', 'done'];
const FILE_RE = /^\d{3}-[a-z0-9-]+\.md$/;

function isTaskFile(name: string): boolean {
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
    idea: status === 'todo' && !/^## Plan\b/m.test(body),
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

const SLUG_MAP: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[äöüß]/g, c => SLUG_MAP[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug || 'aufgabe';
}

/** Create a task file with the next free number (tasks/ and archive/ together), like the TUI. */
export async function createTask(input: {
  title: string;
  project: string;
  body: string;
}): Promise<MoiraTask> {
  await mkdir(TASK_DIR, { recursive: true });
  const names = [
    ...(await readdir(TASK_DIR)),
    ...(await readdir(ARCHIVE_DIR).catch(() => [] as string[])),
  ].filter(isTaskFile);
  const next = Math.max(0, ...names.map(n => Number(n.slice(0, 3)))) + 1;
  const file = `${String(next).padStart(3, '0')}-${slugify(input.title)}.md`;
  const task: MoiraTask = {
    file,
    number: file.split('-', 1)[0],
    title: input.title,
    status: 'todo',
    project: input.project,
    created: new Date().toLocaleDateString('sv-SE'),
    body: input.body,
    idea: true,
    preview: '',
    previewCmd: '',
  };
  await saveTask(task);
  cache = null;
  return task;
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

/**
 * Live state of Claude sessions, written per session by ~/.claude/hooks/moira-activity.sh.
 * A session belongs to the task named in its `/moira NNN` prompt; otherwise to the `doing`
 * task of the project it runs in, or to the only `doing` task.
 */
export async function listActivity(): Promise<MoiraActivity[]> {
  let names: string[] = [];
  try {
    names = (await readdir(ACTIVITY_DIR)).filter(n => n.endsWith('.json'));
  } catch {
    return [];
  }
  const doing = (await listTasks()).tasks.filter(t => t.status === 'doing');
  const now = Date.now() / 1000;
  const result: MoiraActivity[] = [];
  for (const name of names) {
    try {
      const a = JSON.parse(await readFile(join(ACTIVITY_DIR, name), 'utf-8'));
      const inProject = doing.filter(t => t.project && t.project === basename(String(a.cwd ?? '')));
      const number =
        a.task ||
        (inProject.length === 1 ? inProject[0].number : doing.length === 1 ? doing[0].number : '');
      if (!number) continue;
      result.push({
        number,
        state: a.state === 'working' ? 'working' : 'idle',
        summary: String(a.summary ?? ''),
        age: Math.max(0, Math.round(now - Number(a.ts))),
      });
    } catch {
      // half-written or foreign file: skip
    }
  }
  return result;
}
