import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export interface SystemPython { path: string; version: string }

/** `python3.N` binaries on PATH, newest first. `python3` alone names whichever interpreter was
 *  installed last, which may be one no package supports yet while an older one sits beside it. */
function versionedPythonNames(): string[] {
  const minors = new Set<number>();
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const match = /^python3\.(\d+)$/.exec(name);
        if (match) minors.add(Number(match[1]));
      }
    } catch { /* missing or unreadable PATH entry */ }
  }
  return [...minors].sort((a, b) => b - a).map(minor => `python3.${minor}`);
}

/** Locate an existing interpreter without modifying it or installing packages.
 *
 *  `accepts` is asked with each candidate's `major.minor`; a package passes whether it ships a
 *  lock for that version, so a newer default `python3` it cannot serve does not hide an older
 *  versioned one it can. Every interpreter probed is appended to `seen`, for the message. */
export async function findSystemPython(minVersion: string, accepts: (minor: string) => boolean = () => true, seen: SystemPython[] = []): Promise<SystemPython | null> {
  const generic = process.platform === 'win32' ? ['py', 'python3', 'python'] : ['python3', 'python'];
  const candidates = process.platform === 'win32' ? generic : [...generic, ...versionedPythonNames()];
  const [minMajor, minMinor] = minVersion.split('.').map(Number);
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3]); print(sys.executable)'], { timeout: 10_000 });
      const [version, resolved] = stdout.trim().split('\n').map(line => line.trim());
      if (!resolved || seen.some(python => python.path === resolved)) continue;
      seen.push({ path: resolved, version });
      const [major, minor] = version.split('.').map(Number);
      if ((major > minMajor || major === minMajor && minor >= minMinor) && accepts(`${major}.${minor}`)) return { path: resolved, version };
    } catch { /* try the next candidate */ }
  }
  return null;
}
