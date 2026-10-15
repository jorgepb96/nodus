import {retrieveDocumentary} from '@shared/documentaryRetrieval';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from './backgroundParentPort';
import { DocumentaryStore } from '../db/documentaryStore';
import { DocumentaryVectorCache } from '../db/documentaryVectorCache';
import { type ResearchDocumentRead, type RetrievalSettings } from '@shared/researchCorpus';

/** One process serves every retrieval of the session (documentaryPreparation.ts keeps it), so the
 *  read-only store stays open and its vectors stay cached between searches. It was a new process,
 *  a new connection and a scan of every vector in scope per search: ~1 s per search on a real
 *  store, several searches per research turn. */
const opened = new Map<string, { store: DocumentaryStore; vectors: DocumentaryVectorCache; identity: string }>();

/** Which file is at `filename` now: a restore or reset replaces the store under an open connection. */
function fileIdentity(filename: string): string {
  const stat = fs.statSync(filename);
  return `${stat.dev}:${stat.ino}`;
}

function storeFor(filename: string): { store: DocumentaryStore; vectors: DocumentaryVectorCache } {
  const resolved = path.resolve(filename);
  const identity = fileIdentity(resolved);
  const existing = opened.get(resolved);
  if (existing?.store.db.open && existing.identity === identity) return existing;
  if (existing) { existing.vectors.clear(); try { existing.store.close(); } catch { /* already closed */ } opened.delete(resolved); }
  const store = new DocumentaryStore(resolved, true);
  const entry = { store, vectors: new DocumentaryVectorCache(store), identity };
  opened.set(resolved, entry);
  return entry;
}

parentPort?.on('message', (input: { id?: number; filename: string; query: string; lexicalKeys: string[]; vectorKeys: string[]; vector: number[] | null; settings: RetrievalSettings; threshold: number; activity?: boolean; read?: ResearchDocumentRead }) => {
  const id = input.id;
  try {
    const { store, vectors } = storeFor(input.filename);
    const activity = (key: string, operation: 'lexical' | 'semantic' | 'expand' | 'pages' | 'references', status: 'active' | 'completed', count?: number) => {
      if (input.activity) parentPort!.postMessage({ id, type: 'activity', key, operation, status, count });
    };
    const result=retrieveDocumentary(input,{lexicalSearch:(...args)=>store.lexicalSearch(...args),semanticSearch:(...args)=>vectors.semanticSearch(...args),physicalPages:(...args)=>store.physicalPages(...args),adjacentPassages:(...args)=>store.adjacentPassages(...args),activity});
    parentPort!.postMessage({id,...result});
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : 'documentary_retrieval_failed' }); }
});
