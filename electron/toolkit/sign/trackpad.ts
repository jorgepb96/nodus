import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SignTrackpadFrame, SignTrackpadSurface } from '@shared/signTypes';

interface TrackpadBridge {
  start(onFrame: (frame: SignTrackpadFrame) => void): SignTrackpadSurface | null;
  stop(): void;
}
let bridge: TrackpadBridge | null | undefined;

/** Finger positions on the Mac trackpad; null wherever only the cursor is available. */
function nativeTrackpad(): TrackpadBridge | null {
  if (bridge !== undefined) return bridge;
  if (process.platform !== 'darwin') return (bridge = null);
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'trackpad-native', 'nodus-trackpad.node')
    : path.join(app.getAppPath(), 'build', 'trackpad-native', process.arch, 'nodus-trackpad.node');
  try { bridge = createRequire(import.meta.url)(file) as TrackpadBridge; }
  catch { bridge = null; }
  return bridge;
}

/** One drawing session at a time; a new one replaces the previous listener. */
export function startTrackpad(onFrame: (frame: SignTrackpadFrame) => void): SignTrackpadSurface | null {
  const native = nativeTrackpad();
  if (!native) return null;
  try { return native.start(onFrame); }
  catch { return null; }
}

export function stopTrackpad() {
  nativeTrackpad()?.stop();
}
