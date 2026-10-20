// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { parseArchiveByteRange } from '../archiveProtocol';
import { NODUS_AUDIO_SCHEME, resolveAudioUrl, type AudioProtocolResolvers } from './audioUrls';

export { NODUS_AUDIO_SCHEME, clipAudioUrl, liveFragmentUrl, voiceAudioUrl } from './audioUrls';

/**
 * `nodus-audio://` serves narration audio straight from disk with HTTP range support:
 *
 *   nodus-audio://live/<jobId>/<NNN>.wav   a fragment of a narration still being generated
 *   nodus-audio://clip/<clipId>            a finished clip in the active vault
 *   nodus-audio://voice/<voiceId>          a voice library reference recording
 *
 * The old route encoded each WAV as a base64 data: URL in the main process and copied it
 * across IPC; a long report meant tens of megabytes of string work on the main thread. Here
 * Chromium reads the file in streamed slices and the main thread only resolves a path.
 */
export function registerAudioSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: NODUS_AUDIO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

export function registerAudioProtocol(resolvers: AudioProtocolResolvers): void {
  protocol.handle(NODUS_AUDIO_SCHEME, async (request) => {
    try {
      const file = resolveAudioUrl(request.url, resolvers);
      if (!file) return new Response(null, { status: 404 });
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) return new Response(null, { status: 404 });
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      const range = parseArchiveByteRange(request.headers.get('range'), stat.size);
      if (range === 'invalid') {
        headers.set('Content-Range', `bytes */${stat.size}`);
        return new Response(null, { status: 416, headers });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      headers.set('Content-Length', String(stat.size ? end - start + 1 : 0));
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status: range ? 206 : 200, headers });
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(stream, { status: range ? 206 : 200, headers });
    } catch {
      // A vault switch can race an in-flight request; fail only this resource.
      return new Response(null, { status: 503 });
    }
  });
}
