import type {
  AudioEntityKind,
  AudioSegment,
  AudioSegmentRequest,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ImmersionBuildProgress,
  ImmersionRequest,
  ImmersionScope,
  ImmersionSession,
  WritingWorkshopSavedDraft,
  ToolkitJobRequest,
  ToolkitJobProgress,
  ToolkitJobResult,
  TranslateJobRequest,
  TranslateJobProgress,
  TranslateJobResult,
} from '@shared/types';
import type { DatabaseAttachment, DatabaseRow } from '@shared/databases';
import { t } from './i18n';

export type BackgroundJobStatus = 'running' | 'completed' | 'failed';

/**
 * Renderer-wide snapshot of a long generation. The store lives outside React,
 * so changing views only detaches a subscriber; it never owns or cancels the
 * underlying Electron request.
 */
export interface BackgroundJob<Request, Progress, Result> {
  id: string;
  key: string;
  request: Request;
  status: BackgroundJobStatus;
  progress: Progress | null;
  result: Result | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type AnyJob = BackgroundJob<unknown, unknown, unknown>;
type AnyListener = (job: AnyJob | null) => void;

const jobs = new Map<string, AnyJob>();
const listeners = new Map<string, Set<AnyListener>>();
let jobSequence = 0;
const allListeners = new Set<(jobs: AnyJob[]) => void>();

/** Observe every renderer-owned job without taking ownership of its lifecycle. */
export function subscribeBackgroundJobs(listener: (jobs: AnyJob[]) => void): () => void {
  allListeners.add(listener);
  listener([...jobs.values()]);
  return () => { allListeners.delete(listener); };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notify(key: string): void {
  const snapshot = jobs.get(key) ?? null;
  for (const listener of listeners.get(key) ?? []) listener(snapshot);
  for (const listener of allListeners) listener([...jobs.values()]);
}

function replaceJob(job: AnyJob): void {
  jobs.set(job.key, job);
  notify(job.key);
}

export function getBackgroundJob<Request, Progress, Result>(key: string): BackgroundJob<Request, Progress, Result> | null {
  return (jobs.get(key) as BackgroundJob<Request, Progress, Result> | undefined) ?? null;
}

export function findLatestBackgroundJob<Request, Progress, Result>(
  keyPrefix: string
): BackgroundJob<Request, Progress, Result> | null {
  const matches = [...jobs.values()]
    .filter((job) => job.key.startsWith(keyPrefix))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (matches[0] as BackgroundJob<Request, Progress, Result> | undefined) ?? null;
}

/** Subscribe and immediately receive the current snapshot, including completed jobs. */
export function subscribeBackgroundJob<Request, Progress, Result>(
  key: string,
  listener: (job: BackgroundJob<Request, Progress, Result> | null) => void
): () => void {
  const wrapped = listener as AnyListener;
  const bucket = listeners.get(key) ?? new Set<AnyListener>();
  bucket.add(wrapped);
  listeners.set(key, bucket);
  listener(getBackgroundJob<Request, Progress, Result>(key));
  return () => {
    const current = listeners.get(key);
    current?.delete(wrapped);
    if (current?.size === 0) listeners.delete(key);
  };
}

/** Completed/failed jobs can be dismissed; running work is deliberately retained. */
export function clearBackgroundJob(key: string, expectedId?: string): boolean {
  const current = jobs.get(key);
  if (!current || current.status === 'running' || (expectedId && current.id !== expectedId)) return false;
  jobs.delete(key);
  notify(key);
  return true;
}

export function startBackgroundJob<Request, Progress, Result>(
  key: string,
  request: Request,
  run: (request: Request, onProgress: (progress: Progress) => void) => Promise<Result>
): BackgroundJob<Request, Progress, Result> {
  const existing = getBackgroundJob<Request, Progress, Result>(key);
  if (existing?.status === 'running') return existing;

  const job: BackgroundJob<Request, Progress, Result> = {
    id: `${Date.now()}-${++jobSequence}`,
    key,
    request,
    status: 'running',
    progress: null,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  replaceJob(job as AnyJob);

  void Promise.resolve()
    .then(() =>
      run(request, (progress) => {
        const current = getBackgroundJob<Request, Progress, Result>(key);
        if (!current || current.id !== job.id || current.status !== 'running') return;
        replaceJob({ ...current, progress } as AnyJob);
      })
    )
    .then((result) => {
      const current = getBackgroundJob<Request, Progress, Result>(key);
      if (!current || current.id !== job.id) return;
      replaceJob({
        ...current,
        status: 'completed',
        result,
        error: null,
        finishedAt: new Date().toISOString(),
      } as AnyJob);
    })
    .catch((error: unknown) => {
      const current = getBackgroundJob<Request, Progress, Result>(key);
      if (!current || current.id !== job.id) return;
      replaceJob({
        ...current,
        status: 'failed',
        error: messageFromError(error),
        finishedAt: new Date().toISOString(),
      } as AnyJob);
    });

  return job;
}

export const IMMERSION_GENERATION_JOB_KEY = 'immersion:generate';

export interface ImmersionGenerationInput {
  scope: ImmersionScope;
  request: ImmersionRequest;
}

export type ImmersionGenerationJob = BackgroundJob<ImmersionGenerationInput, ImmersionBuildProgress, ImmersionSession>;

export function startImmersionGeneration(input: ImmersionGenerationInput): ImmersionGenerationJob {
  return startBackgroundJob(IMMERSION_GENERATION_JOB_KEY, input, ({ request }, onProgress) =>
    window.nodus.generateImmersionSession(request, { onProgress })
  );
}

// ── Nodus Toolkit (Convert) ──────────────────────────────────────────────────
// A single active conversion job at a time, under a shared key, so its progress
// survives navigation and the Convert view re-subscribes on return.
export const TOOLKIT_JOB_KEY = 'toolkit:convert';

export type ToolkitConvertJob = BackgroundJob<ToolkitJobRequest, ToolkitJobProgress, ToolkitJobResult>;

export function startToolkitJob(request: ToolkitJobRequest): ToolkitConvertJob {
  return startBackgroundJob(TOOLKIT_JOB_KEY, request, (currentRequest, onProgress) =>
    window.nodus.runToolkitJob(currentRequest, { onProgress }),
  );
}

// ── Nodus Translate ──────────────────────────────────────────────────────────
export const TRANSLATE_JOB_KEY = 'toolkit:translate';

export type ToolkitTranslateJob = BackgroundJob<TranslateJobRequest, TranslateJobProgress, TranslateJobResult>;

export function startTranslateJob(request: TranslateJobRequest): ToolkitTranslateJob {
  return startBackgroundJob(TRANSLATE_JOB_KEY, request, (currentRequest, onProgress) =>
    window.nodus.runTranslateJob(currentRequest, { onProgress }),
  );
}

// ── Database AI cells ───────────────────────────────────────────────────────
// Each cell has its own renderer-wide key. The actual generation runs through
// Electron's main process; keeping the promise snapshot here lets any remounted
// database view re-attach without starting the request again.

export interface DatabaseAiCellJobRequest {
  rowId: string;
  columnId: string;
}

export interface DatabaseColumnJobRequest {
  databaseId: string;
  columnId: string;
}

export interface DatabaseColumnJobProgress {
  done: number;
  total: number;
}

export function databaseAiTextCellJobKey(rowId: string, columnId: string): string {
  return `database:ai:text:${rowId}:${columnId}`;
}

export function databaseAiImageCellJobKey(rowId: string, columnId: string): string {
  return `database:ai:image:${rowId}:${columnId}`;
}

export type DatabaseAiTextCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, string>;
export type DatabaseAiImageCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, DatabaseAttachment>;
export type DatabaseComparisonCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, DatabaseRow | null>;
export type DatabaseAiColumnJob = BackgroundJob<DatabaseColumnJobRequest, DatabaseColumnJobProgress, { done: number; failed: number }>;
export type DatabaseComparisonColumnJob = BackgroundJob<DatabaseColumnJobRequest, DatabaseColumnJobProgress, { done: number }>;

export function startDatabaseAiTextCellJob(rowId: string, columnId: string): DatabaseAiTextCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseAiTextCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.runDatabaseAiCell(current.rowId, current.columnId)
  );
}

export function startDatabaseAiImageCellJob(rowId: string, columnId: string): DatabaseAiImageCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseAiImageCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.generateDatabaseAiImage(current.rowId, current.columnId)
  );
}

export function databaseComparisonCellJobKey(rowId: string, columnId: string): string {
  return `database:comparison:cell:${rowId}:${columnId}`;
}

export function databaseComparisonColumnJobKey(databaseId: string, columnId: string): string {
  return `database:comparison:column:${databaseId}:${columnId}`;
}

export function databaseAiTextColumnJobKey(databaseId: string, columnId: string): string {
  return `database:ai:text:column:${databaseId}:${columnId}`;
}

export function databaseAiImageColumnJobKey(databaseId: string, columnId: string): string {
  return `database:ai:image:column:${databaseId}:${columnId}`;
}

export function startDatabaseComparisonCellJob(rowId: string, columnId: string): DatabaseComparisonCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseComparisonCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.runDatabaseComparisonCell(current.rowId, current.columnId)
  );
}

export function startDatabaseComparisonColumnJob(databaseId: string, columnId: string): DatabaseComparisonColumnJob {
  const request = { databaseId, columnId };
  return startBackgroundJob(databaseComparisonColumnJobKey(databaseId, columnId), request, async (current, onProgress) => {
    const unsubscribe = window.nodus.onDatabaseComparisonProgress((progress) => {
      if (progress.databaseId === current.databaseId && progress.columnId === current.columnId) {
        onProgress({ done: progress.done, total: progress.total });
      }
    });
    try {
      return await window.nodus.runDatabaseComparisonColumn(current.databaseId, current.columnId);
    } finally {
      unsubscribe();
    }
  });
}

function startDatabaseAiColumnJob(
  key: string,
  databaseId: string,
  columnId: string,
  run: (databaseId: string, columnId: string) => Promise<{ done: number; failed: number }>
): DatabaseAiColumnJob {
  const request = { databaseId, columnId };
  return startBackgroundJob(key, request, async (current, onProgress) => {
    const unsubscribe = window.nodus.onDatabaseAiProgress((progress) => {
      if (progress.databaseId === current.databaseId && progress.columnId === current.columnId) {
        onProgress({ done: progress.done, total: progress.total });
      }
    });
    try {
      return await run(current.databaseId, current.columnId);
    } finally {
      unsubscribe();
    }
  });
}

export function startDatabaseAiTextColumnJob(databaseId: string, columnId: string): DatabaseAiColumnJob {
  return startDatabaseAiColumnJob(
    databaseAiTextColumnJobKey(databaseId, columnId),
    databaseId,
    columnId,
    (dbId, colId) => window.nodus.runDatabaseAiColumn(dbId, colId)
  );
}

export function startDatabaseAiImageColumnJob(databaseId: string, columnId: string): DatabaseAiColumnJob {
  return startDatabaseAiColumnJob(
    databaseAiImageColumnJobKey(databaseId, columnId),
    databaseId,
    columnId,
    (dbId, colId) => window.nodus.generateDatabaseAiImageColumn(dbId, colId)
  );
}

export const DEEP_RESEARCH_MAIN_JOB_KEY = 'deep-research:main';
export const IMMERSION_DOSSIER_JOB_PREFIX = 'deep-research:immersion:';

export function immersionDossierJobKey(sessionId: string): string {
  return `${IMMERSION_DOSSIER_JOB_PREFIX}${sessionId}`;
}

export interface DeepResearchGenerationResult {
  report: DeepResearchReport;
  savedDraft: WritingWorkshopSavedDraft | null;
  saveError: string | null;
}

export type DeepResearchGenerationJob = BackgroundJob<DeepResearchRequest, DeepResearchProgress, DeepResearchGenerationResult>;

/**
 * Deep Research results are auto-saved after generation. The in-memory job
 * restores the live view; the saved draft makes the finished report durable.
 */
export function startDeepResearchGeneration(key: string, request: DeepResearchRequest): DeepResearchGenerationJob {
  return startBackgroundJob(key, request, async (currentRequest, onProgress) => {
    const report = await window.nodus.generateDeepResearchReport(currentRequest, { onProgress });
    try {
      const savedDraft = await window.nodus.saveWritingWorkshopDraft({
        draft: report.draft,
        model: report.draft.generationModel ?? currentRequest.model,
        decorativeImage: currentRequest.decorativeImage,
      });
      return { report, savedDraft, saveError: null };
    } catch (error) {
      return { report, savedDraft: null, saveError: messageFromError(error) };
    }
  });
}

// ── Deep Research queue: chained sequential generation ───────────────────────
//
// Reports are queued and generated one after another. The controller lives at
// module scope (not inside a view) so a queue keeps draining while the user
// navigates elsewhere. Only one report runs at a time, under the shared main
// job key, so the existing progress subscription keeps working unchanged.

export type DeepResearchQueueStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DeepResearchQueueItem {
  id: string;
  request: DeepResearchRequest;
  title: string;
  status: DeepResearchQueueStatus;
  error: string | null;
  savedDraftId: string | null;
  /**
   * The report was generated but could not be stored as a draft. It is finished work
   * that will never reach the gallery, so the queue carries the reason rather than
   * completing as if nothing had happened.
   */
  saveError: string | null;
  enqueuedAt: string;
}

const deepQueue: DeepResearchQueueItem[] = [];
const deepQueueListeners = new Set<(items: DeepResearchQueueItem[]) => void>();
let deepQueueSeq = 0;
let deepQueueDraining = false;

function snapshotDeepQueue(): DeepResearchQueueItem[] {
  return deepQueue.map((item) => ({ ...item }));
}

function notifyDeepQueue(): void {
  const snapshot = snapshotDeepQueue();
  for (const listener of deepQueueListeners) listener(snapshot);
}

export function subscribeDeepResearchQueue(listener: (items: DeepResearchQueueItem[]) => void): () => void {
  deepQueueListeners.add(listener);
  listener(snapshotDeepQueue());
  return () => {
    deepQueueListeners.delete(listener);
  };
}

export function getDeepResearchQueue(): DeepResearchQueueItem[] {
  return snapshotDeepQueue();
}

function objectivePreview(objective: string): string {
  const clean = objective.replace(/\s+/g, ' ').trim();
  return clean.length > 100 ? `${clean.slice(0, 100)}…` : clean || t('Informe sin título');
}

export function enqueueDeepResearch(request: DeepResearchRequest): DeepResearchQueueItem {
  const item: DeepResearchQueueItem = {
    id: `drq-${Date.now()}-${++deepQueueSeq}`,
    request,
    title: objectivePreview(request.objective),
    status: 'queued',
    error: null,
    savedDraftId: null,
    saveError: null,
    enqueuedAt: new Date().toISOString(),
  };
  deepQueue.push(item);
  notifyDeepQueue();
  drainDeepQueue();
  return item;
}

/** Remove a still-queued item. A running report is never dropped mid-flight. */
export function removeQueuedDeepResearch(id: string): boolean {
  const index = deepQueue.findIndex((item) => item.id === id);
  if (index === -1 || deepQueue[index].status !== 'queued') return false;
  deepQueue.splice(index, 1);
  notifyDeepQueue();
  return true;
}

/** Drop finished (completed/failed) entries the user has acknowledged. */
export function clearFinishedDeepResearch(): void {
  for (let i = deepQueue.length - 1; i >= 0; i--) {
    if (deepQueue[i].status === 'completed' || deepQueue[i].status === 'failed') deepQueue.splice(i, 1);
  }
  notifyDeepQueue();
}

function drainDeepQueue(): void {
  if (deepQueueDraining) return;
  const next = deepQueue.find((item) => item.status === 'queued');
  if (!next) return;
  deepQueueDraining = true;
  next.status = 'running';
  notifyDeepQueue();

  const job = startDeepResearchGeneration(DEEP_RESEARCH_MAIN_JOB_KEY, next.request);
  const unsubscribe = subscribeBackgroundJob<DeepResearchRequest, DeepResearchProgress, DeepResearchGenerationResult>(
    DEEP_RESEARCH_MAIN_JOB_KEY,
    (current) => {
      if (!current || current.id !== job.id) return;
      if (current.status === 'completed') {
        next.status = 'completed';
        next.savedDraftId = current.result?.savedDraft?.id ?? null;
        next.saveError = current.result?.saveError ?? null;
        finish();
      } else if (current.status === 'failed') {
        next.status = 'failed';
        next.error = current.error;
        finish();
      }
    }
  );

  function finish(): void {
    unsubscribe();
    deepQueueDraining = false;
    notifyDeepQueue();
    drainDeepQueue();
  }
}

// ── Audio narration generation ───────────────────────────────────────────────
//
// Narrating a whole report, immersion, chat answer or dictionary entry runs one segment
// at a time: each segment is a Ming job in the TTS sidecar that streams fragments back
// and is saved as a clip by the main process. The loop lives here, at module scope, so
// it keeps running while the user navigates away from the view that started it — and the
// progress bar reappears, mid-run, when they return.

export interface AudioGenerationRequest {
  entityKind: AudioEntityKind;
  entityId: string;
  /** Voice library id; empty uses the saved default. */
  voiceId?: string;
  segmentRequest: AudioSegmentRequest;
  /** Localised strings the module-scope loop cannot resolve through i18n itself. */
  labels: { preparing: string; noText: string };
}

export interface AudioGenerationProgress {
  done: number;
  total: number;
  label: string;
  /** Fragments of the segment in flight, measured speed and time left (Ming jobs). */
  fragmentsDone?: number;
  fragmentsTotal?: number;
  rtf?: number | null;
  etaS?: number | null;
  /** Set the moment the user asks to cancel, so the panel can acknowledge the click
   *  instead of looking frozen while the segment in flight is abandoned. */
  cancelling?: boolean;
}

export interface AudioGenerationResult {
  count: number;
  cancelled: boolean;
}

export type AudioGenerationJob = BackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>;

export function audioGenerationJobKey(kind: AudioEntityKind, id: string): string {
  return `audio:generate:${kind}:${id}`;
}

/**
 * A pending cancellation for one generation key. It is more than a flag: a segment
 * can take minutes (a long section on a local voice) or never settle at all (a dead
 * worker, a stalled cloud request), and the loop used to only look at the flag
 * *between* segments — so Cancel appeared to do nothing, sometimes forever. The
 * promise lets the loop stop waiting for the segment in flight, and the abort
 * controller lets the synthesiser drop the work it is doing.
 */
interface AudioCancellation {
  requested: boolean;
  signal: Promise<void>;
  request: () => void;
  controller: AbortController;
}

const CANCELLED = Symbol('audio-cancelled');

const audioCancellations = new Map<string, AudioCancellation>();

function audioCancellation(key: string): AudioCancellation {
  const existing = audioCancellations.get(key);
  if (existing) return existing;
  let request!: () => void;
  const signal = new Promise<void>((resolve) => { request = resolve; });
  const entry: AudioCancellation = { requested: false, signal, request, controller: new AbortController() };
  audioCancellations.set(key, entry);
  return entry;
}

/** Stop waiting on `promise` as soon as cancellation is requested. */
function untilCancelled<T>(cancellation: AudioCancellation, promise: Promise<T>): Promise<T | typeof CANCELLED> {
  const cancelled: Promise<typeof CANCELLED> = cancellation.signal.then(() => CANCELLED);
  return Promise.race<T | typeof CANCELLED>([promise, cancelled]);
}

export function cancelAudioGeneration(kind: AudioEntityKind, id: string): void {
  const key = audioGenerationJobKey(kind, id);
  const current = getBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(key);
  if (current?.status !== 'running') return;
  const cancellation = audioCancellation(key);
  if (cancellation.requested) return;
  cancellation.requested = true;
  cancellation.request();
  cancellation.controller.abort();
  // Re-render the panel immediately: without this the click mutated a module-level
  // flag only, so nothing on screen changed until the current segment finished.
  replaceJob({
    ...current,
    progress: { done: 0, total: 0, label: '', ...(current.progress ?? {}), cancelling: true },
  } as AnyJob);
}

/** Narrates and saves one segment, injected by the caller so this module stays free of
 *  the TTS client (and can be bundled and unit-tested on its own). `signal` aborts when
 *  the user cancels, so the job in the sidecar is dropped; `report` forwards fragment
 *  progress to the job's subscribers. Resolves false when nothing was saved. */
export interface SegmentNarrationContext {
  request: AudioGenerationRequest;
  index: number;
  total: number;
  signal: AbortSignal;
  report: (progress: Pick<AudioGenerationProgress, 'fragmentsDone' | 'fragmentsTotal' | 'rtf' | 'etaS'>) => void;
}
export type SegmentNarrator = (segment: AudioSegment, context: SegmentNarrationContext) => Promise<boolean>;

export function startAudioGeneration(request: AudioGenerationRequest, narrate: SegmentNarrator): AudioGenerationJob {
  const key = audioGenerationJobKey(request.entityKind, request.entityId);
  const existing = getBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(key);
  if (existing?.status === 'running') return existing;
  audioCancellations.delete(key);

  return startBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(key, request, async (req, onProgress) => {
    const cancellation = audioCancellation(key);
    let done = 0;
    try {
      const segments = await untilCancelled(cancellation, window.nodus.getAudioSegments(req.entityKind, req.entityId, req.segmentRequest));
      if (segments === CANCELLED) return { count: 0, cancelled: true };
      if (!segments.length) throw new Error(req.labels.noText);

      let fragmentProgress: Pick<AudioGenerationProgress, 'fragmentsDone' | 'fragmentsTotal' | 'rtf' | 'etaS'> = {};
      const report = (label: string) =>
        onProgress({ done, total: segments.length, label, cancelling: cancellation.requested, ...fragmentProgress });

      if (await untilCancelled(cancellation, window.nodus.clearAudioClips(req.entityKind, req.entityId)) === CANCELLED) {
        return { count: 0, cancelled: true };
      }
      report(req.labels.preparing);

      for (const [position, segment] of segments.entries()) {
        if (cancellation.requested) return { count: done, cancelled: true };
        fragmentProgress = {};
        report(segment.label);
        // Race the narration: cancelling must end the job now, even when the segment
        // in flight would take minutes more (or never resolve at all).
        const narrated: Promise<boolean | typeof CANCELLED> = narrate(segment, {
          request: req, index: position, total: segments.length, signal: cancellation.controller.signal,
          report: (progress) => { fragmentProgress = progress; report(segment.label); },
        })
          // Aborting the backend rejects the segment; that is the cancellation the
          // user asked for, not a failure to report to them.
          .catch((error: unknown) => {
            if (cancellation.requested) return CANCELLED;
            throw error;
          });
        const saved = await untilCancelled(cancellation, narrated);
        if (saved === CANCELLED || cancellation.requested) return { count: done, cancelled: true };
        if (saved) done += 1;
        fragmentProgress = {};
        report(segment.label);
      }

      return { count: done, cancelled: false };
    } finally {
      // Clear on every exit — including the throwing one — so a later run starts clean.
      audioCancellations.delete(key);
    }
  });
}
