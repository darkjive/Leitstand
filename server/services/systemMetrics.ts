import si from 'systeminformation';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir } from 'fs/promises';
import type { MetricsData, VramGpu } from '../../shared/types.js';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 5000;
// Upper bound for one full scan; a hung si call (e.g. after a GPU driver reset)
// must not pin `inflight` forever.
const FETCH_TIMEOUT_MS = 8000;

// Query NVIDIA GPUs via nvidia-smi. Returns one entry per GPU with used/total.
async function getVramFromNvidia(): Promise<VramGpu[]> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'],
      { timeout: EXEC_TIMEOUT_MS }
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, total, used] = line.split(',').map(s => s.trim());
        const totalMb = parseInt(total, 10);
        const usedMb = parseInt(used, 10);
        return {
          vendor: 'NVIDIA',
          model: name,
          totalMb,
          usedMb,
          percentage: totalMb > 0 ? ((usedMb / totalMb) * 100).toFixed(1) : '0',
        };
      });
  } catch {
    return [];
  }
}

// Query AMD GPUs via sysfs (no external tool required). Linux only.
async function getVramFromAmdgpu(): Promise<VramGpu[]> {
  try {
    const entries = await readdir('/sys/class/drm');
    const cardDirs = entries.filter(e => /^card\d+$/.test(e));
    const gpus: VramGpu[] = [];
    for (const card of cardDirs) {
      const base = `/sys/class/drm/${card}/device`;
      try {
        const [totalB, usedB, nameRaw] = await Promise.all([
          readFile(`${base}/mem_info_vram_total`, 'utf8'),
          readFile(`${base}/mem_info_vram_used`, 'utf8'),
          readFile(`${base}/product_name`, 'utf8').catch(() => 'AMD GPU'),
        ]);
        const total = parseInt(totalB.trim(), 10);
        const used = parseInt(usedB.trim(), 10);
        if (total > 0) {
          gpus.push({
            vendor: 'AMD',
            model: nameRaw.trim() || 'AMD GPU',
            totalMb: Math.round(total / (1024 * 1024)),
            usedMb: Math.round(used / (1024 * 1024)),
            percentage: ((used / total) * 100).toFixed(1),
          });
        }
      } catch {
        // Not an amdgpu device or files missing — skip silently
      }
    }
    return gpus;
  } catch {
    return [];
  }
}

// Query AMD GPUs via rocm-smi (fallback when sysfs is inaccessible). Defensive parsing —
// field names can vary between rocm-smi versions, so we look up by key suffix.
async function getVramFromRocmSmi(): Promise<VramGpu[]> {
  try {
    const [memRes, nameRes] = await Promise.allSettled([
      execFileAsync('rocm-smi', ['--showmeminfo', 'vram', '--json'], { timeout: EXEC_TIMEOUT_MS }),
      execFileAsync('rocm-smi', ['--showproductname', '--json'], { timeout: EXEC_TIMEOUT_MS }),
    ]);
    if (memRes.status !== 'fulfilled') return [];
    const vramData = JSON.parse(memRes.value.stdout) as Record<string, Record<string, string>>;

    const names: Record<string, string> = {};
    if (nameRes.status === 'fulfilled') {
      try {
        const nameData = JSON.parse(nameRes.value.stdout) as Record<string, Record<string, string>>;
        for (const [card, info] of Object.entries(nameData)) {
          names[card] = info['Card series'] || info['Card model'] || 'AMD GPU';
        }
      } catch {
        // ignore parse error — names are best-effort
      }
    }

    const gpus: VramGpu[] = [];
    for (const [card, info] of Object.entries(vramData)) {
      const total =
        parseInt(info['VRAM Total Memory (B)'] ?? '0', 10) ||
        parseInt(info['VRAM Total Memory (Bytes)'] ?? '0', 10);
      const used =
        parseInt(info['VRAM Total Used Memory (B)'] ?? '0', 10) ||
        parseInt(info['VRAM Total Used Memory (Bytes)'] ?? '0', 10);
      if (total > 0) {
        gpus.push({
          vendor: 'AMD',
          model: names[card] || 'AMD GPU',
          totalMb: Math.round(total / (1024 * 1024)),
          usedMb: Math.round(used / (1024 * 1024)),
          percentage: ((used / total) * 100).toFixed(1),
        });
      }
    }
    return gpus;
  } catch {
    return [];
  }
}

// Fallback: static total VRAM via systeminformation. No usage data.
async function getVramFromGraphics(): Promise<VramGpu[]> {
  try {
    const graphics = await si.graphics();
    return (graphics.controllers || [])
      .map(c => ({
        vendor: c.vendor || 'Unknown',
        model: c.model || 'GPU',
        totalMb: c.vram ?? 0,
      }))
      .filter(c => c.totalMb > 0);
  } catch {
    return [];
  }
}

async function getVram(): Promise<{ gpus: VramGpu[]; dynamic: boolean; reason?: string }> {
  const [nvidia, amdSysfs] = await Promise.all([getVramFromNvidia(), getVramFromAmdgpu()]);
  // Prefer sysfs (no external dep); fall back to rocm-smi when sysfs yields nothing
  const amd = amdSysfs.length > 0 ? amdSysfs : await getVramFromRocmSmi();
  if (nvidia.length > 0 || amd.length > 0) {
    return { gpus: [...nvidia, ...amd], dynamic: true };
  }
  const gpus = await getVramFromGraphics();
  if (gpus.length > 0) {
    return {
      gpus,
      dynamic: false,
      reason: 'Live usage requires nvidia-smi, amdgpu sysfs, or rocm-smi',
    };
  }
  return { gpus: [], dynamic: false, reason: 'No GPU VRAM detected' };
}

// Short-lived cache: the WebSocket broadcast, /api/metrics and the frontend
// health check all hit this — without it every caller triggers a full
// systeminformation scan.
let cached: { data: MetricsData; timestamp: number } | null = null;
let inflight: Promise<MetricsData> | null = null;
const CACHE_MS = 2000;

export async function getSystemMetrics(): Promise<MetricsData> {
  if (cached && Date.now() - cached.timestamp < CACHE_MS) {
    return cached.data;
  }
  if (inflight) {
    return inflight;
  }
  inflight = fetchSystemMetrics().finally(() => {
    inflight = null;
  });
  const data = await inflight;
  cached = { data, timestamp: Date.now() };
  return data;
}

async function fetchSystemMetrics(): Promise<MetricsData> {
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Metrics scan timed out')), FETCH_TIMEOUT_MS);
    });
    const [cpu, mem, disk, temp, vram] = await Promise.race([
      Promise.all([si.currentLoad(), si.mem(), si.fsSize(), si.cpuTemperature(), getVram()]),
      timeout,
    ]).finally(() => clearTimeout(timer));

    // Detect if temperature sensors are available
    const tempAvailable = temp.main !== null && temp.main > 0;
    let tempReason: string | undefined;

    if (!tempAvailable) {
      const platform = os.platform();
      if (platform === 'darwin') {
        tempReason = 'Temperature sensors may not be accessible on macOS without additional tools';
      } else {
        tempReason = 'Temperature sensors not detected or not accessible';
      }
    }

    return {
      cpu: {
        usage: cpu.currentLoad.toFixed(1),
        cores: cpu.cpus.map(core => ({
          usage: core.load.toFixed(1),
        })),
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        percentage: ((mem.used / mem.total) * 100).toFixed(1),
      },
      disk: disk
        .filter(d => d.size > 0) // Filter out invalid drives
        .map(d => ({
          fs: d.fs,
          mount: d.mount,
          size: d.size,
          used: d.used,
          percentage: (d.used / d.size) * 100,
        })),
      temperature: {
        main: temp.main || 0,
        max: temp.max || 0,
        cores: temp.cores || [],
        available: tempAvailable,
        reason: tempReason,
      },
      vram: {
        gpus: vram.gpus,
        available: vram.gpus.length > 0,
        dynamic: vram.dynamic,
        reason: vram.reason,
      },
      platform: os.platform(),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Failed to fetch system metrics:', error);
    // Return fallback data instead of throwing to prevent server crash
    return {
      cpu: { usage: '0', cores: [] },
      memory: { total: 0, used: 0, free: 0, percentage: '0' },
      disk: [],
      temperature: {
        main: 0,
        max: 0,
        cores: [],
        available: false,
        reason: 'Failed to fetch temperature data',
      },
      vram: { gpus: [], available: false, dynamic: false, reason: 'Failed to fetch VRAM data' },
      platform: os.platform(),
      timestamp: Date.now(),
    };
  }
}
