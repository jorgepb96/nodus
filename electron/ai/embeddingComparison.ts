import type { EmbeddingComparisonHit, EmbeddingComparisonReport, EmbeddingComparisonRequest } from '@shared/embeddingComparison';
import { retrievalQuality } from '@shared/embeddingComparison';
import { RETRIEVAL_PRESETS, type ResearchNotebook } from '@shared/researchCorpus';
import { getDb, withVaultDatabase } from '../db/database';
import { contractForProfile, embeddingGenerationRevision, embeddingIndexHead, indexContext, indexRow, withEmbeddingIndexContext } from '../db/embeddingIndexesRepo';
import { getVaultByPath, withOwningVault } from '../vaults/vaultRegistry';
import { embedQuery } from './aiClient';
import { retrieveHierarchical, selectPassageEvidence } from './hierarchicalRetrieval';
import { researchCorpusInventory } from './researchCorpusInventory';
import { documentaryStore, pinPublishedResearchDocuments, retrieveSharedDocumentaryEvidence } from './documentaryPreparation';
import { researchFingerprint, resolveNotebookScope } from './researchCorpusScope';

export async function compareEmbeddingIndexes(input: EmbeddingComparisonRequest, signal?: AbortSignal): Promise<EmbeddingComparisonReport> {
  if (!input || !Array.isArray(input.indexIds) || input.indexIds.length !== 2 || input.indexIds.some(id => typeof id !== 'string')
    || !['ideas', 'passages', 'documents', 'documentary'].includes(input.family) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 20
    || (input.reranking !== undefined && !['off', 'local'].includes(input.reranking))
    || input.questions.some(item => !item || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 2000
      || (item.expected && (typeof item.expected.complete !== 'boolean' || !Array.isArray(item.expected.ids) || item.expected.ids.length > 1000 || item.expected.ids.some(id => typeof id !== 'string' || id.length > 1000))))
    || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 30))) throw new Error('Comparación de embeddings no válida.');
  const vault = getVaultByPath(getDb().name);
  if (!vault || (input.vaultId && input.vaultId !== vault.id)) throw new Error('La bóveda cambió antes de comparar los índices.');
  return withOwningVault(vault.id, () => withVaultDatabase(vault.id, async () => {
    const db = getDb(), limit = input.limit ?? 10;
    const revision = embeddingIndexHead(db)?.corpus_revision ?? 0;
    const contexts = input.indexIds.map(id => {
      const row = indexRow(db, id);
      if (row.legacy || !row.dimensions) throw new Error('Selecciona índices con embeddings verificados para compararlos.');
      return indexContext(db, row);
    });
    const generations = contexts.map(context => embeddingGenerationRevision(db, context.indexId, context.generation));
    const referenceFingerprint = (context: typeof contexts[number]) => researchFingerprint(db.prepare('SELECT index_key FROM embedding_index_documentary_refs WHERE index_id=? AND generation=? ORDER BY index_key').all(context.indexId, context.generation));
    const references = input.family === 'documentary' ? contexts.map(referenceFingerprint) : null;
    const inventory = vault.type === 'academic' ? researchCorpusInventory() : { documents: [], collections: [] };
    const owners = vault.type === 'academic' ? new Set((documentaryStore().db.prepare('SELECT document_id FROM documentary_source_owners WHERE vault_id=?').all(vault.id) as Array<{ document_id: string }>).map(row => row.document_id)) : new Set<string>();
    const documents = inventory.documents.filter(document => document.workId || owners.has(document.id));
    const sourceFingerprint = researchFingerprint(documents.map(doc => [doc.id, doc.revision, doc.permissionRevision]));
    const at = new Date().toISOString();
    const notebook: ResearchNotebook = { id: 'embedding-comparison', name: 'Embedding comparison', description: '', mode: 'fixed', sources: [], exclusions: [], revision: 1,
      resolvedDocumentIds: documents.map(doc => doc.id), createdAt: at, updatedAt: at };
    const scope = resolveNotebookScope(vault.id, notebook, pinPublishedResearchDocuments(documents), inventory.collections);
    const works = (db.prepare('SELECT nodus_id FROM works WHERE archived=0').all() as Array<{ nodus_id: string }>).map(row => row.nodus_id);
    const report: EmbeddingComparisonReport = { format: 'nodus.embedding-comparison/1', createdAt: at, vaultId: vault.id, corpusRevision: revision, sourceFingerprint,
      family: input.family, limit, reranking: input.reranking ?? 'off', arms: [] };
    const checkpoint = () => {
      signal?.throwIfAborted();
      for (const context of contexts) indexRow(db, context.indexId);
      if (embeddingIndexHead(db)?.corpus_revision !== revision || contexts.some((context, index) => embeddingGenerationRevision(db, context.indexId, context.generation) !== generations[index]
        || (references && referenceFingerprint(context) !== references[index])))
        throw new Error('El contenido o los vectores cambiaron durante la comparación. Repítela para obtener una instantánea coherente.');
      if (vault.type === 'academic') {
        const current = new Map(researchCorpusInventory().documents.map(doc => [doc.id, doc]));
        if (documents.some(doc => current.get(doc.id)?.revision !== doc.revision || current.get(doc.id)?.permissionRevision !== doc.permissionRevision)) throw new Error('Las fuentes cambiaron durante la comparación.');
      }
    };
    for (const context of contexts) await withEmbeddingIndexContext(context, async () => {
      const arm: EmbeddingComparisonReport['arms'][number] = { indexId: context.indexId, generation: context.generation, profile: context.profile,
        dimensions: context.dimensions!, contract: contractForProfile(context.profile, context.dimensions!),
        ...(references ? { documentaryFingerprint: referenceFingerprint(context) } : {}), questions: [] };
      for (const item of input.questions) {
        checkpoint();
        const question = item.question.trim(), embeddingStarted = performance.now();
        const vector = await embedQuery(question, signal);
        const embeddingMs = performance.now() - embeddingStarted, started = performance.now();
        let hits: EmbeddingComparisonHit[] = [], workerRssBytes = 0, reranking = 'off', rerankingMs = 0;
        if (input.family === 'documentary') {
          const found = await retrieveSharedDocumentaryEvidence(scope, question, { ...RETRIEVAL_PRESETS.balanced, passagesPerRound: limit, reranking: input.reranking ?? 'off' }, vector, signal, undefined, () => researchCorpusInventory().documents);
          hits = found.evidence.slice(0, limit).map(hit => ({ id: `evidence:${researchFingerprint([hit.documentId, hit.attachmentId, hit.text, hit.locator])}`,
            title: documents.find(doc => doc.id === hit.documentId)?.title ?? hit.documentId, text: hit.text.slice(0, 1400),
            location: hit.locator.pageLabel ?? (hit.locator.pageNumber ? `p. ${hit.locator.pageNumber}` : null), channels: ['hybrid'], }));
          workerRssBytes = found.diagnostics?.workerRssBytes ?? 0; reranking = found.diagnostics?.reranking ?? 'off'; rerankingMs = found.diagnostics?.rerankingMs ?? 0;
        } else {
          const found = await retrieveHierarchical(question, { embedding: vector, nodusIds: works, documentLimit: input.family === 'ideas' ? 0 : limit,
            ideaLimit: input.family === 'ideas' ? limit : 0, passageLimit: input.family === 'passages' ? limit : 0 });
          if (input.family === 'ideas') hits = found.ideas.slice(0, limit).map(hit => ({ id: hit.global_id, title: hit.label, text: hit.statement, location: null, channels: ['semantic'], score: hit.similarity }));
          else if (input.family === 'passages') hits = selectPassageEvidence(found.passages, limit, { preferSourceDiversity: true }).map(hit => ({ id: hit.passage_id, title: hit.title, text: hit.text.slice(0, 1400), location: hit.page_label, channels: hit.lanes, score: hit.similarity }));
          else hits = found.documents.slice(0, limit).map(hit => ({ id: hit.nodusId, title: hit.title, text: hit.text.slice(0, 1400), location: null, channels: hit.channels, score: hit.retrievalScore }));
        }
        checkpoint();
        arm.questions.push({ question, hits, ...(item.expected ? { expected: { ids: [...new Set(item.expected.ids)], complete: item.expected.complete } } : {}),
          quality: retrievalQuality(hits.map(hit => hit.id), item.expected, limit), semanticAvailable: !!vector, embeddingMs,
          retrievalMs: performance.now() - started, workerRssBytes, reranking, rerankingMs });
      }
      report.arms.push(arm);
    });
    checkpoint();
    return report;
  }));
}
