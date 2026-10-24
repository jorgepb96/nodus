import fs from 'node:fs';
import path from 'node:path';
import { backgroundProcess, type BackgroundProcess } from '../workers/backgroundProcess';
import { withDocumentWork } from '../workers/documentWork';
import type { ExtractedDoc, ExtractProgress } from './textExtractor';
import type { FileTextExtractionOptions } from './fileTextExtraction';

const active = new Set<BackgroundProcess>();
let disposed = false;

/** No inline desktop fallback: a missing packaged worker is an observable failure. */
export function extractFileTextInWorker(filePath: string, options: FileTextExtractionOptions = {}): Promise<ExtractedDoc> {
  return withDocumentWork(() => run(filePath, options), options.signal);
}

function run(filePath: string, options: FileTextExtractionOptions): Promise<ExtractedDoc> {
  if (disposed) return Promise.reject(new DOMException('Text extraction stopped.', 'AbortError'));
  const filename = process.env.NODUS_TEXT_EXTRACTION_WORKER_FILE || path.join(__dirname, 'textExtractionWorker.js');
  if (!fs.existsSync(filename)) return Promise.reject(new Error('Text extraction process is unavailable.'));
  options.signal?.throwIfAborted();
  const worker = backgroundProcess(filename, 'Nodus idea text extraction');
  active.add(worker);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, doc?: ExtractedDoc) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', cancel);
      active.delete(worker);
      // Wait for termination before releasing the shared CPU slot.
      void worker.terminate().then(() => error ? reject(error) : resolve(doc!), reject);
    };
    const cancel = () => finish(new DOMException('Text extraction cancelled.', 'AbortError'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', (message: { kind: string; progress?: ExtractProgress; doc?: ExtractedDoc; error?: string; name?: string }) => {
      if (settled || options.signal?.aborted) return;
      if (message.kind === 'progress') {
        try { options.onProgress?.(message.progress!); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      } else if (message.kind === 'done') finish(undefined, message.doc);
      else if (message.kind === 'error') finish(Object.assign(new Error(message.error), { name: message.name || 'Error' }));
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('Text extraction process stopped.')); });
    // Only serializable parser options cross the boundary. No vault or database path does.
    const { ocr, declutter, schemeClassifier, perf } = options;
    worker.postMessage({ filePath, options: { ocr, declutter, schemeClassifier, perf } });
  });
}

export function disposeTextExtractionWorkers(): void {
  // Jobs still waiting for a CPU slot must not start a new child during quit.
  disposed = true;
  for (const worker of active) void worker.terminate().catch(() => undefined);
}
