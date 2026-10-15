import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Locate an existing interpreter without modifying it or installing packages. */
export async function findSystemPython(minVersion: string): Promise<{ path: string; version: string } | null> {
  const candidates = process.platform === 'win32' ? ['py', 'python3', 'python'] : ['python3', 'python'];
  const [minMajor, minMinor] = minVersion.split('.').map(Number);
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { timeout: 10_000 });
      const version = stdout.trim();
      const [major, minor] = version.split('.').map(Number);
      if (major > minMajor || major === minMajor && minor >= minMinor) {
        const { stdout: resolved } = await run(candidate, ['-c', 'import sys; print(sys.executable)'], { timeout: 10_000 });
        return { path: resolved.trim(), version };
      }
    } catch { /* try the next candidate */ }
  }
  return null;
}
