import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// UFW log entry interface
export interface UFWLogEntry {
  timestamp: Date;
  action: 'BLOCK' | 'ALLOW';
  protocol: string;
  srcIp: string;
  srcPort?: number;
  dstIp: string;
  dstPort?: number;
  interface?: string;
  raw: string;
}

// UFW firewall rule interface
export interface UFWRule {
  num: number;
  to: string;
  action: string;
  from: string;
  description?: string;
}

// UFW status interface
export interface UFWStatus {
  active: boolean;
  available: boolean;
  logging: string;
  defaultIncoming: string;
  defaultOutgoing: string;
  defaultRouted: string;
  rules: UFWRule[];
  error?: string;
}

// Top attacker statistics
export interface AttackerStats {
  ip: string;
  blockedCount: number;
  lastSeen: Date;
  targetPorts: number[];
}

// Check if a binary exists on PATH (POSIX `command -v`).
async function binaryExists(name: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

// Resolve the limit argument safely into a positive integer for shell use.
function sanitizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
}

// Parse UFW log line (from kern.log or syslog)
// Example format: Dec 28 14:23:15 hostname kernel: [UFW BLOCK] IN=eth0 OUT= MAC=... SRC=1.2.3.4 DST=5.6.7.8 PROTO=TCP SPT=12345 DPT=22
function parseUFWLogLine(line: string): UFWLogEntry | null {
  const ufwMatch = line.match(/\[UFW (BLOCK|ALLOW)\]/);
  if (!ufwMatch) return null;

  const action = ufwMatch[1] as 'BLOCK' | 'ALLOW';

  // Extract timestamp: ISO (journalctl -o short-iso) or classic syslog (no year → current year)
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2})/);
  const sysMatch = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
  let timestamp = new Date();
  if (isoMatch) {
    timestamp = new Date(isoMatch[1]);
  } else if (sysMatch) {
    const parsed = new Date(`${sysMatch[1]} ${new Date().getFullYear()}`);
    if (!Number.isNaN(parsed.getTime())) timestamp = parsed;
  }

  // Extract network details
  const srcMatch = line.match(/SRC=([0-9a-fA-F:.]+)/);
  const dstMatch = line.match(/DST=([0-9a-fA-F:.]+)/);
  const protoMatch = line.match(/PROTO=(\w+)/);
  const sportMatch = line.match(/SPT=(\d+)/);
  const dportMatch = line.match(/DPT=(\d+)/);
  const inMatch = line.match(/IN=(\w+)/);

  return {
    timestamp,
    action,
    protocol: protoMatch?.[1] || 'UNKNOWN',
    srcIp: srcMatch?.[1] || '0.0.0.0',
    srcPort: sportMatch ? parseInt(sportMatch[1]) : undefined,
    dstIp: dstMatch?.[1] || '0.0.0.0',
    dstPort: dportMatch ? parseInt(dportMatch[1]) : undefined,
    interface: inMatch?.[1],
    raw: line,
  };
}

// Get UFW logs (last N entries). Tries kern.log (Debian/Ubuntu), syslog
// (Debian fallback), /var/log/messages (RHEL/Fedora), and journalctl
// (systemd-journald — Arch/NixOS/Fedora default). Returns [] silently if all
// sources are unreadable; check getUFWStatus().available for the install check.
export async function getUFWLogs(limit = 100): Promise<UFWLogEntry[]> {
  const safeLimit = sanitizeLimit(limit);

  // Ordered candidate sources. Each entry yields raw text containing UFW lines.
  const sources: Array<() => Promise<string>> = [
    () =>
      execAsync(`sudo -n grep -i "UFW" /var/log/kern.log | tail -n ${safeLimit}`).then(
        r => r.stdout
      ),
    () =>
      execAsync(`sudo -n grep -i "UFW" /var/log/syslog | tail -n ${safeLimit}`).then(r => r.stdout),
    () =>
      execAsync(`sudo -n grep -i "UFW" /var/log/messages | tail -n ${safeLimit}`).then(
        r => r.stdout
      ),
    // systemd-journald: Arch/NixOS/Fedora store kernel logs only here.
    () =>
      execAsync(
        `journalctl -k -o short-iso --no-pager -n ${safeLimit * 5} 2>/dev/null | grep -i UFW`
      ).then(r => r.stdout),
  ];

  for (const read of sources) {
    try {
      const text = await read();
      if (text && text.trim()) {
        const entries = text
          .split('\n')
          .filter(l => l.trim())
          .map(parseUFWLogLine)
          .filter((entry): entry is UFWLogEntry => entry !== null);
        if (entries.length > 0) {
          return entries.reverse(); // most recent first
        }
      }
    } catch {
      // source unavailable, try next
    }
  }

  return [];
}

// Get UFW status and rules
export async function getUFWStatus(): Promise<UFWStatus> {
  const installed = await binaryExists('ufw');
  if (!installed) {
    return {
      active: false,
      available: false,
      logging: 'unknown',
      defaultIncoming: 'unknown',
      defaultOutgoing: 'unknown',
      defaultRouted: 'unknown',
      rules: [],
      error:
        'ufw not installed (only Ubuntu/Debian ship ufw; firewalld/nftables on Fedora/RHEL/Arch/NixOS)',
    };
  }

  try {
    // Get verbose status
    const { stdout: statusOutput } = await execAsync('sudo -n ufw status verbose');

    const lines = statusOutput.split('\n');
    // "Status: inactive" also contains "active" — match the word after the colon
    const active = /^Status:\s+active\b/i.test(lines[0] ?? '');

    // Parse default policies
    const loggingMatch = statusOutput.match(/Logging:\s+(.+)/);
    const defaultInMatch = statusOutput.match(/Default:\s+(\w+)\s+\(incoming\)/);
    const defaultOutMatch = statusOutput.match(
      /Default:\s+\w+\s+\(incoming\),\s+(\w+)\s+\(outgoing\)/
    );
    const defaultRoutedMatch = statusOutput.match(
      /Default:\s+\w+\s+\(incoming\),\s+\w+\s+\(outgoing\),\s+(\w+)\s+\(routed\)/
    );

    // Get numbered rules
    let rules: UFWRule[] = [];
    try {
      const { stdout: rulesOutput } = await execAsync('sudo -n ufw status numbered');
      const ruleLines = rulesOutput.split('\n').filter(l => l.match(/^\[\s*\d+\]/));

      rules = ruleLines.map(line => {
        const numMatch = line.match(/^\[\s*(\d+)\]/);
        const num = numMatch ? parseInt(numMatch[1]) : 0;

        // Extract rule parts (simplified parsing)
        const parts = line.replace(/^\[\s*\d+\]\s*/, '').split(/\s{2,}/);

        return {
          num,
          to: parts[0] || '',
          action: parts[1] || '',
          from: parts[2] || '',
          description: parts[3],
        };
      });
    } catch {
      // If numbered rules fail, continue with empty array
    }

    return {
      active,
      available: true,
      logging: loggingMatch?.[1] || 'unknown',
      defaultIncoming: defaultInMatch?.[1] || 'unknown',
      defaultOutgoing: defaultOutMatch?.[1] || 'unknown',
      defaultRouted: defaultRoutedMatch?.[1] || 'unknown',
      rules,
    };
  } catch (error) {
    console.error('Failed to fetch UFW status:', error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      active: false,
      available: false,
      logging: 'unknown',
      defaultIncoming: 'unknown',
      defaultOutgoing: 'unknown',
      defaultRouted: 'unknown',
      rules: [],
      error: message.includes('password')
        ? 'sudo requires a password — configure passwordless sudo for ufw or run the server as root'
        : `ufw available but status read failed: ${message}`,
    };
  }
}

// Get top attacker IPs (IPs with most blocks)
export async function getTopAttackers(limit = 10): Promise<AttackerStats[]> {
  try {
    const logs = await getUFWLogs(1000); // Analyze last 1000 entries
    // Multicast-Ziele (224.0.0.0/4, z.B. Router-IGMP an 224.0.0.1) sind keine Angriffe
    const isMulticast = (ip: string) => /^(22[4-9]|23\d)\./.test(ip);
    const blockedLogs = logs.filter(log => log.action === 'BLOCK' && !isMulticast(log.dstIp));

    // Aggregate by source IP
    const attackerMap = new Map<string, { count: number; lastSeen: Date; ports: Set<number> }>();

    for (const log of blockedLogs) {
      const existing = attackerMap.get(log.srcIp);
      if (existing) {
        existing.count++;
        if (log.timestamp > existing.lastSeen) {
          existing.lastSeen = log.timestamp;
        }
        if (log.dstPort) {
          existing.ports.add(log.dstPort);
        }
      } else {
        attackerMap.set(log.srcIp, {
          count: 1,
          lastSeen: log.timestamp,
          ports: new Set(log.dstPort ? [log.dstPort] : []),
        });
      }
    }

    // Convert to array and sort by count
    const attackers: AttackerStats[] = Array.from(attackerMap.entries())
      .map(([ip, data]) => ({
        ip,
        blockedCount: data.count,
        lastSeen: data.lastSeen,
        targetPorts: Array.from(data.ports).sort((a, b) => a - b),
      }))
      .sort((a, b) => b.blockedCount - a.blockedCount)
      .slice(0, limit);

    return attackers;
  } catch (error) {
    console.error('Failed to analyze attackers:', error);
    return [];
  }
}
