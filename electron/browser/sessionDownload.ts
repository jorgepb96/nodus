// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors
import { net } from 'electron';
import { browserSession } from './session';
import { MAX_PUBLIC_DOWNLOAD_BYTES } from '../network/publicDownload';

function safeWebUrl(url: string): boolean {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

export function fetchThroughBrowserSession(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, session: browserSession(), useSessionCookies: true });
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`The document could not be downloaded (HTTP ${response.statusCode}).`));
        // Drain rather than leave the socket hanging on an error path.
        response.on('data', () => undefined);
        return;
      }
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        // Bounded before anything is written: an unbounded read of a hostile or
        // simply enormous URL would be held entirely in memory.
        if (total > MAX_PUBLIC_DOWNLOAD_BYTES) {
          reject(new Error('The document is larger than 64 MB.'));
          request.abort();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      response.on('error', reject);
    });
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (!safeWebUrl(redirectUrl)) {
        reject(new Error('The document redirected to a blocked URL scheme.'));
        request.abort();
      }
    });
    request.on('error', reject);
    request.end();
  });
}
