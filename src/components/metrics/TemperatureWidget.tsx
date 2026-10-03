import { Thermometer } from 'lucide-react';
import { MetricsShell } from './MetricsShell';

export function TemperatureWidget() {
  return (
    <MetricsShell title="TEMPERATURE" icon={<Thermometer className="text-accent-bright w-5 h-5" />}>
      {metrics =>
        metrics.temperature.available ? (
          <div className="space-y-1">
            <div className="text-4xl font-bold text-accent-bright">
              {metrics.temperature.main.toFixed(1)}°C
            </div>
            <div className="text-xs text-gray-400">Max: {metrics.temperature.max.toFixed(1)}°C</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-gray-400 text-sm">Not Available</div>
            <div className="text-xs text-gray-500 border-l-2 border-gray-700 pl-3">
              {metrics.temperature.reason || 'Temperature sensors not detected'}
            </div>
          </div>
        )
      }
    </MetricsShell>
  );
}
