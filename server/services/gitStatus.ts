import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir, stat, access } from 'fs/promises';
import { join, basename } from 'path';
import type { GitStatus, GitCommit, RepoSummary, BulkResultItem } from '../../shared/types.js';

const execAsync = promisify(exec);

// Network operations must never block on a credential prompt (no TTY here) or hang
// forever on a dead remote.
const NET_OPTS = {
  timeout: 120_000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
};

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false
  );

/** Run `fn` over `items` with at most `limit` in flight (bulk ops must not fork 200 gits at once). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
const BULK_CONCURRENCY = 4;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.npm',
  '.pnpm-store',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.idea',
  '.vscode',
  'coverage',
  '.mypy_cache',
  '.pytest_cache',
  'vendor',
  'bower_components',
]);

export async function getGitStatus(repoPath: string = process.cwd()): Promise<GitStatus> {
  // Check if it's a git repo (also true for subfolders of one — a bare .git lookup is not)
  const isRepo = await execAsync('git rev-parse --is-inside-work-tree', { cwd: repoPath }).then(
    r => r.stdout.trim() === 'true',
    () => false
  );
  if (!isRepo) {
    return {
      isRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      recentCommits: [],
      hasChanges: false,
    };
  }

  try {
    // Get current branch
    const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
    });
    const branch = branchOutput.trim();

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: upstreamOutput } = await execAsync(
        'git rev-list --left-right --count @{upstream}...HEAD',
        { cwd: repoPath }
      );
      const [behindStr, aheadStr] = upstreamOutput.trim().split('\t');
      behind = parseInt(behindStr) || 0;
      ahead = parseInt(aheadStr) || 0;
    } catch {
      // No upstream or other error
    }

    // Get status (staged, unstaged, untracked)
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath });
    const lines = statusOutput.split('\n').filter(line => line.trim());

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      // X          Y     Meaning
      // -------------------------------------------------
      //           [AMD]   not updated
      // M        [ MTD]  updated in index
      // A        [ MTD]  added to index
      // D                deleted from index
      // R        [ MTD]  renamed in index
      // C        [ MTD]  copied in index
      // [MTARC]          index and work tree matches
      // [ MTARC]    M    work tree changed since index
      // [ MTARC]    D    deleted in work tree
      // [ D]        R    renamed in work tree
      // [ D]        C    copied in work tree
      // -------------------------------------------------
      // D           D    unmerged, both deleted
      // A           U    unmerged, added by us
      // U           D    unmerged, deleted by them
      // U           A    unmerged, added by them
      // D           U    unmerged, deleted by us
      // A           A    unmerged, both added
      // U           U    unmerged, both modified
      // -------------------------------------------------
      // ?           ?    untracked
      // !           !    ignored

      if (status === '??') {
        untracked.push(file);
      } else {
        // "MM" = staged AND modified again in the work tree → belongs in both lists
        if (status[0] !== ' ' && status[0] !== '?') staged.push(file);
        if (status[1] !== ' ' && status[1] !== '?') unstaged.push(file);
      }
    }

    // Get recent commits (last 5)
    const { stdout: logOutput } = await execAsync(
      "git log -5 --pretty=format:'%H%x1f%an%x1f%ar%x1f%s'",
      {
        cwd: repoPath,
      }
    );

    const recentCommits: GitCommit[] = logOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // \x1f separator: commit subjects may contain '|'
        const [hash, author, date, message] = line.split('\x1f');
        return {
          hash: hash.substring(0, 7),
          author,
          date,
          message,
        };
      });

    const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

    return {
      isRepo: true,
      branch,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      recentCommits,
      hasChanges,
    };
  } catch (error) {
    console.error('[GitStatus] Failed to get git status:', error);
    throw error;
  }
}

export async function gitPull(
  repoPath: string = process.cwd()
): Promise<{ success: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execAsync('git pull', { cwd: repoPath, ...NET_OPTS });
    return {
      success: true,
      message: stdout || stderr || 'Pulled successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to pull',
    };
  }
}

export async function gitPush(
  repoPath: string = process.cwd()
): Promise<{ success: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execAsync('git push', { cwd: repoPath, ...NET_OPTS });
    return {
      success: true,
      message: stdout || stderr || 'Pushed successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to push',
    };
  }
}

// ============================================================
// Multi-Repo Overview
// ============================================================

/**
 * Find git repos recursively under `dir` up to `maxDepth` levels.
 * Stops descending into a directory once it is identified as a git repo.
 * Skips common heavy/irrelevant folders.
 */
async function findGitRepos(dir: string, maxDepth: number, found: string[]): Promise<void> {
  if (maxDepth < 0) return;

  if (await exists(join(dir, '.git'))) {
    found.push(dir);
    return; // do not descend into a repo's own subfolders
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    try {
      if ((await stat(full)).isDirectory()) {
        await findGitRepos(full, maxDepth - 1, found);
      }
    } catch {
      continue;
    }
  }
}

/**
 * Lightweight status for a single repo, suitable for list display.
 */
export async function getRepoSummary(repoPath: string, root: string): Promise<RepoSummary> {
  const name = basename(repoPath);
  const base: RepoSummary = {
    path: repoPath,
    name,
    root,
    branch: '',
    state: 'error',
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    hasUpstream: false,
  };

  try {
    const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
    });
    base.branch = branchOutput.trim();

    // ahead/behind
    let hasUpstream = true;
    try {
      const { stdout: upstreamOutput } = await execAsync(
        'git rev-list --left-right --count @{upstream}...HEAD',
        { cwd: repoPath }
      );
      const [behindStr, aheadStr] = upstreamOutput.trim().split('\t');
      base.behind = parseInt(behindStr) || 0;
      base.ahead = parseInt(aheadStr) || 0;
    } catch {
      hasUpstream = false;
    }
    base.hasUpstream = hasUpstream;

    // porcelain status
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath });
    const lines = statusOutput.split('\n').filter(l => l.trim());

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    let conflict = 0;

    for (const line of lines) {
      const s = line.substring(0, 2);
      if (s === '??') {
        untracked++;
      } else if (
        s[0] === 'U' ||
        s[1] === 'U' ||
        (s[0] === 'D' && s[1] === 'D') ||
        (s[0] === 'A' && s[1] === 'A')
      ) {
        conflict++;
      } else {
        if (s[0] !== ' ' && s[0] !== '?') staged++;
        if (s[1] !== ' ' && s[1] !== '?') unstaged++;
      }
    }

    base.stagedCount = staged;
    base.unstagedCount = unstaged;
    base.untrackedCount = untracked;
    base.changedFiles = staged + unstaged + untracked;

    // last commit
    try {
      const { stdout: logOutput } = await execAsync('git log -1 --pretty=format:"%h|%an|%ar|%s"', {
        cwd: repoPath,
      });
      const [hash, author, date, ...msgParts] = logOutput.split('|');
      base.lastCommit = {
        hash,
        author,
        date,
        message: msgParts.join('|'),
      };
    } catch {
      // no commits yet
    }

    // determine state
    if (conflict > 0) {
      base.state = 'conflict';
    } else if (!hasUpstream) {
      base.state = base.changedFiles > 0 ? 'dirty' : 'no-upstream';
    } else if (base.ahead > 0 && base.behind > 0) {
      base.state = 'diverged';
    } else if (base.ahead > 0) {
      base.state = 'ahead';
    } else if (base.behind > 0) {
      base.state = 'behind';
    } else if (base.changedFiles > 0) {
      base.state = 'dirty';
    } else {
      base.state = 'clean';
    }
  } catch (error) {
    base.state = 'error';
    base.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return base;
}

/**
 * Scan one or more root directories for git repos and return a summary per repo.
 * Runs with a small concurrency pool to avoid spawning too many git processes at once.
 */
export async function scanGitRepos(roots: string[], maxDepth = 3): Promise<RepoSummary[]> {
  const repoPaths: string[] = [];
  for (const root of roots) {
    let st;
    try {
      st = await stat(root);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    await findGitRepos(root, maxDepth, repoPaths);
  }

  // Deduplicate (same path reached via multiple roots)
  const unique = [...new Set(repoPaths)];

  // Concurrency-limited parallel status fetch
  const CONCURRENCY = 8;
  const results: RepoSummary[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const p = unique[idx];
      // Pick the root this repo lives under (longest matching prefix wins via sort)
      const root = roots
        .filter(r => p === r || p.startsWith(r + '/'))
        .sort((a, b) => b.length - a.length)[0];
      try {
        results.push(await getRepoSummary(p, root));
      } catch (error) {
        results.push({
          path: p,
          name: basename(p),
          root: root ?? '',
          branch: '',
          state: 'error',
          ahead: 0,
          behind: 0,
          changedFiles: 0,
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          hasUpstream: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return results;
}

export async function gitFetch(repoPath: string): Promise<{ success: boolean; message: string }> {
  try {
    const { stdout, stderr } = await execAsync('git fetch --all --prune', {
      cwd: repoPath,
      ...NET_OPTS,
    });
    return { success: true, message: stdout || stderr || 'Fetched' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to fetch',
    };
  }
}

function nameOf(path: string): string {
  return basename(path);
}

export async function bulkPull(paths: string[]): Promise<BulkResultItem[]> {
  return mapLimit(paths, BULK_CONCURRENCY, async p => {
    const r = await gitPull(p);
    return { path: p, name: nameOf(p), success: r.success, message: r.message };
  });
}

export async function bulkPush(paths: string[]): Promise<BulkResultItem[]> {
  return mapLimit(paths, BULK_CONCURRENCY, async p => {
    const r = await gitPush(p);
    return { path: p, name: nameOf(p), success: r.success, message: r.message };
  });
}

export async function bulkCommit(
  items: { path: string; message: string }[]
): Promise<BulkResultItem[]> {
  return mapLimit(items, BULK_CONCURRENCY, async it => {
    const r = await gitCommit(it.message, it.path);
    return { path: it.path, name: nameOf(it.path), success: r.success, message: r.message };
  });
}

export async function bulkFetch(paths: string[]): Promise<BulkResultItem[]> {
  return mapLimit(paths, BULK_CONCURRENCY, async p => {
    const r = await gitFetch(p);
    return { path: p, name: nameOf(p), success: r.success, message: r.message };
  });
}

export async function gitCommit(
  message: string,
  repoPath: string = process.cwd()
): Promise<{ success: boolean; message: string }> {
  try {
    // Stage all changes
    await execAsync('git add .', { cwd: repoPath });

    // Commit with message - use spawn to prevent command injection
    const gitProcess = spawn('git', ['commit', '-m', message], {
      cwd: repoPath,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', data => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', data => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number>(resolve => {
      gitProcess.on('close', resolve);
    });

    if (exitCode === 0) {
      return {
        success: true,
        message: stdout || stderr || 'Committed successfully',
      };
    } else {
      return {
        success: false,
        message: stderr || 'Failed to commit',
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to commit',
    };
  }
}
