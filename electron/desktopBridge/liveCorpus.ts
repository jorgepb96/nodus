import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServerSnapshot, type BuiltSnapshot } from '../serverSync/serverSnapshot';
import { getDb, withVaultDatabase } from '../db/database';
import { getVault } from '../vaults/vaultRegistry';
import { statSync } from 'node:fs';
import { invalidateLiveLibrary, serveLiveLibrary } from './liveLibrary';
// The private live transport uses the same tested read projection as Nodus Server.
// @ts-expect-error The server module is JavaScript and is bundled by Vite.
import { createCorpusRoutes } from '../../server/lib/routes/corpus.mjs';

const snapshots = new Map<string, { stamp: string; value: BuiltSnapshot; document: unknown }>();
function databaseStamp(file: string): string {
  return [file, `${file}-wal`].map(name => {
    try { const stat = statSync(name, { bigint: true }); return `${stat.size}:${stat.mtimeNs}`; }
    catch { return 'absent'; }
  }).join('|');
}
export function invalidateLiveCorpus(vaultId: string): void { snapshots.delete(vaultId); invalidateLiveLibrary(vaultId); }

export async function serveLiveCorpus(req: IncomingMessage, res: ServerResponse, url: URL, vaultId: string, segments: string[]): Promise<void> {
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
    cached = { stamp: databaseStamp(vault.path), value, document: JSON.parse(value.buffer.toString('utf8')) };
    snapshots.delete(vaultId); snapshots.set(vaultId, cached);
    if (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
  }
  const built = cached.value;
  res.setHeader('x-nodus-revision', built.revision);
  res.setHeader('cache-control', 'no-store');
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
