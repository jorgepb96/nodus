import { retrieveDocumentary, type DocumentaryRetrievalHost, type DocumentaryRetrievalInput } from '@shared/documentaryRetrieval';

export type { DocumentaryRetrievalInput };

export function runDocumentaryRetrieval(store: DocumentaryRetrievalHost, input: DocumentaryRetrievalInput, activity: DocumentaryRetrievalHost['activity'] = () => {}) {
  // Store methods can live on a class prototype and use instance/private state.
  // Forward each call through its owner when adapting to the portable host.
  return retrieveDocumentary(input, {
    lexicalSearch: (...args) => store.lexicalSearch(...args),
    semanticSearch: (...args) => store.semanticSearch(...args),
    physicalPages: (...args) => store.physicalPages(...args),
    adjacentPassages: (...args) => store.adjacentPassages(...args),
    activity,
  });
}
