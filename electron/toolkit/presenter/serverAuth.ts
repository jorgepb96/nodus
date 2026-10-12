// PDF Presenter — the pure, security-critical helpers of the mobile-remote server:
// PIN generation/checking and path-traversal guards. Kept Electron-free (only node
// crypto/path) so they can be unit-tested directly (scripts/test-presenter-server.mjs).
// The server (server.ts) wires these to the live http/ws sockets.
import crypto from 'node:crypto';
import path from 'node:path';

/** A fresh 6-digit connection PIN for one presentation session. */
export function makePin(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** Loopback clients (the app's own windows) never need the PIN. */
export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const a = remoteAddress.replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/** A LAN client is admitted only with the correct PIN; loopback is always allowed. */
export function isAuthorized(remoteAddress: string | undefined, providedPin: string | null, pin: string | null): boolean {
  if (isLoopback(remoteAddress)) return true;
  return !!pin && providedPin === pin;
}

/** Failed PIN attempts one address may make, and the whole session, before the gate refuses
 *  every further non-loopback request. A 6-digit PIN with no limit falls to a LAN client
 *  looping over 000000–999999 within minutes; with these limits the chance is about 1 in 9,000. */
export const PIN_FAILURES_PER_ADDRESS = 10;
export const PIN_FAILURES_PER_SESSION = 100;

export interface PinRequest {
  remoteAddress: string | undefined;
  providedPin: string | null;
  /** The request's Host and Origin headers. */
  host?: string;
  origin?: string;
}

function hostName(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value.includes('://') ? value : `http://${value}`).hostname.replace(/^\[|\]$/g, ''); }
  catch { return null; }
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', '::1', 'localhost']);

function samePin(provided: string | null, pin: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(pin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** One session's admission check.
 *
 *  Loopback skips the PIN only when the request is addressed to a loopback NAME and no foreign
 *  page sent it: a web page in the presenter's own browser can reach ws://127.0.0.1:<port> (a
 *  WebSocket is not bound by CORS), and a DNS-rebinding page reaches /api/* under its own host
 *  name. Everything else needs the PIN, and repeated wrong PINs close the gate. */
export function createPinGate(pin: string, limits = { perAddress: PIN_FAILURES_PER_ADDRESS, perSession: PIN_FAILURES_PER_SESSION }) {
  const failures = new Map<string, number>();
  let total = 0;
  return {
    admit(request: PinRequest): boolean {
      if (isLoopback(request.remoteAddress)) {
        const host = hostName(request.host);
        const origin = request.origin === undefined ? null : hostName(request.origin);
        if (host && LOOPBACK_NAMES.has(host) && (request.origin === undefined || (origin && LOOPBACK_NAMES.has(origin)))) return true;
      }
      const address = (request.remoteAddress ?? '').replace(/^::ffff:/, '');
      if (total >= limits.perSession || (failures.get(address) ?? 0) >= limits.perAddress) return false;
      if (samePin(request.providedPin, pin)) return true;
      if (request.providedPin !== null) {
        failures.set(address, (failures.get(address) ?? 0) + 1);
        total += 1;
      }
      return false;
    },
  };
}

export type PinGate = ReturnType<typeof createPinGate>;

/**
 * Resolve the on-disk PDF for a presentation id, or null if the id tries to escape
 * the library directory (path traversal). `id` is reduced to its basename first.
 */
export function safePdfPath(baseDir: string, id: string): string | null {
  const safeId = path.basename(String(id));
  if (!safeId || safeId === '.' || safeId === '..') return null;
  const resolved = path.resolve(baseDir, `${safeId}.pdf`);
  const root = path.resolve(baseDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

/**
 * Resolve a static file request against the dist directory, or null if it escapes
 * it. `urlPath` is the request path ("/assets/x.js"); "/" maps to the mobile page.
 */
export function safeStaticPath(distDir: string, urlPath: string): string | null {
  let rel: string;
  // A malformed escape (`/%`) is no path at all, not an exception on an unauthenticated socket.
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (rel === '/' || rel === '') rel = '/presenterRemote.html';
  const resolved = path.resolve(distDir, `.${rel}`);
  const root = path.resolve(distDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
