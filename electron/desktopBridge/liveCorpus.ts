import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServerSnapshot, type BuiltSnapshot } from '../serverSync/serverSnapshot';
import { getDb, withVaultDatabase } from '../db/database';
import { getVault } from '../vaults/vaultRegistry';
import { statSync } from 'node:fs';
import { invalidateLiveLibrary, serveLiveLibrary } from './liveLibrary';
import { buildVectorSet, describeVectorSet, type VectorKind } from '../serverSync/serverVectors';
// @ts-expect-error The provider-free queries are JavaScript, bundled by Vite.
import { semanticReadQuery, contextReadQuery, validQueryKind } from '../../server/lib/core/corpusQueries.mjs';
// @ts-expect-error The vector wire decoder is JavaScript, bundled by Vite.
import { decodeVectorSet } from '../../server/lib/core/vectors.mjs';
// @ts-expect-error Existing Mac vectors use the same explicit legacy contract as Server.
import { migrateLegacyVectorV1Header, fingerprintEmbeddingContract, embeddingContractsCompatible } from '../../server/lib/core/embeddingContract.mjs';
// The private live transport uses the same tested read projection as Nodus Server.
// @ts-expect-error The server module is JavaScript and is bundled by Vite.
import { createCorpusRoutes } from '../../server/lib/routes/corpus.mjs';

type LiveSnapshot = { stamp: string; value: BuiltSnapshot; document: unknown; vectors: Map<VectorKind, ReturnType<typeof decodeVectorSet>> };
const snapshots = new Map<string, LiveSnapshot>();
export function isReadOnlyCorpusQuery(method: string | undefined, path: string | undefined): boolean {
  return method === 'POST' && (path === 'search/semantic' || path === 'context');
}
function databaseStamp(file: string): string {
  return [file, `${file}-wal`].map(name => {
    try { const stat = statSync(name, { bigint: true }); return `${stat.size}:${stat.mtimeNs}`; }
    catch { return 'absent'; }
  }).join('|');
}
export function invalidateLiveCorpus(vaultId: string): void { snapshots.delete(vaultId); invalidateLiveLibrary(vaultId); }

export async function serveLiveCorpus(req: IncomingMessage, res: ServerResponse, url: URL, vaultId: string, segments: string[], input?: Record<string, unknown>): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault) { res.writeHead(404); res.end(); return; }
  if (segments[0] === 'library') { await serveLiveLibrary(req, res, url, vaultId, segments.slice(1)); return; }
  let cached = snapshots.get(vaultId);
  if (!cached || cached.stamp !== databaseStamp(vault.path)) {
    const value = await withVaultDatabase(vaultId, () => buildServerSnapshot(vault, {
      nodusServerIncludePassages: true, nodusServerIncludeUserContent: true,
      // Private domains remain separately granted, never part of this corpus projection.
      nodusServerIncludePrimarySources: false, nodusServerIncludeTestimonies: false,
    }, getDb()));
    cached = { stamp: databaseStamp(vault.path), value, document: JSON.parse(value.buffer.toString('utf8')), vectors: new Map() };
    snapshots.delete(vaultId); snapshots.set(vaultId, cached);
    if (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
  }
  const built = cached.value;
  res.setHeader('x-nodus-revision', built.revision);
  res.setHeader('cache-control', 'no-store');
  if (isReadOnlyCorpusQuery(req.method, segments.join('/'))) {
    if (!input) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_query' })); return; }
    let result;
    if (segments[0] === 'context') result = contextReadQuery(cached.document, input, built.revision);
    else {
      if (!validQueryKind(input)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_vector_kind' })); return; }
      const kind = String(input.kind || 'ideas') as VectorKind;
      const snapshot = cached;
      const { set, locked } = await withVaultDatabase(vaultId, () => {
        const summary = describeVectorSet(getDb(), kind);
        if (!summary) return { set: null, locked: null };
        const header = { ...summary, format: 'nodus.vectors', version: 1, quant: 'int8-l2' };
        const contract = migrateLegacyVectorV1Header(header);
        const locked = { contract, fingerprint: fingerprintEmbeddingContract(contract) };
        // A settings identity probe needs only metadata, never a second copy
        // of a potentially large matrix. Build the matrix only for a query.
        let set = { header, dim: summary.dim, count: summary.count, ids: [], matrix: new Int8Array() };
        const compatible = input.embeddingContract ? embeddingContractsCompatible(contract, input.embeddingContract)
          : input.provider === summary.provider && input.model === summary.model && Number(input.dim) === summary.dim;
        if (Array.isArray(input.vector) && input.vector.length === summary.dim &&
            input.vector.every(value => typeof value === 'number' && Number.isFinite(value)) && compatible) {
          set = snapshot.vectors.get(kind);
          if (!set) {
            const payload = buildVectorSet(getDb(), kind);
            if (!payload) throw new Error('vector_index_unavailable');
            set = decodeVectorSet(payload.buffer); snapshot.vectors.set(kind, set);
          }
        }
        return { set, locked };
      });
      result = await semanticReadQuery(cached.document, input, set, locked);
    }
    res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result.body)); return;
  }
  if (segments[0] === 'snapshot') {
    res.writeHead(200, { 'content-type': 'application/vnd.nodus.snapshot+json' });
    res.end(req.method === 'HEAD' ? undefined : built.buffer); return;
  }
  // The server owns this binary route separately from createCorpusRoutes.
  // Live HTTPS must expose the same explicitly published image hashes.
  if (segments[0] === 'assets') {
    const hash = segments[1];
    const asset = segments.length === 2 && /^[a-f0-9]{64}$/.test(hash ?? '')
      ? built.assets.find(item => item.hash === hash || item.thumbHash === hash) : undefined;
    const bytes = asset && (asset.hash === hash ? asset.data : asset.thumbData);
    const mime = asset && (asset.hash === hash ? asset.mime : asset.thumbMime);
    if (!bytes || !mime) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'not_found' })); return;
    }
    res.writeHead(200, { 'content-type': mime, 'content-length': bytes.length,
      'cache-control': 'private, max-age=31536000, immutable', vary: 'Authorization' });
    res.end(req.method === 'HEAD' ? undefined : bytes); return;
  }
  const snapshot = cached.document;
  const routes = createCorpusRoutes({
    readSnapshot: () => snapshot,
    readAssetBytes: (spaceOrHash: string, requestedHash?: string) => {
      const hash = requestedHash ?? spaceOrHash;
      const asset = built.assets.find(item => item.hash === hash || item.thumbHash === hash);
      if (!asset) return null;
      return { bytes: asset.hash === hash ? asset.data : asset.thumbData, mime: asset.hash === hash ? asset.mime : asset.thumbMime };
    },
  });
  const handled = await routes.handle(req, res, {
    url, segments, space: { id: vaultId, name: vault.name, revision: built.revision },
    json: (response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
    },
  });
  if (!handled) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' })); }
}
