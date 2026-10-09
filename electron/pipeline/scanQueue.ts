import { assertAcademicAutomation, isManualAcademic } from '../ai/academicMode';
import { v4 as uuid } from 'uuid';
import type { QueueItem, QueueKind, QueueProgress, Work, ModelRef } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { runLightScan } from '../ai/lightScan';
import {
  finishDeepScanPublicationOrdinal,
  issueDeepScanPublicationOrdinal,
  runDeepScan,
} from '../ai/deepScan';
import { runSummaryScan } from '../ai/summaryScan';
import { reprocessConnections } from '../ai/reprocessConnections';
import { listThemeLabels } from '../db/themesRepo';
import { resolveWorkText, resolvedTextStateFromDoc } from '../extraction/textExtractor';
import { getItem } from '../zotero/zoteroClient';
import { clearDeepQueued, setDeepPending, setDeepResult, setResolvedTextState, setSummaryPending } from '../db/worksRepo';
import { failedSummaryWorks, pendingSummaryWorks } from '../db/workSummariesRepo';
import { AiError } from '../ai/aiClient';
import { discoverSemanticBridges } from '../ai/semanticBridges';
import { startEmbedding } from '../ai/embeddingPipeline';
import { startPassageEmbedding } from '../ai/passageEmbeddingPipeline';
import { startPerf } from '../perf';
import { addNotification } from '../notifications';
import { coalesce } from '../util/coalesce';
import { nodiText } from '@shared/nodiNotifications';
import { displayedQueueItem } from '@shared/queueProgress';
import { logPipelineFailure, logPipelineWarning } from '../logging/pipelineLogCore';

type ProgressListener = (p: QueueProgress) => void;

const MAX_RETRIES = 4;
// A deep scan that degraded to abstract-only may simply have raced a just-attached
// file. Re-scan once after this delay so the full text is picked up automatically
// once Zotero has finished landing the attachment.

/**
 * One scale per deep item, shared by the phases that can be measured.
 *
 * Each phase used to report a fraction of itself, so the bar climbed to 100% while
 * reading the pages and fell back to 5% when the analysis started. Extraction owns the
 * first half and the analysis the second, and the phases the model cannot size (the
 * required summary, indexing, publishing) report no fraction at all instead of leaving
 * the previous phase's number parked next to an unrelated label.
 */
const EXTRACTION_SHARE = 0.5;
const ANALYSIS_START = EXTRACTION_SHARE;

class ScanQueue {
  private items: QueueItem[] = [];
  private paused = false;
  /** Set when the queue auto-paused on a misconfiguration; cleared on resume. */
  private pausedReason: string | null = null;
  private running = false;
  private listeners = new Set<ProgressListener>();
  private retries = new Map<string, number>();
  /** Last scan kind dequeued, used to interleave deep/light/summary fairly. */
  private lastKind: 'light' | 'deep' | 'summary' | null = null;
  /** True if at least one deep scan completed since the last reprocess run. */
  private deepSinceReprocess = false;
  /** Guards against concurrent reprocess runs. */
  private reprocessing = false;
  /** Required post-batch work stays visible; the queue is not complete until this clears. */
  private maintenanceRunning = false;
  private maintenanceDetail: string | null = null;
  /** When the pass in flight began, and how many times this step has been attempted. */
  private maintenanceStartedAt: string | null = null;
  private maintenanceAttempt = 0;
  /** Visible, resumable failure from global relation/bridge preparation. */
  private maintenanceError: string | null = null;
  /** Wall-clock bounds for the queue session, including required maintenance. */
  private taskStartedAt: string | null = null;
  private taskFinishedAt: string | null = null;
  /** Running providers cannot always abort an accepted request. Keep those items visible
   * until the current operation really settles instead of creating hidden work. */
  private cancelAfterCurrent = new Set<string>();
  private removeAfterSettle = new Set<string>();
  /** Works whose deep scan completed this cycle, awaiting (re-)indexing on drain. */
  private pendingIndexWorks = new Set<string>();
  /** Works already given a delayed re-scan after degrading to abstract-only, so a
   *  work is retried at most once per session (the re-scan itself is idempotent). */
  /** True when a completed deep scan requested semantic bridge discovery on drain. */
  private bridgeAfterDrain = false;
  /** Terminal jobs already represented in a drain notification. */
  private notifiedTerminalIds = new Set<string>();
  /** Deep items whose analysis already committed in an earlier attempt. A retriable
   *  failure in the chain after it (summary, indexing) retries only the chain: the
   *  analysis is not run again, which for a forced rescan would re-pay every chunk. */
  private deepCommitted = new Set<string>();

  onProgress(cb: ProgressListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Progress is emitted at most this often.
   *
   * Every emit copies the whole queue and structured-clones it across IPC, and
   * emits are driven by work, not by time: once per extracted PDF page, once
   * per AI chunk, once per enqueued item. Resuming a 3,000-work library sent
   * 3,000 messages averaging 1,500 items each — millions of cloned objects
   * before the window had even settled — and a single 400-page PDF late in a
   * batch cloned a 2,500-element array 400 times.
   *
   * Coalescing to a fixed cadence makes that cost proportional to elapsed time
   * instead of to the amount of work done. 250ms is well below the threshold
   * where a progress bar looks unresponsive.
   */
  private static readonly EMIT_INTERVAL_MS = 250;

  private readonly emitter = coalesce(() => {
    const p = this.snapshot();
    for (const l of this.listeners) l(p);
  }, ScanQueue.EMIT_INTERVAL_MS);

  private emit(): void {
    this.emitter.schedule();
  }

  snapshot(): QueueProgress {
    // One pass rather than two filters plus a find over the same array.
    let done = 0;
    let failed = 0;
    for (const item of this.items) {
      if (item.state === 'done') done += 1;
      else if (item.state === 'failed') failed += 1;
    }
    // The work the bar narrates is the oldest one still running, not the newest: see
    // displayedQueueItem. The reader's title and detail line must both come from it.
    const current = displayedQueueItem(this.items);
    return {
      paused: this.paused,
      pausedReason: this.pausedReason,
      maintenanceError: this.maintenanceError,
      maintenanceRunning: this.maintenanceRunning,
      maintenanceDetail: this.maintenanceDetail,
      maintenanceStartedAt: this.maintenanceStartedAt,
      maintenanceAttempt: this.maintenanceAttempt,
      startedAt: this.taskStartedAt,
      finishedAt: this.taskFinishedAt,
      total: this.items.length,
      done,
      failed,
      current: current ? { title: current.title, kind: current.kind } : null,
      items: [...this.items],
    };
  }

  isBusy(): boolean {
    return this.running || this.maintenanceRunning
      || this.items.some((item) => item.state === 'queued' || item.state === 'running');
  }

  private beginTask(): void {
    if (!this.taskStartedAt) this.taskStartedAt = new Date().toISOString();
    this.taskFinishedAt = null;
  }

  private resetTaskTimingIfIdle(): void {
    if (this.items.length === 0 && !this.maintenanceRunning) {
      this.taskStartedAt = null;
      this.taskFinishedAt = null;
    }
  }

  /** Keep active/pending work at the top and completed history at the bottom. */
  private insertPending(item: QueueItem): void {
    const firstTerminal = this.items.findIndex((candidate) =>
      candidate.state === 'done' || candidate.state === 'failed' || candidate.state === 'cancelled'
    );
    this.items.splice(firstTerminal >= 0 ? firstTerminal : this.items.length, 0, item);
  }

  private moveRunningToFront(item: QueueItem): void {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    this.items.splice(index, 1);
    const firstNonRunning = this.items.findIndex((candidate) => candidate.state !== 'running');
    this.items.splice(firstNonRunning >= 0 ? firstNonRunning : this.items.length, 0, item);
  }

  private moveTerminalToEnd(item: QueueItem): void {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    this.items.splice(index, 1);
    this.items.push(item);
  }

  /**
   * The queue is an operational view, not an attempt log. Starting the same step
   * again supersedes its completed/failed/cancelled row; keeping those rows made a
   * successful third attempt still look like two actionable failures.
   */
  private dropSupersededAttempts(nodusId: string, kind: QueueKind): void {
    const staleIds = this.items
      .filter((item) =>
        item.nodus_id === nodusId
        && item.kind === kind
        && (item.state === 'done' || item.state === 'failed' || item.state === 'cancelled')
      )
      .map((item) => item.id);
    if (staleIds.length === 0) return;
    const stale = new Set(staleIds);
    this.items = this.items.filter((item) => !stale.has(item.id));
    for (const id of stale) {
      this.retries.delete(id);
      this.notifiedTerminalIds.delete(id);
    }
  }

  enqueue(nodusId: string, title: string, kind: QueueKind, model?: ModelRef | null, opts?: { chain?: boolean; refresh?: boolean }): void {
    assertAcademicAutomation();
    // Avoid duplicate pending/running jobs for the same work+kind.
    const existing = this.items.find(
      (i) => i.nodus_id === nodusId && i.kind === kind && (i.state === 'queued' || i.state === 'running')
    );
    if (existing) {
      // Preserve a chain request even when the job is already queued.
      if (opts?.chain) existing.chain = true;
      if (opts?.refresh) existing.refresh = true;
      return;
    }
    this.dropSupersededAttempts(nodusId, kind);
    this.beginTask();
    if (kind === 'deep') setDeepPending(nodusId);
    this.insertPending({
      id: uuid(),
      nodus_id: nodusId,
      title,
      kind,
      state: 'queued',
      error: null,
      enqueued_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      model: model ?? null,
      chain: opts?.chain ?? false,
      refresh: opts?.refresh ?? false,
    });
    this.emit();
    void this.run();
  }

  enqueueBridge(model?: ModelRef | null, scopeNodusIds?: string[]): void {
    assertAcademicAutomation();
    const existing = this.items.find((i) => i.kind === 'bridge' && (i.state === 'queued' || i.state === 'running'));
    if (existing) {
      if (!scopeNodusIds) existing.scopeNodusIds = undefined;
      else if (existing.scopeNodusIds) existing.scopeNodusIds = [...new Set([...existing.scopeNodusIds, ...scopeNodusIds])];
      return;
    }
    this.dropSupersededAttempts('', 'bridge');
    this.beginTask();
    this.insertPending({
      id: uuid(),
      nodus_id: '',
      title: 'Descubrir relaciones semánticas',
      kind: 'bridge',
      state: 'queued',
      error: null,
      enqueued_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      model: model ?? null,
      scopeNodusIds,
    });
    this.emit();
    void this.run();
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.pausedReason = null;
    if (this.maintenanceError || this.items.some((item) => item.state === 'queued')) this.beginTask();
    this.emit();
    void this.run();
  }

  cancelItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item && (item.state === 'queued' || item.state === 'paused')) {
      item.state = 'cancelled';
      item.finished_at = new Date().toISOString();
      this.resetPendingStatus(item);
      this.moveTerminalToEnd(item);
      // A cancelled deep item stays in the list as history, so only the marker records
      // that the job is gone: resetPendingStatus cannot, since a rescan of an analysed
      // work never went to 'pending'. Without this the work re-enqueues on every launch.
      if (item.kind === 'deep') this.syncDeepQueued(item.nodus_id);
    }
    this.emit();
    this.notifyDrain();
  }

  moveToTop(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0 || this.items[idx].state !== 'queued') return;
    const [item] = this.items.splice(idx, 1);
    const firstQueued = this.items.findIndex((i) => i.state === 'queued');
    const insertAt = firstQueued >= 0 ? firstQueued : this.items.length;
    this.items.splice(insertAt, 0, item);
    if (item.kind !== 'bridge') {
      const order: Array<'deep' | 'light' | 'summary'> = ['deep', 'light', 'summary'];
      this.lastKind = order[(order.indexOf(item.kind) + order.length - 1) % order.length];
    }
    this.emit();
  }

  clear(): void {
    const dropped: QueueItem[] = [];
    for (const item of this.items) {
      if (item.state === 'queued' || item.state === 'cancelled' || item.state === 'paused') {
        this.resetPendingStatus(item);
        dropped.push(item);
      }
    }
    this.items = this.items.filter((i) => i.state === 'running');
    for (const item of dropped) if (item.kind === 'deep') this.syncDeepQueued(item.nodus_id);
    this.resetTaskTimingIfIdle();
    this.emit();
  }

  /**
   * Remove a pending item immediately. An already accepted provider request remains
   * visible until it settles; only then is the row removed. This prevents the UI from
   * claiming the task stopped while an unabortable network operation is still alive.
   */
  removeItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.state === 'running') {
      this.cancelAfterCurrent.add(item.id);
      this.removeAfterSettle.add(item.id);
      item.detail = 'Deteniendo al terminar la operación actual…';
      item.subPct = null;
      this.emit();
      return;
    }
    this.resetPendingStatus(item);
    this.retries.delete(item.id);
    this.items = this.items.filter((i) => i.id !== id);
    if (item.kind === 'deep') this.syncDeepQueued(item.nodus_id);
    this.resetTaskTimingIfIdle();
    this.emit();
  }

  /**
   * Drop pending work and ask running items to settle after their current operation.
   * Running rows stay visible until that happens, and any already-published deep scan
   * is allowed to complete its integrity maintenance.
   */
  stopAll(): void {
    const dropped = this.items.filter((item) => item.state !== 'running');
    const retained = this.items.filter((item) => item.state === 'running');
    for (const item of dropped) this.resetPendingStatus(item);
    for (const item of retained) {
      this.cancelAfterCurrent.add(item.id);
      this.removeAfterSettle.add(item.id);
      item.detail = 'Deteniendo al terminar la operación actual…';
      item.subPct = null;
    }
    this.items = retained;
    for (const item of dropped) if (item.kind === 'deep') this.syncDeepQueued(item.nodus_id);
    this.retries.clear();
    this.lastKind = null;
    // A running deep scan may already have published data. Its required integrity
    // work is allowed to finish and remains visible instead of being abandoned.
    if (retained.length === 0 && !this.maintenanceRunning) {
      this.pendingIndexWorks.clear();
      this.bridgeAfterDrain = false;
      this.deepSinceReprocess = false;
      this.maintenanceError = null;
      this.maintenanceAttempt = 0;
    }
    this.notifiedTerminalIds.clear();
    this.paused = false;
    this.pausedReason = null;
    this.resetTaskTimingIfIdle();
    this.emit();
  }

  private resetPendingStatus(item: QueueItem): void {
    if (item.kind === 'bridge') return;
    const column = item.kind === 'deep' ? 'deep_status' : item.kind === 'summary' ? 'summary_status' : 'light_status';
    getDb().prepare(`UPDATE works SET ${column} = 'none' WHERE nodus_id = ? AND ${column} = 'pending'`).run(item.nodus_id);
  }

  /**
   * Make works.deep_queued say what this queue says. A rescan of an already-analysed
   * work keeps deep_status='done', so the marker is the only trace a restart can find —
   * and it belongs to the WORK, not to the item. A running job remains visible while its
   * accepted provider operation settles, so its marker must remain live during that
   * interval. Ask the list after every mutation. Public because the upload path runs a
   * deep scan without a queue item and must answer the same question when it ends.
   */
  syncDeepQueued(nodusId: string): void {
    const live = this.items.some(
      (i) => i.nodus_id === nodusId && i.kind === 'deep' && (i.state === 'queued' || i.state === 'running')
    );
    if (!live) clearDeepQueued(nodusId);
  }

  /**
   * Pick the next job by rotating deep/light/summary so no independent scan kind
   * starves the others. Bridge jobs remain a valid fallback without entering rotation.
   */
  private nextQueued(): QueueItem | undefined {
    const queued = this.items.filter((i) => i.state === 'queued');
    if (queued.length === 0) return undefined;
    const order: Array<'deep' | 'light' | 'summary'> = ['deep', 'light', 'summary'];
    const nextIndex = this.lastKind === null ? 0 : (order.indexOf(this.lastKind) + 1) % order.length;
    const pick = queued.find((item) => item.kind === order[nextIndex]) ?? queued[0];
    if (pick.kind !== 'bridge') this.lastKind = pick.kind;
    return pick;
  }

  private async run(): Promise<void> {
    if (isManualAcademic()) return;
    if (this.running || this.paused) return;
    this.running = true;
    try {
      const scheduling = getSettings();
      const concurrency = scheduling.aiConcurrencyMode === 'automatic'
        ? 4
        : Math.max(1, Math.min(8, scheduling.concurrency || 1));
      // Automatic mode keeps several documents ready while the transport scheduler
      // applies the stricter account/model limits and reserves interactive capacity.
      const inFlight: Promise<void>[] = [];
      let next: QueueItem | undefined;
      while (!this.paused && (next = this.nextQueued())) {
        const job = next;
        const promise = this.process(job).finally(() => {
          const idx = inFlight.indexOf(promise);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
        inFlight.push(promise);
        if (inFlight.length >= concurrency) await Promise.race(inFlight);
      }
      await Promise.all(inFlight);
    } finally {
      this.running = false;
    }
    if (!this.paused && this.nextQueued()) {
      void this.run();
    } else if (!this.paused && this.deepSinceReprocess && !this.reprocessing && !this.maintenanceRunning) {
      // Queue drained after deep scans → re-trace relations, (re-)index and
      // discover semantic bridges so the global graph stays connected.
      void this.runPostBatch();
    } else if (!this.paused) {
      this.notifyDrain();
    }
  }

  private notifyDrain(): void {
    const live = this.items.some((item) => item.state === 'queued' || item.state === 'running' || item.state === 'paused');
    if (live || this.maintenanceRunning) return;
    if (this.taskStartedAt && !this.taskFinishedAt) {
      this.taskFinishedAt = new Date().toISOString();
      this.emit();
    }
    const terminal = this.items.filter((item) =>
      (item.state === 'done' || item.state === 'failed') && !this.notifiedTerminalIds.has(item.id)
    );
    if (!terminal.length) return;
    for (const item of terminal) this.notifiedTerminalIds.add(item.id);
    const done = terminal.filter((item) => item.state === 'done').length;
    const failed = terminal.length - done;
    addNotification({
      title: nodiText(failed ? 'scanQueueFailedTitle' : 'scanQueueDoneTitle'),
      body: failed
        ? nodiText('scanQueueFailedBody', { done, failed })
        : nodiText('scanQueueDoneBody', { done }),
      kind: failed ? 'warning' : 'success',
      dedupeKey: `scan-queue:${failed ? 'warning' : 'success'}`,
    });
  }

  /**
   * Post-batch chain that runs once the queue drains after deep scans: re-trace
   * inter-work relations + theme memberships, then discover semantic bridges. Per-work
   * embeddings/passages have already completed before its queue item becomes done.
   * A failure remains visible and resumable; it is never reduced to a console message.
   */
  private async runPostBatch(): Promise<void> {
    if (this.maintenanceRunning) return;
    this.maintenanceRunning = true;
    this.maintenanceDetail = 'Postprocesando relaciones del grafo…';
    // A pass is one model call per batch and reports nothing in between, so the bar
    // needs a clock of its own; the attempt counter is what tells a retry apart from
    // the first run when it fails the same way again.
    this.maintenanceStartedAt = new Date().toISOString();
    this.maintenanceAttempt += 1;
    this.taskFinishedAt = null;
    this.emit();
    const ids = Array.from(this.pendingIndexWorks);
    this.pendingIndexWorks.clear();
    let settledSuccessfully = false;
    try {
      if (ids.length > 0) {
        const rethemed = await this.autoReprocessConnections(ids);
        await this.refreshStaleIdeaEmbeddings(rethemed);
      } else this.deepSinceReprocess = false;
      this.maintenanceError = null;
      if (this.bridgeAfterDrain) {
        this.bridgeAfterDrain = false;
        this.maintenanceDetail = 'Preparando descubrimiento de puentes…';
        this.emit();
        if (ids.length > 0) this.maybeEnqueueBridge(ids);
      }
      settledSuccessfully = true;
      this.maintenanceAttempt = 0;
    } catch (error) {
      for (const id of ids) this.pendingIndexWorks.add(id);
      this.deepSinceReprocess = true;
      this.maintenanceError = error instanceof Error ? error.message : String(error);
      addNotification({
        title: nodiText('graphMaintenanceFailedTitle'),
        body: nodiText('graphMaintenanceFailedBody', { error: this.maintenanceError }),
        kind: 'warning',
        dedupeKey: 'knowledge-connections:error',
      });
      this.taskFinishedAt = new Date().toISOString();
    } finally {
      this.maintenanceRunning = false;
      this.maintenanceDetail = null;
      this.maintenanceStartedAt = null;
      this.emit();
      if (settledSuccessfully) this.notifyDrain();
    }
  }

  /**
   * Chain the remaining pipeline steps after a deep scan finishes: regenerate the
   * orientation summary (so it reflects the fresh analysis), schedule the work for
   * re-indexing, and arm bridge discovery for the next drain. `item.chain` forces
   * the chain even when the auto-* settings are off (used by "Procesar todo").
   */
  private async chainAfterDeep(work: Work, item: QueueItem): Promise<void> {
    const settings = getSettings();
    this.pendingIndexWorks.add(work.nodus_id);
    if (this.cancelAfterCurrent.has(item.id)) return;
    if (item.chain || settings.autoSummaryAfterDeep) {
      item.detail = 'Generando el resumen requerido…';
      // These steps have no measurable fraction: the analysis percentage ends with the
      // analysis instead of staying parked next to a label about something else.
      item.subPct = null;
      this.emit();
      setSummaryPending(work.nodus_id);
      await runSummaryScan(work, item.model ?? null, { force: item.refresh });
    }
    if (this.cancelAfterCurrent.has(item.id)) return;
    if (this.embeddingConfigured()) {
      item.detail = 'Indexando ideas y pasajes requeridos…';
      item.subPct = null;
      this.emit();
      await startEmbedding([work.nodus_id]);
      if (this.cancelAfterCurrent.has(item.id)) return;
      await startPassageEmbedding([work.nodus_id]);
    } else {
      item.detail = 'Modo léxico: no hay proveedor de embeddings configurado.';
      item.subPct = null;
      this.emit();
    }
    if (!this.cancelAfterCurrent.has(item.id) && (item.chain || settings.autoBridgeAfterQueue)) {
      this.bridgeAfterDrain = true;
    }
  }

  /**
   * Automatically re-run connection reprocessing (themes + inter-work idea
   * relations) after a batch of deep scans completes. Runs once per drain cycle.
   */
  private async autoReprocessConnections(nodusIds: string[]): Promise<string[]> {
    if (this.reprocessing) return [];
    this.reprocessing = true;
    try {
      const result = await reprocessConnections({ relations: true, nodusIds }, null, (progress) => {
        this.maintenanceDetail = `${progress.label} (${progress.current}/${progress.total})`;
        this.emit();
      });
      if (result.relationsAdded > 0 || result.newThemes > 0) {
        addNotification({
          title: nodiText('connectionsTitle'),
          body: nodiText('connectionsBody', { relations: result.relationsAdded, themes: result.newThemes }),
          kind: 'info',
          dedupeKey: 'knowledge-connections',
        });
      }
      this.deepSinceReprocess = false;
      return result.rethemedIdeaIds ?? [];
    } finally {
      this.reprocessing = false;
    }
  }

  /**
   * Re-embed ideas whose theme links the reprocess pass just rewrote. An idea's
   * embedding text includes its theme labels, so the per-work embeddings from
   * chainAfterDeep go stale the moment reprocessConnections re-themes them — and
   * not only in the scanned works: fused ideas shared with other works change too.
   * Only the re-themed ideas: a library-wide pass would also re-embed every idea an
   * earlier embedding model produced. Runs before bridge discovery so bridges compare
   * fresh vectors. Non-fatal: the pipeline logs its own failure and the "Incomplete"
   * filter still shows the stale works, whereas failing here would make the retry
   * redo the whole model-driven reprocess pass.
   */
  private async refreshStaleIdeaEmbeddings(ideaIds: readonly string[]): Promise<void> {
    if (!ideaIds.length || !this.embeddingConfigured()) return;
    this.maintenanceDetail = 'Actualizando el índice de ideas…';
    this.emit();
    try {
      await startEmbedding(undefined, { ideaIds });
    } catch {
      // Already logged by the embedding pipeline.
    }
  }

  /** True when an embedding provider + model are configured for indexing. */
  private embeddingConfigured(): boolean {
    const settings = getSettings();
    return settings.embeddingProvider === 'nodus'
      || settings.embeddingProvider === 'ollama'
      || settings.embeddingProvider === 'lmstudio'
      || settings.providerKeys[settings.embeddingProvider] === true;
  }

  /** Enqueue semantic bridge discovery once indexing is done, if configured. */
  private maybeEnqueueBridge(nodusIds: string[]): boolean {
    if (!this.embeddingConfigured()) return false;
    const settings = getSettings();
    this.enqueueBridge(settings.relationModel ?? settings.fusionModel ?? settings.synthesisModel ?? null, nodusIds);
    return true;
  }

  private async process(item: QueueItem): Promise<void> {
    item.state = 'running';
    item.started_at ??= new Date().toISOString();
    item.finished_at = null;
    this.moveRunningToFront(item);
    this.emit();
    if (item.kind === 'bridge') {
      try {
        await this.doBridge(item);
        item.state = this.cancelAfterCurrent.has(item.id) ? 'cancelled' : 'done';
        item.error = null;
      } catch (e) {
        item.state = 'failed';
        item.error = (e as Error).message;
      }
      item.finished_at = new Date().toISOString();
      if (this.removeAfterSettle.has(item.id)) this.items = this.items.filter((candidate) => candidate.id !== item.id);
      else this.moveTerminalToEnd(item);
      this.cancelAfterCurrent.delete(item.id);
      this.removeAfterSettle.delete(item.id);
      this.emit();
      return;
    }
    const work = getWorkById(item.nodus_id);
    if (!work) {
      item.state = 'failed';
      item.error = 'Obra no encontrada';
      item.finished_at = new Date().toISOString();
      // No marker to settle: the row this item names is gone from works entirely.
      if (this.removeAfterSettle.has(item.id)) this.items = this.items.filter((candidate) => candidate.id !== item.id);
      else this.moveTerminalToEnd(item);
      this.cancelAfterCurrent.delete(item.id);
      this.removeAfterSettle.delete(item.id);
      this.emit();
      return;
    }
    try {
      if (item.kind === 'light') {
        await this.doLight(work, item);
      } else if (item.kind === 'deep') {
        if (!this.deepCommitted.has(item.id)) {
          await this.doDeep(work, item);
          this.deepCommitted.add(item.id);
        }
        const committedWork = getWorkById(work.nodus_id) ?? work;
        await this.chainAfterDeep(committedWork, item);
        this.deepSinceReprocess = true;
      } else {
        await this.doSummary(work, item);
      }
      item.state = this.cancelAfterCurrent.has(item.id) ? 'cancelled' : 'done';
      item.error = null;
      item.detail = null;
      item.subPct = null;
    } catch (e) {
      if (this.cancelAfterCurrent.has(item.id)) {
        item.state = 'cancelled';
        item.error = null;
        logPipelineWarning({
          subject: 'subjectScan',
          code: 'cancelled',
          reason: 'reasonCancelled',
          context: { scope: 'scan', nodusId: item.nodus_id, documentTitle: item.title, jobId: item.id },
        });
      // A misconfiguration (no model / no key / invalid key) fails identically for
      // every job, so pause the queue once and surface it instead of marking the
      // entire library as failed. The job stays queued and resumes after the fix.
      } else if (e instanceof AiError && e.config) {
        item.state = 'queued';
        item.error = null;
        this.pausedReason = (e as Error).message;
        console.error(`[scanQueue] configuración: ${this.pausedReason} — cola en pausa`);
        logPipelineFailure({
          error: e,
          code: 'queue_paused',
          subject: 'subjectScan',
          context: { scope: 'scan', nodusId: item.nodus_id, documentTitle: item.title, jobId: item.id },
          detail: this.pausedReason,
        });
        this.pause();
        return;
      } else {
        const retriable = e instanceof AiError && e.retriable;
        const attempts = (this.retries.get(item.id) ?? 0) + 1;
        this.retries.set(item.id, attempts);
        if (retriable && attempts <= MAX_RETRIES) {
          const backoff = 2000 * 2 ** (attempts - 1);
          item.state = 'queued';
          item.finished_at = null;
          item.error = `Reintentando (${attempts}/${MAX_RETRIES})…`;
          this.emit();
          logPipelineWarning({
            subject: 'subjectScan',
            code: 'unknown',
            message: { id: 'logRetry', params: { subject: { id: 'subjectScan' }, attempt: attempts + 1, max: MAX_RETRIES + 1 } },
            context: { scope: 'scan', nodusId: item.nodus_id, documentTitle: item.title, jobId: item.id },
            detail: (e as Error).message,
          });
          await delay(backoff);
        } else {
          item.state = 'failed';
          item.error = (e as Error).message;
          console.error(`[scanQueue] ${item.kind} falló: ${item.title} -> ${(e as Error).message}`);
          logPipelineFailure({
            error: e,
            code: 'index_failed',
            subject: 'subjectScan',
            context: { scope: 'scan', nodusId: item.nodus_id, documentTitle: item.title, jobId: item.id },
            detail: (e as Error).message,
          });
          // Persist deep-scan failure so it's visible in the library and not
          // re-enqueued forever by resumePending(). (Light scans already persist.)
          if (item.kind === 'deep' && !(item.refresh && work.deep_status === 'done')) {
            setDeepResult(work.nodus_id, 'failed', null, null, (e as Error).message);
          }
        }
      }
    }
    // The marker follows the job's outcome, never the database write: an abandoned scan
    // writes its result too, and by then the work may already hold a queued replacement.
    if (item.kind === 'deep' && (item.state === 'done' || item.state === 'failed')) this.syncDeepQueued(work.nodus_id);
    if (item.state === 'done' || item.state === 'failed' || item.state === 'cancelled') {
      this.deepCommitted.delete(item.id);
      item.finished_at = new Date().toISOString();
      if (item.kind === 'deep') this.syncDeepQueued(work.nodus_id);
      if (this.removeAfterSettle.has(item.id)) this.items = this.items.filter((candidate) => candidate.id !== item.id);
      else this.moveTerminalToEnd(item);
      this.cancelAfterCurrent.delete(item.id);
      this.removeAfterSettle.delete(item.id);
    }
    this.emit();
  }

  private async doLight(work: Work, item: QueueItem): Promise<void> {
    const settings = getSettings();
    let abstract: string | null = null;
    try {
      const item = await getItem(settings.zoteroUserId, work.zotero_key);
      abstract = item?.abstract ?? null;
    } catch {
      abstract = null;
    }
    // When the user has locked the main themes, constrain assignment to that set.
    const lockedLabels = settings.themesLocked ? listThemeLabels() : null;
    await runLightScan(work, abstract, item.model ?? null, { lockedLabels, force: item.refresh });
  }

  private async doDeep(
    work: Work,
    queueItem: QueueItem
  ): Promise<void> {
    // Reserve before any asynchronous metadata/PDF work. Faster extraction of a later
    // paper therefore cannot overtake an earlier queue item when the graph is committed.
    const publicationOrdinal = issueDeepScanPublicationOrdinal();
    const settings = getSettings();
    const perf = { nodusId: work.nodus_id, title: work.title };
    try {
      let abstract: string | null = null;
      const metadataDone = startPerf('abstract/Zotero metadata', perf);
      try {
        const item = await getItem(settings.zoteroUserId, work.zotero_key);
        abstract = item?.abstract ?? null;
        metadataDone({ abstract: Boolean(abstract) });
      } catch (e) {
        metadataDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        /* offline: rely on stored attachments */
      }
      const doc = await resolveWorkText(
        settings.zoteroUserId,
        work.zotero_key,
        settings.zoteroStoragePath,
        abstract,
        work.doi,
        {
          unpaywallEmail: settings.unpaywallEmail,
          preferZoteroFulltext: settings.preferZoteroFulltext,
          ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
          perf,
          onProgress: (p) => {
            if (this.cancelAfterCurrent.has(queueItem.id)) return;
            queueItem.detail = p.detail;
            // A step with no fraction of its own (checking the Zotero index, the OCR
            // pass over problem pages) leaves the bar without a percentage instead of
            // showing one it cannot back.
            queueItem.subPct = p.pct == null ? null : EXTRACTION_SHARE * p.pct;
            this.emit();
          },
        },
        work.item_type
      );
      setResolvedTextState(work.nodus_id, resolvedTextStateFromDoc(doc));
      if (!this.cancelAfterCurrent.has(queueItem.id)) {
        queueItem.detail = 'Analizando con IA…';
        queueItem.subPct = ANALYSIS_START;
        this.emit();
      }
      await runDeepScan(work, doc, queueItem.model ?? null, (p) => {
        if (this.cancelAfterCurrent.has(queueItem.id)) return;
        queueItem.detail = p.detail;
        queueItem.subPct = ANALYSIS_START + (1 - ANALYSIS_START) * (p.pct ?? 0);
        this.emit();
      }, publicationOrdinal, { force: queueItem.refresh });
    } finally {
      // `runDeepScan` normally advances it; this also covers extraction failures.
      finishDeepScanPublicationOrdinal(publicationOrdinal);
    }
  }

  private async doSummary(work: Work, item: QueueItem): Promise<void> {
    item.detail = 'Resumiendo…';
    item.subPct = null;
    this.emit();
    await runSummaryScan(work, item.model ?? null, { force: item.refresh });
  }

  private async doBridge(item: QueueItem): Promise<void> {
    item.detail = 'Escaneando pares semánticos…';
    item.subPct = null;
    this.emit();
    const result = await discoverSemanticBridges(item.model ?? null, (p) => {
      if (this.cancelAfterCurrent.has(item.id)) return;
      if (p.phase === 'validation') {
        item.detail = `${p.label} (${p.current}/${p.total})`;
        item.subPct = p.total > 0 ? p.current / p.total : null;
      } else if (p.phase === 'scan') {
        item.detail = p.label;
        item.subPct = null;
      } else if (p.phase === 'done') {
        item.detail = p.label;
        item.subPct = 1;
      }
      this.emit();
    }, item.scopeNodusIds);
    if (!this.cancelAfterCurrent.has(item.id)) {
      item.detail = `${result.added} nuevas · ${result.validated} validados · ${result.candidatesScanned} escaneados`;
      item.subPct = 1;
      this.emit();
    }
    if (result.added > 0) {
      addNotification({
        title: nodiText('bridgesTitle'),
        body: nodiText('bridgesBody', { added: result.added, scanned: result.candidatesScanned }),
        kind: 'info',
        dedupeKey: 'semantic-bridges',
      });
    }
  }

  /**
   * Re-enqueue works whose last scan failed — manual recovery after the user fixes
   * the configuration (e.g. selects a model). Resets them to pending and resumes.
   */
  retryFailed(): void {
    const db = getDb();
    for (const item of this.items) {
      if (item.kind === 'bridge' && item.state === 'failed') {
        item.state = 'queued';
        item.error = null;
        item.finished_at = null;
      }
    }
    const failedLight = db
      .prepare("SELECT nodus_id, title FROM works WHERE light_status = 'failed' AND archived = 0")
      .all() as { nodus_id: string; title: string }[];
    // A work that still holds a committed analysis records its failed replacement in
    // deep_error and keeps deep_status='done' — the Library counts it as failed, so
    // this must find it too. Its state is set by enqueue(); do not overwrite it here,
    // or the retry would hide the very analysis the failure was allowed to preserve.
    //
    // The read-tag/manual guard stays OUTSIDE that OR on purpose: every failure writes
    // deep_error, including the ones migration 160 backfilled from old notes, so an
    // unguarded clause would turn this button into a full-library rescan. Degraded works
    // that were never read-tagged are recovered by "rescan degraded", which is the
    // action that queued them in the first place.
    const failedDeep = db
      .prepare(
        `SELECT nodus_id, title FROM works
          WHERE archived = 0
            AND (deep_status = 'failed' OR deep_error IS NOT NULL)
            AND (read_tag = 1 OR manual_deep = 1)`
      )
      .all() as { nodus_id: string; title: string }[];
    const failedSummary = failedSummaryWorks();
    db.prepare("UPDATE works SET light_status = 'pending' WHERE light_status = 'failed' AND archived = 0").run();
    for (const w of failedSummary) setSummaryPending(w.nodus_id);
    for (const w of failedDeep) this.enqueue(w.nodus_id, w.title, 'deep');
    for (const w of failedLight) this.enqueue(w.nodus_id, w.title, 'light');
    for (const w of failedSummary) this.enqueue(w.nodus_id, w.title, 'summary');
    if (this.maintenanceError) this.maintenanceError = null;
    this.resume();
  }

  /** Re-enqueue any work left in a pending state, so scans resume after restart. */
  resumePending(): void {
    if (isManualAcademic()) return;
    const db = getDb();
    const pendingLight = db
      .prepare("SELECT nodus_id, title FROM works WHERE light_status = 'pending' AND archived = 0")
      .all() as { nodus_id: string; title: string }[];
    // deep_queued covers the rescans that deep_status can no longer describe: a work
    // with a committed analysis stays 'done' while its replacement is queued. That half
    // carries no read-tag/manual guard on purpose: the work is here because the user
    // queued it, and enqueue() asks for no eligibility either — losing a job the user
    // asked for is the failure this whole marker exists to prevent.
    const pendingDeep = db
      .prepare(
        `SELECT nodus_id, title FROM works
          WHERE archived = 0
            AND ((deep_status = 'pending' AND (read_tag = 1 OR manual_deep = 1)) OR deep_queued = 1)`
      )
      .all() as { nodus_id: string; title: string }[];
    const pendingSummary = pendingSummaryWorks();
    for (const w of pendingDeep) this.enqueue(w.nodus_id, w.title, 'deep');
    for (const w of pendingLight) this.enqueue(w.nodus_id, w.title, 'light');
    for (const w of pendingSummary) this.enqueue(w.nodus_id, w.title, 'summary');
  }
}

function getWorkById(nodusId: string): Work | null {
  const row = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as Work | undefined;
  return row ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const scanQueue = new ScanQueue();
