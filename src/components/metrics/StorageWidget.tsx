import { HardDrive } from 'lucide-react';
import { MetricsShell } from './MetricsShell';

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function StorageWidget() {
  return (
    <MetricsShell title="STORAGE" icon={<HardDrive className="text-accent w-5 h-5" />}>
      {metrics =>
        metrics.disk.length > 0 ? (
          <div className="space-y-3">
            {metrics.disk.slice(0, 3).map((disk, i) => (
              <div
                key={i}
                className="border-t border-line pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 font-mono text-xs">{disk.mount}</span>
                  <span className="text-accent font-bold text-sm">
                    {disk.percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-gray-500">
                    {formatBytes(disk.used)} / {formatBytes(disk.size)}
                  </span>
                  <span className="text-gray-500">{formatBytes(disk.size - disk.used)} free</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      disk.percentage > 90
                        ? 'bg-red-500'
                        : disk.percentage > 70
                          ? 'bg-accent-bright'
                          : 'bg-accent'
                    }`}
                    style={{ width: `${disk.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No storage devices detected</div>
        )
      }
    </MetricsShell>
  );
}
