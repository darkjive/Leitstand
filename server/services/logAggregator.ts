import { spawn, ChildProcess } from 'child_process';
import { stat, realpath } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { homedir } from 'os';
import type { LogFile, LogLine, LogLevel, LogSuggestion } from '../../shared/types.js';

interface TailProcess {
  process: ChildProcess;
  buffer: LogLine[];
  file: LogFile;
}

const tailProcesses = new Map<string, TailProcess>();
const colors = [
  '#00c3ff', // cyan
  '#ff8700', // orange
  '#00ff87', // green
  '#ff00ff', // magenta
  '#ffff00', // yellow
  '#00ffff', // cyan bright
  '#ff0087', // pink
];

let colorIndex = 0;

export function detectLogLevel(line: string): LogLevel {
  // Whole words only — substring matching flags INTERRUPT/STDERR as errors
  if (/\b(ERROR|ERR|FATAL)\b/i.test(line)) return 'ERROR';
  if (/\bWARN(ING)?\b/i.test(line)) return 'WARN';
  if (/\bINFO\b/i.test(line)) return 'INFO';
  if (/\b(DEBUG|TRACE)\b/i.test(line)) return 'DEBUG';
  return 'UNKNOWN';
}

// Tailing is allowed under these roots. This must stay in sync with what
// getCommonLogSuggestions offers — suggesting a path the tailer rejects is a bug.
const ALLOWED_TAIL_ROOTS = [process.cwd(), '/var/log', homedir()];
// Credential stores under $HOME that must never be tail-able.
const BLOCKED_TAIL_PREFIXES = ['.ssh', '.gnupg', '.aws', '.kube', '.docker'].map(d =>
  join(homedir(), d)
);

// Resolves symlinks first: a link under ~/Dev pointing at ~/.ssh/id_rsa must be
// judged by its target. Throws ENOENT for missing files (callers treat that as failure).
async function assertTailablePath(userPath: string): Promise<string> {
  const resolved = await realpath(resolve(userPath));
  const roots = await Promise.all(ALLOWED_TAIL_ROOTS.map(r => realpath(r).catch(() => r)));
  const allowed = roots.some(root => resolved.startsWith(root + '/'));
  if (!allowed) {
    throw new Error(`Access denied — tailing is limited to ${ALLOWED_TAIL_ROOTS.join(', ')}`);
  }
  if (BLOCKED_TAIL_PREFIXES.some(p => resolved === p || resolved.startsWith(p + '/'))) {
    throw new Error('Access denied — path contains credentials');
  }
  // Env files anywhere (e.g. a project's .env holding DASHBOARD_TOKEN)
  if (/^\.env(\.|$)/.test(basename(resolved))) {
    throw new Error('Access denied — env files are not tailable');
  }
  // Block dotfiles/dotdirs directly under $HOME (credentials, shell history, tokens).
  // Logs under /var/log and the project dir stay allowed — only $HOME root is restrictive.
  const home = homedir();
  if (resolved.startsWith(home + '/')) {
    const rel = resolved.slice(home.length + 1);
    if (rel.startsWith('.')) {
      throw new Error('Access denied — dotfiles under $HOME are not tailable');
    }
  }
  return resolved;
}

export async function startTailing(file: LogFile): Promise<{ success: boolean; message: string }> {
  try {
    const resolvedPath = await assertTailablePath(file.path);

    const st = await stat(resolvedPath);
    if (!st.isFile()) {
      throw new Error(`Not a file: ${resolvedPath}`);
    }

    // Stop existing tail for this file
    if (tailProcesses.has(file.id)) {
      stopTailing(file.id);
    }

    // Start tail process
    const tailProcess = spawn('tail', ['-f', '-n', '50', resolvedPath], {
      shell: false,
    });

    const processData: TailProcess = {
      process: tailProcess,
      buffer: [],
      file,
    };

    tailProcesses.set(file.id, processData);

    // A chunk can end mid-line — keep the tail fragment for the next chunk
    let partial = '';
    tailProcess.stdout.on('data', (data: Buffer) => {
      const chunks = (partial + data.toString()).split('\n');
      partial = chunks.pop() ?? '';
      const lines = chunks.filter(line => line.trim());

      for (const line of lines) {
        const logLine: LogLine = {
          id: `${file.id}-${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          source: file.name,
          level: detectLogLevel(line),
          message: line,
          color: file.color,
        };

        processData.buffer.push(logLine);

        // Keep only last 500 lines per file
        if (processData.buffer.length > 500) {
          processData.buffer.shift();
        }
      }
    });

    tailProcess.stderr.on('data', (data: Buffer) => {
      console.error(`[LogAggregator] Tail error for ${file.name}:`, data.toString());
    });

    tailProcess.on('close', (code: number) => {
      console.log(`[LogAggregator] Tail process for ${file.name} exited with code ${code}`);
      // Only drop our own entry — after a restart the map holds the NEW process
      if (tailProcesses.get(file.id) === processData) tailProcesses.delete(file.id);
    });

    tailProcess.on('error', (error: Error) => {
      console.error(`[LogAggregator] Tail process error for ${file.name}:`, error);
      if (tailProcesses.get(file.id) === processData) tailProcesses.delete(file.id);
    });

    return { success: true, message: `Started tailing ${file.name}` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to start tailing',
    };
  }
}

export function stopTailing(fileId: string): { success: boolean; message: string } {
  const processData = tailProcesses.get(fileId);

  if (!processData) {
    return { success: false, message: 'Tail process not found' };
  }

  try {
    processData.process.kill('SIGTERM');
    tailProcesses.delete(fileId);
    return { success: true, message: 'Stopped tailing' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to stop tailing',
    };
  }
}

export function stopAllTailing(): void {
  for (const [fileId] of tailProcesses) {
    stopTailing(fileId);
  }
}

export function getLogLines(fileIds?: string[]): LogLine[] {
  const allLines: LogLine[] = [];

  for (const [fileId, processData] of tailProcesses) {
    if (!fileIds || fileIds.includes(fileId)) {
      allLines.push(...processData.buffer);
    }
  }

  // Sort by timestamp
  allLines.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return allLines;
}

export function getActiveTails(): LogFile[] {
  return Array.from(tailProcesses.values()).map(p => p.file);
}

export function assignColor(): string {
  const color = colors[colorIndex % colors.length];
  colorIndex++;
  return color;
}

export function clearLogs(fileId?: string): void {
  if (fileId) {
    const processData = tailProcesses.get(fileId);
    if (processData) {
      processData.buffer = [];
    }
  } else {
    // Clear all
    for (const processData of tailProcesses.values()) {
      processData.buffer = [];
    }
  }
}

// Curated, categorized suggestions for typical Linux/dev/AI-agent log files.
// `~` is expanded via os.homedir() so paths are concrete and directly tail-able.
// Only paths that exist, are regular files, AND pass the tail allowlist are
// returned — everything offered here is guaranteed to be tail-able.
export async function getCommonLogSuggestions(
  repoPath: string = process.cwd()
): Promise<LogSuggestion[]> {
  const candidates = logSuggestionCandidates(repoPath);
  const checks = await Promise.all(
    candidates.map(async s => {
      try {
        const real = await assertTailablePath(s.path);
        return (await stat(real)).isFile() ? s : null;
      } catch {
        return null;
      }
    })
  );
  return checks.filter((s): s is LogSuggestion => s !== null);
}

function logSuggestionCandidates(repoPath: string): LogSuggestion[] {
  return [
    // ---- System (Linux) ----
    { category: 'System', name: 'syslog', path: '/var/log/syslog' },
    { category: 'System', name: 'auth.log', path: '/var/log/auth.log' },
    { category: 'System', name: 'kern.log', path: '/var/log/kern.log' },
    { category: 'System', name: 'messages', path: '/var/log/messages' },
    { category: 'System', name: 'secure', path: '/var/log/secure' },
    { category: 'System', name: 'daemon.log', path: '/var/log/daemon.log' },
    { category: 'System', name: 'cron', path: '/var/log/cron' },
    { category: 'System', name: 'dmesg', path: '/var/log/dmesg' },
    // ---- Services ----
    { category: 'Services', name: 'nginx access', path: '/var/log/nginx/access.log' },
    { category: 'Services', name: 'nginx error', path: '/var/log/nginx/error.log' },
    { category: 'Services', name: 'apache access', path: '/var/log/apache2/access.log' },
    { category: 'Services', name: 'apache error', path: '/var/log/apache2/error.log' },
    { category: 'Services', name: 'docker', path: '/var/log/docker.log' },
    { category: 'Services', name: 'fail2ban', path: '/var/log/fail2ban.log' },
    // ---- Dev environment ----
    { category: 'Dev', name: 'app.log', path: join(repoPath, 'logs/app.log') },
    { category: 'Dev', name: 'error.log', path: join(repoPath, 'logs/error.log') },
    { category: 'Dev', name: 'frontend.log', path: join(repoPath, 'frontend.log') },
    { category: 'Dev', name: 'backend.log', path: join(repoPath, 'backend.log') },
  ];
}
