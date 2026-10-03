import { useState, useEffect } from 'react';
import {
  Package,
  Play,
  Square,
  Terminal,
  RefreshCw,
  FolderGit2,
  Plus,
  X,
  AlertCircle,
} from 'lucide-react';

import type { PackageScripts, ScriptOutput } from '../../shared/types';
import { useSetting, useSettingJSON } from '../lib/settings';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

interface SavedProject {
  name: string;
  path: string;
}

export function NpmScriptRunner() {
  const [scripts, setScripts] = useState<PackageScripts | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningScripts, setRunningScripts] = useState<Map<string, string>>(new Map());
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [scriptOutput, setScriptOutput] = useState<string>('');
  const [showOutput, setShowOutput] = useState(false);

  // Project management — persisted + synced with SettingsPanel automatically
  const [savedProjects, setSavedProjects] = useSettingJSON<SavedProject[]>('npm-projects', []);
  const [currentProjectPath, setCurrentProjectPath] = useSetting('npm-current-project', '');

  // Git-root-sourced projects: scanned via /api/git/scan, shown alongside manual ones
  const [gitRoots] = useSettingJSON<string[]>('git-roots', []);
  const [gitRepos, setGitRepos] = useState<SavedProject[]>([]);

  // Scan git-roots whenever they change; surface repos as selectable projects
  useEffect(() => {
    if (gitRoots.length === 0) {
      setGitRepos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/git/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roots: gitRoots }),
        });
        const data = await res.json();
        if (cancelled) return;
        const repos: SavedProject[] = (data.repos || []).map(
          (r: { name: string; path: string }) => ({ name: r.name, path: r.path })
        );
        setGitRepos(repos);
      } catch (err) {
        console.error('Failed to scan git roots for npm projects:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gitRoots]);

  // Merge: manual projects first, then git-root repos not already present by path
  const mergedProjects: SavedProject[] = (() => {
    const seen = new Set(savedProjects.map(p => p.path));
    const merged = [...savedProjects];
    for (const repo of gitRepos) {
      if (!seen.has(repo.path)) {
        merged.push(repo);
        seen.add(repo.path);
      }
    }
    return merged;
  })();

  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');

  const fetchScripts = async (projectPath?: string) => {
    const path = projectPath || currentProjectPath;
    try {
      const url = path ? `/api/npm/scripts?path=${encodeURIComponent(path)}` : '/api/npm/scripts';

      const res = await apiFetch(url);
      const data = await res.json();
      setScripts(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch package scripts:', error);
      setLoading(false);
    }
  };

  const runScript = async (scriptName: string) => {
    try {
      const res = await apiFetch('/api/npm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptName,
          repoPath: currentProjectPath || undefined,
          packageManager: scripts?.packageManager || 'npm',
        }),
      });

      const result = await res.json();
      if (result.processId) {
        // Polling starts via the effect below once runningScripts updates —
        // starting it here too would leak a second uncancelled interval.
        setRunningScripts(prev => new Map(prev).set(scriptName, result.processId));
        setSelectedScript(scriptName);
        setShowOutput(true);
      }
    } catch (error) {
      console.error('Failed to run script:', error);
      toast(`Failed to run ${scriptName}`);
    }
  };

  const stopScript = async (scriptName: string) => {
    const processId = runningScripts.get(scriptName);
    if (!processId) return;

    try {
      await apiFetch('/api/npm/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processId }),
      });

      setRunningScripts(prev => {
        const next = new Map(prev);
        next.delete(scriptName);
        return next;
      });
    } catch (error) {
      console.error('Failed to stop script:', error);
    }
  };

  const pollOutput = (processId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/npm/output/${encodeURIComponent(processId)}`);
        const data: ScriptOutput = await res.json();

        setScriptOutput(data.output);

        if (!data.isRunning) {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Failed to fetch output:', error);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  };

  const addProject = () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) {
      toast('Both name and path are required', 'info');
      return;
    }

    const newProject = { name: newProjectName.trim(), path: newProjectPath.trim() };
    setSavedProjects([...savedProjects, newProject]);
    setCurrentProjectPath(newProject.path);

    setNewProjectName('');
    setNewProjectPath('');
    setShowAddProject(false);
    fetchScripts(newProject.path);
  };

  const removeProject = (path: string) => {
    const updated = savedProjects.filter(p => p.path !== path);
    setSavedProjects(updated);

    if (currentProjectPath === path) {
      const newPath = updated.length > 0 ? updated[0].path : '';
      setCurrentProjectPath(newPath);
      fetchScripts(newPath);
    }
  };

  const switchProject = (path: string) => {
    setCurrentProjectPath(path);
    setRunningScripts(new Map()); // Clear running scripts
    setShowOutput(false);
    fetchScripts(path);
  };

  useEffect(() => {
    fetchScripts();
    const interval = setInterval(() => fetchScripts(), 10000);
    return () => clearInterval(interval);
    // fetchScripts is a component-scope closure; depending on it would
    // invalidate the effect every render. currentProjectPath is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectPath]);

  useEffect(() => {
    if (selectedScript && runningScripts.has(selectedScript)) {
      const processId = runningScripts.get(selectedScript)!;
      const cleanup = pollOutput(processId);
      return cleanup;
    }
  }, [selectedScript, runningScripts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent">
          LOADING SCRIPTS<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  const currentProject = mergedProjects.find(p => p.path === currentProjectPath);
  const isGitRootProject = (path: string | undefined): boolean =>
    !!path && gitRepos.some(r => r.path === path) && !savedProjects.some(p => p.path === path);

  return (
    <div className="h-full overflow-y-auto">
      {/* Project Selector */}
      <div className="mb-3 pb-3 border-b border-line">
        <div className="flex items-center gap-2 mb-2">
          <FolderGit2 className="w-4 h-4 text-accent" />
          <select
            value={currentProjectPath}
            onChange={e => switchProject(e.target.value)}
            className="flex-1 px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded font-mono"
          >
            <option value="">Dashboard Project</option>
            {savedProjects.length > 0 && (
              <optgroup label="Manual">
                {savedProjects.map((project, i) => (
                  <option key={`m-${i}`} value={project.path}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
            )}
            {gitRepos.filter(r => !savedProjects.some(p => p.path === r.path)).length > 0 && (
              <optgroup label="Git Roots">
                {gitRepos
                  .filter(r => !savedProjects.some(p => p.path === r.path))
                  .map((project, i) => (
                    <option key={`g-${i}`} value={project.path}>
                      {project.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          <button
            onClick={() => setShowAddProject(!showAddProject)}
            className="ds-btn sm icon"
            title="Add project"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {showAddProject && (
          <div className="mt-2 p-2 bg-elevated border border-accent rounded">
            <input
              type="text"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded mb-2"
            />
            <input
              type="text"
              value={newProjectPath}
              onChange={e => setNewProjectPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProject()}
              placeholder="Absolute path"
              className="w-full px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={addProject}
                className="ds-btn primary sm flex-1"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowAddProject(false);
                  setNewProjectName('');
                  setNewProjectPath('');
                }}
                className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {currentProject && (
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span className="truncate flex-1 font-mono">{currentProject.path}</span>
            {isGitRootProject(currentProject.path) ? (
              <span className="ml-2 text-[10px] text-gray-600 italic">via git root</span>
            ) : (
              <button
                onClick={() => removeProject(currentProject.path)}
                className="ml-2 text-red-400 hover:text-red-300"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="w-6 h-6 text-accent" />
          <div>
            <h3 className="text-xl font-bold">
              {currentProject?.name || scripts?.projectName || 'NPM SCRIPTS'}
            </h3>
            <div className="text-xs text-gray-400">
              {scripts?.packageManager || 'npm'} • {Object.keys(scripts?.scripts || {}).length}{' '}
              scripts
            </div>
          </div>
        </div>
        <button
          onClick={() => fetchScripts()}
          disabled={loading}
          className="ds-btn"
          title="Refresh scripts"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!scripts?.scripts || Object.keys(scripts.scripts).length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <AlertCircle className="w-12 h-12 mb-2 opacity-50" />
          <p className="text-sm">No package.json found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Object.entries(scripts.scripts).map(([name, command]) => {
            const isRunning = runningScripts.has(name);

            return (
              <div
                key={name}
                className={`ls-card p-3 rounded border transition-all ${
                  isRunning
                    ? 'border-green-500 bg-green-900/20'
                    : 'border-line hover:border-accent'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-bold text-accent">{name}</span>
                      {isRunning && (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                          Running
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 font-mono truncate" title={command}>
                      {command}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {isRunning ? (
                      <>
                        <button
                          onClick={() => {
                            setSelectedScript(name);
                            setShowOutput(true);
                          }}
                          className="ds-btn icon"
                          title="View output"
                        >
                          <Terminal className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => stopScript(name)}
                          className="ds-btn danger"
                          title="Stop script"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => runScript(name)}
                        className="ds-btn primary"
                        title="Run script"
                      >
                        <Play className="w-4 h-4" />
                        <span className="text-sm font-bold">Run</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Output Modal */}
      {showOutput && selectedScript && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-bg border-2 border-accent rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-accent" />
                <h3 className="text-lg font-bold">{selectedScript}</h3>
                {runningScripts.has(selectedScript) && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Running
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowOutput(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-black font-mono text-xs text-gray-300">
              <pre className="whitespace-pre-wrap">{scriptOutput || 'No output yet...'}</pre>
            </div>
            <div className="p-4 border-t border-line flex justify-end gap-2">
              {runningScripts.has(selectedScript) && (
                <button
                  onClick={() => stopScript(selectedScript)}
                  className="ds-btn danger"
                >
                  <Square className="w-4 h-4" />
                  Stop Script
                </button>
              )}
              <button onClick={() => setShowOutput(false)} className="ds-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
