import { app } from 'electron';
import { safeStorage } from '../secrets/safeStorageGate';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPublicHost } from '../../skill-capabilities/publicHost';
import { validateModelAsset } from '../../packages/capability-api/src/models';
import { validateMediaAsset } from '../../packages/capability-api/src/media';
import type { TrustedNetworkPermission, TrustedPermissionSetV2 } from '../../packages/capability-api/src/permissions';
import type { CapabilityHostServices, TrustedWorkerRuntime } from './workerHost';
import { validateVisionReviewResult } from '../../packages/capability-api/src/vision';
import type { VisionSession } from './vision/service';
import { createMapService, type MapService } from './maps/service';

/** The host side of every channel a trusted worker can call.
 *
 *  Nothing here is implicitly allowed: each method starts by finding the permission the
 *  capability declared, and refuses when there is none. The worker is first-party code,
 *  so this is not a containment boundary — it is the place where a package's declared
 *  reach and its actual reach are kept the same, and where the user's secrets stay out
 *  of the process that would otherwise have to hold them. */

export interface CapabilityServiceAdapters {
  vision?: VisionSession;
  beforePaidCall?: () => void;
  /** One completion against the conversation's own model. */
  model?: (runtime: TrustedWorkerRuntime, request: { system?: string; prompt: string; maxTokens?: number }, signal: AbortSignal) => Promise<string>;
  svg?: {
    validate: (svg: string) => Promise<{ ok: boolean; errors: string[] }>;
    inspect: (svg: string) => Promise<{ width?: number; height?: number; elements: number }>;
    refine: (request: { svg: string; instruction: string }, signal: AbortSignal) => Promise<string>;
  };
  python?: {
    ensureRuntime: (runtime: TrustedWorkerRuntime, runtimeId: string, signal: AbortSignal) => Promise<{ ready: boolean; detail?: string }>;
    run: (runtime: TrustedWorkerRuntime, request: { runtimeId: string; args: string[]; stdin?: string; secret?: string; timeoutMs: number }, signal: AbortSignal) => Promise<{ code: number; stdout: string; stderr: string }>;
  };
  subworker?: (runtime: TrustedWorkerRuntime, request: { entry: string; input: unknown; timeoutMs: number }, signal: AbortSignal) => Promise<unknown>;
  /** Bound by the caller to the conversation the invocation belongs to. */
  attachments?: (runtime: TrustedWorkerRuntime, request: { bytes: Buffer; name: string; mimeType: string }) => Promise<{ attachmentId: string; bytes: number }>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const pluginsRoot = () => path.join(app.getPath('userData'), 'plugins');
const namespaced = (root: string, runtime: TrustedWorkerRuntime) => {
  const capability = runtime.manifest.id;
  if (!SLUG.test(runtime.plugin.id) || !SLUG.test(capability)) throw new Error('Invalid capability storage namespace.');
  return path.join(root, runtime.plugin.id, capability);
};

/** Code, durable data, rebuildable caches, runtimes and secrets are separate trees, so a
 *  reinstall, a cache wipe and an uninstall can each touch exactly what they mean to. */
export const capabilityDataDir = (runtime: TrustedWorkerRuntime) => namespaced(path.join(pluginsRoot(), 'data'), runtime);
export const capabilityCacheDir = (runtime: TrustedWorkerRuntime) => namespaced(path.join(pluginsRoot(), 'cache'), runtime);
export const capabilityTempDir = (runtime: TrustedWorkerRuntime) => path.join(capabilityCacheDir(runtime), 'temp');
const secretsFile = (pluginId: string) => {
  if (!SLUG.test(pluginId)) throw new Error('Invalid plugin id.');
  return path.join(pluginsRoot(), 'secrets', `${pluginId}.bin`);
};

/** One file per key rather than one document holding every key.
 *
 *  A capability's cache can be hundreds of megabytes — a country legislation index, a
 *  compiled dependency tree — and rewriting the whole store to set one entry would be
 *  both slow and a way to lose everything to one interrupted write. The quota is applied
 *  across the lane's directory, so the limit still means what it says. */

const keyFile = (dir: string, key: string) => path.join(dir, `${key}.json`);

function laneBytes(dir: string, except?: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      if (!entry.isFile() || entry.name === except) return total;
      try { return total + fs.statSync(path.join(dir, entry.name)).size; } catch { return total; }
    }, 0);
  } catch { return 0; }
}

function storageLane(runtime: TrustedWorkerRuntime, lane: 'state' | 'cache'): { dir: string; quota: number } {
  const permission = runtime.permissions.storage;
  if (!permission) throw new Error('Capability storage is not permitted.');
  const quota = lane === 'state' ? permission.stateBytes : permission.cacheBytes;
  if (quota <= 0) throw new Error(`Capability ${lane} storage is not permitted.`);
  const base = lane === 'state' ? capabilityDataDir(runtime) : capabilityCacheDir(runtime);
  return { dir: path.join(base, lane), quota };
}

function readKey(dir: string, key: string): unknown {
  try { return JSON.parse(fs.readFileSync(keyFile(dir, key), 'utf8')); } catch { return null; }
}

function writeKey(dir: string, key: string, value: unknown, quota: number): void {
  const encoded = JSON.stringify(value ?? null);
  const file = keyFile(dir, key);
  if (laneBytes(dir, `${key}.json`) + Buffer.byteLength(encoded) > quota) throw new Error('Capability storage quota exceeded.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, encoded, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function readCapabilitySecret(pluginId: string, capabilityId: string, secretId: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try { return (JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile(pluginId)))) as Record<string, string>)[`${capabilityId}:${secretId}`]; }
  catch { return undefined; }
}

export function writeCapabilitySecret(pluginId: string, capabilityId: string, secretId: string, value: string | null): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The secure credential store is unavailable.');
  const file = secretsFile(pluginId);
  let secrets: Record<string, string> = {};
  try { secrets = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as Record<string, string>; } catch { secrets = {}; }
  const key = `${capabilityId}:${secretId}`;
  if (value && value.trim()) secrets[key] = value.trim(); else delete secrets[key];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function declaredEndpoint(permissions: TrustedPermissionSetV2, endpointId: unknown): TrustedNetworkPermission {
  const endpoint = permissions.network?.find(candidate => candidate.id === endpointId);
  if (!endpoint) throw new Error('Capability endpoint is not permitted.');
  return endpoint;
}

/** Builds the request the permission actually allows, or refuses. The secret, if any,
 *  is added here and never travels to the worker. */
async function authorizedRequest(runtime: TrustedWorkerRuntime, payload: unknown): Promise<{ url: URL; method: string; headers: Record<string, string>; body?: string; endpoint: TrustedNetworkPermission }> {
  const value = (payload ?? {}) as { endpointId?: unknown; path?: unknown; method?: unknown; headers?: unknown; body?: unknown };
  const endpoint = declaredEndpoint(runtime.permissions, value.endpointId);
  const relative = typeof value.path === 'string' ? value.path : '/';
  const method = String(value.method ?? 'GET').toUpperCase();
  if (!relative.startsWith('/') || relative.startsWith('//') || /[\\#]/.test(relative) || [...relative].some(char => char.charCodeAt(0) <= 32)) throw new Error('Invalid capability network path.');
  const url = new URL(relative, endpoint.origin);
  if (url.origin !== new URL(endpoint.origin).origin || /%(?:25|2f|5c)/i.test(url.pathname)) throw new Error('Capability network origin or path changed.');
  const pathname = decodeURIComponent(url.pathname);
  const allowedPath = endpoint.pathPrefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  if (!allowedPath) throw new Error('Capability network request exceeds its permission.');
  if (!(endpoint.methods as readonly string[]).includes(method)) throw new Error('Capability network method is not permitted.');
  await assertPublicHost(url.hostname);

  const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' };
  // A worker may set ordinary headers, but never one the host reserves for a secret:
  // otherwise a package could overwrite the credential the user actually configured.
  const reserved = new Set((runtime.permissions.secrets ?? [])
    .filter(secret => secret.injection.kind === 'header' && secret.injection.endpointId === endpoint.id)
    .map(secret => secret.injection.kind === 'header' ? secret.injection.header.toLowerCase() : ''));
  for (const [name, headerValue] of Object.entries((value.headers ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(name) || typeof headerValue !== 'string' || headerValue.length > 2_000) throw new Error('Invalid capability request header.');
    if (reserved.has(name.toLowerCase()) || ['authorization', 'cookie', 'host'].includes(name.toLowerCase())) throw new Error(`Capability may not set the ${name} header.`);
    headers[name] = headerValue;
  }
  for (const secret of runtime.permissions.secrets ?? []) {
    if (secret.injection.kind !== 'header' || secret.injection.endpointId !== endpoint.id) continue;
    const stored = readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, secret.id);
    if (!stored) { if (secret.required) throw new Error(`Configure ${secret.label} before using this capability.`); continue; }
    headers[secret.injection.header] = `${secret.injection.prefix ?? ''}${stored}`;
  }

  let body: string | undefined;
  if (value.body !== undefined) {
    body = typeof value.body === 'string' ? value.body : JSON.stringify(value.body);
    if (Buffer.byteLength(body) > 1_000_000) throw new Error('Capability request body is too large.');
    headers['Content-Type'] ??= 'application/json';
  }
  return { url, method, headers, body, endpoint };
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new Error('Capability response is too large.'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('Capability response is too large.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

export function createCapabilityHostServices(adapters: CapabilityServiceAdapters = {}): CapabilityHostServices {
  const mapServices = new Map<string, MapService>();
  return async ({ runtime, channel, method, payload, signal }) => {
    signal.throwIfAborted();
    const value = (payload ?? {}) as Record<string, unknown>;
    if (channel === 'vision') {
      if (!runtime.permissions.vision) throw new Error('Capability vision access is not permitted.');
      if (!adapters.vision) throw new Error('Vision review requires an active conversation.');
      const scope = `${runtime.plugin.id}:${runtime.capabilityId}:${runtime.plugin.digest}`;
      if (method === 'prepareImages') return adapters.vision.prepareImages(payload, runtime.permissions, scope, signal);
      if (method === 'reviewImages') return validateVisionReviewResult(await adapters.vision.reviewImages(payload, scope, runtime.permissions.vision.maxRounds, signal));
      throw new Error('Unknown capability vision operation.');
    }
    if (channel === 'maps') {
      if (!runtime.permissions.maps) throw new Error('Capability maps access is not permitted.');
      if (method !== 'render' && method !== 'retrieve') throw new Error('Unknown capability maps operation.');
      const key = `${runtime.plugin.id}:${runtime.capabilityId}:${runtime.plugin.digest}`;
      let service = mapServices.get(key);
      if (!service) { service = createMapService(runtime.permissions.maps); mapServices.set(key, service); }
      return service[method](payload, signal);
    }
    const key = () => {
      const name = value.key;
      if (typeof name !== 'string' || !KEY.test(name)) throw new Error('Invalid capability storage key.');
      return name;
    };

    if (channel === 'storage') {
      if (method === 'temp.dir') {
        if (!(runtime.permissions.storage?.tempBytes ?? 0)) throw new Error('Capability temporary storage is not permitted.');
        const dir = capabilityTempDir(runtime);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        return dir;
      }
      if (method === 'temp.clear') { fs.rmSync(capabilityTempDir(runtime), { recursive: true, force: true }); return null; }
      const [lane, operation] = method.split('.');
      if (lane !== 'state' && lane !== 'cache') throw new Error('Unknown capability storage lane.');
      const { dir, quota } = storageLane(runtime, lane);
      if (operation === 'get') return readKey(dir, key());
      if (operation === 'keys') {
        try { return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)); }
        catch { return []; }
      }
      if (operation === 'set') { writeKey(dir, key(), value.value, quota); return null; }
      if (operation === 'delete') { fs.rmSync(keyFile(dir, key()), { force: true }); return null; }
      throw new Error('Unknown capability storage operation.');
    }

    if (channel === 'secrets') {
      const id = String(value.id ?? '');
      const declared = runtime.permissions.secrets?.find(secret => secret.id === id);
      if (!declared) throw new Error('Capability secret is not declared.');
      if (method === 'has') return Boolean(readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id));
      if (method === 'store') {
        const secret = value.value;
        if (typeof secret !== 'string' || !secret.trim() || secret.length > 8_000) throw new Error('Invalid capability secret.');
        writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, secret);
        return null;
      }
      if (method === 'delete') { writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, null); return null; }
      throw new Error('Unknown capability secret operation.');
    }

    if (channel === 'network') {
      const { url, method: verb, headers, body, endpoint } = await authorizedRequest(runtime, payload);
      adapters.beforePaidCall?.();
      const timeout = AbortSignal.timeout(endpoint.timeoutMs);
      const response = await fetch(url, { method: verb, headers, body, redirect: 'error', signal: AbortSignal.any([signal, timeout]) });
      if (method === 'downloadToTemp') {
        if (!(runtime.permissions.storage?.tempBytes ?? 0)) throw new Error('Capability temporary storage is not permitted.');
        const bytes = await readBounded(response, Math.min(endpoint.maxResponseBytes, runtime.permissions.storage!.tempBytes));
        const dir = capabilityTempDir(runtime);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `${randomUUID()}.bin`);
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        return { status: response.status, path: file, bytes: bytes.length };
      }
      if (method !== 'fetch') throw new Error('Unknown capability network operation.');
      const bytes = await readBounded(response, endpoint.maxResponseBytes);
      return { status: response.status, headers: Object.fromEntries(response.headers), body: bytes };
    }

    if (channel === 'model') {
      if (!runtime.permissions.model) throw new Error('Capability model access is not permitted.');
      if (method !== 'complete') throw new Error('Unknown capability model operation.');
      if (!adapters.model) throw new Error('Model access is unavailable in this context.');
      const prompt = value.prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Invalid capability model request.');
      adapters.beforePaidCall?.();
      return adapters.model(runtime, { system: typeof value.system === 'string' ? value.system : undefined, prompt, maxTokens: typeof value.maxTokens === 'number' ? value.maxTokens : undefined }, signal);
    }

    if (channel === 'svg') {
      if (!runtime.permissions.svg) throw new Error('Capability SVG access is not permitted.');
      if (!adapters.svg) throw new Error('SVG services are unavailable in this context.');
      const svg = typeof value.svg === 'string' ? value.svg : '';
      if (method === 'validate') return adapters.svg.validate(svg);
      if (method === 'inspect') return adapters.svg.inspect(svg);
      if (method === 'refine') { adapters.beforePaidCall?.(); return adapters.svg.refine({ svg, instruction: String(value.instruction ?? '') }, signal); }
      throw new Error('Unknown capability SVG operation.');
    }

    if (channel === 'subworker') {
      if (!runtime.permissions.subworkers) throw new Error('Capability subworkers are not permitted.');
      if (method !== 'run') throw new Error('Unknown capability subworker operation.');
      if (!adapters.subworker) throw new Error('Subworkers are unavailable in this context.');
      const entry = value.entry;
      if (typeof entry !== 'string' || entry.includes('..') || path.isAbsolute(entry)) throw new Error('Invalid capability subworker entry.');
      return adapters.subworker(runtime, { entry, input: value.input, timeoutMs: Number(value.timeoutMs ?? 30_000) }, signal);
    }

    if (channel === 'python') {
      const runtimeId = String(value.runtimeId ?? '');
      const declared = runtime.permissions.runtimes?.find(entry => entry.id === runtimeId && entry.kind === 'python');
      if (!declared) throw new Error('Capability Python runtime is not declared.');
      if (!adapters.python) throw new Error('Python runtimes are unavailable in this context.');
      if (method === 'ensureRuntime') return adapters.python.ensureRuntime(runtime, runtimeId, signal);
      if (method !== 'run') throw new Error('Unknown capability Python operation.');
      const args = Array.isArray(value.args) ? value.args.map(String) : [];
      // The key is read here and handed straight to the interpreter's stdin: it never
      // passes through the worker, the renderer, a log line or a command line.
      const secretId = typeof value.secretId === 'string' ? value.secretId : undefined;
      const secret = secretId && runtime.permissions.secrets?.some(entry => entry.id === secretId && entry.injection.kind === 'process-stdin' && entry.injection.runtimeId === runtimeId)
        ? readCapabilitySecret(runtime.plugin.id, runtime.manifest.id, secretId)
        : undefined;
      if (secretId && !secret) throw new Error('That capability credential is not configured.');
      return adapters.python.run(runtime, { runtimeId, args, stdin: typeof value.stdin === 'string' ? value.stdin : undefined, secret, timeoutMs: Number(value.timeoutMs ?? 120_000) }, signal);
    }

    // `nodus:3d`. The core owns the format check and the storage; the capability owns
    // nothing but the bytes it produced. A model that would not open on a user's machine
    // is refused here, where the capability can still say something useful about it.
    if (channel === 'models') {
      if (!runtime.permissions.models) throw new Error('Capability 3D access is not permitted.');
      const bytes = value.bytes instanceof Uint8Array ? Buffer.from(value.bytes) : Buffer.from(String(value.bytes ?? ''), 'base64');
      const mimeType = String(value.mimeType ?? '');
      const info = validateModelAsset(bytes, mimeType);
      if (method === 'validate') return info;
      if (method !== 'store') throw new Error('Unknown capability 3D operation.');
      if (!adapters.attachments) throw new Error('Attachments are unavailable in this context.');
      const name = String(value.name ?? '');
      if (!/^[\w][\w .()-]{0,120}$/.test(name) || name.includes('..')) throw new Error('Invalid 3D model name.');
      const stored = await adapters.attachments(runtime, { bytes, name, mimeType });
      return { ...stored, info };
    }

    // Raster and sound. The declared type is a claim; the bytes decide.
    if (channel === 'media') {
      if (!runtime.permissions.media) throw new Error('Capability media access is not permitted.');
      const bytes = value.bytes instanceof Uint8Array ? Buffer.from(value.bytes) : Buffer.from(String(value.bytes ?? ''), 'base64');
      const mimeType = String(value.mimeType ?? '');
      const info = validateMediaAsset(bytes, mimeType);
      if (method === 'validate') return info;
      if (method !== 'store') throw new Error('Unknown capability media operation.');
      if (!adapters.attachments) throw new Error('Attachments are unavailable in this context.');
      const name = String(value.name ?? '');
      if (!/^[\w][\w .()-]{0,120}$/.test(name) || name.includes('..')) throw new Error('Invalid media file name.');
      const stored = await adapters.attachments(runtime, { bytes, name, mimeType });
      return { ...stored, info };
    }

    if (channel === 'attachments') {
      if (method !== 'store') throw new Error('Unknown capability attachment operation.');
      if (!adapters.attachments) throw new Error('Attachments are unavailable in this context.');
      const bytes = value.bytes;
      const buffer = bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(String(bytes ?? ''), 'base64');
      if (!buffer.length || buffer.length > 64 * 1024 * 1024) throw new Error('Invalid capability attachment.');
      return adapters.attachments(runtime, { bytes: buffer, name: String(value.name ?? ''), mimeType: String(value.mimeType ?? '') });
    }

    throw new Error('Unknown capability host channel.');
  };
}
