// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { yieldToEventLoop } from '../util/async';

/**
 * Everything Ming TTS keeps on disk lives under `userData/local-tts/`: the Python environment,
 * downloaded checkpoints, the voice library and the fragments of narrations being generated.
 * Finished narration clips belong to the vault (`<vault>/audio`), like before.
 */
export function ttsRoot(): string {
  return path.join(app.getPath('userData'), 'local-tts');
}
export const ttsRuntimeDir = () => path.join(ttsRoot(), 'runtime');
export const ttsModelsDir = () => path.join(ttsRoot(), 'models');
export const ttsVoicesDir = () => path.join(ttsRoot(), 'voices');
export const ttsLiveDir = () => path.join(ttsRoot(), 'live');
export const ttsLogPath = () => path.join(ttsRoot(), 'engine.log');

/** Sidecar scripts and locks: beside the app resources when packaged, the repo in development. */
export function ttsAssetsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'ming-tts') : path.join(app.getAppPath(), 'runtime/ming-tts');
}

/** Voices that ship with Nodus (the CC0 Castilian sample). Read from the asar, copied out on first use. */
export function ttsBundledVoicesDir(): string {
  return path.join(app.getAppPath(), 'electron/assets/tts/voices');
}

/** The pinned standalone Python runtime bundled for Windows and Linux. */
export function ttsBundledPythonRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp');
}

/** Total bytes under a directory, walked asynchronously so a large environment never stalls the main thread. */
export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  let visited = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        try { total += (await fs.stat(full)).size; } catch { /* removed meanwhile */ }
      }
      if (++visited % 256 === 0) await yieldToEventLoop();
    }
  };
  await walk(root);
  return total;
}
