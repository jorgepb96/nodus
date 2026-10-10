import type { CloudflareCapabilityDocument } from './cloudflare';
import { hasCloudflareSafetyFeatures, CLOUDFLARE_SAFETY_UPGRADE_MESSAGE } from './cloudflare';

async function cloudFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(60_000);
  return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout, redirect: 'error' });
}

export interface NodusCloudCredentials {
  origin: string;
  spaceId: string;
  deviceToken: string;
}

export class NodusCloudError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) { super(message); this.name = 'NodusCloudError'; }
}

function origin(value: string): string {
  const parsed = new URL(value); if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new Error('Nodus Cloud requires HTTPS.');
  return parsed.origin;
}

export class NodusCloudClient {
  readonly origin: string;
  constructor(readonly credentials: NodusCloudCredentials) { this.origin = origin(credentials.origin); }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${this.credentials.deviceToken}`); headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await cloudFetch(`${this.origin}${path}`, { ...init, headers });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { error?: string; error_description?: string; code?: string; title?: string; detail?: string };
      throw new NodusCloudError(response.status, problem.error || problem.code || 'request_failed', problem.error_description || problem.detail || problem.title || `HTTP ${response.status}`, problem);
    }
    return response.json() as Promise<T>;
  }

  static async capabilities(value: string): Promise<CloudflareCapabilityDocument> {
    const response = await cloudFetch(`${origin(value)}/api/v3/capabilities`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new NodusCloudError(response.status, 'capabilities_failed', `HTTP ${response.status}`);
    const result = await response.json() as CloudflareCapabilityDocument;
    if (result.service !== 'nodus-cloudflare' || result.protocolVersion < 3) throw new Error('This address is not a compatible Nodus Cloud deployment.');
    if (!hasCloudflareSafetyFeatures(result)) throw new NodusCloudError(426,'safety_upgrade_required',CLOUDFLARE_SAFETY_UPGRADE_MESSAGE);
    return result;
  }

  static async pair(value: string, code: string, deviceName: string, deviceKind = 'replica') {
    const base = origin(value);
    const response = await cloudFetch(`${base}/api/v3/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ code, deviceName, deviceKind }) });
    const result = await response.json().catch(() => ({})) as { deviceToken?: string; space?: { id: string; name: string; vault: unknown }; user?: { email: string; role: string }; server?: { name: string; language: string }; error?: string; error_description?: string; detail?: string };
    if (!response.ok || !result.deviceToken || !result.space) throw new NodusCloudError(response.status, result.error || 'pair_failed', result.error_description || result.detail || `HTTP ${response.status}`, result);
    return {
      deviceToken: result.deviceToken,
      space: result.space,
      user: result.user,
      server: result.server,
      credentials: { origin: base, spaceId: result.space.id, deviceToken: result.deviceToken } satisfies NodusCloudCredentials,
    };
  }

  static async signIn(value: string, email: string, password: string) {
    const base = origin(value);
    const response = await cloudFetch(`${base}/api/v3/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email, password }) });
    const result = await response.json().catch(() => ({})) as { ticket?: string; spaces?: unknown[]; serverName?: string; userEmail?: string; error?: string; error_description?: string; detail?: string };
    if (!response.ok || !result.ticket) throw new NodusCloudError(response.status, result.error || 'login_failed', result.error_description || result.detail || `HTTP ${response.status}`, result);
    return {
      origin: base,
      ticket: result.ticket,
      spaces: Array.isArray(result.spaces) ? result.spaces : [],
      serverName: result.serverName,
      userEmail: result.userEmail,
    };
  }

  static async selectSpace(value: string, ticket: string, spaceId: string, deviceName: string) {
    const base = origin(value);
    const response = await cloudFetch(`${base}/api/v3/auth/device`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ticket, spaceId, deviceName }) });
    const result = await response.json().catch(() => ({})) as { deviceToken?: string; role?: string; userEmail?: string; space?: { id: string; name: string; vault: unknown }; error?: string; error_description?: string; detail?: string };
    if (!response.ok || !result.deviceToken || !result.space) throw new NodusCloudError(response.status, result.error || 'space_failed', result.error_description || result.detail || `HTTP ${response.status}`, result);
    return {
      deviceToken: result.deviceToken,
      role: result.role,
      userEmail: result.userEmail,
      space: result.space,
      credentials: { origin: base, spaceId: result.space.id, deviceToken: result.deviceToken } satisfies NodusCloudCredentials,
    };
  }

  async me() { return this.request<{ user: unknown; spaces: unknown[]; server: unknown }>('/api/v3/me'); }

  async snapshot(etag?: string): Promise<{ unchanged: boolean; etag: string | null; revision: string | null; bytes: ArrayBuffer | null }> {
    const headers = new Headers({ authorization: `Bearer ${this.credentials.deviceToken}` }); if (etag) headers.set('if-none-match', etag);
    const response = await cloudFetch(`${this.origin}/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/snapshot`, { headers });
    if (response.status === 304) return { unchanged: true, etag: etag ?? null, revision: response.headers.get('x-nodus-revision'), bytes: null };
    if (!response.ok) { const problem = await response.json().catch(() => ({})) as { error?: string; error_description?: string; detail?: string; code?: string }; throw new NodusCloudError(response.status, problem.error || problem.code || 'snapshot_failed', problem.error_description || problem.detail || `HTTP ${response.status}`, problem); }
    return { unchanged: false, etag: response.headers.get('etag'), revision: response.headers.get('x-nodus-revision'), bytes: await response.arrayBuffer() };
  }

  async negotiateAssets(objects: Array<{ hash: string; bytes: number }>): Promise<string[]> {
    const result = await this.request<{ missing: string[] }>(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/assets/negotiate`, {
      method: 'POST', body: JSON.stringify({ objects: objects.map((entry) => ({ ...entry, purpose: 'asset' })) }),
    });
    return result.missing;
  }

  async uploadAsset(hash: string, mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', body: RequestInit['body']): Promise<void> {
    await this.request(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/assets/${encodeURIComponent(hash)}`, {
      method: 'PUT', headers: { 'content-type': mime }, body,
    });
  }

  async asset(hash: string, etag?: string): Promise<{ unchanged: boolean; etag: string | null; mime: string | null; bytes: ArrayBuffer | null }> {
    const headers = new Headers({ authorization: `Bearer ${this.credentials.deviceToken}` }); if (etag) headers.set('if-none-match', etag);
    const response = await cloudFetch(`${this.origin}/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/assets/${encodeURIComponent(hash)}`, { headers });
    if (response.status === 304) return { unchanged: true, etag: etag ?? null, mime: null, bytes: null };
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { error?: string; error_description?: string };
      throw new NodusCloudError(response.status, problem.error || 'asset_failed', problem.error_description || `HTTP ${response.status}`, problem);
    }
    return { unchanged: false, etag: response.headers.get('etag'), mime: response.headers.get('content-type'), bytes: await response.arrayBuffer() };
  }

  async getMutations(since = 0, limit = 32) { return this.request<{ mutations: unknown[]; cursor: number; hasMore: boolean }>(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/mutations?since=${since}&limit=${limit}`, { method: 'GET' }); }
  async postMutations(mutations: unknown[]) { return this.request<{ accepted: string[]; duplicate: string[]; rejected: unknown[]; cursor: number | null }>(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/mutations`, { method: 'POST', body: JSON.stringify({ mutations }) }); }
  async acknowledgeMutations(cursor: number) { return this.request(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/mutations/ack`, { method: 'POST', body: JSON.stringify({ cursor }) }); }
  async getNodiNotes(since = 0) { return this.request(`/api/v3/nodi/notes?since=${since}`, { method: 'GET' }); }
  async putNodiNotes(notes: unknown[]) { return this.request('/api/v3/nodi/notes', { method: 'POST', body: JSON.stringify({ notes }) }); }
  async semanticSearch(input: { kind: 'ideas' | 'documents' | 'passages'; query: string; vector: number[]; provider: string; model: string; dim: number; limit?: number; threshold?: number }) {
    return this.request(`/api/v3/spaces/${encodeURIComponent(this.credentials.spaceId)}/search/semantic`, { method: 'POST', body: JSON.stringify(input) });
  }
}
