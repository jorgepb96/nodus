import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import { buildServerSnapshot } from '../serverSync/serverSnapshot';
import { buildServerLibraryPublicationAsync } from '../serverSync/serverLibrary';
import { describeVectorSet, type VectorKind } from '../serverSync/serverVectors';
import { readVaultConfig } from '../serverSync/serverSyncShared';
import type { CloudflareDeployPreview, CloudflareVaultInventory } from '@shared/cloudflare';
import { currentPricingCatalog, estimateCloudflareCost } from './pricing';
import { CLOUDFLARE_SYNC_INTERVAL_MS } from '../serverSync/cloudflareSyncSafety';

const gzipAsync = promisify(gzip);
const INLINE_D1_ROW_BYTES = 512 * 1024;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function structuredSize(payload: { tables?: Record<string, Record<string, unknown>[]> }): { rows: number; json: number; inlineJson: number; overflowRows: number; overflowBytes: number; fts: number } {
  let rows = 0; let json = 0; let inlineJson = 0; let overflowRows = 0; let overflowBytes = 0; let fts = 0;
  for (const values of Object.values(payload.tables || {})) for (const row of values) {
    rows += 1;
    const bytes = jsonBytes(row);
    json += bytes;
    if (bytes > INLINE_D1_ROW_BYTES) { overflowRows += 1; overflowBytes += bytes; inlineJson += 256; }
    else inlineJson += bytes;
    fts += Math.min(100_000, Object.values(row).filter((value) => typeof value === 'string').reduce((sum, value) => sum + Buffer.byteLength(value as string), 0));
  }
  return { rows, json, inlineJson, overflowRows, overflowBytes, fts };
}

function uniqueAssetBytes(assets: ReturnType<typeof buildServerSnapshot>['assets']): { count: number; bytes: number } {
  const values = new Map<string, number>();
  for (const asset of assets) {
    values.set(asset.hash, asset.data.length);
    if (asset.thumbHash && asset.thumbData) values.set(asset.thumbHash, asset.thumbData.length);
  }
  return { count: values.size, bytes: [...values.values()].reduce((sum, value) => sum + value, 0) };
}

function vectorInventory(db: Database.Database, includeVectors: boolean, includePassages: boolean) {
  if (!includeVectors) return [];
  const kinds: VectorKind[] = includePassages ? ['ideas', 'documents', 'passages'] : ['ideas', 'documents'];
  return kinds.flatMap((kind) => {
    const summary = describeVectorSet(db, kind);
    if (!summary) return [];
    return [{
      kind, provider: summary.provider, model: summary.model, count: summary.count, dimensions: summary.dim,
      // The official Deploy to Cloudflare flow can provision D1/R2 without
      // knowing anything about the vault. Vectorize dimensions are model-specific,
      // so the zero-intermediation template stores the portable exact index in R2.
      bytes: summary.bytes, mode: 'r2-exact' as const,
    }];
  });
}

export async function inspectActiveVaultForCloudflare(activity: Partial<CloudflareVaultInventory['activity']> = {}): Promise<CloudflareVaultInventory> {
  const vault = getActiveVault();
  const db = getDb();
  const config = readVaultConfig(vault);
  const library = config.includeLibraryDocuments ? await buildServerLibraryPublicationAsync() : null;
  const snapshot = buildServerSnapshot(vault, {
    nodusServerIncludeUserContent: config.includeUserContent,
    nodusServerIncludePassages: config.includePassages,
    nodusServerIncludePrimarySources: config.includePrimarySources,
    nodusServerIncludeTestimonies: config.includeTestimonies,
  }, db, library?.manifest || null);
  const payload = JSON.parse(snapshot.buffer.toString('utf8')) as { tables?: Record<string, Record<string, unknown>[]> };
  const structured = structuredSize(payload);
  const compressed = await gzipAsync(snapshot.buffer, { level: 1 });
  const assets = uniqueAssetBytes(snapshot.assets);
  const libraryBytes = library?.packages.reduce((sum, entry) => sum + entry.data.length, 0) || 0;
  const vectors = vectorInventory(db, config.includeVectors, config.includePassages);
  const exactVectorBytes = vectors.reduce((sum, entry) => sum + entry.bytes, 0);
  const publicationsPerMonth = Math.max(1, Math.round(activity.publicationsPerMonth ?? 30));
  // Conservatively model a continuously running Desktop: action claim, account lookup,
  // Library changes/command claim, owner inbox and Nodi notes. Each extra replica probes
  // role, snapshot and preferences. 304 responses still invoke the Worker and D1.
  const devices = Math.max(1, Math.round(activity.devices ?? 2));
  const backgroundRequests = Math.ceil(30 * 86400_000 / CLOUDFLARE_SYNC_INTERVAL_MS) * (6 + 3 * (devices - 1));
  const apiReadsPerMonth = Math.max(0, Math.round(activity.apiReadsPerMonth ?? 3_000)) + backgroundRequests;
  const semanticQueriesPerMonth = Math.max(0, Math.round(activity.semanticQueriesPerMonth ?? 300));
  const mutationRowsPerMonth = Math.max(0, Math.round(activity.mutationRowsPerMonth ?? 300));
  const exactDimensions = vectors.filter((entry) => entry.mode === 'r2-exact').reduce((sum, entry) => sum + entry.count * entry.dimensions, 0);
  const averageWorkerCpuMs = Math.max(1, Number(activity.averageWorkerCpuMs ?? Math.min(50, 4 + exactDimensions / 20_000_000)));
  const uploadRequests = publicationsPerMonth * (Math.ceil(structured.rows / 15) + assets.count + (library?.packages.length || 0) + 5);
  const estimatedEgressBytesPerMonth = Math.max(0, Math.round(activity.estimatedEgressBytesPerMonth
    ?? compressed.length * devices * publicationsPerMonth + libraryBytes * 0.1));
  return {
    vaultId: vault.id, vaultName: vault.name, vaultType: vault.type, schemaVersion: snapshot.schemaVersion,
    generatedAt: new Date().toISOString(),
    structured: {
      tables: Object.keys(payload.tables || {}).length, rows: structured.rows, jsonBytes: structured.json,
      // D1 stores keys and indexes beside the JSON; measured row JSON is the base and the
      // explicit multiplier is shown as an estimate, never presented as a Cloudflare limit.
      estimatedD1Bytes: Math.ceil(structured.inlineJson * 1.35 * 3 + 512 * 1024),
      estimatedIndexBytes: Math.ceil(structured.fts * 1.25 * 3),
    },
    objects: {
      uniqueObjects: assets.count + (library?.packages.length || 0) + 1 + vectors.length + structured.overflowRows,
      structuredOverflowBytes: structured.overflowBytes * 3,
      assetBytes: assets.bytes, libraryBytes, snapshotBytes: compressed.length, vectorBackupBytes: exactVectorBytes * 3,
      retainedGenerationBytes: compressed.length * 2,
    },
    vectors,
    activity: {
      devices, publicationsPerMonth, apiReadsPerMonth, semanticQueriesPerMonth, mutationRowsPerMonth,
      estimatedWorkerRequestsPerMonth: Math.ceil(apiReadsPerMonth + semanticQueriesPerMonth + mutationRowsPerMonth * 2 + uploadRequests),
      averageWorkerCpuMs, estimatedEgressBytesPerMonth,
    },
  };
}

export async function cloudflareDeployPreview(activity: Partial<CloudflareVaultInventory['activity']> = {}): Promise<CloudflareDeployPreview> {
  const [inventory, pricing] = await Promise.all([inspectActiveVaultForCloudflare(activity), currentPricingCatalog()]);
  return { estimate: estimateCloudflareCost(inventory, pricing.catalog), catalogLive: pricing.live, catalogWarning: pricing.warning, officialSources: Object.values(pricing.catalog.sources) };
}
