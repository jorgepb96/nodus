export const API_PREFIX = '/api/v1';
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
// A row uses three D1 statements. Fifteen rows plus the
// authorization/metadata queries remain below the 50-query Free-plan ceiling.
export const TABLE_CHUNK_ROWS = 15;
export const TABLE_CHUNK_BYTES = 1024 * 1024;
export const OBJECT_PART_BYTES = 8 * 1024 * 1024;
export const MAX_MUTATION_BYTES = 256 * 1024;
// Authentication and validation consume a handful of D1 statements too. Keeping the
// mutation batch below the Free-plan 50-query invocation ceiling (including ownership
// lookups and writes for private child rows) makes the same contract
// reliable on both free and paid accounts.
export const MAX_MUTATION_BATCH = 3;
export const MAX_MUTATION_READ_BATCH = 32;

const encoder = new TextEncoder();

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function randomId(prefix = '') {
  return `${prefix}${crypto.randomUUID()}`;
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Bytes(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(value) {
  return [...await sha256Bytes(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64Url(value) {
  return bytesToBase64Url(await sha256Bytes(value));
}

export function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index % Math.max(1, a.length)] ?? 0) ^ (b[index % Math.max(1, b.length)] ?? 0);
  return mismatch === 0;
}

export function responseHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

export function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: responseHeaders(headers) });
}

export function problem(status, error, description = null, extra = {}) {
  return json({ error, ...(description ? { error_description: description } : {}), ...extra }, status);
}

export function html(value, status = 200, headers = {}) {
  return new Response(value, {
    status,
    headers: responseHeaders({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...headers,
    }),
  });
}

export function redirect(location, status = 303) {
  return new Response(null, { status, headers: responseHeaders({ location }) });
}

export async function readBody(request, maxBytes = MAX_JSON_BYTES) {
  const announced = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(announced) && announced > maxBytes) throw new HttpError(413, 'payload_too_large', `The request is larger than ${maxBytes} bytes.`);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpError(413, 'payload_too_large', `The request is larger than ${maxBytes} bytes.`);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const bytes = await readBody(request, maxBytes);
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
}

export async function readForm(request, maxBytes = 128 * 1024) {
  const bytes = await readBody(request, maxBytes);
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function errorResponse(error) {
  if (error instanceof HttpError) return problem(error.status, error.code, error.message, error.extra);
  return problem(500, 'internal_error', 'Nodus Cloud could not complete this request.');
}

export function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1]?.trim() || null;
}

export function bootstrapToken(request) {
  const match = /^Bootstrap\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1]?.trim() || null;
}

export function cookies(request) {
  const parsed = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    parsed[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return parsed;
}

export async function first(db, sql, ...bindings) {
  return db.prepare(sql).bind(...bindings).first();
}

export async function all(db, sql, ...bindings) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result?.results ?? [];
}

export async function run(db, sql, ...bindings) {
  return db.prepare(sql).bind(...bindings).run();
}

export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function clampInteger(value, minimum, maximum, fallback = minimum) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

export function etagMatches(request, etag) {
  return request.headers.get('if-none-match') === etag;
}

export function scalarRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, cell] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) return null;
    if (cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') out[key] = cell;
    else return null;
  }
  return out;
}

export function searchProjection(row) {
  const strings = Object.values(row).filter((value) => typeof value === 'string');
  const title = String(row.title ?? row.label ?? row.display_name ?? row.name ?? '').slice(0, 1000);
  return { title, body: strings.join('\n').slice(0, 100_000) };
}

export function mimeFromBytes(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder('latin1').decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder('latin1').decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 6)))) return 'image/gif';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'application/zip';
  return 'application/octet-stream';
}

export function assertObjectHash(hash) {
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new HttpError(400, 'bad_hash', 'Object hashes must be lowercase SHA-256 values.');
  return String(hash);
}

export function clientAddress(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

export async function strictRateLimit(env, bucket, subject, limit, windowMs, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const statement = env.DB.prepare(`
    INSERT INTO rate_limits (bucket, subject, window_start, count) VALUES (?1, ?2, ?3, 1)
    ON CONFLICT(bucket, subject, window_start) DO UPDATE SET count = count + 1
    RETURNING count
  `).bind(bucket, subject, windowStart);
  const row = await statement.first();
  return Number(row?.count || 0) <= limit;
}
