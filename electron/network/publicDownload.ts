// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

export const MAX_PUBLIC_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.epub', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.html', '.htm', '.xml', '.jats',
  '.csv', '.tsv', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.png', '.jpg', '.jpeg', '.webp',
  '.gif', '.tif', '.tiff', '.bmp', '.svg', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.mp4', '.m4v', '.webm',
]);

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/epub+zip': '.epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/csv': '.csv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

export interface PublicFetchResult {
  response: Response;
  finalUrl: string;
}

export interface PublicFetchOptions {
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  assertPublic?: (url: string) => Promise<URL>;
  signal?: AbortSignal;
}

export interface RemoteFileNameCandidate {
  fileName?: string;
  title?: string;
  mimeType?: string;
  url?: string;
}

function cleanText(value: unknown, limit = 10_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function safeRemoteFileName(raw: string | undefined, mimeType: string | undefined, url?: string): string {
  let candidate = cleanText(raw, 240);
  if (!candidate && url) {
    try { candidate = decodeURIComponent(path.basename(new URL(url).pathname)); } catch { candidate = ''; }
  }
  candidate = [...candidate]
    .map((character) => (character.codePointAt(0)! < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!candidate) candidate = `document-${randomUUID().slice(0, 8)}`;
  let extension = path.extname(candidate).toLowerCase();
  const mime = cleanText(mimeType, 200).split(';')[0].toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    extension = MIME_EXTENSIONS[mime] ?? '.txt';
    candidate = `${path.basename(candidate, path.extname(candidate))}${extension}`;
  }
  return candidate.slice(-220);
}

function ipv6Hextets(address: string): number[] | null {
  let normalized = address.toLowerCase().trim();
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1);
  normalized = normalized.split('%', 1)[0];
  const dotted = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dotted) {
    const octets = dotted.split('.').map(Number);
    if (octets.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) return null;
    normalized = `${normalized.slice(0, -dotted.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (parts.length !== 8 || parts.some((entry) => !/^[0-9a-f]{1,4}$/.test(entry))) return null;
  return parts.map((entry) => Number.parseInt(entry, 16));
}

export function isPrivateAddress(address: string): boolean {
  const literal = address.toLowerCase().trim().replace(/^\[|\]$/g, '').split('%', 1)[0];
  const normalized = literal.replace(/^::ffff:/, '');
  if (net.isIPv4(normalized)) {
    const [a, b, c] = normalized.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIPv6(literal)) {
    const words = ipv6Hextets(literal);
    if (!words) return true;
    const mapped = words.slice(0, 5).every((entry) => entry === 0) && words[5] === 0xffff;
    const compatible = words.slice(0, 6).every((entry) => entry === 0);
    if (mapped || compatible) {
      const embedded = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
      if (isPrivateAddress(embedded)) return true;
    }
    return words.every((entry) => entry === 0) ||
      (words.slice(0, 7).every((entry) => entry === 0) && words[7] === 1) ||
      (words[0] & 0xfe00) === 0xfc00 ||
      (words[0] & 0xffc0) === 0xfe80 ||
      (words[0] & 0xff00) === 0xff00 ||
      (words[0] === 0x2001 && words[1] === 0x0db8);
  }
  return false;
}

// The lookup runs inside the actual socket connection. This both validates and
// pins the chosen public address, closing the DNS-rebinding gap between a
// preflight lookup and fetch().
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const resolved = Array.isArray(addresses) ? addresses : [];
    if (!resolved.length || resolved.some((entry) => isPrivateAddress(entry.address))) {
      const rejected = new Error('The resource host resolves to a private or reserved address.') as NodeJS.ErrnoException;
      rejected.code = 'ENOTFOUND';
      return callback(rejected, '', 0);
    }
    if (options.all) return callback(null, resolved);
    return callback(null, resolved[0].address, resolved[0].family);
  });
};

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function fetchWithPinnedPublicDns(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET',
      headers: init.headers as Record<string, string>,
      lookup: publicLookup,
      signal: init.signal ?? undefined,
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2)
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      // The Response constructor throws for a body on a null-body status (204, 304, …) and
      // for any status outside 200-599. Thrown here, inside the socket callback, that
      // escaped the promise as an uncaught exception and left the caller waiting for the
      // timeout, which then reported a misleading "operation was aborted".
      const status = incoming.statusCode ?? 500;
      try {
        const nullBody = NULL_BODY_STATUSES.has(status);
        if (nullBody) incoming.resume();
        resolve(new Response(nullBody ? null : Readable.toWeb(incoming) as ReadableStream, {
          status,
          statusText: incoming.statusMessage,
          headers,
        }));
      } catch (error) {
        incoming.destroy();
        reject(new Error(`The resource server answered with an invalid HTTP status (${status}).`, { cause: error }));
      }
    });
    request.once('error', reject);
    request.end();
  });
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) resources can be downloaded.');
  if (!url.hostname || url.username || url.password || url.hostname.toLowerCase() === 'localhost') throw new Error('The resource URL is not public.');
  if (isPrivateAddress(url.hostname)) throw new Error('Private-network resource URLs are not accepted.');
  const addresses = await dnsPromises.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('The resource host resolves to a private address.');
  return url;
}

export async function fetchPublicResource(raw: string, options: PublicFetchOptions = {}): Promise<PublicFetchResult> {
  const validate = options.assertPublic ?? assertPublicUrl;
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_DOWNLOAD_BYTES;
  let current = await validate(raw);
  for (let redirect = 0; redirect < 6; redirect += 1) {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    const init = {
      redirect: 'manual',
      signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
      headers: {
        Accept: options.accept ?? '*/*',
        'User-Agent': 'Nodus/4 document client',
        ...(options.headers ?? {}),
      },
    } as RequestInit;
    const response = options.fetcher
      ? await options.fetcher(current, init)
      : await fetchWithPinnedPublicDns(current, init);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Resource download redirected without a location (${response.status}).`);
      await response.body?.cancel();
      current = await validate(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Resource download returned ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error(`The resource is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    return { response, finalUrl: current.toString() };
  }
  throw new Error('The resource redirected too many times.');
}

export async function fetchPublicAttachment(raw: string, options: PublicFetchOptions = {}): Promise<Response> {
  return (await fetchPublicResource(raw, options)).response;
}

/**
 * Read a response as text, refusing to buffer past `maxBytes`.
 *
 * A declared `content-length` is only a promise: a body that streams without one, or that
 * understates itself, would otherwise be read into memory in full.
 */
export async function readBoundedText(response: Response, maxBytes: number, tooLargeMessage = 'The downloaded page is larger than allowed.'): Promise<string> {
  if (!response.body) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(tooLargeMessage);
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

export async function responseToTemporaryFile(
  response: Response,
  candidate: RemoteFileNameCandidate,
  options: { prefix?: string; maxBytes?: number } = {},
): Promise<{ dir: string; file: string }> {
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_DOWNLOAD_BYTES;
  const mimeType = cleanText(response.headers.get('content-type') ?? candidate.mimeType, 200).split(';')[0];
  const fileName = safeRemoteFileName(candidate.fileName || candidate.title, mimeType, candidate.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? 'nodus-public-download-'));
  const file = path.join(dir, fileName);
  const handle = fs.openSync(file, 'wx', 0o600);
  let total = 0;
  try {
    if (!response.body) throw new Error('The resource response was empty.');
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`The resource is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      fs.writeSync(handle, chunk);
    }
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  fs.closeSync(handle);
  if (!total) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('The resource response was empty.'); }
  return { dir, file };
}
