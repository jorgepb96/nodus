import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { buildServerSnapshot, type BuiltSnapshot } from '../serverSync/serverSnapshot';
import { mobileConsultationSnapshot } from '../../shared/mobileConsultationSnapshot';
import { getDb, withVaultDatabase } from '../db/database';
import { getVault, withOwningVault } from '../vaults/vaultRegistry';
import { semanticSearch as searchDesktopByMeaning } from '../ai/semanticSearch';
import {buildSectionDownload} from './sectionDownloads';
import { statSync } from 'node:fs';
import { readPrivateSourceContext } from './privateSources';
import { privateContextRevision } from './privateSourceContext';
import { invalidateLiveLibrary, serveLiveLibrary } from './liveLibrary';
import { buildVectorSet, describeVectorSet, type VectorKind } from '../serverSync/serverVectors';
// @ts-expect-error The provider-free queries are JavaScript, bundled by Vite.
import { semanticReadQuery, contextReadQuery, validQueryKind } from '../../server/lib/core/corpusQueries.mjs';
// @ts-expect-error The vector wire decoder is JavaScript, bundled by Vite.
import { decodeVectorSet } from '../../server/lib/core/vectors.mjs';
// @ts-expect-error Existing Mac vectors use the same explicit legacy contract as Server.
import { migrateLegacyVectorV1Header, validateEmbeddingContract, fingerprintEmbeddingContract, embeddingContractsCompatible } from '../../server/lib/core/embeddingContract.mjs';
// The private live transport uses the same tested read projection as Nodus Server.
// @ts-expect-error The server module is JavaScript and is bundled by Vite.
import { createCorpusRoutes } from '../../server/lib/routes/corpus.mjs';

type LiveSnapshot = { stamp: string; value: BuiltSnapshot; document: unknown; vectors: Map<VectorKind, ReturnType<typeof decodeVectorSet>>; sectionDownload?: {name: string; result: ReturnType<typeof buildSectionDownload>} };
const snapshots = new Map<string, LiveSnapshot>();
export function isReadOnlyCorpusQuery(method: string | undefined, path: string | undefined): boolean {
  return method === 'POST' && (path === 'search/semantic' || path === 'search/related' || path === 'context');
}
function databaseStamp(file: string): string {
  return [file, `${file}-wal`].map(name => {
    try { const stat = statSync(name, { bigint: true }); return `${stat.size}:${stat.mtimeNs}`; }
    catch { return 'absent'; }
  }).join('|');
}
export function invalidateLiveCorpus(vaultId: string): void { snapshots.delete(vaultId); invalidateLiveLibrary(vaultId); }

/** Reading marks and annotations are personal, so public snapshots exclude them.
 * The authenticated companion must see the same reading state as Desktop.
 * Add only rows for reports in this vault's private corpus, never to publication. */
function buildPrivateCorpusSnapshot(vault: NonNullable<ReturnType<typeof getVault>>, bridgeGenealogyEvidence = false): BuiltSnapshot {
  const db = getDb();
  const built = buildServerSnapshot(vault, {
    nodusServerIncludePassages: true, nodusServerIncludeUserContent: true,
    nodusServerIncludePrimarySources: false, nodusServerIncludeTestimonies: false,
    ...(vault.type === 'genealogy' ? { bridgeGenealogyEvidence } : {}),
  }, db);
  const document = JSON.parse(built.buffer.toString('utf8'));
  const drafts = document.tables?.writing_saved_drafts;
  if (!Array.isArray(drafts)) return built;
  const ids = new Set(drafts.map((draft: {id: string}) => String(draft.id)));
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='writing_draft_reads'").get();
  const reads = exists
    ? (db.prepare('SELECT draft_id, updated_at FROM writing_draft_reads ORDER BY draft_id').all() as {draft_id: string; updated_at: string}[])
      .filter(row => ids.has(String(row.draft_id)))
    : [];
  document.tables.writing_draft_reads = reads;
  const hasAnnotations = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='writing_draft_annotations'").get();
  const annotations = hasAnnotations
    ? (db.prepare('SELECT * FROM writing_draft_annotations ORDER BY id').all() as {draft_id: string}[])
      .filter(row => ids.has(String(row.draft_id)))
    : [];
  document.tables.writing_draft_annotations = annotations;
  const counts = {...built.counts, writing_draft_reads: reads.length, writing_draft_annotations: annotations.length};
  if (document.counts) {
    document.counts.writing_draft_reads = reads.length;
    document.counts.writing_draft_annotations = annotations.length;
  }
  // Personal changes invalidate private catalogue/detail ETags without changing publication.
  const revision = createHash('sha256').update(built.revision)
    .update(JSON.stringify({reads, annotations})).digest('base64url');
  return {...built, counts, revision, buffer: Buffer.from(JSON.stringify(document))};
}

export async function liveCorpusRevision(vaultId:string):Promise<string>{
  const vault=getVault(vaultId);if(!vault)throw new Error('vault_not_found');
  const built=await withVaultDatabase(vaultId,()=>buildPrivateCorpusSnapshot(vault));
  return built.revision;
}

export async function serveLiveCorpus(req: IncomingMessage, res: ServerResponse, url: URL, vaultId: string, segments: string[], input?: Record<string, unknown>, domains: readonly string[] = []): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault) { res.writeHead(404); res.end(); return; }
  if (req.method === 'POST' && segments.join('/') === 'search/related') {
    // The companion sends text, never provider credentials or a different embedding model.
    // Reuse Desktop's active-index retrieval under the explicitly linked vault. This only
    // embeds the query; it cannot prepare, activate or modify a corpus index.
    const query = typeof input?.query === 'string' ? input.query.trim() : '';
    const limit = typeof input?.limit === 'number' && Number.isInteger(input.limit) ? input.limit : 50;
    if (vault.type !== 'academic' || query.length < 2 || query.length > 4096 || limit < 1 || limit > 50) {
      res.writeHead(400, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: 'invalid_query'})); return;
    }
    const result = await withOwningVault(vaultId, () => withVaultDatabase(vaultId, async () => {
      try { return await searchDesktopByMeaning(query, {kinds: ['idea', 'work', 'passage'], limit}); }
      catch { return {available: false, results: [], warning: 'semantic_search_unavailable'}; }
    }));
    res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(result)); return;
  }
  if (segments[0] === 'library') { await serveLiveLibrary(req, res, url, vaultId, segments.slice(1)); return; }
  // Evidence quotations are private source content. Ordinary kinship/place metadata
  // remains corpus-only; a cache built with a stronger grant cannot answer a weaker one.
  const bridgeGenealogyEvidence = vault.type === 'genealogy' && domains.includes('corpus') && domains.includes('primary-source-files');
  const stamp = `${databaseStamp(vault.path)}:genealogy-evidence=${bridgeGenealogyEvidence}`;
  let cached = snapshots.get(vaultId);
  if (!cached || cached.stamp !== stamp) {
    const value = await withVaultDatabase(vaultId, () => buildPrivateCorpusSnapshot(vault, bridgeGenealogyEvidence));
    cached = { stamp, value, document: JSON.parse(value.buffer.toString('utf8')), vectors: new Map() };
    snapshots.delete(vaultId); snapshots.set(vaultId, cached);
    if (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
  }
  const built = cached.value;
  if (segments.length === 3 && segments[0] === 'downloads' && segments[1] === 'sections' && ['GET','HEAD'].includes(req.method ?? '')) {
    try {
      // Retain at most one bounded section per cached vault. A HEAD poll on an unchanged
      // database must not rebuild the graph or repeatedly encode all report illustrations.
      const section = cached.sectionDownload?.name === segments[2] ? cached.sectionDownload.result
        : await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => buildSectionDownload(built, segments[2])));
      cached.sectionDownload = {name: segments[2], result: section};
      res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'content-length': section.buffer.length,
        'x-nodus-revision': section.revision, 'cache-control': 'no-store'});
      res.end(req.method === 'HEAD' ? undefined : section.buffer);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'section_download_failed';
      res.writeHead(code === 'section_download_too_large' ? 413 : 400, {'content-type': 'application/json'});
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({error: code}));
    }
    return;
  }
  res.setHeader('x-nodus-revision', built.revision);
  res.setHeader('cache-control', 'no-store');
  if (isReadOnlyCorpusQuery(req.method, segments.join('/'))) {
    if (!input) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_query' })); return; }
    let result;
    if (segments[0] === 'context') {
      result = contextReadQuery(cached.document, input, built.revision);
      if (Array.isArray(input.include) && input.include.includes('sources') && typeof input.query === 'string') {
        const content = result.body;
        const publicSources = content.sections.find((section: {kind:string}) => section.kind === 'sources');
        const additional = await readPrivateSourceContext(vaultId,domains,input.query,Math.max(0,content.stats.budget-content.stats.chars));
        if (additional.items.length) {
          if (publicSources) {
            const replaced = new Set(additional.items.map(row => String(row.citation)));
            for (const row of publicSources.items) if (replaced.has(row.citation)) content.stats.chars -= JSON.stringify(row).length;
            publicSources.items = publicSources.items.filter((row: {citation:string}) => !replaced.has(row.citation));
            publicSources.items.push(...additional.items);
          }
          else content.sections.push({kind:'sources',items:additional.items});
        }
        content.stats.chars += additional.used; content.stats.matched += additional.matched;
        content.stats.truncated ||= additional.truncated;
        // Private revisions and content never modify the public cached snapshot.
        content.revision = privateContextRevision(built.revision,additional.items);
        res.setHeader('x-nodus-revision',content.revision);
      }
    }
    else {
      if (!validQueryKind(input)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_vector_kind' })); return; }
      const kind = String(input.kind || 'ideas') as VectorKind;
      const snapshot = cached;
      const { set, locked } = await withVaultDatabase(vaultId, () => {
        const summary = describeVectorSet(getDb(), kind);
        if (!summary) return { set: null, locked: null };
        const header = { ...summary, format: 'nodus.vectors', version: 1, quant: 'int8-l2' };
        // Wire format v1 also carries modern index contracts. Only metadata without
        // a contract is legacy; migrating a modern header rejects its own contract.
        const contract = summary.embeddingContract
          ? validateEmbeddingContract(summary.embeddingContract)
          : migrateLegacyVectorV1Header(header);
        if (contract.provider !== summary.provider || contract.model !== summary.model || contract.dim !== summary.dim) {
          throw new Error('embedding_contract_identity_mismatch');
        }
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
    const projection = url.searchParams.get('projection');
    if (projection !== null && projection !== 'dictionary' && projection !== 'sources') {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_snapshot_projection' })); return;
    }
    res.writeHead(200, { 'content-type': 'application/vnd.nodus.snapshot+json' });
    res.end(req.method === 'HEAD' ? undefined : projection
      ? JSON.stringify(mobileConsultationSnapshot(cached.document as Record<string, unknown>, projection)) : built.buffer); return;
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
