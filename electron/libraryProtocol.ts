import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { libraryReaderAttachmentPath, libraryReaderOriginalPath } from './libraryReader/libraryReaderStore';

export const NODUS_LIBRARY_SCHEME = 'nodus-library';

export function registerLibrarySchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: NODUS_LIBRARY_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

interface ByteRange { start: number; end: number }

function parseRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return 'invalid';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function mimeType(file: string): string {
  return ({
    '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.xml': 'application/xml; charset=utf-8', '.jats': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8',
  } as Record<string, string>)[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function resourceIdentity(request: Request): { kind: 'original'; documentId: string } | { kind: 'attachment'; documentId: string; attachmentId: string } | null {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map((entry) => decodeURIComponent(entry));
    if (url.hostname === 'original' && parts.length === 1 && parts[0].length <= 2_048) return { kind: 'original', documentId: parts[0] };
    if (url.hostname === 'attachment' && parts.length === 2 && parts.every((entry) => entry.length <= 2_048)) {
      return { kind: 'attachment', documentId: parts[0], attachmentId: parts[1] };
    }
    return null;
  } catch { return null; }
}

function readSlice(file: string, start: number, end: number): Uint8Array {
  const length = end - start + 1;
  const result = Buffer.allocUnsafe(length);
  const descriptor = fs.openSync(file, 'r');
  try {
    const read = fs.readSync(descriptor, result, 0, length, start);
    return Uint8Array.from(result.subarray(0, read));
  } finally { fs.closeSync(descriptor); }
}

export function registerLibraryProtocol(): void {
  protocol.handle(NODUS_LIBRARY_SCHEME, (request) => {
    try {
      const identity = resourceIdentity(request);
      if (!identity) return new Response(null, { status: 400 });
      const file = identity.kind === 'original'
        ? libraryReaderOriginalPath(identity.documentId)
        : libraryReaderAttachmentPath(identity.documentId, identity.attachmentId);
      if (!file) return new Response(null, { status: 404 });
      const stat = fs.statSync(file);
      const headers = new Headers({
        'Accept-Ranges': 'bytes', 'Content-Type': mimeType(file), 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file).replace(/[\r\n]/g, ''))}`,
      });
      const range = parseRange(request.headers.get('range'), stat.size);
      if (range === 'invalid') {
        headers.set('Content-Range', `bytes */${stat.size}`);
        return new Response(null, { status: 416, headers });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      // An empty file has no byte 0: without this it was announced as one byte long with an
      // empty body, a length mismatch the renderer reports as a failed load.
      if (stat.size === 0) {
        headers.set('Content-Length', '0');
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(0), { status: 200, headers });
      }
      headers.set('Content-Length', String(Math.max(0, end - start + 1)));
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      return new Response(readSlice(file, start, end), { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 503 }); }
  });
}
