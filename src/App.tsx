import { useState, useEffect, useMemo } from 'react';
import GridLayout from 'react-grid-layout/legacy';
import { CpuWidget } from './components/metrics/CpuWidget';
import { MemoryWidget } from './components/metrics/MemoryWidget';
import { MetricsGraphWidget } from './components/metrics/MetricsGraphWidget';
import { VramWidget } from './components/metrics/VramWidget';
import { StorageWidget } from './components/metrics/StorageWidget';
import { TemperatureWidget } from './components/metrics/TemperatureWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { GitHubStats } from './components/GitHubStats';
import { ServiceStatus } from './components/ServiceStatus';
import { NetworkOutageMap } from './components/NetworkOutageMap';
import { WebScraper } from './components/WebScraper';
import { MarkdownEditor } from './components/MarkdownEditor';
import { SoundManager } from './components/SoundManager';
import { GitStatus } from './components/GitStatus';
import { DockerWidget } from './components/DockerWidget';
import { SettingsPanel } from './components/SettingsPanel';
import { useSetting } from './lib/settings';
import { Toaster } from './components/Toaster';
import {
  RotateCcw,
  Eye,
  EyeOff,
  Save,
  Settings,
  Activity,
  ChartLine,
  CloudSun,
  Container,
  Cpu,
  FileText,
  GitBranch,
  Github,
  Globe,
  Gpu,
  HardDrive,
  MemoryStick,
  Move,
  Radio,
  Thermometer,
} from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import { apiFetch } from './lib/api';

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

// 12-column grid layout with standardized sizes.
// Every row's widths sum to exactly 12 and all items in a row share the same
// height, so react-grid-layout's vertical compaction can never stagger
// columns into a "staircase" — each row's bottom edge lines up cleanly for
// the next row.
const defaultLayout = [
  // Row 1: CPU, Storage + performance graph
  { i: 'metrics-cpu', x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
  { i: 'metrics-storage', x: 3, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
  { i: 'metrics-graph', x: 6, y: 0, w: 6, h: 4, minW: 6, minH: 3 },

  // Row 2: Memory, VRAM, Temperature — compact half-height strip
  { i: 'metrics-memory', x: 0, y: 4, w: 4, h: 2, minW: 3, minH: 2 },
  { i: 'metrics-vram', x: 4, y: 4, w: 4, h: 2, minW: 3, minH: 2 },
  { i: 'metrics-temp', x: 8, y: 4, w: 4, h: 2, minW: 3, minH: 2 },

  // Row 3: Dev tools
  { i: 'git-status', x: 0, y: 6, w: 6, h: 6, minW: 4, minH: 4 },
  { i: 'docker', x: 6, y: 6, w: 6, h: 6, minW: 4, minH: 4 },

  // Row 4: Services
  { i: 'github', x: 0, y: 12, w: 4, h: 4, minW: 4, minH: 4 },
  { i: 'service-status', x: 4, y: 12, w: 4, h: 4, minW: 4, minH: 4 },
  { i: 'weather', x: 8, y: 12, w: 4, h: 4, minW: 4, minH: 4 },

  // Row 5: Network + scraper
  { i: 'network-outage', x: 0, y: 16, w: 6, h: 4, minW: 6, minH: 4 },
  { i: 'web-scraper', x: 6, y: 16, w: 6, h: 4, minW: 3, minH: 3 },

  // Row 6: Markdown editor (full width for editing room)
  { i: 'markdown-editor', x: 0, y: 20, w: 12, h: 4, minW: 6, minH: 3 },
];

// Below this width the grid collapses to one column (phones via the Pforte gateway).
const MOBILE_BREAKPOINT = 768;
// Page padding: px-3 on phones, px-6 above; the grid width must match.
const gridWidth = (viewport: number) => viewport - (viewport < MOBILE_BREAKPOINT ? 24 : 48);

const defaultEnabledWidgets = {
  'metrics-cpu': true,
  'metrics-memory': true,
  'metrics-graph': true,
  'metrics-vram': true,
  'metrics-storage': true,
  'metrics-temp': true,
  'markdown-editor': true,
  'web-scraper': true,
  weather: true,
  github: true,
  'service-status': true,
  'network-outage': true,
  'git-status': true,
  docker: true,
};

type WidgetStatus = 'ready' | 'warning' | 'disabled';

interface WidgetHealth {
  status: WidgetStatus;
  message?: string;
}

const widgetConfig = {
  'metrics-cpu': { name: 'CPU', icon: Cpu, component: CpuWidget },
  'metrics-memory': { name: 'MEMORY', icon: MemoryStick, component: MemoryWidget },
  'metrics-graph': { name: 'PERFORMANCE', icon: ChartLine, component: MetricsGraphWidget },
  'metrics-vram': { name: 'VRAM', icon: Gpu, component: VramWidget },
  'metrics-storage': { name: 'STORAGE', icon: HardDrive, component: StorageWidget },
  'metrics-temp': { name: 'TEMPERATURE', icon: Thermometer, component: TemperatureWidget },
  'markdown-editor': { name: 'MARKDOWN EDITOR', icon: FileText, component: MarkdownEditor },
  'web-scraper': { name: 'WEB SCRAPER', icon: Globe, component: WebScraper },
  weather: { name: 'WEATHER', icon: CloudSun, component: WeatherWidget },
  github: { name: 'GITHUB STATS', icon: Github, component: GitHubStats },
  'service-status': { name: 'SERVICE STATUS', icon: Activity, component: ServiceStatus },
  'network-outage': { name: 'NETWORK OUTAGES', icon: Radio, component: NetworkOutageMap },
  'git-status': { name: 'GIT STATUS', icon: GitBranch, component: GitStatus },
  docker: { name: 'DOCKER', icon: Container, component: DockerWidget },
};

// Drops keys of removed widgets and fills in widgets the saved selection predates.
function parseEnabledWidgets(data: unknown): Record<string, boolean> | null {
  if (typeof data !== 'object' || data === null) return null;
  const entries = Object.entries(data).filter(([key]) => Object.hasOwn(widgetConfig, key));
  if (!entries.every(([, value]) => typeof value === 'boolean')) return null;
  return { ...defaultEnabledWidgets, ...Object.fromEntries(entries) };
}

const METRIC_WIDGET_IDS = [
  'metrics-cpu',
  'metrics-memory',
  'metrics-graph',
  'metrics-vram',
  'metrics-storage',
  'metrics-temp',
];

// One-time migration: split legacy single 'metrics' widget into 6 individual
// metric widgets. Runs at module load so useState initializers see the new keys.
function migrateLegacyMetrics() {
  try {
    const layoutRaw = localStorage.getItem('dashboard-layout');
    if (layoutRaw) {
      const parsed = JSON.parse(layoutRaw);
      if (
        Array.isArray(parsed) &&
        parsed.some((i: { i: string }) => i.i === 'metrics') &&
        !parsed.some((i: { i: string }) => METRIC_WIDGET_IDS.includes(i.i))
      ) {
        const legacy = parsed.find((i: LayoutItem) => i.i === 'metrics') ?? {
          i: 'metrics',
          x: 6,
          y: 0,
          w: 6,
          h: 6,
        };
        const replacements: LayoutItem[] = [
          { i: 'metrics-cpu', x: legacy.x, y: legacy.y, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'metrics-memory', x: legacy.x + 3, y: legacy.y, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'metrics-graph', x: legacy.x, y: legacy.y + 4, w: 6, h: 4, minW: 4, minH: 3 },
          { i: 'metrics-vram', x: legacy.x, y: legacy.y + 8, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'metrics-storage', x: legacy.x + 3, y: legacy.y + 8, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'metrics-temp', x: legacy.x, y: legacy.y + 12, w: 3, h: 3, minW: 3, minH: 3 },
        ];
        const filtered = parsed.filter((i: LayoutItem) => i.i !== 'metrics');
        localStorage.setItem('dashboard-layout', JSON.stringify([...filtered, ...replacements]));
      }
    }
  } catch {
    // Silent migration failure — falls back to defaults
  }

  try {
    const enabledRaw = localStorage.getItem('enabled-widgets');
    if (enabledRaw) {
      const parsed = JSON.parse(enabledRaw);
      if (parsed && typeof parsed === 'object' && 'metrics' in parsed) {
        const { metrics: legacyEnabled, ...rest } = parsed;
        const next: Record<string, boolean> = { ...rest };
        for (const id of METRIC_WIDGET_IDS) {
          if (!(id in next)) next[id] = legacyEnabled === true;
        }
        localStorage.setItem('enabled-widgets', JSON.stringify(next));
      }
    }
  } catch {
    // Silent migration failure
  }
}

// Bump whenever defaultLayout's positions/sizes change meaningfully.
// Stale saved layouts (from an older defaultLayout revision) are discarded
// so users get the fixed layout automatically, without having to know to
// press "Reset".
const LAYOUT_VERSION = 4;

function invalidateStaleLayout() {
  try {
    const storedVersion = localStorage.getItem('dashboard-layout-version');
    if (storedVersion !== String(LAYOUT_VERSION)) {
      localStorage.removeItem('dashboard-layout');
      localStorage.setItem('dashboard-layout-version', String(LAYOUT_VERSION));
    }
  } catch {
    // Silent fallback — saved layout (if any) is kept
  }
}

invalidateStaleLayout();
migrateLegacyMetrics();

// Check widget health (service availability, config status)
async function checkWidgetHealth(widgetId: string): Promise<WidgetHealth> {
  try {
    switch (widgetId) {
      case 'web-scraper':
        // Check backend server
        try {
          const res = await apiFetch('/api/metrics', { signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error('Backend not available');
          return { status: 'ready' };
        } catch {
          return { status: 'warning', message: 'Backend server not running' };
        }

      default:
        // All other widgets have no external dependencies
        return { status: 'ready' };
    }
  } catch {
    return { status: 'warning', message: 'Service check failed' };
  }
}

function App() {
  const [layout, setLayout] = useState<LayoutItem[]>(() => {
    try {
      const saved = localStorage.getItem('dashboard-layout');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            item =>
              typeof item === 'object' &&
              item !== null &&
              typeof item.i === 'string' &&
              typeof item.x === 'number'
          )
        ) {
          return parsed;
        }
      }
    } catch {
      // Silent fallback to default
    }
    return defaultLayout;
  });

  const [enabledWidgets, setEnabledWidgets] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('enabled-widgets');
      if (saved) {
        const parsed = parseEnabledWidgets(JSON.parse(saved));
        if (parsed) return parsed;
      }
    } catch {
      // Silent fallback to default
    }
    return defaultEnabledWidgets;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [showWidgetControls, setShowWidgetControls] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? gridWidth(window.innerWidth) : 2500
  );

  // Persisted + synced with SettingsPanel automatically
  const [githubUsername] = useSetting('github-username', '');
  const [showSettings, setShowSettings] = useState(false);

  const [widgetHealth, setWidgetHealth] = useState<Record<string, WidgetHealth>>({});

  // Periodic health check for enabled widgets
  useEffect(() => {
    const checkAllWidgets = async () => {
      const healthChecks = await Promise.all(
        Object.keys(widgetConfig).map(async widgetId => {
          if (!enabledWidgets[widgetId]) {
            return [widgetId, { status: 'disabled' as WidgetStatus }];
          }
          const health = await checkWidgetHealth(widgetId);
          return [widgetId, health];
        })
      );
      setWidgetHealth(Object.fromEntries(healthChecks));
    };

    checkAllWidgets();
    const interval = setInterval(checkAllWidgets, 60000); // Check every 60s (reduced from 10s)
    return () => clearInterval(interval);
  }, [enabledWidgets]);

  // Side effects (localStorage, setLayout) live outside the state updater —
  // updaters must be pure (StrictMode runs them twice).
  const toggleWidget = (widgetId: string) => {
    const wasEnabled = enabledWidgets[widgetId];
    const updated = { ...enabledWidgets, [widgetId]: !wasEnabled };
    setEnabledWidgets(updated);
    localStorage.setItem('enabled-widgets', JSON.stringify(updated));

    if (!wasEnabled && !layout.some((item: { i: string }) => item.i === widgetId)) {
      const maxY = layout.reduce(
        (max: number, item: LayoutItem) => Math.max(max, item.y + item.h),
        0
      );

      const newItem = {
        i: widgetId,
        x: 0,
        y: maxY,
        w: 12,
        h: 6,
        minW: 4,
        minH: 4,
      };

      const newLayout = [...layout, newItem];
      setLayout(newLayout);
      localStorage.setItem('dashboard-layout', JSON.stringify(newLayout));
    }
  };

  const manualSave = () => {
    localStorage.setItem('dashboard-layout', JSON.stringify(layout));
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const isMobile = containerWidth < MOBILE_BREAKPOINT - 24;
  // Phones: one column in desktop reading order (row by row, left to right), fixed in
  // place. Derived on the fly and never saved, so the desktop layout stays untouched.
  const mobileLayout = useMemo(() => {
    const stacked: LayoutItem[] = [];
    for (const item of [...layout].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const prev = stacked.at(-1);
      stacked.push({
        ...item,
        x: 0,
        y: prev ? prev.y + prev.h : 0,
        w: 1,
        minW: 1,
        h: Math.max(item.h, 3),
      });
    }
    return stacked;
  }, [layout]);

  const saveLayout = (newLayout: ReadonlyArray<LayoutItem>) => {
    setLayout(newLayout as LayoutItem[]);
    localStorage.setItem('dashboard-layout', JSON.stringify(newLayout));
  };

  const resetLayout = () => {
    // Reset to default layout but only include enabled widgets
    const resetLayout = defaultLayout.filter(item => enabledWidgets[item.i]);
    setLayout(resetLayout);
    localStorage.setItem('dashboard-layout', JSON.stringify(resetLayout));
  };

  useEffect(() => {
    const handleResize = () => {
      setContainerWidth(gridWidth(window.innerWidth));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="min-h-screen">
      <header
        className="border-b border-line backdrop-blur-sm sticky top-0 z-50"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="px-3 py-3 md:px-6 md:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="ds-brand">
              <img src="/favicon.svg" alt="" />
              <h1>Leitstand</h1>
            </div>
            <div className="flex items-center gap-2">
              <SoundManager />
              <div className="w-px h-6 bg-line" />
              <button
                onClick={() => setShowWidgetControls(!showWidgetControls)}
                className="ds-btn"
                title="Toggle Widgets"
              >
                {showWidgetControls ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span className="hidden sm:inline">Widgets</span>
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`ds-btn ${showSettings ? 'active' : ''}`}
                title="Settings"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Settings</span>
              </button>
              {/* Layout actions only where the layout can be edited (not in the fixed phone view) */}
              {!isMobile && (
                <>
                  <button
                    onClick={manualSave}
                    className={`ds-btn ${showSaved ? 'text-good' : ''}`}
                    title="Save Layout"
                  >
                    <Save className="w-4 h-4" />
                    <span className="hidden sm:inline">{showSaved ? 'Saved!' : 'Save'}</span>
                  </button>
                  <button onClick={resetLayout} className="ds-btn" title="Reset Layout to Default">
                    <RotateCcw className="w-4 h-4" />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {showWidgetControls && (
            <div className="mt-4 pt-4 border-t border-line space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-bold text-accent">WIDGET VISIBILITY</h3>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span>Running</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-yellow-500 widget-pulse" />
                      <span>Warning</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span>Disabled</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {Object.entries(widgetConfig).map(([id, config]) => {
                    const health = widgetHealth[id] || { status: 'ready' };
                    const isEnabled = enabledWidgets[id];
                    const hasWarning = isEnabled && health.status === 'warning';

                    return (
                      <button
                        key={id}
                        onClick={() => toggleWidget(id)}
                        title={health.message || (isEnabled ? 'Enabled' : 'Disabled')}
                        className={`p-2 rounded text-xs font-mono transition-all flex items-center gap-2 relative ${
                          !isEnabled
                            ? 'bg-red-900/30 border border-red-500/50 text-red-300'
                            : hasWarning
                              ? 'bg-yellow-900/30 border border-yellow-500/50 text-yellow-300'
                              : 'bg-green-900/30 border border-green-500/50 text-green-300'
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${
                            !isEnabled
                              ? 'bg-red-500'
                              : hasWarning
                                ? 'bg-yellow-500 widget-pulse'
                                : 'bg-green-500'
                          }`}
                        />
                        <config.icon size={12} className="shrink-0" />
                        <span className="truncate">{config.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <Toaster />

      <div className="px-3 py-3 md:px-6 md:py-6">
        <GridLayout
          className="layout"
          layout={isMobile ? mobileLayout : layout}
          cols={isMobile ? 1 : 12}
          rowHeight={isMobile ? 80 : 120}
          width={containerWidth}
          onLayoutChange={isMobile ? undefined : saveLayout}
          onDragStart={() => setIsDragging(true)}
          onDragStop={() => setIsDragging(false)}
          draggableHandle=".drag-handle"
          isDraggable={!isMobile}
          isResizable={!isMobile}
          compactType="vertical"
          preventCollision={false}
        >
          {Object.entries(widgetConfig).map(([id, config]) => {
            if (!enabledWidgets[id]) return null;

            const WidgetComponent = config.component;

            return (
              <div
                key={id}
                className={isDragging ? 'dragging' : ''}
                style={{ pointerEvents: 'auto' }}
              >
                <div className="drag-handle group cursor-move p-2 border-b border-line hover:bg-accent/10 select-none">
                  <div className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
                    <config.icon size={12} />
                    {config.name}
                    <Move
                      size={12}
                      className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
                <div
                  className="p-4 overflow-auto"
                  style={{ height: 'calc(100% - 48px)', pointerEvents: 'auto' }}
                >
                  {id === 'github' ? (
                    <WidgetComponent username={githubUsername} />
                  ) : (
                    <WidgetComponent />
                  )}
                </div>
              </div>
            );
          })}
        </GridLayout>

        <footer className="mt-12 py-6 border-t border-line text-center">
          <p className="text-sm text-gray-500">
            Leitstand // Powered by React 19 + Vite 7 + Tailwind 4
          </p>
          <p className="text-xs text-gray-600 mt-2">Widgets per Drag &amp; Drop anordnen</p>
          <p className="text-xs text-gray-700 mt-2">
            Crafted by <span style={{ color: 'var(--color-accent)' }}>𐌀𐌋𐌀𐌉𐌍</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
