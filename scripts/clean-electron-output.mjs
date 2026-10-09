// Empties dist-electron before a build.
//
// Vite writes the main process as content-hashed chunks, and `emptyOutDir` is false on every one
// of those targets because several passes write into the same directory and a later pass would
// otherwise wipe an earlier pass's output. Nothing then removed the previous build's chunks, so
// the directory accumulated one ~21 MB `main-<hash>.js` per build — measured at 133 files and
// 460 MB, of which 21 MB was reachable — and `package.json` packs `dist-electron/**/*`, so all of
// it shipped inside the archive.
//
// The size was the lesser problem. Asking "is this fix in the build?" by searching the archive
// returned one hit per retained copy, which says only how many builds ago a string was added; and
// a string REMOVED by the current build still appeared in the older copies, so the search could
// report a fix as present when the live bundle no longer had it. Two build checks were answered
// wrongly that way before the cause was found.
//
// Cleaning once here, rather than setting `emptyOutDir` on the targets, keeps the multi-pass
// writes working: every pass still appends, and the directory now means "this build".
//
// Node rather than `rm -rf`: the build runs on windows-latest in CI.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'dist-electron');

// The path is derived, not taken from input, but it is a recursive delete: check it anyway.
if (path.basename(target) !== 'dist-electron' || path.dirname(target) !== root) {
  throw new Error(`refusing to delete ${target}: not the expected build output directory`);
}

if (!existsSync(target)) {
  console.log('[clean] dist-electron: nothing to remove');
} else {
  const files = readdirSync(target, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const bytes = files.reduce((sum, entry) => {
    try { return sum + statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size; } catch { return sum; }
  }, 0);
  rmSync(target, { recursive: true, force: true });
  console.log(`[clean] dist-electron: removed ${files.length} file(s), ${(bytes / 1048576).toFixed(0)} MB`);
}
