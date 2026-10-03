import { spawn, type ChildProcess } from 'child_process';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { PackageScripts, ScriptOutput } from '../../shared/types.js';

// Store running processes. Finished entries stay (so the UI can still read the
// final output) and are dropped after FINISHED_TTL_MS.
const runningProcesses = new Map<string, { process: ChildProcess; output: string[] }>();
const FINISHED_TTL_MS = 5 * 60 * 1000;

/**
 * Signal the whole process group. The script runs detached (own group), so this
 * also reaches grandchildren like vite/tsx that `npm run` spawns — killing only
 * the npm process would leave them running.
 */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal); // group already gone or not a leader
    } catch {
      /* already exited */
    }
  }
}

export async function getPackageScripts(repoPath: string = process.cwd()): Promise<PackageScripts> {
  try {
    const packageJsonPath = join(repoPath, 'package.json');

    // Check if package.json exists
    await access(packageJsonPath);

    const content = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    // Detect package manager (check for lock files)
    let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';
    try {
      await access(join(repoPath, 'pnpm-lock.yaml'));
      packageManager = 'pnpm';
    } catch {
      try {
        await access(join(repoPath, 'yarn.lock'));
        packageManager = 'yarn';
      } catch {
        try {
          await access(join(repoPath, 'bun.lockb'));
          packageManager = 'bun';
        } catch {
          // Default to npm
        }
      }
    }

    return {
      scripts: packageJson.scripts || {},
      projectName: packageJson.name || 'unknown',
      packageManager,
    };
  } catch (error) {
    console.error('[NPM Scripts] Failed to read package.json:', error);
    throw new Error('Failed to read package.json');
  }
}

export function runScript(
  scriptName: string,
  repoPath: string = process.cwd(),
  packageManager: string = 'npm'
): string {
  const processId = `${repoPath}:${scriptName}:${Date.now()}`;

  // Kill existing process with same script name
  for (const [id, proc] of runningProcesses.entries()) {
    if (id.startsWith(`${repoPath}:${scriptName}:`)) {
      try {
        killGroup(proc.process, 'SIGTERM');
      } catch (error) {
        console.error('[NPM Scripts] Failed to kill existing process:', error);
      } finally {
        // Always remove from map, even if kill failed
        runningProcesses.delete(id);
      }
    }
  }

  const pmCommands: Record<string, string> = {
    npm: 'npm',
    pnpm: 'pnpm',
    yarn: 'yarn',
    bun: 'bun',
  };
  const command = pmCommands[packageManager] ?? 'npm';
  // All package managers support "<pm> run <script>"; using the run form avoids
  // ambiguity with built-in subcommands (e.g. `pnpm test` would else run pnpm's
  // own test, not the user script).
  const args = ['run', scriptName];

  // shell: false — scriptName is constrained to [A-Za-z0-9:_-] by the route's
  // zod schema; running through a shell would allow metacharacter injection.
  const childProcess = spawn(command, args, {
    cwd: repoPath,
    shell: false,
    detached: true, // own process group → stoppable as a unit, see killGroup()
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const processData = {
    process: childProcess,
    output: [] as string[],
  };

  runningProcesses.set(processId, processData);

  childProcess.stdout.on('data', (data: Buffer) => {
    const output = data.toString();
    processData.output.push(output);
    // Limit output size (keep last 100 lines)
    if (processData.output.length > 100) {
      processData.output.shift();
    }
  });

  childProcess.stderr.on('data', (data: Buffer) => {
    const output = `[ERROR] ${data.toString()}`;
    processData.output.push(output);
    if (processData.output.length > 100) {
      processData.output.shift();
    }
  });

  childProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    processData.output.push(
      signal ? `\n[Process terminated by ${signal}]` : `\n[Process exited with code ${code}]`
    );
    setTimeout(() => {
      if (runningProcesses.get(processId) === processData) runningProcesses.delete(processId);
    }, FINISHED_TTL_MS).unref();
  });

  childProcess.on('error', (error: Error) => {
    processData.output.push(`\n[Error: ${error.message}]`);
  });

  return processId;
}

export function getScriptOutput(processId: string): ScriptOutput {
  const processData = runningProcesses.get(processId);

  if (!processData) {
    return {
      output: 'Process not found',
      exitCode: null,
      isRunning: false,
    };
  }

  const isRunning =
    processData.process.exitCode === null && processData.process.signalCode === null;

  return {
    output: processData.output.join(''),
    exitCode: processData.process.exitCode,
    isRunning,
  };
}

export function stopScript(processId: string): { success: boolean; message: string } {
  const processData = runningProcesses.get(processId);

  if (!processData) {
    return { success: false, message: 'Process not found' };
  }

  try {
    killGroup(processData.process, 'SIGTERM');

    // Force kill after 2 seconds if still running
    setTimeout(() => {
      if (processData.process.exitCode === null && processData.process.signalCode === null) {
        killGroup(processData.process, 'SIGKILL');
      }
    }, 2000).unref();

    // Entry stays until the 'close' handler's TTL — the final output remains readable
    return { success: true, message: 'Process stopped' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to stop process',
    };
  }
}

export function getRunningProcesses(): string[] {
  return Array.from(runningProcesses.entries())
    .filter(([, p]) => p.process.exitCode === null && p.process.signalCode === null)
    .map(([id]) => id);
}

/** Server shutdown: take all script process groups down with us. */
export function stopAllScripts(): void {
  for (const { process: child } of runningProcesses.values()) killGroup(child, 'SIGTERM');
}
