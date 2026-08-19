# 🚀 Homelab Control Center

<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Vite-7.3-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind-4.1-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
</p>

> **Futuristic homelab dashboard with real-time system monitoring and cyberpunk aesthetics inspired by pxlngn.net**

![Homelab Control Center dashboard](docs/screenshot.png)

## ✨ Features

### Widgets (real backend data)

| Widget                                                                                                                             | Data Source                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **System Metrics** — CPU · Memory · Performance graph · VRAM · Storage · Temperature (six independent widgets, shared data stream) | `systeminformation` + nvidia-smi/amdgpu sysfs         |
| **Weather**                                                                                                                        | wttr.in API (proxied through the backend)             |
| **Docker Monitoring**                                                                                                              | Docker socket                                         |
| **ChatBot**                                                                                                                        | Local [Ollama](https://ollama.ai) (auto-discovers)    |
| **Git Widget**                                                                                                                     | status, pull, push, fetch, commit, bulk operations    |
| **NPM Script Runner**                                                                                                              | runs scripts from `package.json`                      |
| **Log Aggregator**                                                                                                                 | tails files under the project, `/var/log` and `$HOME` |
| **Web Scraper**                                                                                                                    | Playwright/Chromium (see NixOS note below)            |
| **Port Killer**                                                                                                                    | requires `lsof`                                       |
| **Firewall Monitor**                                                                                                               | requires UFW (not available on NixOS)                 |
| **Port Scanner**                                                                                                                   | requires `nmap`/`ss`                                  |
| **GitHub Stats**                                                                                                                   | GitHub API (set your username in Settings)            |
| **Hacker News Feed**                                                                                                               | HN Firebase API                                       |
| **RSS Feed** / **Custom RSS Feed**                                                                                                 | any RSS/Atom URL (via rss2json.com CORS proxy)        |
| **Service Status**                                                                                                                 | Statuspage.io API (Cloudflare, GitHub, OpenAI, etc.)  |
| **Connectivity Monitor**                                                                                                           | HTTP latency checks to internet endpoints             |
| **Network Outage Map**                                                                                                             | visualizes connectivity status                        |

### Local-only widgets (no backend)

| Widget              | Storage                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Markdown Editor** | `localStorage`                                                                                                                            |
| **Quick Links**     | `localStorage`                                                                                                                            |
| **Sound Manager**   | `<audio>` loop — drop a file at `public/audio/ambiance-legal.ogg` (not shipped in the repo); the widget shows a disabled state without it |

### 🎨 Cyberpunk Design

- **Cyan/Orange Gradient Palette** (pxlngn.net inspired)
- **Animated Scan Line Effect** (retro terminal vibe)
- **Glowing Text Effects** (cyberpunk aesthetics)
- **Responsive Grid Layout** (drag & resize widgets)
- **Custom Scrollbars** (themed for immersion)
- **Blinking Cursor Animation** ("INITIALIZING..." effect)

## 🛠️ Tech Stack

### Frontend

- **React 19.2** - Latest React with Concurrent Features
- **Vite 7.3** - Lightning-fast build tool
- **TypeScript 5.9** - Type safety (shared wire types in `shared/types.ts`)
- **Tailwind CSS 4.1** - Utility-first styling (configured in `src/index.css`)
- **Recharts 3.6** - Data visualization
- **Lucide React** - Icon library
- **react-grid-layout** - Draggable/resizable widget grid

### Backend

- **Express 5.2** - Node.js API server
- **systeminformation** - Cross-platform system metrics
- **WebSockets (ws)** - Real-time metrics broadcast (one shared 2s loop for all clients)
- **Docker API** - Container status monitoring
- **Playwright** - Headless Chromium for web scraping
- **Helmet + CORS + express-rate-limit + Host-header allowlist** - Security layers

## 🚀 Quick Start

### Prerequisites

- **Node.js 22+**
- **pnpm**
- Optional: **Docker**, **Ollama**, **UFW**, **lsof**, **nmap** (per-widget)

### Installation

```bash
git clone https://github.com/darkjive/homelab-dashboard.git
cd homelab-dashboard
pnpm install

# Start frontend (http://localhost:5173) + backend (http://localhost:3010)
pnpm dev:all

# Or start separately:
pnpm dev        # Frontend only (Vite) - http://localhost:5173
pnpm dev:server # Backend only (Express) - http://localhost:3010
pnpm dev:ollama # Local Ollama server (optional, for ChatBot) - http://localhost:11434
```

> Build scripts: pnpm blocks postinstall scripts by default; this repo allowlists
> `electron` and `esbuild` in `pnpm-workspace.yaml`. If the Electron binary is
> still missing after install, run `pnpm approve-builds`.

### Configuration

The dashboard works out of the box with defaults. For overrides, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable          | Default                  | Purpose                                                                                                         |
| ----------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `OLLAMA_URL`      | `http://localhost:11434` | Ollama server URL (chatbot proxy)                                                                               |
| `BIND_HOST`       | `127.0.0.1`              | Network interface to bind the backend to (loopback default)                                                     |
| `PORT`            | `3010`                   | Backend port (also picked up by the Vite proxy + Electron)                                                      |
| `DASHBOARD_TOKEN` | _(empty)_                | Shared token for destructive endpoints. Empty = open (loopback default). **Required** when `BIND_HOST=0.0.0.0`. |

> Frontend dev is `5173`, Vite preview is `4173`.

### ⚠️ Security defaults

The backend **binds to loopback (`127.0.0.1`) by default** — only your local browser can reach it. This is intentional: there is **no authentication** on any endpoint, and several can run shell commands on your behalf (`/api/ports/kill`, `/api/npm/run`, `/api/git/push|commit`, `/api/logs/tail`, `/api/scrape`).

Additional guards:

- **Host-header allowlist** against DNS-rebinding attacks (active on loopback binds).
- **SSRF guard** on the scraper: literal + DNS-resolved private-range checks, re-checked after redirects.
- **Ollama proxy whitelist**: only `tags/ps/version/generate/chat/show` are proxied — model management endpoints are blocked.
- **Path validation**: git/npm/log endpoints resolve paths and block sensitive system prefixes (`/etc`, `/proc`, `/root`, …); log tailing is limited to the project dir, `/var/log` and `$HOME` (minus `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`).

- **Optional token gate**: set `DASHBOARD_TOKEN` to require an `X-Dashboard-Token` header on
  **the entire `/api` surface — reads included**, plus a `?token=` query param on the metrics
  WebSocket (browsers cannot set headers on a WS handshake). Reads are gated because endpoints
  like `/api/git/scan`, `/api/logs/lines` and `/api/ports` expose filesystem layout, log contents
  and running processes — gating only the destructive half would leave an exposed instance wide
  open. `/health` stays open for uptime probes. Configure the matching token under
  **Settings → General → Dashboard Token** in the browser. When unset, the API stays open
  (fine for the loopback default). The token is compared in constant time.

If you really need LAN access, opt in explicitly **and set a token**:

```bash
DASHBOARD_TOKEN=$(openssl rand -hex 16) BIND_HOST=0.0.0.0 pnpm dev:server   # exposes backend — token now required
```

The server logs a loud warning on startup if it binds to a non-loopback interface without a token.

### Optional system tools

Widgets degrade gracefully if a tool is missing, and report the reason in their JSON response.

| Tool                | Required by                          | Install hint                                                                    |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `lsof`              | PortKiller                           | Debian: `lsof`, NixOS: `pkgs.lsof`                                              |
| `nmap` (optional)   | PortScanner external scan            | Debian: `nmap`                                                                  |
| `ss`                | PortScanner local listeners          | ships with `iproute2`                                                           |
| `ufw` + sudo        | FirewallMonitor (Ubuntu/Debian only) | needs passwordless sudo for `ufw` + log reads (`sudo -n`, fails fast otherwise) |
| `ollama`            | ChatBot                              | https://ollama.ai                                                               |
| Docker daemon       | DockerWidget                         | user in `docker` group                                                          |
| Playwright Chromium | WebScraper                           | `pnpm exec playwright install`                                                  |

### Customization

Open **Settings** (gear icon in the header) to configure the GitHub username,
weather location, git roots, npm projects, log files, RSS feeds and quick links.
Everything is persisted in `localStorage`.

#### Modify Color Theme

Tailwind 4 is configured via CSS. Edit the `@theme {}` block in `src/index.css`:

```css
@theme {
  --color-cyber-cyan: rgb(0, 195, 255);
  --color-cyber-orange: rgb(255, 135, 0);
  --color-cyber-darkbg: #0a0e27;
  --color-cyber-cardbg: #151a2e;
}
```

## 📁 Project Structure

```
homelab-dashboard/
├── shared/
│   └── types.ts                  # Wire types shared by server + frontend
├── server/
│   ├── index.ts                  # Express API (all routes inline)
│   └── services/                 # One file per concern
│       ├── systemMetrics.ts
│       ├── weather.ts
│       ├── docker.ts
│       ├── gitStatus.ts
│       ├── npmScripts.ts
│       ├── logAggregator.ts
│       ├── scraper.ts
│       ├── netGuard.ts           # SSRF guard (literal + DNS checks)
│       ├── ufw.ts
│       ├── ports.ts
│       └── portKiller.ts
├── src/
│   ├── components/               # One file per widget (+ Toaster)
│   │   └── metrics/              # Six metric widgets (CPU, Memory, Graph, VRAM, Storage, Temp)
│   ├── lib/
│   │   ├── settings.ts           # useSetting/useSettingJSON hooks (localStorage + sync)
│   │   ├── metricsStore.ts       # Singleton metrics store (one WS + HTTP-polling fallback)
│   │   ├── api.ts                # apiFetch wrapper (attaches optional dashboard token)
│   │   └── toast.ts              # toast() notifications
│   ├── App.tsx                   # Main dashboard grid layout
│   ├── index.css                 # Tailwind + cyberpunk theme
│   └── main.tsx                  # React entry point
├── electron/
│   └── main.cjs                  # Electron shell (spawns server + vite)
├── scripts/
│   └── start-ollama.sh
├── .env.example
├── eslint.config.js              # ESLint flat config (browser + node blocks)
├── tsconfig.server.json          # Backend typecheck (run by pnpm build)
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Backend (`http://localhost:3010`)

| Endpoint                         | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `GET /api/metrics`               | System metrics (CPU, RAM, Disk, VRAM) — cached 2s |
| `GET /api/weather?location=...`  | Weather from wttr.in                              |
| `GET /api/docker`                | Docker container status — cached 5s               |
| `GET /api/firewall/*`            | UFW status, logs, ports, top-attackers            |
| `GET /api/service-status`        | Aggregated Statuspage.io data                     |
| `GET /api/connectivity`          | HTTP latency probes                               |
| `GET /api/ports`                 | Active listening ports                            |
| `POST /api/ports/kill`           | Kill process by port                              |
| `GET/POST /api/git/*`            | status, pull, push, fetch, commit, bulk           |
| `GET/POST /api/npm/*`            | scripts, run, output, stop, running               |
| `POST /api/logs/*`               | tail, stop, lines, active, clear                  |
| `POST /api/scrape`               | Playwright scraper (SSRF-guarded)                 |
| `GET/POST /api/ollama/api/:name` | Proxy to Ollama (whitelisted endpoints)           |
| `GET /health`                    | Health check                                      |
| `WebSocket /ws`                  | Real-time metrics stream (2s broadcast)           |

All endpoints are rate-limited (1000 req/min general, stricter for scraper and Ollama).
When `DASHBOARD_TOKEN` is set, everything under `/api` plus the WebSocket requires the token —
only `GET /health` stays open.

## 🧩 Optional Integrations

Widgets degrade gracefully if the underlying tool is missing.

| Widget          | Requires                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| ChatBot         | [Ollama](https://ollama.ai) at `OLLAMA_URL` (default `localhost:11434`)          |
| WebScraper      | `pnpm exec playwright install` (NixOS: see below)                                |
| DockerWidget    | Docker daemon socket access                                                      |
| PortKiller      | `lsof` on PATH                                                                   |
| PortScanner     | `nmap` or `ss` on PATH                                                           |
| FirewallMonitor | UFW (absent on NixOS — widget degrades)                                          |
| Git/NPM/Logs    | shell out; paths validated server-side (blocked system prefixes, tail allowlist) |

### NixOS Note (Playwright)

NixOS doesn't ship standard glibc paths Playwright expects. Use [`playwright-nix`](https://github.com/nginx-nixos/playwright-nix) or run Chromium via a FHS env. See [NixOS wiki: Playwright](https://nixos.wiki/wiki/Playwright).

## 🎯 Use Cases

- **Personal homelab dashboard** – Monitor home server, Docker containers, services from one interface.
- **Developer control center** – Watch resources while running multiple dev environments.
- **System administration** – Quick overview of system health, ports, firewall, services.

## 🔧 Development

```bash
pnpm build      # typechecks frontend (tsc -b) AND backend (tsconfig.server.json), then vite build
pnpm typecheck:server  # backend typecheck only
pnpm preview    # Preview production build (port 4173)
pnpm lint       # ESLint (browser globals for src/, node globals for server/)
pnpm format     # Prettier
pnpm desktop    # Electron dev (spawns server + vite)
pnpm desktop:prod  # vite build, then Electron loads backend-served bundle on :3010
```

No test framework or CI is set up — `pnpm build` + `pnpm lint` are the verification gates.

## 🎨 Design Inspiration

Heavily inspired by **[pxlngn.net](https://pxlngn.net)**:

- Cyan/Orange gradient palette (`rgb(0, 195, 255)` + `rgb(255, 135, 0)`)
- JetBrains Mono typography
- Blinking cursor animation ("INITIALIZING..." effect)
- Scan line effect (retro terminal aesthetic)
- Glowing text shadows (cyberpunk neon)

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🙏 Acknowledgments

- **[Homepage by gethomepage](https://github.com/gethomepage/homepage)** - Dashboard structure inspiration
- **[pxlngn.net](https://pxlngn.net)** - Design aesthetics and color palette
- **[wttr.in](https://wttr.in)** - Weather data API
- **[systeminformation](https://github.com/sebhildebrandt/systeminformation)** - System metrics library

---

<p align="center">
  Built with <span style="color: rgb(0, 195, 255)">Cyan</span> and <span style="color: rgb(255, 135, 0)">Orange</span> 🚀
</p>
