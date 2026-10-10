import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import type { VaultSummary } from '@shared/types';
import type { CloudflareCapabilityDocument, CloudflarePublicationManifest, CloudflarePublicationSession } from '@shared/cloudflare';
import { identityColumnsInDatabase } from '../db/rowIdentityCore';
import { buildServerSnapshot, type SnapshotAsset, type SnapshotAssetRef } from './serverSnapshot';
import type { BuiltServerLibraryPublication, ServerLibraryPackage } from './serverLibrary';
import { buildVectorSet, buildVectorizeChunks, describeVectorSet, type VectorKind } from './serverVectors';
import type { VaultServerConfig } from './serverSyncShared';
import { normalizeServerUrl, serverFetchWithTimeout, ServerHttpError, assertCloudflareSafetyCapabilities } from './serverNetwork';
import { cloudflareTableChunks, CLOUDFLARE_MAX_PUBLICATION_REQUESTS, validateCloudflarePartBytes } from './cloudflarePublicationProtocol';

const gzipAsync = promisify(gzip);
const DIRECT_OBJECT_BYTES = 8 * 1024 * 1024;
const EXACT_VECTOR_SEARCH_BYTES = 32 * 1024 * 1024;
const INLINE_D1_ROW_BYTES = 512 * 1024;
const DIRECT_R2_ROW_BYTES = 8 * 1024 * 1024;
const publicationBudget = new AsyncLocalStorage<{ remaining: number }>();

async function publicationFetch(url: string, init: RequestInit): Promise<Response> {
  const budget = publicationBudget.getStore();
  if (!budget || budget.remaining-- <= 0) throw new Error('La publicación alcanzó el límite de seguridad de llamadas a Cloudflare.');
  return serverFetchWithTimeout(url, { ...init, redirect: 'error' });
}

interface SnapshotPayload {
  vault: { id: string; name: string; type: string };
  capabilities: Record<string, boolean>;
  tables: Record<string, Record<string, unknown>[]>;
  assets: SnapshotAssetRef[];
}

function hash(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }

async function jsonRequest<T>(url: string, token: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`); headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await publicationFetch(url, { ...init, headers });
  const result = await response.json().catch(() => ({})) as T & { error?: string; detail?: string; title?: string };
  if (!response.ok) throw new ServerHttpError(response.status, result.detail || result.error || result.title || `Nodus Cloud respondió con HTTP ${response.status}.`);
  return result;
}

async function putObject(base: string, spaceId: string, publicationId: string, token: string, purpose: string, objectHash: string, mime: string, data: Buffer): Promise<void> {
  const directLimit = purpose === 'row' ? DIRECT_R2_ROW_BYTES : DIRECT_OBJECT_BYTES;
  if (data.length <= directLimit) {
    const response = await publicationFetch(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/objects/${purpose}/${objectHash}?publicationId=${encodeURIComponent(publicationId)}`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': mime, 'content-length': String(data.length) }, body: data,
    });
    if (!response.ok) { const value = await response.json().catch(() => ({})) as { detail?: string; error_description?: string }; throw new ServerHttpError(response.status, value.detail || value.error_description || `Nodus Cloud rechazó un archivo (HTTP ${response.status}).`); }
    return;
  }
  const started = await jsonRequest<{ id: string; partBytes: number }>(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications/${publicationId}/uploads`, token, {
    method: 'POST', body: JSON.stringify({ purpose, hash: objectHash, bytes: data.length, mime }),
  });
  const parts: Array<{ partNumber: number; etag: string }> = [];
  try {
    const partBytes = validateCloudflarePartBytes(started.partBytes);
    for (let offset = 0, partNumber = 1; offset < data.length; offset += partBytes, partNumber += 1) {
      const chunk = data.subarray(offset, Math.min(data.length, offset + partBytes));
      const result = await jsonRequest<{ etag: string }>(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/uploads/${started.id}/parts/${partNumber}`, token, {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-nodus-part-sha256': hash(chunk) }, body: chunk,
      });
      parts.push({ partNumber, etag: result.etag });
    }
    await jsonRequest(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/uploads/${started.id}/complete`, token, { method: 'POST', body: JSON.stringify({ parts }) });
  } catch (error) {
    await jsonRequest(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/uploads/${started.id}/abort`, token, { method: 'POST' }).catch(() => undefined);
    throw error;
  }
}

async function missingObjects(base: string, spaceId: string, token: string, objects: Array<{ hash: string; bytes: number; purpose: string }>): Promise<Set<string>> {
  const missing = new Set<string>();
  for (let index = 0; index < objects.length; index += 2_000) {
    const result = await jsonRequest<{ missing: string[] }>(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/objects/negotiate`, token, { method: 'POST', body: JSON.stringify({ objects: objects.slice(index, index + 2_000) }) });
    for (const objectHash of result.missing || []) missing.add(objectHash);
  }
  return missing;
}

interface R2RowObject { hash: string; bytes: number; table: string; key: string; data: Buffer }

function stableRows(db: Database.Database, payload: SnapshotPayload): {
  tables: Record<string, Array<{ key: string; row: Record<string, unknown> }>>;
  rowObjects: R2RowObject[];
} {
  const tables: Record<string, Array<{ key: string; row: Record<string, unknown> }>> = {};
  const rowObjects: R2RowObject[] = [];
  for (const [table, rows] of Object.entries(payload.tables)) {
    const identity = identityColumnsInDatabase(db, table);
    if (!identity.length) throw new Error(`La tabla ${table} no tiene una identidad estable y no puede publicarse de forma segura.`);
    tables[table] = rows.map((row) => {
      const key = JSON.stringify(identity.map((column) => row[column] ?? null));
      const data = Buffer.from(JSON.stringify(row));
      if (data.length <= INLINE_D1_ROW_BYTES) return { key, row };
      const objectHash = hash(data);
      const strings = Object.values(row).filter((value): value is string => typeof value === 'string');
      const title = String(row.title ?? row.label ?? row.display_name ?? row.name ?? '').slice(0, 1_000);
      rowObjects.push({ hash: objectHash, bytes: data.length, table, key, data });
      return { key, row: { __nodus_r2_row: objectHash, __nodus_search_title: title, __nodus_search_body: strings.join('\n').slice(0, 100_000) } };
    });
  }
  return { tables, rowObjects };
}

async function uploadRowObjects(base: string, spaceId: string, publicationId: string, token: string, rows: R2RowObject[]): Promise<number> {
  const byHash = new Map(rows.map((row) => [row.hash, row]));
  const missing = await missingObjects(base, spaceId, token, rows.map((row) => ({ hash: row.hash, bytes: row.bytes, purpose: 'row' })));
  for (const objectHash of missing) {
    const row = byHash.get(objectHash);
    if (row) await putObject(base, spaceId, publicationId, token, 'row', objectHash, 'application/json', row.data);
  }
  return missing.size;
}

async function uploadAssets(base: string, spaceId: string, publicationId: string, token: string, assets: SnapshotAsset[]): Promise<number> {
  const values = new Map<string, { data: Buffer; mime: string }>();
  for (const asset of assets) {
    values.set(asset.hash, { data: asset.data, mime: asset.mime });
    if (asset.thumbHash && asset.thumbData) values.set(asset.thumbHash, { data: asset.thumbData, mime: asset.thumbMime || asset.mime });
  }
  const missing = await missingObjects(base, spaceId, token, [...values].map(([objectHash, value]) => ({ hash: objectHash, bytes: value.data.length, purpose: 'asset' })));
  for (const objectHash of missing) {
    const value = values.get(objectHash); if (value) await putObject(base, spaceId, publicationId, token, 'asset', objectHash, value.mime, value.data);
  }
  return missing.size;
}

async function uploadLibrary(base: string, spaceId: string, publicationId: string, token: string, packages: ServerLibraryPackage[]): Promise<number> {
  const byHash = new Map(packages.map((entry) => [entry.hash, entry]));
  const missing = await missingObjects(base, spaceId, token, packages.map((entry) => ({ hash: entry.hash, bytes: entry.data.length, purpose: 'library' })));
  for (const objectHash of missing) { const entry = byHash.get(objectHash); if (entry) await putObject(base, spaceId, publicationId, token, 'library', objectHash, 'application/zip', entry.data); }
  return missing.size;
}

async function vectorizeDimensions(base: string): Promise<Set<number>> {
  const response = await publicationFetch(`${base}/api/v3/capabilities`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new ServerHttpError(response.status, `Nodus Cloud respondió con HTTP ${response.status}.`);
  const value = await response.json().catch(() => ({})) as Partial<CloudflareCapabilityDocument>;
  assertCloudflareSafetyCapabilities(value);
  return new Set((value.storage?.vectorizeDimensions || []).filter((dimension) => Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 1536));
}

async function uploadVectors(base: string, spaceId: string, publicationId: string, token: string, db: Database.Database, kinds: VectorKind[], availableVectorizeDimensions: Set<number>): Promise<void> {
  for (const kind of kinds) {
    const summary = describeVectorSet(db, kind); if (!summary) continue;
    if (availableVectorizeDimensions.has(summary.dim)) {
      for (const chunk of buildVectorizeChunks(db, kind, 40)) {
        const body = JSON.stringify(chunk);
        await jsonRequest(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications/${publicationId}/vectors/${kind}/vectorize`, token, {
          method: 'PUT', body: JSON.stringify({ ...chunk, chunkId: hash(body) }),
        });
      }
    } else {
      const exact = buildVectorSet(db, kind);
      if (!exact || exact.buffer.length > EXACT_VECTOR_SEARCH_BYTES) throw new Error(`El índice ${kind} (${exact ? exact.buffer.length : 0} bytes) supera el límite seguro de búsqueda exacta. Añade en Cloudflare un índice Vectorize de ${summary.dim} dimensiones o desactiva esta proyección.`);
      const response = await publicationFetch(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications/${publicationId}/vectors/${kind}/exact`, {
        method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.nodus.vectors' }, body: exact.buffer,
      });
      if (!response.ok) throw new ServerHttpError(response.status, `Nodus Cloud rechazó el índice ${kind} (HTTP ${response.status}).`);
    }
  }
}

export interface CloudflarePublishResult { revision: string; updatedAt: string; bytes: number; assetsSent: number; libraryPackagesSent: number; }

export async function publishVaultToCloudflare(
  config: VaultServerConfig,
  token: string,
  vault: VaultSummary,
  db: Database.Database,
  preparedLibrary: BuiltServerLibraryPublication | null,
): Promise<CloudflarePublishResult> {
  return publicationBudget.run({ remaining: CLOUDFLARE_MAX_PUBLICATION_REQUESTS },
    () => publishVault(config, token, vault, db, preparedLibrary));
}

async function publishVault(config: VaultServerConfig, token: string, vault: VaultSummary,
  db: Database.Database, preparedLibrary: BuiltServerLibraryPublication | null): Promise<CloudflarePublishResult> {
  const base = normalizeServerUrl(config.url); const spaceId = config.spaceId;
  const availableVectorizeDimensions = await vectorizeDimensions(base);
  const library = preparedLibrary;
  const snapshot = buildServerSnapshot(vault, {
    nodusServerIncludeUserContent: config.includeUserContent,
    nodusServerIncludePassages: config.includePassages,
    nodusServerIncludePrimarySources: config.includePrimarySources,
    nodusServerIncludeTestimonies: config.includeTestimonies,
  }, db, library?.manifest || null);
  const payload = JSON.parse(snapshot.buffer.toString('utf8')) as SnapshotPayload;
  const preparedRows = stableRows(db, payload);
  const compressed = await gzipAsync(snapshot.buffer, { level: 1 });
  const snapshotHash = hash(compressed);
  const vectorKinds: VectorKind[] = config.includeVectors
    ? (config.includePassages ? ['ideas', 'documents', 'passages'] : ['ideas', 'documents'])
    : [];
  const vectors = vectorKinds.flatMap((kind) => {
    const summary = describeVectorSet(db, kind); if (!summary) return [];
    const exact = availableVectorizeDimensions.has(summary.dim) ? null : buildVectorSet(db, kind);
    if (!availableVectorizeDimensions.has(summary.dim) && !exact) return [];
    if (exact && exact.buffer.length > EXACT_VECTOR_SEARCH_BYTES) throw new Error(`El índice ${kind} supera el límite seguro de búsqueda exacta de Cloudflare.`);
    let count = exact?.summary.count || 0;
    if (!exact) for (const chunk of buildVectorizeChunks(db, kind)) count += chunk.vectors.length;
    if (!count) return [];
    const effective = exact?.summary || { ...summary, count };
    return [{ kind, provider: effective.provider, model: effective.model, dimensions: effective.dim, count,
      sha256: exact ? hash(exact.buffer) : hash(`${kind}:${snapshot.revision}:${effective.provider}:${effective.model}:${effective.dim}:${count}`),
      bytes: exact?.buffer.length || count * effective.dim * 4, mode: availableVectorizeDimensions.has(effective.dim) ? 'vectorize' as const : 'r2-exact' as const }];
  });
  const manifest: CloudflarePublicationManifest = {
    protocolVersion: 3, revision: snapshot.revision, schemaVersion: snapshot.schemaVersion,
    vault: payload.vault, capabilities: payload.capabilities, counts: snapshot.counts,
    assets: payload.assets,
    rowObjects: preparedRows.rowObjects.map(({ hash: objectHash, bytes, table, key }) => ({ hash: objectHash, bytes, table, key })),
    library: library ? { ...library.manifest, packages: library.packages.map((entry) => ({ hash: entry.hash, bytes: entry.bytes, documentId: entry.documentId })) } : null,
    snapshot: { bytes: compressed.length, sha256: snapshotHash, contentEncoding: 'gzip' }, vectors,
  };
  const publication = await jsonRequest<CloudflarePublicationSession>(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications`, token, { method: 'POST', body: JSON.stringify(manifest) });
  if (publication.committed) return { revision: snapshot.revision, updatedAt: new Date().toISOString(), bytes: compressed.length, assetsSent: 0, libraryPackagesSent: 0 };
  for (const [table, rows] of Object.entries(preparedRows.tables)) {
    // Re-send deterministic keys on resume. D1 upserts make this idempotent and it avoids
    // relying on a count as a positional cursor if local row order changed after a crash.
    for (const chunk of cloudflareTableChunks(rows)) await jsonRequest(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications/${publication.id}/tables/${encodeURIComponent(table)}`, token, { method: 'PUT', body: JSON.stringify({ rows: chunk }) });
  }
  await uploadRowObjects(base, spaceId, publication.id, token, preparedRows.rowObjects);
  const assetsSent = await uploadAssets(base, spaceId, publication.id, token, snapshot.assets);
  const libraryPackagesSent = library ? await uploadLibrary(base, spaceId, publication.id, token, library.packages) : 0;
  await putObject(base, spaceId, publication.id, token, 'snapshot', snapshotHash, 'application/vnd.nodus.snapshot+json', compressed);
  await uploadVectors(base, spaceId, publication.id, token, db, vectorKinds, availableVectorizeDimensions);
  const committed = await jsonRequest<{ updatedAt: string }>(`${base}/api/v3/spaces/${encodeURIComponent(spaceId)}/publications/${publication.id}/commit`, token, { method: 'POST' });
  return { revision: snapshot.revision, updatedAt: committed.updatedAt || new Date().toISOString(), bytes: compressed.length, assetsSent, libraryPackagesSent };
}
