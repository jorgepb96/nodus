// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The single lane every podcast episode goes through, one at a time.
 *
 * Same contract as the Deep Research lane: a job is bound to the vault that was open when it
 * was queued and only runs while that vault is active; the lane survives a restart (a job
 * that was running is queued again and resumes from its checkpoint); cancelling a running job
 * aborts it but the lane stays busy until the pipeline has unwound.
 *
 * Unlike a report, an episode can stop half way on purpose: with "review the script" it
 * parks in `awaiting_review` without holding the lane, the user edits the script, and
 * approving it queues the job again from the recording stage.
 *
 * No Electron, database or AI imports: the real work is injected (`run`), so the lane is
 * driven by tests with fakes (scripts/test-podcast-queue.mjs).
 */
import { normalizePodcastRequest, normalizePodcastScript, type PodcastCheckpoint, type PodcastJob, type PodcastRequest, type PodcastScript } from '@shared/podcast';
import type { PodcastProgress } from './podcastCore';

export interface PodcastRunContext {
  signal: AbortSignal;
  progress(progress: PodcastProgress): void;
  checkpoint(checkpoint: PodcastCheckpoint): void;
  title(title: string): void;
}

export type PodcastRunOutcome = { outcome: 'awaiting_review' } | { outcome: 'done'; episodeId: string };

export interface PodcastQueueDeps {
  activeVault(): { id: string; name: string };
  run(job: PodcastJob, context: PodcastRunContext): Promise<PodcastRunOutcome>;
  load?(): PodcastJob[];
  persist?(jobs: PodcastJob[]): void;
  onChange?(jobs: PodcastJob[]): void;
  /** Once per job that finishes, fails, is cancelled or parks for review. */
  onSettled?(job: PodcastJob): void;
  now?(): string;
  newId?(): string;
}

/** Finished jobs kept for the strip before the oldest go. */
const MAX_FINISHED = 20;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500) || 'PODCAST_FAILED';
}

export class PodcastQueue {
  private jobs: PodcastJob[] = [];
  private draining = false;
  private running: { id: string; controller: AbortController } | null = null;
  private sequence = 0;

  constructor(private readonly deps: PodcastQueueDeps) {
    const restored = deps.load?.() ?? [];
    for (const job of restored) {
      if (!job || typeof job.id !== 'string') continue;
      // A job interrupted by a quit resumes from its checkpoint.
      if (job.status === 'running') { job.status = 'queued'; job.phase = 'queued'; job.message = undefined; }
      this.jobs.push(job);
    }
  }

  private now(): string { return this.deps.now?.() ?? new Date().toISOString(); }

  private newId(): string { return this.deps.newId?.() ?? `pod-${Date.now().toString(36)}-${(this.sequence += 1)}`; }

  list(): PodcastJob[] { return clone(this.jobs); }

  get(id: string): PodcastJob | null {
    const job = this.jobs.find((entry) => entry.id === id);
    return job ? clone(job) : null;
  }

  busy(): boolean { return this.running !== null; }

  private changed(): void {
    // Keep the newest finished jobs only; parked and pending ones always stay.
    const finished = this.jobs.filter((job) => TERMINAL.has(job.status));
    if (finished.length > MAX_FINISHED) {
      const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED).map((job) => job.id));
      this.jobs = this.jobs.filter((job) => !drop.has(job.id));
    }
    const snapshot = this.list();
    try { this.deps.persist?.(snapshot); } catch { /* the lane keeps working in memory */ }
    try { this.deps.onChange?.(snapshot); } catch { /* a closed window */ }
  }

  private settle(job: PodcastJob): void {
    try { this.deps.onSettled?.(clone(job)); } catch { /* best effort */ }
  }

  enqueue(input: PodcastRequest | unknown): PodcastJob {
    const request = normalizePodcastRequest(input);
    const vault = this.deps.activeVault();
    const job: PodcastJob = { id: this.newId(), vaultId: vault.id, request, status: 'queued', phase: 'queued', createdAt: this.now() };
    this.jobs.push(job);
    this.changed();
    void this.drain();
    return clone(job);
  }

  cancel(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || TERMINAL.has(job.status)) return;
    if (this.running?.id === id) {
      // The run settles as cancelled once the pipeline unwinds.
      this.running.controller.abort(new Error('PODCAST_CANCELLED'));
      job.message = undefined;
      this.changed();
      return;
    }
    job.status = 'cancelled';
    job.phase = 'cancelled';
    job.finishedAt = this.now();
    this.changed();
    this.settle(job);
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((job) => !TERMINAL.has(job.status));
    this.changed();
  }

  /** Replaces the script of a job parked for review. */
  updateScript(id: string, script: PodcastScript | unknown): PodcastJob {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== 'awaiting_review' || !job.checkpoint?.plan) throw new Error('PODCAST_NOT_AWAITING_REVIEW');
    job.checkpoint = { ...job.checkpoint, script: normalizePodcastScript(script, job.request.hosts.length, job.checkpoint.plan.chapters.length), reviewed: true };
    this.changed();
    return clone(job);
  }

  /** Sends a reviewed script to recording. */
  approve(id: string): PodcastJob {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== 'awaiting_review') throw new Error('PODCAST_NOT_AWAITING_REVIEW');
    job.status = 'queued';
    job.phase = 'queued';
    job.request = { ...job.request, reviewScript: false };
    job.checkpoint = { ...job.checkpoint, reviewed: true };
    this.changed();
    void this.drain();
    return clone(job);
  }

  /** Queues a failed job again; its checkpoint is kept, so finished stages are not repeated. */
  retry(id: string): PodcastJob {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== 'failed') throw new Error('PODCAST_NOT_FAILED');
    job.status = 'queued';
    job.phase = 'queued';
    job.error = undefined;
    job.finishedAt = undefined;
    this.changed();
    void this.drain();
    return clone(job);
  }

  /** Runs queued jobs of the active vault, one at a time. Safe to call at any moment. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const vault = this.deps.activeVault();
        const job = this.jobs.find((entry) => entry.status === 'queued' && entry.vaultId === vault.id);
        if (!job) return;
        await this.runJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runJob(job: PodcastJob): Promise<void> {
    const controller = new AbortController();
    this.running = { id: job.id, controller };
    job.status = 'running';
    job.phase = 'researching';
    job.startedAt ??= this.now();
    job.error = undefined;
    this.changed();
    const context: PodcastRunContext = {
      signal: controller.signal,
      progress: (progress) => {
        if (controller.signal.aborted) return;
        job.phase = progress.phase;
        job.message = progress.message;
        job.done = progress.done;
        job.total = progress.total;
        job.recordedS = progress.recordedS;
        job.estimatedS = progress.estimatedS;
        this.changed();
      },
      checkpoint: (checkpoint) => { job.checkpoint = clone(checkpoint); this.changed(); },
      title: (title) => { job.title = title; this.changed(); },
    };
    try {
      const result = await this.deps.run(clone(job), context);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (result.outcome === 'awaiting_review') {
        job.status = 'awaiting_review';
        job.phase = 'awaiting_review';
      } else {
        job.status = 'done';
        job.phase = 'done';
        job.episodeId = result.episodeId;
        job.finishedAt = this.now();
        // The episode row holds everything now; the strip only needs the metadata.
        job.checkpoint = undefined;
      }
    } catch (error) {
      job.finishedAt = this.now();
      if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.phase = 'cancelled';
      } else {
        job.status = 'failed';
        job.phase = 'failed';
        job.error = errorCode(error);
      }
    } finally {
      this.running = null;
      job.message = undefined;
      this.changed();
      this.settle(job);
    }
  }
}
