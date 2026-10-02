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

// Report which scanner tools are installed. nmap is optional (slow external
// scan); ss is the fast local listener lister and ships with iproute2.
export async function getPortScannerStatus(): Promise<{
  ss: boolean;
  nmap: boolean;
  error?: string;
}> {
  const check = async (bin: string) => {
    try {
      await execAsync(`command -v ${bin}`);
      return true;
    } catch {
      return false;
    }
  };
  const [ss, nmap] = await Promise.all([check('ss'), check('nmap')]);
  let error: string | undefined;
  if (!ss && !nmap) {
    error = "neither 'ss' (iproute2) nor 'nmap' is installed — install one to enable port scanning";
  } else if (!nmap) {
    error = "'nmap' not installed — external port scan will be empty, only local listeners shown";
  }
  return { ss, nmap, error };
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
  };
}

// Parse nmap output line
// Example: 22/tcp   open  ssh
function parseNmapLine(line: string): ScannedPort | null {
  const match = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(.+)$/);
  if (!match) return null;

  return {
    port: parseInt(match[1]),
    protocol: match[2].toUpperCase() as 'TCP' | 'UDP',
    state: match[3],
    service: match[4].trim(),
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

// Get externally visible ports using nmap
export async function getExternalPorts(): Promise<ScannedPort[]> {
  try {
    // Scan localhost to see what's externally accessible
    // -p-: scan all ports, --open: only show open ports
    const { stdout } = await execAsync('nmap -p- --open localhost', {
      timeout: 30000, // 30 second timeout
    });

    const lines = stdout.split('\n');
    const ports = lines
      .map(parseNmapLine)
      .filter((port): port is ScannedPort => port !== null)
      .sort((a, b) => a.port - b.port);

    return ports;
  } catch (error) {
    console.error('Failed to get external ports with nmap:', error);
    return [];
  }
}

// Get both local and external port scan
export async function getPortScan(): Promise<PortScanResult> {
  try {
    const [localPorts, externalPorts] = await Promise.all([getLocalPorts(), getExternalPorts()]);

    return {
      localPorts,
      externalPorts,
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
