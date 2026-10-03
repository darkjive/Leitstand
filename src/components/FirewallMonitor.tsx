import { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Activity, Network, RefreshCw, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';

// Types matching backend interfaces
interface UFWLogEntry {
  timestamp: string;
  action: 'BLOCK' | 'ALLOW';
  protocol: string;
  srcIp: string;
  srcPort?: number;
  dstIp: string;
  dstPort?: number;
  interface?: string;
}

interface UFWRule {
  num: number;
  to: string;
  action: string;
  from: string;
  description?: string;
}

interface UFWStatus {
  active: boolean;
  logging: string;
  defaultIncoming: string;
  defaultOutgoing: string;
  defaultRouted: string;
  rules: UFWRule[];
}

interface AttackerStats {
  ip: string;
  blockedCount: number;
  lastSeen: string;
  targetPorts: number[];
}

interface PortInfo {
  port: number;
  protocol: 'TCP' | 'UDP';
  state: string;
  service: string;
  pid?: number;
  program?: string;
}

interface PortScanResult {
  localPorts: PortInfo[];
  externalPorts: PortInfo[];
  scanTime: string;
}

type TabType = 'status' | 'logs' | 'attackers' | 'ports';

export function FirewallMonitor() {
  const [activeTab, setActiveTab] = useState<TabType>('status');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [status, setStatus] = useState<UFWStatus | null>(null);
  const [logs, setLogs] = useState<UFWLogEntry[]>([]);
  const [attackers, setAttackers] = useState<AttackerStats[]>([]);
  const [portScan, setPortScan] = useState<PortScanResult | null>(null);

  // Fetch UFW status
  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/firewall/status');
      if (!res.ok) throw new Error('Failed to fetch UFW status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch UFW status:', err);
    }
  };

  // Fetch UFW logs
  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/api/firewall/logs?limit=50');
      if (!res.ok) throw new Error('Failed to fetch UFW logs');
      const data = await res.json();
      setLogs(data.logs);
    } catch (err) {
      console.error('Failed to fetch UFW logs:', err);
    }
  };

  // Fetch top attackers
  const fetchAttackers = async () => {
    try {
      const res = await apiFetch('/api/firewall/top-attackers?limit=10');
      if (!res.ok) throw new Error('Failed to fetch attackers');
      const data = await res.json();
      setAttackers(data.attackers);
    } catch (err) {
      console.error('Failed to fetch attackers:', err);
    }
  };

  // Fetch port scan
  const fetchPortScan = async () => {
    try {
      const res = await apiFetch('/api/firewall/ports');
      if (!res.ok) throw new Error('Failed to fetch port scan');
      const data = await res.json();
      setPortScan(data);
    } catch (err) {
      console.error('Failed to fetch port scan:', err);
    }
  };

  // Fetch all data
  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchStatus(), fetchLogs(), fetchAttackers(), fetchPortScan()]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch firewall data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 60000); // Update every 60s
    return () => clearInterval(interval);
    // fetchAllData is a component-scope closure; we intentionally run once on
    // mount and on the interval. Empty deps is deliberate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent animate-pulse">Loading firewall data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <AlertCircle className="w-12 h-12 text-red-400 mb-2" />
        <div className="text-red-400 text-sm">{error}</div>
        <button
          onClick={fetchAllData}
          className="mt-4 px-4 py-2 bg-elevated border border-accent text-accent rounded hover:bg-accent/10 transition-colors text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-elevated rounded-lg border border-accent/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-accent/30">
        <div className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${status?.active ? 'text-green-400' : 'text-red-400'}`} />
          <h3 className="text-lg font-bold text-accent">Firewall Monitor</h3>
          {status && (
            <span
              className={`text-xs px-2 py-1 rounded ${
                status.active
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}
            >
              {status.active ? 'ACTIVE' : 'INACTIVE'}
            </span>
          )}
        </div>
        <button
          onClick={fetchAllData}
          className="p-2 hover:bg-accent/10 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-accent" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-accent/30">
        {[
          { id: 'status' as TabType, label: 'Status', icon: Shield },
          { id: 'logs' as TabType, label: 'Logs', icon: Activity },
          { id: 'attackers' as TabType, label: 'Attackers', icon: ShieldAlert },
          { id: 'ports' as TabType, label: 'Ports', icon: Network },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === tab.id
                ? 'bg-accent/20 text-accent border-b-2 border-accent'
                : 'text-gray-400 hover:text-accent hover:bg-accent/10'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'status' && <StatusTab status={status} />}
        {activeTab === 'logs' && <LogsTab logs={logs} />}
        {activeTab === 'attackers' && <AttackersTab attackers={attackers} />}
        {activeTab === 'ports' && <PortsTab portScan={portScan} />}
      </div>
    </div>
  );
}

// Status Tab Component
function StatusTab({ status }: { status: UFWStatus | null }) {
  if (!status) {
    return <div className="text-gray-400 text-sm">No status data available</div>;
  }

  return (
    <div className="space-y-4">
      {/* Overview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-bg/50 p-3 rounded border border-accent/20">
          <div className="text-xs text-gray-400 mb-1">Status</div>
          <div className={`text-lg font-bold ${status.active ? 'text-green-400' : 'text-red-400'}`}>
            {status.active ? 'Active' : 'Inactive'}
          </div>
        </div>
        <div className="bg-bg/50 p-3 rounded border border-accent/20">
          <div className="text-xs text-gray-400 mb-1">Logging</div>
          <div className="text-lg font-bold text-accent">{status.logging}</div>
        </div>
      </div>

      {/* Default Policies */}
      <div className="bg-bg/50 p-4 rounded border border-accent/20">
        <h4 className="text-sm font-bold text-accent mb-3">Default Policies</h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-gray-400">Incoming:</span>
            <span
              className={`ml-2 font-mono ${
                status.defaultIncoming === 'deny' ? 'text-green-400' : 'text-orange-400'
              }`}
            >
              {status.defaultIncoming}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Outgoing:</span>
            <span className="ml-2 font-mono text-accent">{status.defaultOutgoing}</span>
          </div>
          <div>
            <span className="text-gray-400">Routed:</span>
            <span className="ml-2 font-mono text-accent">{status.defaultRouted}</span>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className="bg-bg/50 p-4 rounded border border-accent/20">
        <h4 className="text-sm font-bold text-accent mb-3">
          Active Rules ({status.rules.length})
        </h4>
        <div className="space-y-2 max-h-60 overflow-auto">
          {status.rules.length === 0 ? (
            <div className="text-gray-400 text-xs">No custom rules configured</div>
          ) : (
            status.rules.map(rule => (
              <div
                key={rule.num}
                className="flex items-center gap-3 text-xs bg-bg/30 p-2 rounded border border-accent/10"
              >
                <span className="text-gray-500 w-6">#{rule.num}</span>
                <span className="text-accent flex-1 font-mono">{rule.to}</span>
                <span
                  className={`px-2 py-1 rounded font-bold ${
                    rule.action.includes('ALLOW')
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {rule.action}
                </span>
                <span className="text-gray-400 flex-1 font-mono">{rule.from}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Logs Tab Component
function LogsTab({ logs }: { logs: UFWLogEntry[] }) {
  if (logs.length === 0) {
    return <div className="text-gray-400 text-sm">No firewall logs found</div>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log, idx) => (
        <div
          key={idx}
          className={`p-3 rounded border text-xs font-mono ${
            log.action === 'BLOCK'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-green-500/10 border-green-500/30'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span
              className={
                log.action === 'BLOCK' ? 'text-red-400 font-bold' : 'text-green-400 font-bold'
              }
            >
              {log.action}
            </span>
            <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="text-gray-300 space-y-1">
            <div>
              <span className="text-gray-500">From:</span>{' '}
              <span className="text-accent-bright">{log.srcIp}</span>
              {log.srcPort && <span className="text-gray-500">:{log.srcPort}</span>}
            </div>
            <div>
              <span className="text-gray-500">To:</span>{' '}
              <span className="text-accent">{log.dstIp}</span>
              {log.dstPort && (
                <>
                  <span className="text-gray-500">:{log.dstPort}</span>
                  <span className="text-gray-500 ml-2">({log.protocol})</span>
                </>
              )}
            </div>
            {log.interface && (
              <div>
                <span className="text-gray-500">Interface:</span> {log.interface}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Attackers Tab Component
function AttackersTab({ attackers }: { attackers: AttackerStats[] }) {
  if (attackers.length === 0) {
    return <div className="text-gray-400 text-sm">No blocked IPs detected</div>;
  }

  return (
    <div className="space-y-3">
      {attackers.map((attacker, idx) => (
        <div key={idx} className="bg-bg/50 p-4 rounded border border-red-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span className="font-mono text-accent-bright font-bold">{attacker.ip}</span>
            </div>
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30">
              {attacker.blockedCount} blocks
            </span>
          </div>
          <div className="text-xs text-gray-400 space-y-1">
            <div>Last seen: {new Date(attacker.lastSeen).toLocaleString()}</div>
            {attacker.targetPorts.length > 0 && (
              <div>
                Target ports:{' '}
                <span className="text-accent">{attacker.targetPorts.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Ports Tab Component
function PortsTab({ portScan }: { portScan: PortScanResult | null }) {
  if (!portScan) {
    return <div className="text-gray-400 text-sm">No port scan data available</div>;
  }

  return (
    <div className="space-y-4">
      {/* Local Ports */}
      <div className="bg-bg/50 p-4 rounded border border-accent/20">
        <h4 className="text-sm font-bold text-accent mb-3">
          Local Listening Ports ({portScan.localPorts.length})
        </h4>
        <div className="space-y-2 max-h-60 overflow-auto">
          {portScan.localPorts.length === 0 ? (
            <div className="text-gray-400 text-xs">No local ports found</div>
          ) : (
            portScan.localPorts.map((port, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 text-xs bg-bg/30 p-2 rounded border border-accent/10"
              >
                <span className="text-accent-bright font-mono font-bold w-16">{port.port}</span>
                <span className="text-gray-500 w-12">{port.protocol}</span>
                <span className="text-accent flex-1">{port.service}</span>
                {port.program && <span className="text-gray-400 font-mono">{port.program}</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* External Ports */}
      <div className="bg-bg/50 p-4 rounded border border-orange-500/30">
        <h4 className="text-sm font-bold text-accent-bright mb-3">
          Externally Visible Ports ({portScan.externalPorts.length})
        </h4>
        <div className="space-y-2 max-h-60 overflow-auto">
          {portScan.externalPorts.length === 0 ? (
            <div className="text-gray-400 text-xs">No externally visible ports (good!)</div>
          ) : (
            portScan.externalPorts.map((port, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 text-xs bg-orange-500/10 p-2 rounded border border-orange-500/30"
              >
                <span className="text-accent-bright font-mono font-bold w-16">{port.port}</span>
                <span className="text-gray-500 w-12">{port.protocol}</span>
                <span className="text-orange-300 flex-1">{port.service}</span>
                <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded">
                  OPEN
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 text-center">
        Last scan: {new Date(portScan.scanTime).toLocaleString()}
      </div>
    </div>
  );
}
