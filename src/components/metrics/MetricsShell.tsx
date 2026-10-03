import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MetricsData } from '../../../shared/types';
import { useMetrics } from '../../lib/metricsStore';

interface MetricsShellProps {
  title: string;
  icon: ReactNode;
  children: (metrics: MetricsData) => ReactNode;
}

export function MetricsShell({ title, icon, children }: MetricsShellProps) {
  const { metrics, loading, error, status } = useMetrics();

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-base font-bold">{title}</h3>
        <div
          className={`w-2 h-2 rounded-full ml-auto ${
            status === 'connected'
              ? 'bg-green-500 animate-pulse'
              : status === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-red-500'
          }`}
          title={
            status === 'connected'
              ? 'LIVE'
              : status === 'connecting'
                ? 'CONNECTING'
                : 'DISCONNECTED'
          }
        />
        <span
          className="text-[10px] font-mono uppercase tracking-wider text-gray-400"
          aria-live="polite"
        >
          {status === 'connected' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
        </span>
      </div>

      <div className="flex-1">
        {loading ? (
          <div className="text-accent text-sm">
            CONNECTING
            <span className="blink-cursor" />
          </div>
        ) : error ? (
          <div className="text-red-500 text-sm">
            <AlertTriangle size={14} className="inline mr-1" />
            {error}
            {status !== 'connected' && (
              <div className="text-xs text-gray-500 mt-1">Attempting to reconnect…</div>
            )}
          </div>
        ) : !metrics ? (
          <div className="text-gray-400 text-sm">Waiting for data...</div>
        ) : (
          children(metrics)
        )}
      </div>
    </div>
  );
}
