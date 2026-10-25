import os from 'node:os';
import { Semaphore } from '../capabilities/hostLimits';

// Idea extraction, clean-document preparation and chunking share the same CPU budget.
// Provider concurrency is a separate limit: more network requests must not start more
// PDF parsers, renderers and OCR engines on the user's machine.
export const DOCUMENT_WORK_CONCURRENCY = Math.max(1, Math.min(2, os.availableParallelism() - 1));
const slots = new Semaphore(DOCUMENT_WORK_CONCURRENCY);

export async function withDocumentWork<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await slots.acquire(signal);
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    release();
  }
}
