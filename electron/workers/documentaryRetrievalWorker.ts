import { parentPort } from './backgroundParentPort';
import { DocumentaryStore } from '../db/documentaryStore';
import { runDocumentaryRetrieval, type DocumentaryRetrievalInput } from '../db/documentaryRetrieval';

parentPort?.once('message', (input: DocumentaryRetrievalInput & { filename: string; activity?: boolean }) => {
  const store = new DocumentaryStore(input.filename, true);
  try {
    const result = runDocumentaryRetrieval(store, input, (key, operation, status, count) => {
      if (input.activity) parentPort!.postMessage({ type: 'activity', key, operation, status, count });
    });
    parentPort!.postMessage(result);
  } catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : 'documentary_retrieval_failed' }); }
  finally { store.close(); }
});
