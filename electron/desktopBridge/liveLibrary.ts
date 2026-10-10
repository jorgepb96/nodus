import type { IncomingMessage, ServerResponse } from 'node:http';
import { allServerLibraryItems, buildServerLibraryPublication, type BuiltServerLibraryPublication } from '../serverSync/serverLibrary';
import { withOwningVault } from '../vaults/vaultRegistry';
import { withVaultDatabase } from '../db/database';

const catalogues = new Map<string, { time: number; value: BuiltServerLibraryPublication }>();
const packages = new Map<string, { time: number; value: BuiltServerLibraryPublication }>();
export function invalidateLiveLibrary(vaultId: string): void {
  catalogues.delete(vaultId);
  for (const key of packages.keys()) if (key.startsWith(`${vaultId}:`)) packages.delete(key);
}
function scoped<T>(vaultId: string, run: () => T): Promise<T> {
  return withOwningVault(vaultId, () => withVaultDatabase(vaultId, run));
}
/** Private, vault-scoped Library. ZIPs are built only for the document being opened. */
export async function serveLiveLibrary(req: IncomingMessage, res: ServerResponse, url: URL, vaultId: string, segments: string[]): Promise<void> {
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
  };
  let cached = catalogues.get(vaultId);
  if (!cached || Date.now() - cached.time > 5_000) {
    const value = await scoped(vaultId, () => buildServerLibraryPublication(undefined, { items: allServerLibraryItems(vaultId), includePackages: false }));
    const used = new Set(value.manifest.documents.flatMap(document => document.collectionIds));
    // Keep collection ancestors, but never disclose unrelated collection names.
    let changed = true;
    while (changed) { changed = false; for (const collection of value.manifest.collections) if (used.has(collection.id) && collection.parentId && !used.has(collection.parentId)) { used.add(collection.parentId); changed = true; } }
    value.manifest.collections = value.manifest.collections.filter(collection => used.has(collection.id)).map(collection => ({ ...collection,
      directItemCount: value.manifest.documents.filter(document => document.collectionIds.includes(collection.id)).length }));
    cached = { time: Date.now(), value }; catalogues.set(vaultId, cached);
    if (catalogues.size > 9) catalogues.delete(catalogues.keys().next().value!);
  }
  const library = cached.value.manifest;
  if (!segments.length) { json(200, { published: true, documents: library.documents.length, collections: library.collections.length,
    downloadableDocuments: library.documents.filter(document => document.cleanAvailable || document.originalAvailable).length,
    packageBytes: 0, generatedAt: library.generatedAt }); return; }
  if (segments[0] === 'collections' && segments.length === 1) { json(200, { collections: library.collections, generatedAt: library.generatedAt }); return; }
  if (segments[0] !== 'documents') { json(404, { error: 'not_found' }); return; }
  if (segments.length === 1) {
    const query = String(url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
    const collectionId = url.searchParams.get('collectionId');
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 200)));
    const items = library.documents.filter(document => (!collectionId || document.collectionIds.includes(collectionId))
      && (!query || [document.title, document.abstract, ...document.creators, ...document.tags].filter(Boolean).join('\n').toLocaleLowerCase().includes(query)));
    json(200, { items: items.slice(offset, offset + limit).map(document => ({ ...document, annotations: document.annotations ?? [] })),
      total: items.length, limit, offset, hasMore: offset + limit < items.length, generatedAt: library.generatedAt }); return;
  }
  const id = segments[1];
  if (!library.documents.some(document => document.id === id)) { json(404, { error: 'document_not_found' }); return; }
  const key = `${vaultId}:${id}`;
  let prepared = packages.get(key);
  if (!prepared || Date.now() - prepared.time > 60_000) {
    const item = await scoped(vaultId, () => allServerLibraryItems(vaultId).find(item => item.id === id));
    if (!item) { json(404, { error: 'document_not_found' }); return; }
    prepared = { time: Date.now(), value: await scoped(vaultId, () => buildServerLibraryPublication(undefined, { items: [item] })) };
    packages.set(key, prepared); if (packages.size > 3) packages.delete(packages.keys().next().value!);
  }
  const document = prepared.value.manifest.documents[0];
  if (!document) { json(404, { error: 'document_not_found' }); return; }
  if (segments.length === 2) {
    json(200, { document: { ...document, annotations: document.annotations ?? [] }, generatedAt: prepared.value.manifest.generatedAt }); return;
  }
  if (segments.length !== 3 || segments[2] !== 'download.zip') { json(404, { error: 'not_found' }); return; }
  const file = prepared.value.packages[0];
  if (!file) { json(409, { error: 'package_unavailable' }); return; }
  res.writeHead(200, { 'content-type': 'application/zip', 'content-length': file.bytes,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', etag: `"${file.hash}"` });
  res.end(req.method === 'HEAD' ? undefined : file.data);
}
