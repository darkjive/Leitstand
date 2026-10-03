// Electron desktop entry. Spawns the existing Express backend (and Vite in dev),
// waits for it to come up, then opens a single BrowserWindow. No refactor of the
// server required — it boots itself via server.listen on import.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', '.bin');
const SERVER_PORT = process.env.PORT || 3010;
const VITE_PORT = 5180;
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

let serverProc = null;
let viteProc = null;
let win = null;

function bin(name) {
  return process.platform === 'win32' ? path.join(BIN, name + '.cmd') : path.join(BIN, name);
}

function spawnBin(name, args) {
  const child = spawn(bin(name), args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  child.on('exit', code => {
    if (code !== null && code !== 0) console.error(`[desktop] ${name} exited with ${code}`);
  });
  return child;
}

function waitFor(url, { timeout = 30000 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () =>
      http
        .get(url, res => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeout) reject(new Error(`timeout waiting for ${url}`));
          else setTimeout(check, 300);
        });
    check();
  });
}

let ready = false;

async function bootstrap() {
  serverProc = spawnBin('tsx', ['server/index.ts']);
  if (isDev) {
    viteProc = spawnBin('vite', []);
    await waitFor(`http://localhost:${VITE_PORT}/`);
  }
  await waitFor(`http://localhost:${SERVER_PORT}/health`);
  ready = true;
  await createWindow();
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0a0a0f',
    title: 'Leitstand',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.on('closed', () => {
    win = null;
  });

  const target = isDev ? `http://localhost:${VITE_PORT}/` : `http://localhost:${SERVER_PORT}/`;
  const targetOrigin = new URL(target).origin;

  // Handlers go in BEFORE loadURL — otherwise early window.open/navigation slips through.
  // External links open in the system browser; the window never leaves the app origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== targetOrigin) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  await win.loadURL(target);
}

function killChild(child) {
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

app
  .whenReady()
  .then(bootstrap)
  .catch(err => {
    console.error('[desktop] failed to start:', err);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS dock click: reopen the window only — the server is still running.
  // (Re-running bootstrap() would spawn a second server/vite.)
  if (win === null && ready) createWindow();
});

app.on('before-quit', () => {
  killChild(serverProc);
  killChild(viteProc);
});
