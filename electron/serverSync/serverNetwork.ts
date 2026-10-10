import { hasCloudflareSafetyFeatures, CLOUDFLARE_SAFETY_UPGRADE_MESSAGE } from '../../shared/cloudflare';

const REQUEST_TIMEOUT_MS = 60_000;

export class ServerHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ServerHttpError'; }
}

export function assertCloudflareSafetyCapabilities(value: unknown): void {
  if (!hasCloudflareSafetyFeatures(value)) throw new ServerHttpError(426, CLOUDFLARE_SAFETY_UPGRADE_MESSAGE);
}
const safetyCheckedAt = new Map<string, number>();
/** An older deployment must pause before any sync writes, even after upgrading Desktop. */
export async function requireCloudflareSafety(base: string): Promise<void> {
  const url=normalizeServerUrl(base);
  const checked=safetyCheckedAt.get(url);const elapsed=checked===undefined ? Infinity : Date.now()-checked;
  if (elapsed>=0 && elapsed<60_000) return;
  const response=await serverFetchWithTimeout(`${url}/api/v3/capabilities`,{headers:{accept:'application/json'},redirect:'error'});
  if (!response.ok) throw new ServerHttpError(response.status,`No se pudieron verificar las protecciones de Cloudflare (HTTP ${response.status}).`);
  assertCloudflareSafetyCapabilities(await response.json());
  safetyCheckedAt.set(url,Date.now());
}

/** Network-only helpers that are safe to import from an Electron utility process. */
export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function serverFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}
