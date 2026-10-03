import { LineChart as LineChartIcon } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { MetricsShell } from './MetricsShell';
import { useMetrics } from '../../lib/metricsStore';

export function MetricsGraphWidget() {
  const { history } = useMetrics();

  return (
    <MetricsShell
      title="REAL-TIME PERFORMANCE"
      icon={<LineChartIcon className="text-accent w-5 h-5" />}
    >
      {() => (
        <div className="space-y-2 h-full flex flex-col">
          <div className="flex-1 min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212, 165, 116, 0.1)" />
                <XAxis dataKey="time" stroke="rgba(212, 165, 116, 0.5)" />
                <YAxis stroke="rgba(212, 165, 116, 0.5)" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#161b22',
                    border: '1px solid rgba(212, 165, 116, 0.2)',
                    borderRadius: '8px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#d4a574"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="#e8b985"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-accent rounded" />
              <span>CPU</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-accent-bright rounded" />
              <span>Memory</span>
            </div>
          </div>
        </div>
      )}
    </MetricsShell>
  );
}
