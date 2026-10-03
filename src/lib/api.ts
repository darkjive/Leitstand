// Fetch wrapper that attaches the optional dashboard token to same-origin API
// requests. The token is configured in Settings and persisted in localStorage
// under 'dashboard-token'. When unset, requests go out unchanged (loopback
// default). Server-side the token gates the whole /api surface — reads included,
// since they expose filesystem layout, log contents and running processes.
//
// Only ever use this for same-origin '/api/...' paths: third-party endpoints
// (GitHub, Hacker News, rss2json) must keep plain fetch so the token never
// leaves the machine.

const TOKEN_KEY = 'dashboard-token';

export function getDashboardToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setDashboardToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(
      new CustomEvent('homelab:settings-changed', { detail: { key: TOKEN_KEY } })
    );
  } catch {
    // ignore quota / privacy mode
  }
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getDashboardToken();
  const headers = new Headers(init.headers || {});
  // Custom header → browsers must preflight, so foreign sites cannot trigger
  // state-changing requests (server enforces it for non-GET, see server/index.ts).
  headers.set('X-Leitstand-Request', '1');
  if (token) headers.set('X-Dashboard-Token', token);
  return fetch(path, { ...init, headers });
}

/**
 * Appends the dashboard token to a WebSocket URL. Browsers cannot set headers
 * on a WS handshake, so the server reads it from the query string instead.
 */
export function wsUrlWithToken(url: string): string {
  const token = getDashboardToken();
  if (!token) return url;
  return `${url}?token=${encodeURIComponent(token)}`;
}
