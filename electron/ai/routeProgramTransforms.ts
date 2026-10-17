import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { parseRouteTransforms, routeProgramTransformsBlock as formatBlock } from '@shared/routeProgramTransforms';

/** Finding the installed chemistry package, so program mode can offer the transformations it ships.
 *
 *  Why this exists, measured 2026-10-13: program mode's contract says "use only the transformation
 *  ids the application offers you", and the application offered none — no tool lists them and the
 *  worker never surfaced them. The model duly wrote no program, because it could not know a single
 *  valid id. The contract was unfollowable, not ignored.
 *
 *  Best-effort by design: no package, an older one without the file, or unreadable JSON all return
 *  an empty list, and the caller then sends no transformation block.
 */
const PLUGIN_ID = 'chemistry-studio';

/** The active slot's directory, by the same path the capability registry uses. The slot is named
 *  for the version it was INSTALLED as, which is not the version of the content it holds — a
 *  sideload overwrites the slot in place — so the name is read from state.json, never assumed. */
function activeSlotDirectory(): string | null {
  try {
    const installed = path.join(app.getPath('userData'), 'plugins', 'installed', PLUGIN_ID);
    const state = JSON.parse(fs.readFileSync(path.join(installed, 'state.json'), 'utf8')) as
      { active?: { version?: string; digest?: string } };
    const { version, digest } = state.active ?? {};
    if (!version || !digest) return null;
    return path.join(installed, 'versions', `${version}-${digest}`);
  } catch {
    return null;
  }
}

/** The transformation block for a program-mode request, or '' when none could be read. */
export function routeProgramTransformsBlock(): string {
  const slot = activeSlotDirectory();
  if (!slot) return '';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(slot, 'python', 'route_transforms.json'), 'utf8'));
    return formatBlock(parseRouteTransforms(raw));
  } catch {
    return '';
  }
}
