import { createHash } from 'node:crypto';
import type { PassageInsert } from '../db/passagesRepo';
import { beginPassagePublication, assertPassagePublication, type PassagePublication } from '../db/passagePublications';
import { prepareDocumentaryText, prepareDocumentaryEmbeddings, documentaryStore } from './documentaryPreparation';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocument, resolveNotebookScope } from './researchCorpusScope';
import { getActiveVault } from '../vaults/vaultRegistry';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { planRetrievalChunks } from '@shared/retrievalChunks';
import { schemeCleaningFor } from './schemeCleaning';
import { embedMany } from './aiClient';

export interface PreparedLegacyPassages {
  contentHash: string; rows: PassageInsert[]; embeddingProvider: string; embeddingModel: string; publication: PassagePublication;
}
/** All academic legacy producers use the same immutable text/vector store. Their
 * vault passage rows remain an adapter for historical identifiers. */
export async function prepareLegacyDocumentaryPassages(nodusId: string, text: string, sourceMap: Record<string, string>, coverage: 'abstract' | 'fulltext', signal?: AbortSignal): Promise<PreparedLegacyPassages> {
  const contentHash = createHash('sha1').update(text).digest('hex');
  const publication = beginPassagePublication(nodusId, contentHash);
  if (getActiveVault().type !== 'academic') {
    const config = currentEmbeddingConfig();
    const cleaning = schemeCleaningFor(text, sourceMap);
    const planned = planRetrievalChunks(text, { sourceMap });
    const chunks = cleaning ? planned.map(chunk => cleaning.clean(chunk)) : planned;
    const vectors = await embedMany(chunks.map(chunk => chunk.text), signal);
    if (vectors.some(vector => !vector?.length)) throw new Error('documentary_embeddings_unavailable');
    return { contentHash, publication, rows: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] })), embeddingProvider: config.provider, embeddingModel: config.model };
  }
  const inventory = researchCorpusInventory();
  const document = inventory.documents.find(document => document.workId === nodusId);
  if (!document) throw new Error('research_source_not_authorized');
  const scope = resolveNotebookScope(getActiveVault().id, { id: 'legacy-preparation', revision: 1, name: '', mode: 'fixed', sources: [], exclusions: [],
    resolvedDocumentIds: [document.id], createdAt: '', updatedAt: '' }, inventory.documents, []);
  const prepared = await prepareDocumentaryText({ ...document, coverage }, text, sourceMap, signal);
  assertResearchDocument(scope, document.id, researchCorpusInventory().documents.find(item => item.id === document.id));
  assertPassagePublication(nodusId, publication);
  // A merged legacy derivative must not displace independent attachment indexes.
  if (!document.attachments || document.attachments.length <= 1) documentaryStore().publishDocument(document, [prepared.indexKey]);
  const embedded = await prepareDocumentaryEmbeddings(prepared.indexKey, prepared.chunks, signal);
  signal?.throwIfAborted();
  assertResearchDocument(scope, document.id, researchCorpusInventory().documents.find(item => item.id === document.id));
  assertPassagePublication(nodusId, publication);
  return { contentHash, rows: prepared.chunks.map((chunk, index) => ({ ...chunk, embedding: embedded.vectors[index] })),
    embeddingProvider: embedded.provider, embeddingModel: embedded.model, publication };
}
