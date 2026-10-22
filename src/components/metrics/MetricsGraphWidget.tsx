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
          <div className="flex-1 min-h-45">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--text-dim)" />
                <YAxis stroke="var(--text-dim)" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--r-md)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="var(--accent-bright)"
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
