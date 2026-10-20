// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';

/** Pure URL mapping for `nodus-audio://` (see audioProtocol.ts), kept Electron-free for tests. */
export const NODUS_AUDIO_SCHEME = 'nodus-audio';

export interface AudioProtocolResolvers {
  liveDir: () => string;
  clipPath: (clipId: string) => string | null;
  voicePath: (voiceId: string) => string | null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Maps a `nodus-audio://` URL to a file, refusing anything that could escape its directory. */
export function resolveAudioUrl(url: string, resolvers: AudioProtocolResolvers): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== `${NODUS_AUDIO_SCHEME}:`) return null;
  const parts = parsed.pathname.replace(/^\/+/, '').split('/').map((part) => decodeURIComponent(part));
  if (!parts.every((part) => SAFE_SEGMENT.test(part) && part !== '.' && part !== '..')) return null;
  if (parsed.hostname === 'live' && parts.length === 2 && /^\d{3,5}\.wav$/.test(parts[1])) {
    const root = resolvers.liveDir();
    const file = path.join(root, parts[0], parts[1]);
    return path.relative(root, file).startsWith('..') ? null : file;
  }
  if (parsed.hostname === 'clip' && parts.length === 1) return resolvers.clipPath(parts[0]);
  if (parsed.hostname === 'voice' && parts.length === 1) return resolvers.voicePath(parts[0]);
  return null;
}

export function liveFragmentUrl(jobId: string, filePath: string): string {
  return `${NODUS_AUDIO_SCHEME}://live/${encodeURIComponent(jobId)}/${encodeURIComponent(path.basename(filePath))}`;
}
export const clipAudioUrl = (clipId: string) => `${NODUS_AUDIO_SCHEME}://clip/${encodeURIComponent(clipId)}`;
export const voiceAudioUrl = (voiceId: string) => `${NODUS_AUDIO_SCHEME}://voice/${encodeURIComponent(voiceId)}`;

