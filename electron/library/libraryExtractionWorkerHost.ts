// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'node:fs';
import path from 'node:path';
import { backgroundProcess, type BackgroundProcess } from '../workers/backgroundProcess';
import type { LibraryExtractionOptions, LibraryItemRecord } from '@shared/libraryTypes';
import {
  extractLibraryItem,
  type LibraryExtractionProgressHandler,
  type LibraryExtractionResult,
  type LibraryRemoteOcr,
} from './libraryExtractionEngine';
import { LibraryDiskStore } from './libraryStorage';
import { recordEmbeddingTrace } from '../qa/embeddingTrace';

export interface LibraryWorkerExtractionInput {
  item: LibraryItemRecord;
  store: LibraryDiskStore;
  extractionOptions?: Partial<LibraryExtractionOptions>;
  onProgress?: LibraryExtractionProgressHandler;
  signal?: AbortSignal;
  remoteOcr?: LibraryRemoteOcr;
}

const activeWorkers = new Set<BackgroundProcess>();

function workerFile(): string {
  return process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE
    || path.join(__dirname, 'libraryExtractionWorker.js');
}

export function libraryExtractionWorkerAvailable(): boolean {
  return process.env.NODUS_DISABLE_LIBRARY_EXTRACTION_WORKER !== '1' && fs.existsSync(workerFile());
}

function abortError(): Error {
  const error = new Error('Library extraction canceled.');
  error.name = 'AbortError';
  return error;
}

/** Run the complete extraction pipeline in an owned process outside Electron's main process. */
export async function extractLibraryItemInWorker(input: LibraryWorkerExtractionInput): Promise<LibraryExtractionResult> {
  if (!libraryExtractionWorkerAvailable()) {
    if (process.type === 'browser') throw new Error('Library extraction process is unavailable.');
    // Source-level unit tests do not build the worker entry. Production and
    // packaged development builds always include it; retain a functional
    // fallback for those isolated tests and explicit diagnostic opt-outs.
    return extractLibraryItem(input);
  }
  if (input.signal?.aborted) throw abortError();
  const worker = backgroundProcess(workerFile(), 'Nodus document extraction');
  if (process.env.NODUS_EMBEDDING_QA_TRACE === '1') {
    recordEmbeddingTrace({ type: 'extraction-worker', phase: 'requested', itemId: input.item.id, file: workerFile() });
    worker.once('spawn', pid => recordEmbeddingTrace({ type: 'extraction-worker', phase: 'spawned', itemId: input.item.id, pid }));
  }
  activeWorkers.add(worker);
  worker.unref();
  return new Promise<LibraryExtractionResult>((resolve, reject) => {
    let settled = false;
    let forcedTermination: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error, result?: LibraryExtractionResult): void => {
      if (settled) return;
      settled = true;
      if (forcedTermination) clearTimeout(forcedTermination);
      input.signal?.removeEventListener('abort', cancel);
      activeWorkers.delete(worker);
      recordEmbeddingTrace({ type: 'extraction-worker', phase: 'terminating', itemId: input.item.id, error: error?.message });
      void worker.terminate().finally(() => { recordEmbeddingTrace({ type: 'extraction-worker', phase: 'terminated', itemId: input.item.id }); if (error) reject(error); else resolve(result!); });
    };
    const cancel = (): void => {
      worker.postMessage({ kind: 'cancel' });
      // A synchronous PDF renderer cannot receive its cancel message until it
      // returns to the worker event loop. Terminate after a short grace period;
      // published output is staged atomically, so an abrupt stop cannot replace
      // the last readable extraction.
      forcedTermination = setTimeout(() => finish(abortError()), 750);
      forcedTermination.unref?.();
    };
    input.signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', (message: any) => {
      if (message?.kind === 'progress') {
        // A busy renderer keeps reporting pages until it is terminated. Once the work is
        // cancelled or settled nobody is listening; a callback that fails (a pause or a
        // lost lease) stops the extraction instead of escaping as an uncaught exception.
        if (settled || input.signal?.aborted) return;
        try {
          input.onProgress?.(message.progress);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      if (message?.kind === 'remote-ocr') {
        const respond = (value: { text?: string; error?: string }) => {
          if (!settled) worker.postMessage({ kind: 'remote-ocr-result', requestId: message.requestId, ...value });
        };
        if (!input.remoteOcr) {
          respond({ error: 'Remote OCR is not configured.' });
          return;
        }
        void input.remoteOcr({ page: Number(message.page) || 0, image: Buffer.from(message.image), mimeType: message.mimeType }, input.signal)
          .then((text) => respond({ text }), (error) => respond({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      if (message?.kind === 'done') finish(undefined, message.result);
      if (message?.kind === 'error') {
        const error = new Error(message.error ?? 'Library extraction worker failed.');
        error.name = message.name ?? 'Error';
        finish(error);
      }
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(input.signal?.aborted ? abortError() : new Error(`Library extraction worker exited with code ${code}.`));
    });
    worker.postMessage({
      kind: 'run',
      item: input.item,
      root: input.store.root,
      deviceId: input.store.deviceId,
      extractionOptions: input.extractionOptions,
    });
  });
}

export function disposeLibraryExtractionWorkers(): void {
  for (const worker of activeWorkers) void worker.terminate().catch(() => undefined);
  activeWorkers.clear();
}

/** Original page reads use the same owned extractor process without a writable library. */
export async function readResearchOriginalInWorker(input: import('../extraction/researchOriginal').OriginalPageRead, signal?: AbortSignal): Promise<import('../extraction/researchOriginal').OriginalPage[]> {
  return originalWorker('read-original', input, signal);
}
export async function inspectResearchOriginalInWorker(input: { file: string; sha256?: string }, signal?: AbortSignal): Promise<import('../extraction/researchOriginal').OriginalInspection> {
  return originalWorker('inspect-original', input, signal);
}
async function originalWorker<T>(kind: 'read-original' | 'inspect-original', input: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!libraryExtractionWorkerAvailable()) throw new Error('documentary_extraction_worker_unavailable');
  const worker = backgroundProcess(workerFile(), 'Nodus original reading');
  activeWorkers.add(worker);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); signal?.removeEventListener('abort', cancel); activeWorkers.delete(worker);
      void worker.terminate().finally(() => error ? reject(error) : resolve(value!));
    };
    const cancel = () => finish(abortError());
    const deadline = setTimeout(() => finish(new Error('research_original_read_timeout')), 30000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', (message: any) => {
      if (message?.kind === 'done') finish(undefined, message.result);
      if (message?.kind === 'error') finish(new Error(message.error));
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => finish(new Error('research_original_worker_closed')));
    worker.postMessage({ kind, input });
  });
}
