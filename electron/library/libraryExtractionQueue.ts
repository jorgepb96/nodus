import { randomUUID } from 'node:crypto';
import type {
  LibraryExtractionEnqueueResult,
  LibraryExtractionJob,
  LibraryExtractionOptions,
  LibraryExtractionProgress,
  LibraryItemRecord,
} from '@shared/libraryTypes';
import { LibraryCatalog } from './libraryCatalog';
import {
  DEFAULT_LIBRARY_EXTRACTION_OPTIONS,
  extractLibraryItem,
  type LibraryRemoteOcr,
} from './libraryExtractionEngine';
import { LibraryDiskStore } from './libraryStorage';
import { failLibraryExtractionRevision, markLibraryExtractionRevision } from './libraryRevision';
import { disposeLibraryExtractionWorkers, extractLibraryItemInWorker } from './libraryExtractionWorkerHost';
import { logPipelineFailure, logPipelineSuccess, logPipelineWarning } from '../logging/pipelineLogCore';
import { recordEmbeddingTrace } from '../qa/embeddingTrace';
import { withoutDatabaseContext } from '../db/database';

type ExtractFn = typeof extractLibraryItem;

export interface LibraryExtractionQueueOptions {
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  concurrency?: number;
  extract?: ExtractFn;
  remoteOcr?: LibraryRemoteOcr;
  onProgress?: (progress: LibraryExtractionProgress) => void;
}

export class LibraryExtractionQueue {
  private readonly store: LibraryDiskStore;
  private readonly catalog: LibraryCatalog;
  private readonly concurrency: number;
  private readonly extract: ExtractFn;
  private readonly remoteOcr?: LibraryRemoteOcr;
  private readonly onProgress?: (progress: LibraryExtractionProgress) => void;
  private readonly active = new Map<string, AbortController>();
  private scheduled = false;
  private disposed = false;

  constructor(options: LibraryExtractionQueueOptions) {
    this.store = options.store;
    this.catalog = options.catalog;
    this.concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 1)));
    this.extract = options.extract ?? extractLibraryItemInWorker;
    this.remoteOcr = options.remoteOcr;
    this.onProgress = options.onProgress;
    this.catalog.resumeInterruptedExtractionJobs();
    this.schedule();
  }

  private emit(job: LibraryExtractionJob, message: string): void {
    this.onProgress?.({ ...job, message });
  }

  private item(itemId: string): LibraryItemRecord | null {
    const storageId = this.catalog.itemStorageId(itemId);
    if (!storageId) return null;
    const item = this.store.readMaterializedItem(storageId);
    return item && !item.deletedAt ? item : null;
  }

  enqueue(
    itemIds: string[],
    partialOptions: Partial<LibraryExtractionOptions> = {},
    priority = 0,
  ): LibraryExtractionEnqueueResult {
    const options = { ...DEFAULT_LIBRARY_EXTRACTION_OPTIONS, ...partialOptions };
    const result: LibraryExtractionEnqueueResult = { queued: 0, skipped: 0, jobIds: [] };
    const now = new Date().toISOString();
    for (const itemId of [...new Set(itemIds)]) {
      const item = this.item(itemId);
      const active = this.catalog.findActiveExtractionJob(itemId);
      if (!item || active || (!options.force && item.extraction?.status === 'ready')) {
        result.skipped += 1;
        if (active) {
          if (active.status === 'queued' && priority > active.priority) {
            const promoted = { ...active, priority: Math.trunc(priority), updatedAt: now };
            this.catalog.putExtractionJob(promoted);
            this.emit(promoted, 'Documento priorizado para abrirlo en cuanto esté listo.');
          }
          result.jobIds.push(active.id);
        }
        continue;
      }
      const job: LibraryExtractionJob = {
        id: randomUUID(), itemId, status: 'queued', phase: 'queued', progress: 0,
        priority: Math.trunc(priority), options, attempts: 0, error: null,
        createdAt: now, updatedAt: now,
      };
      this.catalog.putExtractionJob(job);
      this.emit(job, 'Documento añadido a la cola de extracción.');
      result.queued += 1;
      result.jobIds.push(job.id);
    }
    this.schedule();
    return result;
  }

  list(): LibraryExtractionJob[] {
    return this.catalog.listExtractionJobs();
  }

  cancel(jobId: string): boolean {
    const job = this.catalog.getExtractionJob(jobId);
    if (!job || !['queued', 'processing'].includes(job.status)) return false;
    this.active.get(jobId)?.abort();
    const canceled: LibraryExtractionJob = {
      ...job, status: 'canceled', phase: job.phase, error: null, updatedAt: new Date().toISOString(),
    };
    this.catalog.putExtractionJob(canceled);
    this.emit(canceled, 'Extracción cancelada.');
    return true;
  }

  retry(jobId: string): boolean {
    const job = this.catalog.getExtractionJob(jobId);
    if (!job || !['failed', 'canceled'].includes(job.status)) return false;
    const queued: LibraryExtractionJob = {
      ...job, status: 'queued', phase: 'queued', progress: 0, error: null, updatedAt: new Date().toISOString(),
    };
    this.catalog.putExtractionJob(queued);
    this.emit(queued, 'Extracción preparada para reintento.');
    this.schedule();
    return true;
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    // The Global Library outlives a vault-scoped IPC invocation. Its progress
    // events must not inherit that invocation's connection after it is closed.
    withoutDatabaseContext(() => setImmediate(() => {
      this.scheduled = false;
      void this.drain();
    }));
  }

  private async drain(): Promise<void> {
    if (this.disposed) return;
    const available = this.concurrency - this.active.size;
    if (available <= 0) return;
    const queued = this.catalog.listExtractionJobs('queued').slice(0, available);
    for (const job of queued) void this.run(job);
  }

  private async run(initial: LibraryExtractionJob): Promise<void> {
    if (this.active.has(initial.id) || this.disposed) return;
    const controller = new AbortController();
    this.active.set(initial.id, controller);
    let job: LibraryExtractionJob = {
      ...initial, status: 'processing', phase: 'analyze', progress: 0.01,
      attempts: initial.attempts + 1, error: null, updatedAt: new Date().toISOString(),
    };
    try {
      this.catalog.putExtractionJob(job);
      recordEmbeddingTrace({ type: 'extraction-queue', phase: 'starting', itemId: job.itemId });
      this.emit(job, 'Iniciando extracción…');
      const item = this.item(job.itemId);
      if (!item) throw new Error('El documento ya no existe en la biblioteca.');
      const current = this.store.readMaterializedItem(item.storageId) ?? item;
      if (current.extraction?.status !== 'processing') {
        const now = new Date().toISOString();
        const processing = this.store.upsertItem({
          ...current,
          contentRevision: markLibraryExtractionRevision(current, 'running', 'A replacement extraction is running.', now),
          extraction: { ...current.extraction, status: 'processing', progress: 0, error: undefined, updatedAt: now },
        }, current.clock.revision, now);
        this.catalog.indexItem(processing, this.store);
      }
      const extractionResult = await this.extract({
        item: this.store.readMaterializedItem(item.storageId) ?? item,
        store: this.store,
        extractionOptions: job.options,
        signal: controller.signal,
        remoteOcr: this.remoteOcr,
        onProgress: (value) => {
          const live = this.catalog.getExtractionJob(job.id);
          if (!live || live.status === 'canceled') return;
          job = {
            ...live, status: 'processing', phase: value.phase,
            progress: Math.max(live.progress, Math.min(0.99, value.progress)), updatedAt: new Date().toISOString(),
          };
          this.catalog.putExtractionJob(job);
          this.emit(job, value.message);
        },
      });
      const live = this.catalog.getExtractionJob(job.id);
      if (live?.status === 'canceled' || controller.signal.aborted) return;
      job = { ...job, status: 'done', phase: 'done', progress: 1, error: null, updatedAt: new Date().toISOString() };
      this.catalog.putExtractionJob(job);
      this.catalog.indexItem(extractionResult.item, this.store);
      this.emit(job, 'Extracción completada.');
      // The green line carries what the quality report measured — words, figures, tables —
      // because "it worked" is not what someone needs when a document looks empty later.
      const quality = extractionResult.quality;
      const context = this.logContext(job);
      if (quality.status === 'passed' && quality.warnings.length === 0) {
        logPipelineSuccess({
          subject: 'subjectLibraryExtraction',
          context,
          message: {
            id: 'documentExtracted',
            params: {
              title: context.documentTitle ?? '',
              words: quality.words,
              figures: quality.figures,
              tables: quality.tables,
            },
          },
        });
      } else {
        // `needs-review` is not a failure, but it is the reason a reader finds an empty
        // section two weeks later, so it is recorded with the report's own warnings.
        logPipelineWarning({
          subject: 'subjectLibraryExtraction',
          code: 'no_legible_text',
          context,
          message: {
            id: 'documentExtractedReview',
            params: {
              title: context.documentTitle ?? '',
              warnings: quality.warnings.length ? quality.warnings.join('; ') : quality.status,
            },
          },
        });
      }
    } catch (error) {
      const live = this.catalog.getExtractionJob(job.id);
      if (controller.signal.aborted || live?.status === 'canceled' || (error instanceof Error && error.name === 'AbortError')) {
        if (live?.status !== 'canceled') {
          job = { ...job, status: 'canceled', error: null, updatedAt: new Date().toISOString() };
          this.catalog.putExtractionJob(job);
          this.emit(job, 'Extracción cancelada.');
        }
        const item = this.item(job.itemId);
        if (item) {
          const current = this.store.readMaterializedItem(item.storageId) ?? item;
          if (current.extraction?.status === 'processing') {
            const now = new Date().toISOString();
            const canceledItem = this.store.upsertItem({
              ...current,
              contentRevision: markLibraryExtractionRevision(current, 'queued', 'Replacement extraction was canceled.', now),
              extraction: { ...current.extraction, status: 'pending', progress: job.progress, error: undefined, updatedAt: now },
            }, current.clock.revision, now);
            this.catalog.indexItem(canceledItem, this.store);
          }
        }
        logPipelineWarning({
          subject: 'subjectLibraryExtraction',
          code: 'cancelled',
          reason: 'reasonCancelled',
          context: this.logContext(job),
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        job = { ...job, status: 'failed', error: message, updatedAt: new Date().toISOString() };
        this.catalog.putExtractionJob(job);
        const item = this.item(job.itemId);
        if (item) {
          const current = this.store.readMaterializedItem(item.storageId) ?? item;
          const failedItem = this.store.upsertItem({
            ...current,
            contentRevision: failLibraryExtractionRevision(current, message, job.updatedAt),
            extraction: {
              ...current.extraction,
              status: 'failed', progress: job.progress, updatedAt: job.updatedAt, error: message,
            },
          }, current.clock.revision, job.updatedAt);
          this.catalog.indexItem(failedItem, this.store);
        }
        this.emit(job, message);
        logPipelineFailure({
          error,
          code: 'extract_failed',
          subject: 'subjectLibraryExtraction',
          context: this.logContext(job),
          detail: message,
        });
      }
    } finally {
      this.active.delete(initial.id);
      this.schedule();
    }
  }

  /**
   * Which document a line is about. The Library is not vault-scoped, so the vault stays empty
   * and the item id plus its title are what make a failure findable later.
   */
  private logContext(job: LibraryExtractionJob): { scope: 'library'; nodusId: string; jobId: string; documentTitle: string | null } {
    const item = this.item(job.itemId);
    return {
      scope: 'library',
      nodusId: job.itemId,
      jobId: job.id,
      documentTitle: item?.metadata?.title ?? null,
    };
  }

  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const started = Date.now();
    while (this.active.size || this.catalog.listExtractionJobs('queued').length) {
      if (Date.now() - started > timeoutMs) throw new Error('La cola de extracción no terminó a tiempo.');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    disposeLibraryExtractionWorkers();
  }
}
