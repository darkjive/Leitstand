import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowUp,
  ArrowDown,
  RefreshCw,
  GitCommit,
  Upload,
  Download,
  FileText,
  FilePlus,
  FileQuestion,
  FolderGit2,
  Plus,
  X,
  Check,
  ChevronRight,
  Search,
  Cloud,
  CloudOff,
  AlertTriangle,
} from 'lucide-react';

import type {
  RepoState,
  RepoSummary,
  BulkResultItem,
  GitStatus as GitDetail,
} from '../../shared/types';
import { useSettingJSON } from '../lib/settings';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

type FilterKey = 'all' | 'dirty' | 'ahead' | 'behind' | 'conflict';

// ============================================================
// Helpers
// ============================================================

const STATE_META: Record<RepoState, { label: string; dot: string; text: string; border: string }> =
  {
    clean: {
      label: 'clean',
      dot: 'bg-green-400',
      text: 'text-green-400',
      border: 'border-green-500/40',
    },
    dirty: {
      label: 'dirty',
      dot: 'bg-yellow-400',
      text: 'text-yellow-400',
      border: 'border-yellow-500/40',
    },
    ahead: {
      label: 'ahead',
      dot: 'bg-accent',
      text: 'text-accent',
      border: 'border-accent/40',
    },
    behind: {
      label: 'behind',
      dot: 'bg-orange-400',
      text: 'text-orange-400',
      border: 'border-orange-500/40',
    },
    diverged: {
      label: 'diverged',
      dot: 'bg-purple-400',
      text: 'text-purple-400',
      border: 'border-purple-500/40',
    },
    'no-upstream': {
      label: 'no upstream',
      dot: 'bg-gray-500',
      text: 'text-gray-500',
      border: 'border-gray-600/40',
    },
    conflict: {
      label: 'conflict',
      dot: 'bg-red-500',
      text: 'text-red-400',
      border: 'border-red-500/40',
    },
    error: { label: 'error', dot: 'bg-red-700', text: 'text-red-500', border: 'border-red-700/40' },
  };

function matchesFilter(repo: RepoSummary, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'dirty':
      return repo.changedFiles > 0;
    case 'ahead':
      return repo.ahead > 0;
    case 'behind':
      return repo.behind > 0;
    case 'conflict':
      return repo.state === 'conflict';
  }
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ============================================================
// Component
// ============================================================

export function GitStatus() {
  // Roots configuration — persisted + synced with SettingsPanel automatically
  const [roots, setRoots] = useSettingJSON<string[]>('git-roots', []);
  const [showAddRoot, setShowAddRoot] = useState(false);
  const [newRoot, setNewRoot] = useState('');

  // Repo list
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // UI state
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);

  // Detail data (loaded on expand)
  const [detail, setDetail] = useState<GitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [showCommitInput, setShowCommitInput] = useState(false);

  // Bulk commit modal
  const [bulkCommitOpen, setBulkCommitOpen] = useState(false);
  const [bulkCommitMsg, setBulkCommitMsg] = useState('');

  // Confirmation modal for bulk ops
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    paths: string[];
    op: 'pull' | 'push' | 'fetch';
  } | null>(null);

  // ---- scanning ----
  const scan = useCallback(async () => {
    if (roots.length === 0) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await apiFetch('/api/git/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roots }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setRepos(data.repos as RepoSummary[]);
      setLastScan(Date.now());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [roots]);

  useEffect(() => {
    scan();
  }, [scan]);

  // periodic rescan (lightweight, doesn't auto-fetch)
  useEffect(() => {
    if (roots.length === 0) return;
    const id = setInterval(() => scan(), 30000);
    return () => clearInterval(id);
  }, [roots, scan]);

  // ---- root management ----
  const addRoot = () => {
    const r = newRoot.trim();
    if (!r) return;
    if (!roots.includes(r)) {
      setRoots([...roots, r]);
    }
    setNewRoot('');
    setShowAddRoot(false);
  };

  const removeRoot = (r: string) => {
    setRoots(roots.filter(x => x !== r));
  };

  // ---- detail ----
  const loadDetail = useCallback(async (path: string) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleExpand = (path: string) => {
    if (expanded === path) {
      setExpanded(null);
      setDetail(null);
      setShowCommitInput(false);
    } else {
      setExpanded(path);
      setCommitMsg('');
      setShowCommitInput(false);
      loadDetail(path);
    }
  };

  // ---- single-repo actions ----
  const runRepoAction = async (path: string, op: 'pull' | 'push' | 'fetch') => {
    setActionLoading(prev => ({ ...prev, [path]: op }));
    try {
      const res = await apiFetch(`/api/git/${op}?path=${encodeURIComponent(path)}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!result.success) toast(`${op} failed: ${result.message}`);
      await Promise.all([scan(), expanded === path ? loadDetail(path) : Promise.resolve()]);
    } catch {
      toast(`${op} failed`);
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  const handleCommit = async (path: string) => {
    if (!commitMsg.trim()) return;
    setActionLoading(prev => ({ ...prev, [path]: 'commit' }));
    try {
      const res = await apiFetch(`/api/git/commit?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg }),
      });
      const result = await res.json();
      if (!result.success) {
        toast(`Commit failed: ${result.message}`);
      } else {
        setCommitMsg('');
        setShowCommitInput(false);
      }
      await Promise.all([scan(), loadDetail(path)]);
    } catch {
      toast('Commit failed');
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  // ---- bulk actions ----
  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repos
      .filter(r => matchesFilter(r, filter))
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [repos, filter, search]);

  const bulkEligible = (): string[] => {
    return filteredRepos
      .filter(r => r.state !== 'error' && r.state !== 'conflict')
      .filter(r => r.hasUpstream)
      .map(r => r.path);
  };

  const runBulk = async (op: 'pull' | 'push' | 'fetch', paths: string[]) => {
    setBulkLoading(op);
    setConfirm(null);
    try {
      const res = await apiFetch(`/api/git/bulk/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      const data = await res.json();
      const results: BulkResultItem[] = data.results || [];
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        const msg = failed.map(r => `• ${r.name}: ${r.message}`).join('\n');
        toast(`Bulk ${op}: ${failed.length} failed\n${msg}`);
      }
      await scan();
    } catch {
      toast(`Bulk ${op} failed`);
    } finally {
      setBulkLoading(null);
    }
  };

  const openConfirm = (op: 'pull' | 'push' | 'fetch') => {
    const paths = bulkEligible();
    if (paths.length === 0) {
      toast(`No eligible repos for bulk ${op}`, 'info');
      return;
    }
    setConfirm({
      title: `Bulk ${op.toUpperCase()}`,
      body: `Apply ${op} to ${paths.length} repositor${paths.length === 1 ? 'y' : 'ies'}?`,
      paths,
      op,
    });
  };

  const runBulkCommit = async () => {
    if (!bulkCommitMsg.trim()) return;
    const items = filteredRepos
      .filter(r => r.changedFiles > 0)
      .map(r => ({ path: r.path, message: bulkCommitMsg }));
    if (items.length === 0) {
      toast('No repos with changes to commit', 'info');
      return;
    }
    setBulkLoading('commit');
    setBulkCommitOpen(false);
    try {
      const res = await apiFetch('/api/git/bulk/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      const failed = (data.results || []).filter((r: BulkResultItem) => !r.success);
      if (failed.length > 0) {
        const msg = failed.map((r: BulkResultItem) => `• ${r.name}: ${r.message}`).join('\n');
        toast(`Bulk commit: ${failed.length} failed\n${msg}`);
      }
      setBulkCommitMsg('');
      await scan();
    } catch {
      toast('Bulk commit failed');
    } finally {
      setBulkLoading(null);
    }
  };

  // ---- stats ----
  const stats = useMemo(() => {
    const s = { clean: 0, dirty: 0, ahead: 0, behind: 0, conflict: 0, total: repos.length };
    for (const r of repos) {
      if (r.state === 'clean') s.clean++;
      if (r.changedFiles > 0) s.dirty++;
      if (r.ahead > 0) s.ahead++;
      if (r.behind > 0) s.behind++;
      if (r.state === 'conflict') s.conflict++;
    }
    return s;
  }, [repos]);

  // ============================================================
  // Render
  // ============================================================

  if (roots.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-4">
        <FolderGit2 className="w-10 h-12 text-accent mb-3" />
        <h3 className="text-sm font-bold text-gray-200 mb-1">No Dev roots configured</h3>
        <p className="text-xs text-gray-500 mb-4">Add a directory to scan for git repositories.</p>
        <div className="w-full max-w-sm">
          <input
            type="text"
            value={newRoot}
            onChange={e => setNewRoot(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRoot()}
            placeholder="/home/user/Dev"
            className="w-full px-3 py-2 bg-bg border border-line text-gray-300 text-xs rounded font-mono mb-2"
            autoFocus
          />
          <button
            onClick={addRoot}
            className="ds-btn primary block"
          >
            Add Root & Scan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ---- Header ---- */}
      <div className="px-3 py-2 border-b border-line flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-accent" />
            <span className="text-xs font-bold text-gray-200">
              {repos.length} repo{repos.length === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-gray-600">·</span>
            <span className="text-xs text-gray-500">{timeAgo(lastScan)}</span>
          </div>
          <button onClick={scan} disabled={scanning} className="ds-btn sm icon" title="Rescan">
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Roots chips */}
        <div className="flex flex-wrap gap-1 items-center">
          {roots.map(r => (
            <span
              key={r}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-elevated border border-line rounded text-xs text-gray-400 font-mono max-w-[140px] truncate"
              title={r}
            >
              {r.split('/').pop() || r}
              <button
                onClick={() => removeRoot(r)}
                className="text-gray-600 hover:text-red-400"
                title={`Remove ${r}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowAddRoot(!showAddRoot)}
            className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-line rounded text-xs text-gray-500 hover:text-accent hover:border-accent"
          >
            <Plus className="w-3 h-3" /> root
          </button>
        </div>

        {showAddRoot && (
          <div className="mt-2 flex gap-1">
            <input
              type="text"
              value={newRoot}
              onChange={e => setNewRoot(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRoot()}
              placeholder="/home/user/Dev"
              className="flex-1 px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded font-mono"
              autoFocus
            />
            <button
              onClick={addRoot}
              className="ds-btn primary sm"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddRoot(false);
                setNewRoot('');
              }}
              className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs"
            >
              Cancel
            </button>
          </div>
        )}

        {scanError && <div className="mt-2 text-xs text-red-400">Scan error: {scanError}</div>}
      </div>

      {/* ---- Stat strip ---- */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line text-xs flex-shrink-0">
        <span className="text-green-400">{stats.clean} clean</span>
        <span className="text-gray-700">·</span>
        <span className="text-yellow-400">{stats.dirty} dirty</span>
        <span className="text-gray-700">·</span>
        <span className="text-accent">{stats.ahead} ahead</span>
        <span className="text-gray-700">·</span>
        <span className="text-orange-400">{stats.behind} behind</span>
        {stats.conflict > 0 && (
          <>
            <span className="text-gray-700">·</span>
            <span className="text-red-400">{stats.conflict} conflict</span>
          </>
        )}
      </div>

      {/* ---- Toolbar: filter + search + bulk ---- */}
      <div className="px-3 py-2 border-b border-line space-y-2 flex-shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'dirty', 'ahead', 'behind', 'conflict'] as FilterKey[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                filter === f
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-line text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
          <div className="ml-auto relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="search"
              className="pl-7 pr-2 py-0.5 bg-bg border border-line text-gray-300 text-xs rounded w-32"
            />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => openConfirm('fetch')}
            disabled={bulkLoading !== null}
            className="ds-btn sm"
            title="Fetch all filtered (git fetch --all --prune)"
          >
            {bulkLoading === 'fetch' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Cloud className="w-3 h-3" />
            )}
            Fetch
          </button>
          <button
            onClick={() => openConfirm('pull')}
            disabled={bulkLoading !== null}
            className="ds-btn sm"
            title="Pull all filtered"
          >
            {bulkLoading === 'pull' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Pull
          </button>
          <button
            onClick={() => openConfirm('push')}
            disabled={bulkLoading !== null}
            className="ds-btn sm"
            title="Push all filtered"
          >
            {bulkLoading === 'push' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Push
          </button>
          <button
            onClick={() => setBulkCommitOpen(true)}
            disabled={bulkLoading !== null}
            className="ds-btn sm"
            title="Commit all dirty repos with one message"
          >
            {bulkLoading === 'commit' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <GitCommit className="w-3 h-3" />
            )}
            Commit
          </button>
        </div>
      </div>

      {/* ---- Repo list ---- */}
      <div className="flex-1 overflow-y-auto">
        {filteredRepos.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-600">
            {repos.length === 0
              ? scanning
                ? 'Scanning...'
                : 'No repos found'
              : 'No repos match filter'}
          </div>
        )}

        {filteredRepos.map(repo => {
          const meta = STATE_META[repo.state];
          const isExpanded = expanded === repo.path;
          const loading = actionLoading[repo.path];
          return (
            <div key={repo.path} className="border-b border-line">
              {/* Row */}
              <button
                onClick={() => toggleExpand(repo.path)}
                className="w-full text-left px-3 py-2 hover:bg-elevated/50 flex items-center gap-2"
              >
                <ChevronRight
                  className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                <span className="text-xs text-gray-200 font-mono truncate flex-1">{repo.name}</span>

                {repo.hasUpstream ? null : (
                  <span title="No upstream" className="flex-shrink-0">
                    <CloudOff className="w-3 h-3 text-gray-600" />
                  </span>
                )}
                {repo.ahead > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-accent">
                    <ArrowUp className="w-3 h-3" />
                    {repo.ahead}
                  </span>
                )}
                {repo.behind > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-orange-400">
                    <ArrowDown className="w-3 h-3" />
                    {repo.behind}
                  </span>
                )}
                {repo.changedFiles > 0 && (
                  <span className="text-xs text-yellow-400">+{repo.changedFiles}</span>
                )}
                {repo.branch && (
                  <span className="text-xs text-gray-500 font-mono hidden sm:inline">
                    {repo.branch}
                  </span>
                )}
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-3 pb-3 bg-bg/40">
                  <div className="text-xs text-gray-600 font-mono mb-2 truncate">{repo.path}</div>

                  {repo.state === 'conflict' && (
                    <div className="flex items-center gap-2 text-xs text-red-400 mb-2 p-2 border border-red-500/30 bg-red-900/10 rounded">
                      <AlertTriangle className="w-3 h-3" />
                      Merge conflict — resolve manually, skipped by bulk ops
                    </div>
                  )}

                  {repo.lastCommit && (
                    <div className="text-xs text-gray-400 mb-2">
                      <span className="font-mono text-accent">{repo.lastCommit.hash}</span>{' '}
                      {repo.lastCommit.message}
                      <span className="text-gray-600">
                        {' '}
                        — {repo.lastCommit.author} · {repo.lastCommit.date}
                      </span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="grid grid-cols-3 gap-1 mb-2">
                    <button
                      onClick={() => runRepoAction(repo.path, 'fetch')}
                      disabled={!!loading || !repo.hasUpstream}
                      className="ds-btn sm"
                    >
                      {loading === 'fetch' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Cloud className="w-3 h-3" />
                      )}
                      Fetch
                    </button>
                    <button
                      onClick={() => runRepoAction(repo.path, 'pull')}
                      disabled={!!loading || !repo.hasUpstream}
                      className="ds-btn sm"
                    >
                      {loading === 'pull' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      Pull
                    </button>
                    <button
                      onClick={() => runRepoAction(repo.path, 'push')}
                      disabled={!!loading || !repo.hasUpstream}
                      className="ds-btn sm"
                    >
                      {loading === 'push' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      Push
                    </button>
                  </div>

                  {/* Commit input */}
                  {!showCommitInput ? (
                    <button
                      onClick={() => setShowCommitInput(true)}
                      disabled={repo.changedFiles === 0}
                      className="ds-btn sm block"
                    >
                      <GitCommit className="w-3 h-3" />
                      Commit {repo.changedFiles > 0 ? `(${repo.changedFiles})` : ''}
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={commitMsg}
                        onChange={e => setCommitMsg(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleCommit(repo.path);
                          if (e.key === 'Escape') {
                            setShowCommitInput(false);
                            setCommitMsg('');
                          }
                        }}
                        placeholder="commit message..."
                        className="w-full px-2 py-1 bg-bg border border-line text-gray-300 rounded text-xs"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleCommit(repo.path)}
                          disabled={loading === 'commit' || !commitMsg.trim()}
                          className="ds-btn primary sm flex-1"
                        >
                          {loading === 'commit' ? 'Committing...' : 'Commit All'}
                        </button>
                        <button
                          onClick={() => {
                            setShowCommitInput(false);
                            setCommitMsg('');
                          }}
                          className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* File lists */}
                  {detailLoading ? (
                    <div className="text-xs text-gray-600 mt-2">Loading details...</div>
                  ) : detail ? (
                    <FileLists detail={detail} />
                  ) : null}

                  {repo.error && (
                    <div className="text-xs text-red-400 mt-2">Error: {repo.error}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- Bulk confirm modal ---- */}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-sm text-gray-300 mb-3">{confirm.body}</p>
          <div className="max-h-40 overflow-y-auto mb-3 text-xs text-gray-500 font-mono space-y-0.5">
            {confirm.paths.map(p => (
              <div key={p} className="truncate">
                • {p.split('/').pop()}
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setConfirm(null)}
              className="ds-btn sm"
            >
              Cancel
            </button>
            <button
              onClick={() => runBulk(confirm.op, confirm.paths)}
              className="ds-btn primary sm"
            >
              {bulkLoading === confirm.op ? 'Running...' : `Confirm ${confirm.op.toUpperCase()}`}
            </button>
          </div>
        </Modal>
      )}

      {/* ---- Bulk commit modal ---- */}
      {bulkCommitOpen && (
        <Modal title="Bulk Commit" onClose={() => setBulkCommitOpen(false)}>
          <p className="text-xs text-gray-400 mb-2">
            Commit all dirty repos ({filteredRepos.filter(r => r.changedFiles > 0).length}) with
            this message:
          </p>
          <textarea
            value={bulkCommitMsg}
            onChange={e => setBulkCommitMsg(e.target.value)}
            placeholder="commit message for all repos..."
            className="w-full px-2 py-1 bg-bg border border-line text-gray-300 rounded text-xs font-mono mb-2 h-20 resize-none"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setBulkCommitOpen(false)}
              className="ds-btn sm"
            >
              Cancel
            </button>
            <button
              onClick={runBulkCommit}
              disabled={!bulkCommitMsg.trim()}
              className="ds-btn primary sm"
            >
              Commit All
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function FileLists({ detail }: { detail: GitDetail }) {
  if (!detail.hasChanges) {
    return (
      <div className="mt-2 p-2 bg-green-900/10 border border-green-500/30 rounded text-xs text-green-400 flex items-center gap-2">
        <Check className="w-3 h-3" />
        Working tree clean
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {detail.staged.length > 0 && (
        <FileGroup
          icon={<FilePlus className="w-3 h-3 text-green-400" />}
          label="STAGED"
          count={detail.staged.length}
          files={detail.staged}
          colorClass="text-green-400 border-green-500/30 bg-green-900/10"
        />
      )}
      {detail.unstaged.length > 0 && (
        <FileGroup
          icon={<FileText className="w-3 h-3 text-yellow-400" />}
          label="MODIFIED"
          count={detail.unstaged.length}
          files={detail.unstaged}
          colorClass="text-yellow-400 border-yellow-500/30 bg-yellow-900/10"
        />
      )}
      {detail.untracked.length > 0 && (
        <FileGroup
          icon={<FileQuestion className="w-3 h-3 text-gray-400" />}
          label="UNTRACKED"
          count={detail.untracked.length}
          files={detail.untracked}
          colorClass="text-gray-400 border-gray-500/30 bg-gray-900/10"
        />
      )}
    </div>
  );
}

function FileGroup({
  icon,
  label,
  count,
  files,
  colorClass,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  files: string[];
  colorClass: string;
}) {
  return (
    <div className={`p-1.5 rounded border ${colorClass}`}>
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-xs font-bold">
          {label} ({count})
        </span>
      </div>
      <div className="text-xs text-gray-400 font-mono space-y-0.5 max-h-16 overflow-y-auto">
        {files.slice(0, 8).map((f, i) => (
          <div key={i} className="truncate">
            {f}
          </div>
        ))}
        {files.length > 8 && <div className="text-gray-600">+ {files.length - 8} more</div>}
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-accent rounded-lg p-4 max-w-md w-full shadow-lg shadow-accent/20"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-accent">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
