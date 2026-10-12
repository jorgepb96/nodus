import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from './backgroundParentPort';
import { DocumentaryStore } from '../db/documentaryStore';
import { DocumentaryVectorCache } from '../db/documentaryVectorCache';
import { runDocumentaryRetrieval, type DocumentaryRetrievalInput } from '../db/documentaryRetrieval';

/** One process serves every retrieval of the session, keeping the read-only store and its
 *  revision-aware semantic vectors cached between searches. */
const opened = new Map<string, { store: DocumentaryStore; vectors: DocumentaryVectorCache; identity: string }>();

/** A restore/reset can replace the database file while this worker stays alive. */
function fileIdentity(filename: string): string {
  const stat = fs.statSync(filename);
  return `${stat.dev}:${stat.ino}`;
}

function storeFor(filename: string): { store: DocumentaryStore; vectors: DocumentaryVectorCache } {
  const resolved = path.resolve(filename);
  const identity = fileIdentity(resolved);
  const existing = opened.get(resolved);
  if (existing?.store.db.open && existing.identity === identity) return existing;
  if (existing) {
    existing.vectors.clear();
    try { existing.store.close(); } catch { /* already closed */ }
    opened.delete(resolved);
  }
  const store = new DocumentaryStore(resolved, true);
  const entry = { store, vectors: new DocumentaryVectorCache(store), identity };
  opened.set(resolved, entry);
  return entry;
}

type RetrievalRequest = DocumentaryRetrievalInput & {
  id?: number;
  filename: string;
  activity?: boolean;
};

parentPort?.on('message', (input: RetrievalRequest) => {
  const id = input.id;
  try {
    const { store, vectors } = storeFor(input.filename);
    // Use the same canonical-content deduplication, facet lexical lane, round-robin
    // neighbor expansion and partial accounting in production and offline tests, while
    // routing semantics through the long-lived revision-aware vector cache.
    const retrievalStore = {
      lexicalSearch: store.lexicalSearch.bind(store),
      semanticSearch: vectors.semanticSearch.bind(vectors),
      physicalPages: store.physicalPages.bind(store),
      adjacentPassages: store.adjacentPassages.bind(store),
    };
    const result = runDocumentaryRetrieval(retrievalStore, input, (key, operation, status, count) => {
      if (input.activity) parentPort!.postMessage({ id, type: 'activity', key, operation, status, count });
    });
    parentPort!.postMessage({ id, ...result });
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : 'documentary_retrieval_failed' });
  }
});
