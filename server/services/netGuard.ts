import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * SSRF guard: literal check for hostnames/IPs that are private / loopback /
 * link-local / CGNAT. Handles IPv4, IPv6 (incl. ::1, fc00::/7, fe80::/10) and
 * the literal "localhost" name. Does NOT resolve DNS — use isPrivateHost() for
 * the full check including resolution.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::' || host === '::ffff:127.0.0.1') return true;

  // IPv4 dotted-quad — strip any IPv4-in-IPv6 prefix
  let v4 = host.startsWith('::ffff:') ? host.slice(7) : host;
  // ::ffff:aabb:ccdd  →  aa.bb.cc.dd  (IPv4-mapped in hex group notation)
  const hexMapped = v4.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])].map(octet => {
      if (octet > 255) return NaN;
      return octet;
    });
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 (loopback)
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  }

  // IPv6 private/link-local (only simple forms — does not normalize). Gated on a
  // real IPv6 literal: hostnames like fcbayern.com or fdroid.org also start with "fc"/"fd".
  if (isIP(host) === 6) {
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 ULA
    if (
      host.startsWith('fe80:') ||
      host.startsWith('fe90:') ||
      host.startsWith('fea0:') ||
      host.startsWith('feb0:')
    )
      return true; // fe80::/10 link-local
  }

  return false;
}

/**
 * Full SSRF check: literal match plus DNS resolution — a public-looking
 * hostname whose A/AAAA records point at private space is treated as private.
 * Unresolvable hostnames are treated as private (fail closed).
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  if (isPrivateOrLoopbackHost(hostname)) return true;
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return false; // literal public IP

  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.some(a => isPrivateOrLoopbackHost(a.address));
  } catch {
    return true; // fail closed: unresolvable → refuse to scrape
  }
}
