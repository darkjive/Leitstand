import { useState, useEffect } from 'react';
import { Zap, RefreshCw, Skull, Server, AlertTriangle } from 'lucide-react';
import type { DevPortInfo } from '../../shared/types';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

export function PortKiller() {
  const [ports, setPorts] = useState<DevPortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState<number | null>(null);
  const [lastKilled, setLastKilled] = useState<number | null>(null);

  const fetchPorts = async () => {
    try {
      const res = await apiFetch('/api/ports');
      const data = await res.json();
      setPorts(data.ports || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch ports:', error);
      setLoading(false);
    }
  };

  const killPort = async (port: number) => {
    setKilling(port);
    try {
      const res = await apiFetch('/api/ports/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });

      const result = await res.json();

      if (result.success) {
        setLastKilled(port);
        setTimeout(() => setLastKilled(null), 3000);
        // Refresh ports after kill
        await fetchPorts();
      } else {
        toast(`Failed to kill port ${port}: ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to kill port:', error);
      toast(`Error killing port ${port}`);
    } finally {
      setKilling(null);
    }
  };

  useEffect(() => {
    fetchPorts();
    const interval = setInterval(fetchPorts, 3000); // Refresh every 3s
    return () => clearInterval(interval);
  }, []);

  const getPortColor = (port: number) => {
    if (port >= 3000 && port < 4000) return 'text-green-400'; // Node/React dev servers
    if (port >= 5000 && port < 6000) return 'text-blue-400'; // Vite/Python
    if (port === 5432) return 'text-purple-400'; // PostgreSQL
    if (port === 27017) return 'text-yellow-400'; // MongoDB
    if (port >= 8000 && port < 9000) return 'text-orange-400'; // Generic web servers
    return 'text-cyber-cyan';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-cyber-cyan">
          SCANNING PORTS<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-cyber-orange" />
          <h3 className="text-xl font-bold cyber-glow">PORT KILLER</h3>
        </div>
        <button
          onClick={fetchPorts}
          disabled={loading}
          className="cyber-button flex items-center gap-2 text-sm"
          title="Refresh ports"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {ports.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <Server className="w-12 h-12 mb-2 opacity-50" />
          <p className="text-sm">No dev ports in use</p>
          <p className="text-xs text-gray-600 mt-1">Scans ports: 3000-9000, 5432, 27017</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ports.map(portInfo => (
            <div
              key={`${portInfo.port}-${portInfo.pid}`}
              className={`cyber-card p-3 rounded border transition-all ${
                lastKilled === portInfo.port
                  ? 'border-red-500 bg-red-900/20'
                  : 'border-cyber-border hover:border-cyber-cyan'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-2xl font-bold ${getPortColor(portInfo.port)}`}>
                      :{portInfo.port}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{portInfo.protocol}</span>
                    <span className="text-xs text-gray-600 font-mono">PID {portInfo.pid}</span>
                  </div>
                  <div className="text-sm text-gray-400 font-mono" title={portInfo.command}>
                    <span className="text-cyber-cyan">{portInfo.processName}</span>
                    <div className="text-gray-600 break-all whitespace-normal mt-0.5">
                      {portInfo.command}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => killPort(portInfo.port)}
                  disabled={killing === portInfo.port}
                  className={`flex-shrink-0 px-3 py-2 rounded font-bold text-sm transition-all ${
                    killing === portInfo.port
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700 hover:scale-105'
                  }`}
                  title={`Kill process on port ${portInfo.port}`}
                >
                  {killing === portInfo.port ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Skull className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-yellow-200">
            <strong>Warning:</strong> Killing processes will terminate them immediately. Make sure
            you save your work before killing dev servers.
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-cyber-border text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>
            {ports.length} active dev port{ports.length !== 1 ? 's' : ''}
          </span>
          <span className="text-gray-600">Auto-refresh: 3s</span>
        </div>
      </div>
    </div>
  );
}
