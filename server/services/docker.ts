import si from 'systeminformation';
import type { DockerContainer, DockerInfo } from '../../shared/types.js';

let lastFetch: { data: DockerInfo; timestamp: number } | null = null;
let fetchPromise: Promise<DockerInfo> | null = null;
const CACHE_DURATION = 5000; // 5 seconds cache

export async function getDockerInfo(): Promise<DockerInfo> {
  // Return cached data if fresh
  if (lastFetch && Date.now() - lastFetch.timestamp < CACHE_DURATION) {
    return lastFetch.data;
  }

  // Prevent concurrent fetches - return existing promise if fetch is in progress
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      // Check if Docker is running by getting containers
      const containers = await si.dockerContainers(true);

      if (!containers || containers.length === 0) {
        // si returns [] both for "no containers" and "daemon unreachable";
        // dockerInfo() yields {} (no id) in the latter case.
        const daemon = await si.dockerInfo();
        const emptyInfo: DockerInfo = {
          containers: [],
          running: 0,
          stopped: 0,
          total: 0,
          available: Boolean(daemon.id),
          ...(daemon.id ? {} : { error: 'Docker daemon not reachable' }),
        };
        lastFetch = { data: emptyInfo, timestamp: Date.now() };
        return emptyInfo;
      }

      // Map systeminformation docker data to our interface.
      // Cast to any: systeminformation's declared DockerContainerData omits
      // `status`/`cpuPercent`/`memPercent` which the runtime DOES return when
      // stats are available — using the declared type would drop those fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedContainers: DockerContainer[] = containers.map((c: any) => ({
        id: c.id || '',
        name: c.name || 'unknown',
        image: c.image || '',
        state: c.state || 'unknown',
        status: c.status || '',
        created: c.created || 0,
        started: c.started || 0,
        // Docker API returns port objects; the widget shows "public->private/type".
        ports: (c.ports || []).map(
          (p: { PrivatePort: number; PublicPort?: number; Type: string }) =>
            p.PublicPort
              ? `${p.PublicPort}->${p.PrivatePort}/${p.Type}`
              : `${p.PrivatePort}/${p.Type}`
        ),
        mounts: c.mounts || [],
        cpu: c.cpuPercent || undefined,
        memory: c.memPercent || undefined,
      }));

      const running = mappedContainers.filter(c => c.state === 'running').length;
      const stopped = mappedContainers.filter(c => c.state !== 'running').length;

      const info: DockerInfo = {
        containers: mappedContainers,
        running,
        stopped,
        total: mappedContainers.length,
        available: true,
      };

      lastFetch = { data: info, timestamp: Date.now() };
      return info;
    } catch (error) {
      console.error('[Docker] Failed to fetch Docker info:', error);

      const errorInfo: DockerInfo = {
        containers: [],
        running: 0,
        stopped: 0,
        total: 0,
        available: false,
        error: error instanceof Error ? error.message : 'Docker not available',
      };

      lastFetch = { data: errorInfo, timestamp: Date.now() };
      return errorInfo;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}
