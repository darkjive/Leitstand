import { useState, useEffect } from 'react';
import { Cloud, Server, Globe, Wifi, Circle, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ServiceStatus {
  name: string;
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  description: string;
  statusUrl: string;
}

const ICONS: Record<string, LucideIcon> = {
  Cloudflare: Cloud,
  GitHub: Server,
  OpenAI: Server,
  Anthropic: Server,
  Vercel: Globe,
};

export function ServiceStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/service-status');
      if (!res.ok) return;
      const data = await res.json();
      setServices(data.services);
      setLastUpdated(new Date(data.timestamp));
    } catch {
      // Backend not ready yet or unavailable
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'operational':
        return 'text-green-500';
      case 'degraded':
        return 'text-yellow-500';
      case 'outage':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'operational':
        return 'OPERATIONAL';
      case 'degraded':
        return 'DEGRADED';
      case 'outage':
        return 'OUTAGE';
      default:
        return 'UNKNOWN';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-accent">
          CHECKING SERVICES<span className="blink-cursor"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-bold">SERVICE STATUS</h3>
        </div>
        <button
          onClick={fetchStatus}
          className="p-1.5 hover:bg-accent/10 rounded transition-all"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-accent" />
        </button>
      </div>

      <div className="space-y-2">
        {services.map(service => {
          const Icon = ICONS[service.name] ?? Globe;
          return (
            <a
              key={service.name}
              href={service.statusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 bg-bg rounded border border-line hover:border-accent transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="font-mono text-sm">{service.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Circle className={`w-3 h-3 fill-current ${getStatusColor(service.status)}`} />
                  <span className={`text-xs font-bold ${getStatusColor(service.status)}`}>
                    {getStatusLabel(service.status)}
                  </span>
                </div>
              </div>
              {service.description && service.status !== 'operational' && (
                <div className="text-xs text-gray-400 mt-1 ml-7">{service.description}</div>
              )}
            </a>
          );
        })}
      </div>

      {lastUpdated && (
        <div className="mt-4 text-xs text-gray-500 text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
