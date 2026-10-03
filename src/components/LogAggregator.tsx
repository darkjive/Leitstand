import { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Play,
  Square,
  Trash2,
  Plus,
  Filter,
  Download,
  Pause,
  PlayCircle,
  X,
  Sparkles,
} from 'lucide-react';

import type { LogFile, LogLine, LogSuggestion } from '../../shared/types';
import { useSettingJSON } from '../lib/settings';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

export function LogAggregator() {
  const [activeTails, setActiveTails] = useState<LogFile[]>([]);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<Set<string>>(
    new Set(['ERROR', 'WARN', 'INFO', 'DEBUG', 'UNKNOWN'])
  );

  // Add log file
  const [showAddLog, setShowAddLog] = useState(false);
  const [newLogName, setNewLogName] = useState('');
  const [newLogPath, setNewLogPath] = useState('');

  // Example suggestions (fetched from /api/logs/common-paths on demand)
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<LogSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Saved log configs — persisted + synced with SettingsPanel automatically
  const [savedLogs, setSavedLogs] = useSettingJSON<Omit<LogFile, 'color'>[]>('log-configs', []);

  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchActiveTails = async () => {
    try {
      const res = await apiFetch('/api/logs/active');
      const data = await res.json();
      setActiveTails(data.tails || []);
    } catch (error) {
      console.error('Failed to fetch active tails:', error);
    }
  };

  const fetchLogLines = async () => {
    try {
      const res = await apiFetch('/api/logs/lines');
      const data = await res.json();
      setLogLines(data.lines || []);
    } catch (error) {
      console.error('Failed to fetch log lines:', error);
    }
  };

  const startTailing = async (log: Omit<LogFile, 'color'>) => {
    try {
      const res = await apiFetch('/api/logs/tail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: log.id,
          name: log.name,
          path: log.path,
        }),
      });

      const result = await res.json();
      if (result.success) {
        await fetchActiveTails();
      } else {
        toast(`Failed to start tailing: ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to start tailing:', error);
      toast('Failed to start tailing');
    }
  };

  const stopTailing = async (fileId: string) => {
    try {
      await apiFetch('/api/logs/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });

      await fetchActiveTails();
    } catch (error) {
      console.error('Failed to stop tailing:', error);
    }
  };

  const clearLogs = async () => {
    try {
      await apiFetch('/api/logs/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      setLogLines([]);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  };

  const addLog = () => {
    if (!newLogName.trim() || !newLogPath.trim()) {
      toast('Both name and path are required', 'info');
      return;
    }

    const newLog = {
      id: `log-${Date.now()}`,
      name: newLogName.trim(),
      path: newLogPath.trim(),
    };

    setSavedLogs([...savedLogs, newLog]);

    // Auto-start tailing
    startTailing(newLog);

    setNewLogName('');
    setNewLogPath('');
    setShowAddLog(false);
  };

  const removeLog = (logId: string) => {
    setSavedLogs(savedLogs.filter(l => l.id !== logId));

    // Stop tailing if active
    if (activeTails.find(t => t.id === logId)) {
      stopTailing(logId);
    }
  };

  const openSuggestions = async () => {
    setShowSuggestions(true);
    setSuggestionsLoading(true);
    try {
      const res = await apiFetch('/api/logs/common-paths');
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch (error) {
      console.error('Failed to fetch log suggestions:', error);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const applySuggestion = (s: LogSuggestion) => {
    setNewLogName(s.name);
    setNewLogPath(s.path);
    setShowSuggestions(false);
    setShowAddLog(true);
  };

  const toggleLevelFilter = (level: string) => {
    setLevelFilter(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const downloadLogs = () => {
    const text = filteredLines
      .map(line => `[${line.timestamp}] [${line.source}] [${line.level}] ${line.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchActiveTails();
    fetchLogLines();

    const interval = setInterval(() => {
      fetchLogLines();
    }, 1000); // Poll every second

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  const filteredLines = logLines.filter(line => levelFilter.has(line.level));

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'text-red-400';
      case 'WARN':
        return 'text-yellow-400';
      case 'INFO':
        return 'text-blue-400';
      case 'DEBUG':
        return 'text-gray-400';
      default:
        return 'text-gray-300';
    }
  };

  const getLevelBadgeColor = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'bg-red-900/30 border-red-500/50 text-red-300';
      case 'WARN':
        return 'bg-yellow-900/30 border-yellow-500/50 text-yellow-300';
      case 'INFO':
        return 'bg-blue-900/30 border-blue-500/50 text-blue-300';
      case 'DEBUG':
        return 'bg-gray-900/30 border-gray-500/50 text-gray-300';
      default:
        return 'bg-gray-900/30 border-gray-500/50 text-gray-400';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-accent" />
          <div>
            <h3 className="text-xl font-bold">LOG AGGREGATOR</h3>
            <div className="text-xs text-gray-400">
              {activeTails.length} active • {filteredLines.length} lines
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`ds-btn icon ${autoScroll ? 'active' : ''}`}
            title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          >
            {autoScroll ? <PlayCircle className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button onClick={downloadLogs} className="ds-btn icon" title="Download logs">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={clearLogs} className="ds-btn icon" title="Clear logs">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Level Filter */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        {['ERROR', 'WARN', 'INFO', 'DEBUG', 'UNKNOWN'].map(level => (
          <button
            key={level}
            onClick={() => toggleLevelFilter(level)}
            className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
              levelFilter.has(level)
                ? getLevelBadgeColor(level)
                : 'bg-gray-800 border-gray-700 text-gray-600'
            }`}
          >
            {level}
          </button>
        ))}
      </div>

      {/* Active Tails */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-gray-400">TAILING</span>
          <button
            onClick={() => setShowAddLog(!showAddLog)}
            className="ds-btn sm icon"
            title="Add log file"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={openSuggestions}
            className="ds-btn sm icon"
            title="Pick from example paths"
          >
            <Sparkles className="w-3 h-3" />
          </button>
        </div>

        {showAddLog && (
          <div className="mb-2 p-2 bg-elevated border border-accent rounded">
            <input
              type="text"
              value={newLogName}
              onChange={e => setNewLogName(e.target.value)}
              placeholder="Log name (e.g., Backend)"
              className="w-full px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded mb-2"
            />
            <input
              type="text"
              value={newLogPath}
              onChange={e => setNewLogPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLog()}
              placeholder="Absolute path (e.g., /var/log/app.log)"
              className="w-full px-2 py-1 bg-bg border border-line text-gray-300 text-xs rounded mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={addLog}
                className="ds-btn primary sm flex-1"
              >
                Add & Start
              </button>
              <button
                onClick={() => {
                  setShowAddLog(false);
                  setNewLogName('');
                  setNewLogPath('');
                }}
                className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {savedLogs.map(log => {
            const isActive = activeTails.find(t => t.id === log.id);
            const activeLog = activeTails.find(t => t.id === log.id);

            return (
              <div
                key={log.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs border ${
                  isActive ? 'bg-green-900/20 border-green-500/50' : 'bg-gray-800 border-gray-700'
                }`}
              >
                {isActive && activeLog && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: activeLog.color }}
                  />
                )}
                <span className="font-mono">{log.name}</span>
                <button
                  onClick={() => (isActive ? stopTailing(log.id) : startTailing(log))}
                  className="hover:text-accent transition-colors"
                  title={isActive ? 'Stop tailing' : 'Start tailing'}
                >
                  {isActive ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => removeLog(log.id)}
                  className="text-red-400 hover:text-red-300 transition-colors"
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log Output */}
      <div
        ref={logContainerRef}
        className="flex-1 bg-black rounded border border-line p-2 overflow-y-auto font-mono text-xs"
      >
        {filteredLines.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No logs yet. Add and start tailing log files above.
          </div>
        ) : (
          filteredLines.map(line => (
            <div key={line.id} className="mb-1 hover:bg-gray-900/50">
              <span className="text-gray-600">
                [{new Date(line.timestamp).toLocaleTimeString()}]
              </span>{' '}
              <span style={{ color: line.color }} className="font-bold">
                [{line.source}]
              </span>{' '}
              <span className={`font-bold ${getLevelColor(line.level)}`}>[{line.level}]</span>{' '}
              <span className="text-gray-300">{line.message}</span>
            </div>
          ))
        )}
      </div>

      {/* Suggestions Modal */}
      {showSuggestions && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-bg border-2 border-accent rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-accent" />
                <h3 className="text-lg font-bold">Example Log Paths</h3>
              </div>
              <button
                onClick={() => setShowSuggestions(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {suggestionsLoading ? (
                <div className="text-accent text-center py-8">
                  LOADING<span className="blink-cursor"></span>
                </div>
              ) : (
                (() => {
                  const categories = ['System', 'Services', 'Dev', 'AI Agents'] as const;
                  return categories.map(cat => {
                    const items = suggestions.filter(s => s.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat} className="mb-4">
                        <div className="text-xs font-bold text-accent uppercase tracking-wider mb-2">
                          {cat}
                        </div>
                        <div className="space-y-1">
                          {items.map(s => (
                            <button
                              key={`${cat}-${s.name}`}
                              onClick={() => applySuggestion(s)}
                              className="w-full text-left px-3 py-2 bg-elevated border border-line rounded hover:border-accent transition-colors"
                            >
                              <div className="text-sm text-gray-200 font-mono">{s.name}</div>
                              <div className="text-xs text-gray-500 font-mono truncate">
                                {s.path}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            <div className="p-4 border-t border-line flex justify-end">
              <button onClick={() => setShowSuggestions(false)} className="ds-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
