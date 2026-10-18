import type { ResearchCorpusCollection, ResearchCorpusDocument } from '@shared/researchCorpus';
import { listResearchAttachmentSources } from './researchAttachmentSources';
import type { Work } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getGlobalLibraryItem, listGlobalLibraryCollections, listGlobalLibraryItems, listGlobalLibraryVaultLinks } from '../library/libraryService';
import { researchFingerprint } from './researchCorpusScope';

export function researchCorpusInventory(): { documents: ResearchCorpusDocument[]; collections: ResearchCorpusCollection[] } {
  const vault = getActiveVault();
  if (vault.type !== 'academic') throw new Error('Research notebooks require an academic vault');
  const documents: ResearchCorpusDocument[] = [];
  const collections: ResearchCorpusCollection[] = [];
  const linkedWorks = new Set<string>();
  const works = getDb().prepare('SELECT * FROM works WHERE archived=0').all() as Work[];
  const userId = getSettings().zoteroUserId || '0';
  const workByZoteroIdentity = new Map(works.flatMap(work => {
    const match = /^groups:([^:]+):(.+)$/.exec(work.zotero_key);
    if (!match && !/^[A-Z0-9]{8}$/.test(work.zotero_key)) return [];
    return [[JSON.stringify([match ? 'group' : 'user', match?.[1] ?? userId, match?.[2] ?? work.zotero_key]), work.nodus_id] as const];
  }));
  const availableWorkIds = new Set(works.map(work => work.nodus_id));
  const links = listGlobalLibraryVaultLinks().filter(link => link.vaultId === vault.id);
  // Keyed once: a per-item search through every link is quadratic in a large library.
  const linkedWorkByItem = new Map<string, string>();
  for (const link of links) if (!linkedWorkByItem.has(link.itemId)) linkedWorkByItem.set(link.itemId, link.workId);
  const globalMembership = new Map<string, string[]>();
  for (let offset = 0; ; offset += 500) {
    const page = listGlobalLibraryItems({ offset, limit: 500, includeFacets: false });
    for (const summary of page.items) {
      const item = getGlobalLibraryItem(summary.id);
      if (!item || item.deletedAt || item.sourceState === 'library-missing') continue;
      const identity = item.sourceIdentities.find(source => source.source === 'zotero' && (source.libraryType === 'user' || source.libraryType === 'group'));
      const canonicalWork = identity ? workByZoteroIdentity.get(JSON.stringify([identity.libraryType, identity.libraryId, identity.itemKey])) : null;
      const linkedId = linkedWorkByItem.get(item.id) ?? item.vaultWorkIds?.[vault.id] ?? canonicalWork ?? null;
      const workId = linkedId && availableWorkIds.has(linkedId) ? linkedId : null;
      if (workId) linkedWorks.add(workId);
      documents.push({ id: item.id, workId, libraryItemId: item.id, title: item.metadata.title,
        authors: item.metadata.creators.filter(creator => creator.creatorType === 'author').map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')),
        year: item.metadata.year ?? null, revision: researchFingerprint({ metadata: item.metadata, attachments: item.attachments.map(attachment => [attachment.id, attachment.sha256, attachment.sourceVersion]) }),
        attachmentId: item.attachments.length === 1 ? item.attachments[0].id : null,
        attachments: item.attachments.map(attachment => ({ id: attachment.id, revision: researchFingerprint([attachment.sha256, attachment.sourceVersion]) })),
        origin: identity ? { kind: 'zotero', libraryType: identity.libraryType as 'user' | 'group', libraryId: identity.libraryId, itemKey: identity.itemKey } : { kind: 'nodus', id: item.id },
        permissionRevision: researchFingerprint({ id: item.id, sourceState: item.sourceState ?? 'current', sources: item.sourceIdentities }),
        coverage: summary.readerAvailable ? 'fulltext' : item.metadata.abstract ? 'abstract' : 'metadata' });
      for (const id of item.collectionIds) {
        const members = globalMembership.get(id);
        if (members) members.push(item.id); else globalMembership.set(id, [item.id]);
      }
    }
    if (offset + page.items.length >= page.total || !page.items.length) break;
  }
  // Nodus collections are the Global Library's own. Its mirrors of Zotero collections are
  // kept aside: the vault's Zotero collections below are the same folders, and a mirror is
  // only listed when the vault does not hold that collection itself.
  const zoteroMirrors: Array<{ collection: ReturnType<typeof listGlobalLibraryCollections>[number] }> = [];
  for (const collection of listGlobalLibraryCollections()) {
    if (collection.source !== 'nodus') { zoteroMirrors.push({ collection }); continue; }
    collections.push({ reference: { kind: 'library-collection', id: collection.id }, name: collection.name, parentId: collection.parentId,
      documentIds: globalMembership.get(collection.id) ?? [], origin: 'nodus' });
  }
  for (const work of works) {
    if (linkedWorks.has(work.nodus_id)) continue;
    const match = /^groups:([^:]+):(.+)$/.exec(work.zotero_key);
    const zotero = match || /^[A-Z0-9]{8}$/.test(work.zotero_key);
    const id = zotero ? `zotero:${match ? 'group' : 'user'}:${match?.[1] ?? userId}:${match?.[2] ?? work.zotero_key}` : `vault:${vault.id}:${work.nodus_id}`;
    let authors: string[] = [];
    try { const parsed = JSON.parse(work.authors_json); if (Array.isArray(parsed)) authors = parsed.filter(value => typeof value === 'string'); } catch { /* Legacy metadata. */ }
    documents.push({ id, workId: work.nodus_id, libraryItemId: null, title: work.title, authors, year: work.year, attachmentId: null,
      revision: researchFingerprint([work.zotero_version, work.zotero_fingerprint, work.resolved_text_hash, work.title]),
      permissionRevision: researchFingerprint([vault.id, work.nodus_id, work.zotero_key, work.archived]),
      origin: zotero ? { kind: 'zotero', libraryType: match ? 'group' : 'user', libraryId: match?.[1] ?? userId, itemKey: match?.[2] ?? work.zotero_key } : { kind: 'nodus', id },
      coverage: work.resolved_source_type === 'abstract_only' ? 'abstract' : work.resolved_text_chars > 0 ? 'fulltext' : 'metadata' });
  }
  const rows = getDb().prepare('SELECT collection_key,name,parent_key FROM collections').all() as { collection_key: string; name: string; parent_key: string | null }[];
  const members = getDb().prepare('SELECT collection_key,nodus_id FROM work_collections').all() as { collection_key: string; nodus_id: string }[];
  // Grouped once, in the order the scans below used to produce: filtering every membership
  // row and then every document for each collection was ~370M comparisons on a
  // 14k-work library with 945 collections, freezing the main process for minutes.
  const membersByCollection = new Map<string, string[]>();
  for (const member of members) {
    const list = membersByCollection.get(member.collection_key);
    if (list) list.push(member.nodus_id); else membersByCollection.set(member.collection_key, [member.nodus_id]);
  }
  const documentIdsByWork = new Map<string, string[]>();
  for (const document of documents) {
    if (!document.workId) continue;
    const list = documentIdsByWork.get(document.workId);
    if (list) list.push(document.id); else documentIdsByWork.set(document.workId, [document.id]);
  }
  for (const row of rows) {
    const match = /^groups:([^:]+):(.+)$/.exec(row.collection_key);
    collections.push({ reference: { kind: 'zotero-collection', id: match?.[2] ?? row.collection_key, libraryType: match ? 'group' : 'user', libraryId: match?.[1] ?? userId },
      name: row.name, parentId: row.parent_key?.replace(/^groups:[^:]+:/, '') ?? null, origin: 'zotero',
      documentIds: (membersByCollection.get(row.collection_key) ?? []).flatMap(workId => documentIdsByWork.get(workId) ?? []) });
  }
  const vaultZoteroKeys = new Set(rows.map(row => row.collection_key.replace(/^groups:[^:]+:/, '')));
  for (const { collection } of zoteroMirrors) {
    if (collection.sourceKey && vaultZoteroKeys.has(collection.sourceKey)) continue;
    collections.push({ reference: { kind: 'library-collection', id: collection.id }, name: collection.name, parentId: collection.parentId,
      documentIds: globalMembership.get(collection.id) ?? [], origin: 'zotero' });
  }
  // A selectable note is not an implicit corpus member. General chat selects
  // linked works only; notebooks must explicitly select a note reference.
  const notes = getDb().prepare("SELECT id,title,kind,content FROM notes WHERE trashed_at IS NULL AND length(trim(content))>0 AND kind IN ('markdown','assistant','writing')")
    .all() as Array<{ id: string; title: string; kind: string; content: string }>;
  for (const note of notes) {
    const id = `vault:${vault.id}:note:${note.id}`;
    documents.push({ id, noteId: note.id, authoredKind: note.kind === 'markdown' ? 'user-note' : 'generated-report',
      workId: null, libraryItemId: null, title: note.title, authors: [], year: null, attachmentId: null,
      origin: { kind: 'nodus', id }, revision: researchFingerprint([note.title, note.content]),
      permissionRevision: researchFingerprint([vault.id, note.id, 'active-note']), coverage: 'fulltext' });
  }
  for (const { conversationId, attachmentId, source } of listResearchAttachmentSources()) {
    const id = `vault:${vault.id}:conversation:${conversationId}:attachment:${attachmentId}`;
    const revision = researchFingerprint([source.name, source.text, source.warning]);
    documents.push({ id, conversationAttachment: { conversationId, attachmentId }, sourceWarning: source.warning,
      workId: null, libraryItemId: null, title: source.name, authors: [], year: null, attachmentId,
      attachments: [{ id: attachmentId, revision }], origin: { kind: 'nodus', id }, revision,
      permissionRevision: researchFingerprint([vault.id, conversationId, attachmentId]), coverage: 'fulltext' });
  }
  return { documents, collections };
}
