// Wire types shared between server (Express API) and frontend (React widgets).
// Only shapes that serialize 1:1 over JSON belong here — types containing Date
// objects (UFW logs, port-scan results) stay local to each side, since JSON
// turns Dates into strings on the way to the client.

// ---- System metrics (/api/metrics, WebSocket /ws) ----

export interface VramGpu {
  vendor: string;
  model: string;
  totalMb: number;
  usedMb?: number;
  percentage?: string;
}

export interface MetricsData {
  cpu: { usage: string; cores: { usage: string }[] };
  memory: { total: number; used: number; free: number; percentage: string };
  disk: { fs: string; mount: string; size: number; used: number; percentage: number }[];
  temperature: { main: number; max: number; cores: number[]; available: boolean; reason?: string };
  vram: { gpus: VramGpu[]; available: boolean; dynamic: boolean; reason?: string };
  platform: string;
  timestamp: number;
}

// ---- Docker (/api/docker) ----

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  started: number;
  ports: string[];
  mounts: string[];
  cpu?: number;
  memory?: number;
}

export interface DockerInfo {
  containers: DockerContainer[];
  running: number;
  stopped: number;
  total: number;
  available: boolean;
  error?: string;
}

// ---- Git (/api/git/*) ----

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  recentCommits: GitCommit[];
  hasChanges: boolean;
}

export type RepoState =
  'clean' | 'dirty' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'conflict' | 'error';

export interface RepoSummary {
  path: string;
  name: string;
  root: string;
  branch: string;
  state: RepoState;
  ahead: number;
  behind: number;
  changedFiles: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  hasUpstream: boolean;
  lastCommit?: {
    hash: string;
    message: string;
    date: string;
    author: string;
  };
  error?: string;
}

export interface BulkResultItem {
  path: string;
  name: string;
  success: boolean;
  message: string;
}

// ---- npm scripts (/api/npm/*) ----

export interface PackageScripts {
  scripts: Record<string, string>;
  projectName: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
}

export interface ScriptOutput {
  output: string;
  exitCode: number | null;
  isRunning: boolean;
}

// ---- Log aggregator (/api/logs/*) ----

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'UNKNOWN';

export interface LogFile {
  id: string;
  name: string;
  path: string;
  color: string;
}

export interface LogLine {
  id: string;
  timestamp: string;
  source: string;
  level: LogLevel;
  message: string;
  color: string;
}

export interface LogSuggestion {
  category: 'System' | 'Services' | 'Dev' | 'AI Agents';
  name: string;
  path: string;
}

// ---- Port killer (/api/ports) ----

export interface DevPortInfo {
  port: number;
  pid: number;
  protocol: string;
  processName: string;
  command: string;
}

// ---- Port scanner (/api/firewall/ports) ----

export interface ScannedPort {
  port: number;
  protocol: 'TCP' | 'UDP';
  state: string;
  service: string;
  pid?: number;
  program?: string;
  bindAddress?: string;
  // Set on externalPorts: who can connect (all interfaces, LAN address, Tailscale only)
  exposure?: 'all' | 'lan' | 'tailscale';
}

// ---- Web scraper (/api/scrape) ----

export interface ScrapeResult {
  url: string;
  title: string;
  markdown: string;
  metadata: {
    depth: number;
    pagesScraped: number;
    timestamp: string;
    links: string[];
  };
}

// ---- Weather (/api/weather) ----

export interface WeatherData {
  current_condition: Array<{
    temp_C: string;
    weatherDesc: Array<{ value: string }>;
    humidity: string;
    windspeedKmph: string;
    FeelsLikeC: string;
  }>;
  nearest_area: Array<{
    areaName: Array<{ value: string }>;
    country: Array<{ value: string }>;
  }>;
}
