import { exec } from 'child_process';
import { promisify } from 'util';
import type { ScannedPort } from '../../shared/types.js';

const execAsync = promisify(exec);

// Port scan result interface (server-side; scanTime serializes to string)
export interface PortScanResult {
  localPorts: ScannedPort[];
  externalPorts: ScannedPort[];
  scanTime: Date;
}

// Report whether the listener lister (ss, ships with iproute2) is installed.
export async function getPortScannerStatus(): Promise<{ ss: boolean; error?: string }> {
  try {
    await execAsync('command -v ss');
    return { ss: true };
  } catch {
    return {
      ss: false,
      error: "'ss' (iproute2) not installed — install it to enable port scanning",
    };
  }
}

// Parse ss output line
// Example: tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=1234,fd=3))
function parseSSLine(line: string): ScannedPort | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const protocol = parts[0]?.toUpperCase() as 'TCP' | 'UDP';
  const state = parts[1];
  const localAddr = parts[4];

  // Extract port from address (format: 0.0.0.0:22 or :::22)
  const portMatch = localAddr?.match(/:(\d+)$/);
  if (!portMatch) return null;

  const port = parseInt(portMatch[1]);

  // Extract process info if available
  const processMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
  const program = processMatch?.[1];
  const pid = processMatch?.[2] ? parseInt(processMatch[2]) : undefined;

  // Determine service name based on common ports
  const service = getServiceName(port);

  return {
    port,
    protocol,
    state,
    service,
    pid,
    program,
    bindAddress: localAddr.slice(0, -portMatch[0].length),
  };
}

// Get common service name for port
function getServiceName(port: number): string {
  const commonPorts: Record<number, string> = {
    20: 'FTP Data',
    21: 'FTP Control',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    53: 'DNS',
    80: 'HTTP',
    110: 'POP3',
    143: 'IMAP',
    443: 'HTTPS',
    445: 'SMB',
    3000: 'Development Server',
    3010: 'Backend API',
    3306: 'MySQL',
    5173: 'Vite Dev Server',
    5180: 'Leitstand Vite Dev Server',
    5432: 'PostgreSQL',
    6379: 'Redis',
    8080: 'HTTP Alt',
    8443: 'HTTPS Alt',
    9000: 'SonarQube',
    27017: 'MongoDB',
  };

  return commonPorts[port] || 'Unknown';
}

// Get local listening ports using ss
export async function getLocalPorts(): Promise<ScannedPort[]> {
  try {
    // ss -tulnp: TCP + UDP, listening, numeric, show process
    const { stdout } = await execAsync('ss -tulnp');

    const lines = stdout.split('\n').slice(1); // Skip header
    const ports = lines
      .map(parseSSLine)
      .filter((port): port is ScannedPort => port !== null)
      .sort((a, b) => a.port - b.port);

    return ports;
  } catch (error) {
    console.error('Failed to get local ports with ss:', error);
    return [];
  }
}

// Classify a bind address: loopback listeners are unreachable from other devices.
function getExposure(bindAddress: string): ScannedPort['exposure'] | null {
  const addr = bindAddress.replace(/^\[|\](%.*)?$/g, '');
  if (/^(127\.|::1$)/.test(addr)) return null;
  if (addr === '0.0.0.0' || addr === '*' || addr === '::') return 'all';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^fd7a:115c:a1e0:/i.test(addr)) return 'tailscale';
  return 'lan';
}

// TCP listeners bound to a non-loopback address, one entry per port (the widest
// exposure wins when a port is bound on several addresses, e.g. 0.0.0.0 + [::]).
function getReachablePorts(localPorts: ScannedPort[]): ScannedPort[] {
  const rank = { tailscale: 0, lan: 1, all: 2 } as const;
  const byPort = new Map<number, ScannedPort>();
  for (const p of localPorts) {
    if (p.protocol !== 'TCP' || !p.bindAddress) continue;
    const exposure = getExposure(p.bindAddress);
    if (!exposure) continue;
    const existing = byPort.get(p.port);
    if (!existing || rank[exposure] > rank[existing.exposure!]) {
      byPort.set(p.port, { ...p, exposure });
    }
  }
  return Array.from(byPort.values()).sort((a, b) => a.port - b.port);
}

// Get both local and external port scan
export async function getPortScan(): Promise<PortScanResult> {
  try {
    const localPorts = await getLocalPorts();

    return {
      localPorts,
      externalPorts: getReachablePorts(localPorts),
      scanTime: new Date(),
    };
  } catch (error) {
    console.error('Failed to perform port scan:', error);
    return {
      localPorts: [],
      externalPorts: [],
      scanTime: new Date(),
    };
  }
}
