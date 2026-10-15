import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** Where the user's building-block library lives, or null when they have not installed one.
 *
 *  The library is the user's own data and is never shipped: the plugin's decomposition reads a
 *  `monomers.json` from this directory, built by `tools/build-monomers.py`, and without one it
 *  still returns the fragments it cut, unnamed. So a missing library degrades the decomposition
 *  rather than failing it, and this returns null exactly as the stock directory does when no
 *  catalogue has been imported.
 *
 *  Overridable with NODUS_MONOMER_DIR, which is how a harness run points at a library outside the
 *  application's own data directory. */
export function monomerLibraryDirectory(): string | null {
  const dir = process.env.NODUS_MONOMER_DIR || path.join(app.getPath('userData'), 'chemistry-monomers');
  try {
    return fs.statSync(path.join(dir, 'monomers.json')).isFile() ? dir : null;
  } catch {
    return null;
  }
}

export interface MonomerLibraryInfo { entries: number; aliases: number; sources: string[]; generated?: string }

/** What the installed library holds, for the settings view. Null when there is none, and null
 *  rather than a throw when the file is there but unreadable — a corrupt library reads as no
 *  library, which is what the decomposition does with it too. */
export function monomerLibraryInfo(): MonomerLibraryInfo | null {
  const dir = monomerLibraryDirectory();
  if (!dir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'monomers.json'), 'utf8')) as {
      counts?: { entries?: number; aliases?: number };
      sources?: Array<{ file?: string }>;
      generated?: string;
    };
    return {
      entries: raw.counts?.entries ?? 0,
      aliases: raw.counts?.aliases ?? 0,
      sources: (raw.sources ?? []).map((s) => s.file ?? '').filter(Boolean),
      ...(raw.generated ? { generated: raw.generated } : {}),
    };
  } catch {
    return null;
  }
}
