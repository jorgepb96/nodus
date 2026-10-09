import { LIMITS } from '../../packages/capability-api/src/limits';
import { assertPublicHost } from '../../skill-capabilities/publicHost';
import { capabilityRegistry } from './registry';
import { resolveTrustedCapability } from './pluginStoreV2';
import { readCappedBody } from './cappedBody';

/** Tiles for a IIIF image, fetched by the host and never by the page.
 *
 *  Every other result kind is self-contained; this one cannot be, because a deep-zoom
 *  image is a service rather than a file. That makes it the only place where opening an
 *  old conversation can cause a network request, so the rule is narrow and enforced here
 *  rather than in the renderer:
 *
 *   - the tile must belong to a capability that is installed *now*, so a package that was
 *     removed cannot keep fetching through a view it left behind;
 *   - its origin must be one that capability's own manifest already declared, so a IIIF
 *     node cannot reach anywhere the package was not already permitted to reach;
 *   - the path must sit under the service base the view named, so a service URL cannot be
 *     used as a prefix for something else on the same host;
 *   - and the host must be public, so a view cannot probe the machine it is opened on.
 *
 *  The renderer receives bytes, never a URL it could load itself. */

const MAX_URL = 2_000;

export interface TileRequest {
  capabilityId: string;
  /** The `service` the view node declared: a IIIF Image API base URL. */
  service: string;
  /** The rest of the IIIF request, as the tile layer built it. */
  path: string;
}

export async function assertTileRequestAllowed(request: TileRequest): Promise<URL> {
  const provider = capabilityRegistry().providers.get(request.capabilityId);
  if (!provider || provider.source !== 'plugin') throw new Error('That capability is not installed.');
  const runtime = resolveTrustedCapability(request.capabilityId, provider.plugin && { version: provider.plugin.version, digest: provider.plugin.digest });
  if (!runtime) throw new Error('That capability is not installed.');

  let service: URL;
  try { service = new URL(request.service); } catch { throw new Error('Invalid tiled image service.'); }
  if (service.protocol !== 'https:' || service.username || service.password) throw new Error('A tiled image service must be https.');

  // The package must already have been allowed to talk to this origin for its own
  // requests. A view cannot widen what its package was granted.
  const permitted = (runtime.permissions.network ?? []).some(endpoint => {
    let origin: URL;
    try { origin = new URL(endpoint.origin); } catch { return false; }
    return origin.origin === service.origin && endpoint.methods.includes('GET')
      && endpoint.pathPrefixes.some(prefix => service.pathname.startsWith(prefix));
  });
  if (!permitted) throw new Error('This capability is not permitted to reach that image service.');

  if (typeof request.path !== 'string' || !request.path || request.path.length > MAX_URL) throw new Error('Invalid tile request.');
  // Built by joining, then checked by comparing: whatever the tile layer produced has to
  // land under the base the view declared, however it was spelled.
  const base = service.href.endsWith('/') ? service.href : `${service.href}/`;
  let target: URL;
  try { target = new URL(request.path.replace(/^\/+/, ''), base); } catch { throw new Error('Invalid tile request.'); }
  if (target.origin !== service.origin || !target.pathname.startsWith(new URL(base).pathname)) throw new Error('A tile must belong to its own image service.');
  if (target.username || target.password || target.hash) throw new Error('Invalid tile request.');

  // Awaited: this one resolves the name, and an unawaited rejection would leave the check
  // looking like it ran while the fetch went ahead regardless.
  await assertPublicHost(target.hostname);
  return target;
}

export async function fetchCapabilityTile(request: TileRequest, fetcher: typeof fetch = fetch): Promise<{ bytes: Buffer; mimeType: string }> {
  const target = await assertTileRequestAllowed(request);
  const response = await fetcher(target.href, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'image/jpeg,image/png,image/webp,application/json' },
  });
  if (!response.ok) throw new Error(`The image service answered ${response.status}.`);

  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/json'].includes(mimeType)) {
    throw new Error(`The image service returned ${mimeType || 'an unknown type'}.`);
  }
  // Read against the ceiling: the whole body used to be buffered first and measured after.
  const bytes = await readCappedBody(response, LIMITS.tileBytes, 'The tile is larger than allowed.');
  return { bytes, mimeType };
}
