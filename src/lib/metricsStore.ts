import { useSyncExternalStore } from 'react';
import type { MetricsData } from '../../shared/types';
import { apiFetch, wsUrlWithToken } from './api';

// Singleton metrics store: opens ONE WebSocket (with HTTP polling fallback)
// and shares the stream with every metrics widget via useSyncExternalStore.
// No React Context (per AGENTS.md "no Redux/Context") — useSyncExternalStore
// is the React-blessed way to consume external mutable state.

export interface HistoricalPoint {
  time: string;
  cpu: number;
  memory: number;
}

export type MetricsStatus = 'connecting' | 'connected' | 'disconnected';

export interface MetricsState {
  metrics: MetricsData | null;
  history: HistoricalPoint[];
  status: MetricsStatus;
  error: string | null;
  loading: boolean;
}

const MAX_HISTORY = 20;
const MAX_WS_FAILS = 3;
const WS_TIMEOUT_MS = 5000;
const WS_RECONNECT_MS = 5000;
const POLL_INTERVAL_MS = 2000;

let state: MetricsState = {
  metrics: null,
  history: [],
  status: 'connecting',
  error: null,
  loading: true,
};

const listeners = new Set<() => void>();
let initialized = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let wsFailCount = 0;
let ws: WebSocket | null = null;
let connectTimeout: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

function patch(p: Partial<MetricsState>) {
  state = { ...state, ...p };
  notify();
}

function pushSample(metrics: MetricsData) {
  const point: HistoricalPoint = {
    time: new Date().toLocaleTimeString(),
    cpu: parseFloat(metrics.cpu.usage),
    memory: parseFloat(metrics.memory.percentage),
  };
  state = {
    ...state,
    metrics,
    history: [...state.history, point].slice(-MAX_HISTORY),
    status: 'connected',
    error: null,
    loading: false,
  };
  notify();
}

function startPolling() {
  if (pollingTimer) return;
  patch({ status: 'connected', loading: false });

  const fetchMetrics = async () => {
    try {
      const res = await apiFetch('/api/metrics');
      if (!res.ok) throw new Error('HTTP error');
      const data: MetricsData = await res.json();
      if (!data.cpu || !data.memory) return;
      pushSample(data);
    } catch {
      patch({ error: 'Cannot reach metrics service' });
    }
  };

  fetchMetrics();
  pollingTimer = setInterval(fetchMetrics, POLL_INTERVAL_MS);
}

function connectWebSocket() {
  if (wsFailCount >= MAX_WS_FAILS) {
    startPolling();
    return;
  }

  patch({ status: 'connecting' });

  const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = wsUrlWithToken(`${wsProto}://${window.location.host}/ws`);

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    wsFailCount++;
    scheduleReconnectOrPoll();
    return;
  }

  let openHandled = false;
  // One failure per socket: error, timeout and close all fire for the same dead
  // connection and would otherwise count it up to three times.
  let failCounted = false;
  const countFailure = () => {
    if (openHandled || failCounted) return;
    failCounted = true;
    wsFailCount++;
  };
  const socket = ws;

  connectTimeout = setTimeout(() => {
    // close() on a CONNECTING socket fires onclose, which counts + reschedules
    if (!openHandled) socket.close();
  }, WS_TIMEOUT_MS);

  ws.onopen = () => {
    openHandled = true;
    if (connectTimeout) clearTimeout(connectTimeout);
    wsFailCount = 0;
    patch({ status: 'connected', loading: false, error: null });
  };

  ws.onmessage = event => {
    try {
      const data: MetricsData = JSON.parse(event.data);
      if (!data.cpu || !data.memory) return;
      pushSample(data);
    } catch {
      // Silent parse error
    }
  };

  ws.onerror = () => {
    if (!openHandled) {
      countFailure();
      patch({ status: 'disconnected', error: 'WebSocket connection failed' });
    }
  };

  ws.onclose = () => {
    if (connectTimeout) clearTimeout(connectTimeout);
    patch({ status: 'disconnected' });
    countFailure();
    scheduleReconnectOrPoll();
  };
}

function scheduleReconnectOrPoll() {
  if (wsFailCount >= MAX_WS_FAILS) {
    startPolling();
  } else if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, WS_RECONNECT_MS);
  }
}

function ensureStarted() {
  if (initialized) return;
  initialized = true;
  connectWebSocket();
}

function teardown() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (connectTimeout) {
    // A stale timer would close the NEXT socket (React StrictMode mounts twice)
    clearTimeout(connectTimeout);
    connectTimeout = null;
  }
  if (ws) {
    // Detach every handler so the dead socket cannot touch the fresh state.
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
    ws = null;
  }
  initialized = false;
  wsFailCount = 0;
  state = { metrics: null, history: [], status: 'connecting', error: null, loading: true };
}

function subscribe(cb: () => void): () => void {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) teardown();
  };
}

function getSnapshot(): MetricsState {
  return state;
}

export function useMetrics(): MetricsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
