// Wire types shared between server (Express API) and frontend (React widgets).
// Only shapes that serialize 1:1 over JSON belong here — types containing Date
// objects stay local to each side, since JSON turns Dates into strings on the
// way to the client.

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

// ---- Moira board (/api/moira/tasks) ----

export type MoiraStatus = 'todo' | 'doing' | 'review' | 'done';

export interface MoiraActivity {
  number: string;
  state: 'working' | 'idle';
  summary: string;
  /** Seconds since the session last reported. */
  age: number;
}

export interface MoiraTask {
  file: string;
  number: string;
  title: string;
  status: MoiraStatus;
  project: string;
  created: string;
  body: string;
  /** todo without a `## Plan` section: raw idea that still needs formulating and planning. */
  idea: boolean;
  preview: string;
  previewCmd: string;
}
