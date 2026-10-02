import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { resolve } from 'path';

try {
  process.loadEnvFile();
} catch {
  // .env optional
}
import { getSystemMetrics } from './services/systemMetrics.js';
import { getWeather } from './services/weather.js';
import { scrapeUrl } from './services/scraper.js';
import { getActiveDevPorts, killPortProcess, getPortKillerStatus } from './services/portKiller.js';
import {
  getGitStatus,
  gitPull,
  gitPush,
  gitCommit,
  scanGitRepos,
  gitFetch,
  bulkPull,
  bulkPush,
  bulkCommit,
  bulkFetch,
} from './services/gitStatus.js';
import {
  getPackageScripts,
  runScript,
  getScriptOutput,
  stopScript,
  getRunningProcesses,
} from './services/npmScripts.js';
import {
  startTailing,
  stopTailing,
  stopAllTailing,
  getLogLines,
  getActiveTails,
  clearLogs,
  assignColor,
  getCommonLogSuggestions,
} from './services/logAggregator.js';
import { getDockerInfo } from './services/docker.js';
import { getUFWStatus, getUFWLogs, getTopAttackers } from './services/ufw.js';
import { getPortScan, getPortScannerStatus } from './services/ports.js';
import { isPrivateHost } from './services/netGuard.js';
import type { LogFile } from '../shared/types.js';
import type { IncomingMessage } from 'http';

// Sensitive system paths that must never be touched by git operations
const BLOCKED_PATH_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/etc', '/root', '/var/log'];

/**
 * Validate a path for git operations. Unlike validatePath, this allows
 * directories outside process.cwd() (needed because users configure their
 * own Dev roots), but still blocks traversal into sensitive system areas.
 */
function validateGitPath(userPath: string): string {
  const resolvedPath = resolve(userPath);
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (resolvedPath === blocked || resolvedPath.startsWith(blocked + '/')) {
      throw new Error(`Access to path "${resolvedPath}" is blocked`);
    }
  }
  return resolvedPath;
}

/**
 * @types/express 5 types route params as `string | string[]`. A single
 * `:name` segment is always a string at runtime; arrays collapse to '' so
 * downstream allowlists reject them instead of silently stringifying.
 */
function oneParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? '' : (value ?? '');
}

const app = express();
const PORT = parseInt(process.env.PORT || '3010', 10);
// Bind to loopback by default. Set BIND_HOST=0.0.0.0 to expose on the LAN —
// make sure you understand the consequences (no auth on any endpoint).
const HOST = process.env.BIND_HOST || '127.0.0.1';
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Shared token guarding destructive endpoints (npm run, port kill, git write,
// log tail, scrape). Leave empty for loopback-only use; REQUIRED for BIND_HOST=0.0.0.0.
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';
const server = createServer(app);

// WebSocket server with proper configuration.
// Origin check is port-agnostic: any loopback origin is fine (Vite picks the
// next free port when 5173 is taken), while foreign web origins — the actual
// threat, e.g. a malicious site opening a WS to the local daemon — stay blocked.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
    // Browsers cannot set headers on a WebSocket handshake, so the token
    // travels as a query param here instead of X-Dashboard-Token.
    if (DASHBOARD_TOKEN) {
      const token = new URL(info.req.url || '/', 'http://localhost').searchParams.get('token');
      if (!token || !safeEqual(token, DASHBOARD_TOKEN)) return false;
    }
    const origin = info.origin || info.req.headers.origin;
    if (!origin) return true; // non-browser clients (curl, health checks)
    try {
      const { hostname } = new URL(origin);
      return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    } catch {
      return false;
    }
  },
});

// DNS-rebinding guard: a malicious website can point its own DNS at 127.0.0.1
// and reach this server "same-origin", bypassing CORS entirely. The Host
// header still names the attacker's domain, so an allowlist stops it. Skipped
// when the server is deliberately exposed via BIND_HOST (LAN IPs vary).
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  `[::1]:${PORT}`,
  'localhost',
  '127.0.0.1',
]);
const isLoopbackBind = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
app.use((req, res, next) => {
  if (!isLoopbackBind) return next();
  const host = req.headers.host?.toLowerCase();
  if (host && !ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: `Forbidden Host header: ${host}` });
  }
  next();
});

// CSP applies to the served frontend bundle (Electron prod / single-origin
// mode). connectSrc must list every API the widgets call directly from the
// browser — anything missing here is silently blocked in production.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'], // GitHub avatars, simpleicons CDN
        connectSrc: [
          "'self'",
          `ws://localhost:${PORT}`, // metrics WebSocket
          'https://api.github.com', // GitHubStats
          'https://hacker-news.firebaseio.com', // HackerNewsFeed
          'https://api.rss2json.com', // RSSFeed CORS proxy
        ],
        mediaSrc: ["'self'"], // SoundManager ambiance
      },
    },
  })
);

app.use(
  cors({
    origin: ['http://localhost:5180', 'http://localhost:4173', 'http://127.0.0.1:5180'],
    credentials: true,
  })
);

// Single boundary for the whole API surface — new routes are covered by default
// instead of needing to remember the guard. /health stays open so container and
// uptime probes keep working without a token. Placed ahead of the body parser so
// an unauthenticated client can never make us parse a 1 MB payload.
app.use('/api', requireToken);

app.use(express.json({ limit: '1mb' }));

/** Length-safe constant-time string compare (timingSafeEqual throws on length mismatch). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Guards the API when DASHBOARD_TOKEN is set. The gate covers reads as well as
// writes: endpoints like /api/git/scan, /api/logs/lines and /api/ports expose
// filesystem layout, log contents and running processes, so token-gating only
// the destructive half would leave an exposed instance wide open. When no token
// is configured the API stays open — fine for the loopback default.
function requireToken(req: Request, res: Response, next: NextFunction) {
  if (!DASHBOARD_TOKEN) return next(); // opt-in; no token configured → no gate
  const provided = req.get('X-Dashboard-Token');
  if (provided && safeEqual(provided, DASHBOARD_TOKEN)) return next();
  return res.status(401).json({ error: 'Unauthorized — invalid or missing X-Dashboard-Token' });
}

// Generous limit that never bites the dashboard's own polling, but caps
// runaway clients. No localhost exemption — with the default loopback bind
// every request is localhost, which would disable limiting entirely.
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 1000, // 1000 requests per minute
  message: { error: 'Too many requests, please try again later' },
});

const scraperLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Scraping rate limit exceeded' },
});

const ollamaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Ollama rate limit exceeded' },
});

app.get('/api/metrics', generalLimiter, async (_req, res) => {
  try {
    const metrics = await getSystemMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Failed to fetch system metrics:', error);
    res.status(500).json({ error: 'Failed to fetch system metrics' });
  }
});

app.get('/api/weather', generalLimiter, async (req, res) => {
  try {
    const locationSchema = z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9\s,.-]+$/);
    const location = locationSchema.parse((req.query.location as string) || 'Munich');

    const weather = await getWeather(location);
    res.json(weather);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid location format' });
    }
    console.error('Failed to fetch weather:', error);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

app.get('/api/docker', generalLimiter, async (_req, res) => {
  try {
    const dockerInfo = await getDockerInfo();
    res.json(dockerInfo);
  } catch (error) {
    console.error('Failed to fetch Docker info:', error);
    res.status(500).json({ error: 'Failed to fetch Docker info' });
  }
});

// Firewall monitoring endpoints
app.get('/api/firewall/status', generalLimiter, async (_req, res) => {
  try {
    const status = await getUFWStatus();
    res.json(status);
  } catch (error) {
    console.error('Failed to fetch UFW status:', error);
    res.status(500).json({ error: 'Failed to fetch UFW status' });
  }
});

app.get('/api/firewall/logs', generalLimiter, async (req, res) => {
  try {
    const limitSchema = z.number().int().min(1).max(1000).optional();
    const limit = limitSchema.parse(req.query.limit ? Number(req.query.limit) : 100);
    const logs = await getUFWLogs(limit);
    res.json({ logs });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    console.error('Failed to fetch UFW logs:', error);
    res.status(500).json({ error: 'Failed to fetch UFW logs' });
  }
});

app.get('/api/firewall/top-attackers', generalLimiter, async (req, res) => {
  try {
    const limitSchema = z.number().int().min(1).max(50).optional();
    const limit = limitSchema.parse(req.query.limit ? Number(req.query.limit) : 10);
    const attackers = await getTopAttackers(limit);
    res.json({ attackers });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    console.error('Failed to fetch top attackers:', error);
    res.status(500).json({ error: 'Failed to fetch top attackers' });
  }
});

app.get('/api/firewall/ports', generalLimiter, async (_req, res) => {
  try {
    const [portScan, status] = await Promise.all([getPortScan(), getPortScannerStatus()]);
    res.json({ ...portScan, tools: status });
  } catch (error) {
    console.error('Failed to perform port scan:', error);
    res.status(500).json({ error: 'Failed to perform port scan' });
  }
});

app.post('/api/scrape', scraperLimiter, async (req, res) => {
  try {
    const scrapeSchema = z.object({
      url: z.url().max(2048),
      depth: z.number().int().min(1).max(3),
      maxPages: z.number().int().min(1).max(50).optional(),
    });

    const { url, depth, maxPages } = scrapeSchema.parse(req.body);
    const urlObj = new URL(url);

    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return res.status(403).json({ error: 'Only HTTP/HTTPS protocols allowed' });
    }

    // Literal + DNS-resolved check; the scraper re-checks every navigated URL
    if (await isPrivateHost(urlObj.hostname)) {
      return res.status(403).json({ error: 'Cannot scrape internal/private networks' });
    }

    console.log(`[SCRAPER] Starting scrape: ${url} (depth: ${depth}, maxPages: ${maxPages || 50})`);

    const result = await scrapeUrl({ url, depth, maxPages });

    console.log(`[SCRAPER] Completed: ${result.metadata.pagesScraped} pages scraped`);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.issues,
      });
    }
    console.error('[SCRAPER] Failed to scrape:', error);
    res.status(500).json({
      error: 'Failed to scrape URL',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Whitelist of proxied Ollama endpoints. Everything else (delete, pull, push,
// create, …) is blocked — the dashboard reads and chats, it doesn't manage models.
const OLLAMA_GET_ENDPOINTS = new Set(['tags', 'ps', 'version']);
const OLLAMA_POST_ENDPOINTS = new Set(['generate', 'chat', 'show']);

// GET endpoint for Ollama (health checks, listing models)
app.get('/api/ollama/api/:endpoint', ollamaLimiter, async (req, res) => {
  try {
    const endpoint = oneParam(req.params.endpoint);
    if (!OLLAMA_GET_ENDPOINTS.has(endpoint)) {
      return res.status(403).json({ error: 'Ollama endpoint not allowed' });
    }
    const ollamaPath = `/api/${endpoint}`;
    const ollamaUrl = `${OLLAMA_BASE_URL}${ollamaPath}`;

    const response = await fetch(ollamaUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      // Silent fail for health checks - don't spam logs
      return res.status(503).json({
        available: false,
        error: 'Ollama service not available',
      });
    }

    const data = await response.json();
    res.json(data);
  } catch {
    // Silent fail - Ollama not running is expected
    res.status(503).json({
      available: false,
      error: 'Ollama service not running',
    });
  }
});

// POST endpoint for Ollama (chat, generate)
app.post('/api/ollama/api/:endpoint', ollamaLimiter, async (req, res) => {
  try {
    const endpoint = oneParam(req.params.endpoint);
    if (!OLLAMA_POST_ENDPOINTS.has(endpoint)) {
      return res.status(403).json({ error: 'Ollama endpoint not allowed' });
    }
    const ollamaPath = `/api/${endpoint}`;
    const ollamaUrl = `${OLLAMA_BASE_URL}${ollamaPath}`;

    console.log(`[OLLAMA PROXY] ${req.method} ${ollamaPath}`);

    const response = await fetch(ollamaUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      console.error(`[OLLAMA PROXY] Error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        error: `Ollama error: ${response.statusText}`,
        details: 'Make sure Ollama is running (ollama serve)',
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[OLLAMA PROXY] Failed:', error);
    res.status(503).json({
      error: 'Ollama service unavailable',
      details: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Run: ollama serve',
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Fetches real service status from Statuspage.io APIs
app.get('/api/service-status', generalLimiter, async (_req, res) => {
  const services = [
    {
      name: 'Cloudflare',
      apiUrl: 'https://www.cloudflarestatus.com/api/v2/status.json',
      statusUrl: 'https://www.cloudflarestatus.com/',
    },
    {
      name: 'GitHub',
      apiUrl: 'https://www.githubstatus.com/api/v2/status.json',
      statusUrl: 'https://www.githubstatus.com/',
    },
    {
      name: 'OpenAI',
      apiUrl: 'https://status.openai.com/api/v2/status.json',
      statusUrl: 'https://status.openai.com/',
    },
    {
      name: 'Anthropic',
      apiUrl: 'https://status.anthropic.com/api/v2/status.json',
      statusUrl: 'https://status.anthropic.com/',
    },
    {
      name: 'Vercel',
      apiUrl: 'https://www.vercel-status.com/api/v2/status.json',
      statusUrl: 'https://www.vercel-status.com/',
    },
  ];

  const results = await Promise.allSettled(
    services.map(async service => {
      const response = await fetch(service.apiUrl, { signal: AbortSignal.timeout(5000) });
      const data = (await response.json()) as {
        status?: { indicator?: string; description?: string };
      };
      const indicator: string = data?.status?.indicator ?? 'unknown';
      const status =
        indicator === 'none'
          ? 'operational'
          : indicator === 'minor'
            ? 'degraded'
            : indicator === 'major' || indicator === 'critical'
              ? 'outage'
              : 'unknown';
      return {
        name: service.name,
        status,
        description: data?.status?.description ?? '',
        statusUrl: service.statusUrl,
      };
    })
  );

  const statuses = results.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          name: services[i].name,
          status: 'unknown',
          description: 'Unable to fetch',
          statusUrl: services[i].statusUrl,
        }
  );

  res.json({ services: statuses, timestamp: Date.now() });
});

// HTTP HEAD connectivity checks with latency to key internet endpoints
app.get('/api/connectivity', generalLimiter, async (_req, res) => {
  const targets = [
    { name: 'Cloudflare DNS', url: 'https://1.1.1.1' },
    { name: 'Google DNS', url: 'https://8.8.8.8' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Cloudflare', url: 'https://cloudflare.com' },
    { name: 'Google', url: 'https://google.com' },
  ];

  const results = await Promise.allSettled(
    targets.map(async target => {
      const start = Date.now();
      await fetch(target.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return { name: target.name, reachable: true, latencyMs: Date.now() - start };
    })
  );

  const checks = results.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : { name: targets[i].name, reachable: false, latencyMs: null }
  );

  res.json({ checks, timestamp: Date.now() });
});

app.get('/api/ports', generalLimiter, async (_req, res) => {
  try {
    const [ports, status] = await Promise.all([getActiveDevPorts(), getPortKillerStatus()]);
    res.json({ ports, tools: status });
  } catch (error) {
    console.error('Failed to fetch active ports:', error);
    res.status(500).json({ error: 'Failed to fetch active ports' });
  }
});

app.post('/api/ports/kill', generalLimiter, async (req, res) => {
  try {
    const portSchema = z.object({
      port: z.number().int().min(1).max(65535),
    });

    const { port } = portSchema.parse(req.body);
    const result = await killPortProcess(port);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid port number' });
    }
    console.error('Failed to kill port process:', error);
    res.status(500).json({ error: 'Failed to kill process' });
  }
});

app.get('/api/git/status', generalLimiter, async (req, res) => {
  try {
    const userPath = (req.query.path as string) || process.cwd();
    const repoPath = validateGitPath(userPath);
    const status = await getGitStatus(repoPath);
    res.json(status);
  } catch (error) {
    console.error('Failed to get git status:', error);
    const message = error instanceof Error ? error.message : 'Failed to get git status';
    res.status(500).json({ error: message });
  }
});

app.post('/api/git/pull', generalLimiter, async (req, res) => {
  try {
    const userPath = (req.query.path as string) || process.cwd();
    const repoPath = validateGitPath(userPath);
    const result = await gitPull(repoPath);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Failed to pull:', error);
    res.status(500).json({ error: 'Failed to pull' });
  }
});

app.post('/api/git/push', generalLimiter, async (req, res) => {
  try {
    const userPath = (req.query.path as string) || process.cwd();
    const repoPath = validateGitPath(userPath);
    const result = await gitPush(repoPath);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Failed to push:', error);
    res.status(500).json({ error: 'Failed to push' });
  }
});

app.post('/api/git/fetch', generalLimiter, async (req, res) => {
  try {
    const userPath = (req.query.path as string) || process.cwd();
    const repoPath = validateGitPath(userPath);
    const result = await gitFetch(repoPath);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Failed to fetch:', error);
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

app.post('/api/git/commit', generalLimiter, async (req, res) => {
  try {
    const commitSchema = z.object({
      message: z.string().min(1).max(500),
    });

    const { message } = commitSchema.parse(req.body);
    const userPath = (req.query.path as string) || process.cwd();
    const repoPath = validateGitPath(userPath);
    const result = await gitCommit(message, repoPath);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid commit message' });
    }
    console.error('Failed to commit:', error);
    res.status(500).json({ error: 'Failed to commit' });
  }
});

// ============================================================
// Multi-repo overview endpoints
// ============================================================

const rootsSchema = z.object({
  roots: z.array(z.string().min(1)).min(1).max(20),
  maxDepth: z.number().int().min(1).max(8).optional(),
});

app.post('/api/git/scan', generalLimiter, async (req, res) => {
  try {
    const { roots: rawRoots, maxDepth } = rootsSchema.parse(req.body);
    const roots = rawRoots.map(validateGitPath);
    const summaries = await scanGitRepos(roots, maxDepth ?? 3);
    res.json({ repos: summaries });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid roots' });
    }
    console.error('Failed to scan git repos:', error);
    const message = error instanceof Error ? error.message : 'Failed to scan';
    res.status(500).json({ error: message });
  }
});

const bulkPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
});

app.post('/api/git/bulk/pull', generalLimiter, async (req, res) => {
  try {
    const { paths: rawPaths } = bulkPathsSchema.parse(req.body);
    const paths = rawPaths.map(validateGitPath);
    const results = await bulkPull(paths);
    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid paths' });
    }
    console.error('Failed bulk pull:', error);
    res.status(500).json({ error: 'Failed bulk pull' });
  }
});

app.post('/api/git/bulk/push', generalLimiter, async (req, res) => {
  try {
    const { paths: rawPaths } = bulkPathsSchema.parse(req.body);
    const paths = rawPaths.map(validateGitPath);
    const results = await bulkPush(paths);
    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid paths' });
    }
    console.error('Failed bulk push:', error);
    res.status(500).json({ error: 'Failed bulk push' });
  }
});

app.post('/api/git/bulk/fetch', generalLimiter, async (req, res) => {
  try {
    const { paths: rawPaths } = bulkPathsSchema.parse(req.body);
    const paths = rawPaths.map(validateGitPath);
    const results = await bulkFetch(paths);
    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid paths' });
    }
    console.error('Failed bulk fetch:', error);
    res.status(500).json({ error: 'Failed bulk fetch' });
  }
});

const bulkCommitSchema = z.object({
  items: z
    .array(
      z.object({
        path: z.string().min(1),
        message: z.string().min(1).max(500),
      })
    )
    .min(1)
    .max(200),
});

app.post('/api/git/bulk/commit', generalLimiter, async (req, res) => {
  try {
    const { items: rawItems } = bulkCommitSchema.parse(req.body);
    const items = rawItems.map(it => ({ path: validateGitPath(it.path), message: it.message }));
    const results = await bulkCommit(items);
    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid items' });
    }
    console.error('Failed bulk commit:', error);
    res.status(500).json({ error: 'Failed bulk commit' });
  }
});

app.get('/api/npm/scripts', generalLimiter, async (req, res) => {
  try {
    const repoPath = validateGitPath((req.query.path as string) || process.cwd());
    const scripts = await getPackageScripts(repoPath);
    res.json(scripts);
  } catch (error) {
    console.error('Failed to get package scripts:', error);
    res.status(500).json({ error: 'Failed to read package.json' });
  }
});

app.post('/api/npm/run', generalLimiter, async (req, res) => {
  try {
    const runSchema = z.object({
      scriptName: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9:_-]+$/, 'Invalid script name'),
      repoPath: z.string().optional(),
      packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).optional(),
    });

    const { scriptName, repoPath, packageManager } = runSchema.parse(req.body);
    const safeRepoPath = validateGitPath(repoPath || process.cwd());
    const processId = runScript(scriptName, safeRepoPath, packageManager || 'npm');

    res.json({ processId, message: 'Script started' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Failed to run script:', error);
    res.status(500).json({ error: 'Failed to run script' });
  }
});

app.get('/api/npm/output/:processId', generalLimiter, async (req, res) => {
  try {
    const processId = oneParam(req.params.processId);
    const output = getScriptOutput(processId);
    res.json(output);
  } catch (error) {
    console.error('Failed to get script output:', error);
    res.status(500).json({ error: 'Failed to get output' });
  }
});

app.post('/api/npm/stop', generalLimiter, async (req, res) => {
  try {
    const stopSchema = z.object({
      processId: z.string().min(1),
    });

    const { processId } = stopSchema.parse(req.body);
    const result = stopScript(processId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Failed to stop script:', error);
    res.status(500).json({ error: 'Failed to stop script' });
  }
});

app.get('/api/npm/running', generalLimiter, async (_req, res) => {
  try {
    const processes = getRunningProcesses();
    res.json({ processes });
  } catch (error) {
    console.error('Failed to get running processes:', error);
    res.status(500).json({ error: 'Failed to get running processes' });
  }
});

app.post('/api/logs/tail', generalLimiter, async (req, res) => {
  try {
    const tailSchema = z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(100),
      path: z.string().min(1).max(500),
      color: z.string().optional(),
    });

    const parsed = tailSchema.parse(req.body);
    const file: LogFile = { ...parsed, color: parsed.color ?? assignColor() };

    const result = await startTailing(file);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Failed to start tailing:', error);
    res.status(500).json({ error: 'Failed to start tailing' });
  }
});

app.post('/api/logs/stop', generalLimiter, async (req, res) => {
  try {
    const stopSchema = z.object({
      fileId: z.string().min(1),
    });

    const { fileId } = stopSchema.parse(req.body);
    const result = stopTailing(fileId);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Failed to stop tailing:', error);
    res.status(500).json({ error: 'Failed to stop tailing' });
  }
});

app.get('/api/logs/lines', generalLimiter, async (req, res) => {
  try {
    const fileIds = req.query.fileIds ? (req.query.fileIds as string).split(',') : undefined;
    const lines = getLogLines(fileIds);
    res.json({ lines });
  } catch (error) {
    console.error('Failed to get log lines:', error);
    res.status(500).json({ error: 'Failed to get log lines' });
  }
});

app.get('/api/logs/active', generalLimiter, async (_req, res) => {
  try {
    const tails = getActiveTails();
    res.json({ tails });
  } catch (error) {
    console.error('Failed to get active tails:', error);
    res.status(500).json({ error: 'Failed to get active tails' });
  }
});

app.post('/api/logs/clear', generalLimiter, async (req, res) => {
  try {
    const fileId = req.body.fileId as string | undefined;
    clearLogs(fileId);
    res.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    console.error('Failed to clear logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

app.get('/api/logs/common-paths', generalLimiter, async (req, res) => {
  try {
    const repoPath = validateGitPath((req.query.path as string) || process.cwd());
    const suggestions = await getCommonLogSuggestions(repoPath);
    res.json({ suggestions });
  } catch (error) {
    console.error('Failed to get common paths:', error);
    res.status(500).json({ error: 'Failed to get common paths' });
  }
});

// One shared broadcast loop instead of a metrics interval per client — the
// systeminformation scan runs once per tick no matter how many clients listen.
const broadcastMetrics = async () => {
  if (wss.clients.size === 0) return;
  try {
    const payload = JSON.stringify(await getSystemMetrics());
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload); // 1 = OPEN
    }
  } catch (error) {
    console.error('[WebSocket] Failed to broadcast metrics:', error);
  }
};
setInterval(broadcastMetrics, 2000);

// Keepalive ping for all clients
setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.ping();
  }
}, 30000);

wss.on('connection', (ws, req) => {
  console.log('[WebSocket] Client connected from:', req.socket.remoteAddress);

  // Send initial metrics immediately (cached, so this is cheap)
  getSystemMetrics()
    .then(metrics => {
      if (ws.readyState === 1) ws.send(JSON.stringify(metrics));
    })
    .catch(error => console.error('[WebSocket] Failed to send initial metrics:', error));

  ws.on('close', () => console.log('[WebSocket] Client disconnected'));
  ws.on('error', error => console.error('[WebSocket] Connection error:', error));
});

wss.on('error', error => {
  console.error('[WebSocket Server] Error:', error);
});

// Serve built frontend (single-origin prod / Electron desktop mode).
// Registered after all API routes so they take precedence; no SPA fallback needed
// (no client-side router) — express.static serves index.html for "/" automatically.
const distDir = resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
}

// Refuse to start rather than merely warn: a non-loopback bind without a
// token would serve every destructive endpoint (git push, kill processes,
// npm scripts) to the whole LAN unauthenticated.
if (!isLoopbackBind && !DASHBOARD_TOKEN) {
  console.error(
    '[SECURITY] Refusing to start: BIND_HOST is non-loopback but DASHBOARD_TOKEN is not set. Set DASHBOARD_TOKEN in .env or bind to loopback.'
  );
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 Homelab Dashboard API running on http://${HOST}:${PORT}`);
  console.log(`📊 System Metrics (HTTP): http://${HOST}:${PORT}/api/metrics`);
  console.log(`📊 System Metrics (WebSocket): ws://${HOST}:${PORT}/ws`);
  console.log(`🌤️  Weather: http://${HOST}:${PORT}/api/weather?location=Munich`);
  console.log(`🤖 Ollama Proxy: POST http://${HOST}:${PORT}/api/ollama/*`);
  console.log(`🌐 Web Scraper: POST http://${HOST}:${PORT}/api/scrape`);
  console.log(`✅ Health Check: http://${HOST}:${PORT}/health`);
  if (HOST === '127.0.0.1' || HOST === '::1') {
    console.log(`\n🔒 Listening on loopback only. Set BIND_HOST=0.0.0.0 to expose on LAN.\n`);
  } else {
    console.log(
      `\n⚠️  WARNING: listening on ${HOST} — endpoints have NO AUTH other than DASHBOARD_TOKEN. Anyone with the token can run git push, kill processes, run npm scripts, etc.\n`
    );
  }
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  stopAllTailing();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, cleaning up...');
  stopAllTailing();
  process.exit(0);
});
