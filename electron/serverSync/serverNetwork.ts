const REQUEST_TIMEOUT_MS = 60_000;
/**
 * The slowest uplink a request body is still expected to cross: 256 KiB/s, about 2 Mbit/s.
 *
 * AbortSignal.timeout covers the whole exchange, upload included, and the server answers
 * only once it has the whole body. A flat 60 s therefore meant a publication could only ever
 * succeed above a fixed upload speed: a real academic library's snapshot is 36.7 MiB gzipped
 * (85.6 MiB with passages), which needs ~4.9 (~11.4) Mbit/s sustained to finish in 60 s. Below
 * that every attempt was aborted, rebuilt and re-sent from scratch, forever.
 */
const MIN_UPLOAD_BYTES_PER_SECOND = 256 * 1024;

function bodyBytes(body: unknown): number {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
}

/** The time budget for one request: the base, plus what its body needs at the slowest uplink. */
export function requestTimeoutMs(init: RequestInit = {}): number {
  return REQUEST_TIMEOUT_MS + Math.ceil((bodyBytes(init.body) / MIN_UPLOAD_BYTES_PER_SECOND) * 1000);
}

/** Network-only helpers that are safe to import from an Electron utility process. */
export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function serverFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs(init)) });
}
