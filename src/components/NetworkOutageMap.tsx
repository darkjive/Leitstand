import { useState, useEffect } from 'react';
import { Activity, RefreshCw, WifiOff, Wifi } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ConnectivityCheck {
  name: string;
  reachable: boolean;
  latencyMs: number | null;
}

export function NetworkOutageMap() {
  const [checks, setChecks] = useState<ConnectivityCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchConnectivity = async () => {
    try {
      const res = await apiFetch('/api/connectivity');
      if (!res.ok) return;
      const data = await res.json();
      setChecks(data.checks);
      setLastUpdated(new Date(data.timestamp));
    } catch {
      // Backend not ready yet or unavailable
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectivity();
    const interval = setInterval(fetchConnectivity, 60000);
    return () => clearInterval(interval);
  }, []);

  const getLatencyColor = (reachable: boolean, latencyMs: number | null) => {
    if (!reachable) return 'text-red-500';
    if (latencyMs === null) return 'text-gray-500';
    if (latencyMs < 100) return 'text-green-500';
    if (latencyMs < 400) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getLatencyLabel = (reachable: boolean, latencyMs: number | null) => {
    if (!reachable) return 'UNREACHABLE';
    if (latencyMs === null) return '—';
    return `${latencyMs}ms`;
  };

  const allReachable = checks.length > 0 && checks.every(c => c.reachable);
  const someUnreachable = checks.some(c => !c.reachable);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent">
          SCANNING NETWORK<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent-bright" />
          <h3 className="text-lg font-bold text-accent-bright">CONNECTIVITY</h3>
        </div>
        <button
          onClick={fetchConnectivity}
          className="ds-btn ghost icon"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-accent" />
        </button>
      </div>

      {/* Overall status banner */}
      <div
        className={`mb-4 p-3 rounded border flex items-center gap-2 ${
          allReachable
            ? 'bg-green-900/20 border-green-500/40 text-green-400'
            : someUnreachable
              ? 'bg-red-900/20 border-red-500/40 text-red-400'
              : 'bg-gray-900/20 border-gray-500/40 text-gray-400'
        }`}
      >
        {allReachable ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
        <span className="text-sm font-bold">
          {allReachable
            ? 'All targets reachable'
            : someUnreachable
              ? 'Some targets unreachable'
              : 'Checking...'}
        </span>
      </div>

      {/* Individual checks */}
      <div className="space-y-2">
        {checks.map(check => (
          <div
            key={check.name}
            className="flex items-center justify-between p-3 bg-bg rounded border border-line"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${check.reachable ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="font-mono text-sm">{check.name}</span>
            </div>
            <span
              className={`text-xs font-bold font-mono ${getLatencyColor(check.reachable, check.latencyMs)}`}
            >
              {getLatencyLabel(check.reachable, check.latencyMs)}
            </span>
          </div>
        ))}
      </div>

      {lastUpdated && (
        <div className="mt-4 text-xs text-gray-500 text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
