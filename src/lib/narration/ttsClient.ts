// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioClip } from '@shared/types';
import type { TtsEvent, TtsSpeakRequest, TtsSpeakStarted } from '@shared/api/tts';
import type { TtsFragmentEvent, TtsJobProgress, TtsStatus } from '@shared/ttsModels';

/**
 * The renderer's single subscription to narration events. Jobs, downloads and the engine
 * state arrive on one IPC channel; this module routes them to whoever asked, so a dozen
 * listen buttons never each install their own IPC listener. Everything here is small
 * messages: audio is played straight from `nodus-audio://` URLs.
 */
type StatusListener = (status: TtsStatus) => void;
type EventListener = (event: TtsEvent) => void;

interface JobWatch {
  onFragment?: (fragment: TtsFragmentEvent) => void;
  onProgress?: (progress: TtsJobProgress) => void;
  resolve: (result: { clip: AudioClip | null; cancelled: boolean; progress: TtsJobProgress }) => void;
  reject: (error: Error) => void;
  /** Events that arrived before `ttsSpeak` returned the job id. */
}

const jobs = new Map<string, JobWatch>();
const early = new Map<string, TtsEvent[]>();
const statusListeners = new Set<StatusListener>();
const eventListeners = new Set<EventListener>();
let lastStatus: TtsStatus | null = null;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed || typeof window === 'undefined' || !window.nodus?.onTtsEvent) return;
  subscribed = true;
  window.nodus.onTtsEvent((event) => {
    for (const listener of eventListeners) listener(event);
    if (event.kind === 'status') {
      lastStatus = event.status;
      for (const listener of statusListeners) listener(event.status);
      return;
    }
    const jobId = event.kind === 'fragment' ? event.fragment.jobId : event.kind === 'job' ? event.progress.jobId : null;
    if (!jobId) return;
    const watch = jobs.get(jobId);
    if (!watch) {
      // The job id is only known once `ttsSpeak` resolves; keep what arrives before that.
      const queue = early.get(jobId) ?? [];
      queue.push(event);
      early.set(jobId, queue.slice(-200));
      return;
    }
    deliver(jobId, watch, event);
  });
}

function deliver(jobId: string, watch: JobWatch, event: TtsEvent): void {
  if (event.kind === 'fragment') { watch.onFragment?.(event.fragment); return; }
  if (event.kind !== 'job') return;
  watch.onProgress?.(event.progress);
  const { state } = event.progress;
  if (state === 'done' || state === 'cancelled') {
    jobs.delete(jobId);
    watch.resolve({ clip: event.clip ?? null, cancelled: state === 'cancelled', progress: event.progress });
  } else if (state === 'error') {
    jobs.delete(jobId);
    watch.reject(new Error(event.progress.error || 'TTS_SYNTH_FAILED'));
  }
}

export interface SpeakHandle extends TtsSpeakStarted {
  done: Promise<{ clip: AudioClip | null; cancelled: boolean; progress: TtsJobProgress }>;
  cancel: () => void;
}

/** Starts a narration job. Fragments and progress are reported as they arrive. */
export async function speak(request: TtsSpeakRequest, hooks: Pick<JobWatch, 'onFragment' | 'onProgress'> = {}, signal?: AbortSignal): Promise<SpeakHandle> {
  ensureSubscribed();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const started = await window.nodus.ttsSpeak(request);
  let watch!: JobWatch;
  const done = new Promise<{ clip: AudioClip | null; cancelled: boolean; progress: TtsJobProgress }>((resolve, reject) => {
    watch = { ...hooks, resolve, reject };
  });
  jobs.set(started.jobId, watch);
  for (const event of early.get(started.jobId) ?? []) deliver(started.jobId, watch, event);
  early.delete(started.jobId);
  const cancel = () => { void window.nodus.ttsCancel(started.jobId); };
  signal?.addEventListener('abort', cancel, { once: true });
  void done.finally(() => signal?.removeEventListener('abort', cancel)).catch(() => {});
  return { ...started, done, cancel };
}

/** Engine status, kept fresh by events; the first call asks the main process. */
export function subscribeTtsStatus(listener: StatusListener): () => void {
  ensureSubscribed();
  statusListeners.add(listener);
  if (lastStatus) listener(lastStatus);
  else void refreshTtsStatus();
  return () => statusListeners.delete(listener);
}

export async function refreshTtsStatus(): Promise<TtsStatus> {
  ensureSubscribed();
  const status = await window.nodus.ttsStatus();
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
  return status;
}

export function currentTtsStatus(): TtsStatus | null {
  return lastStatus;
}

/** Raw events (install phases, model downloads) for Settings. */
export function subscribeTtsEvents(listener: EventListener): () => void {
  ensureSubscribed();
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/** Whether narration can start right away: runtime installed and the chosen model on disk. */
export function ttsReady(status: TtsStatus | null, modelId?: string | null): boolean {
  if (!status?.runtime.installed) return false;
  const models = status.models.filter((model) => model.downloaded);
  return modelId ? models.some((model) => model.id === modelId) : models.length > 0;
}

export const clipUrl = (clipId: string) => `nodus-audio://clip/${encodeURIComponent(clipId)}`;
export const voiceUrl = (voiceId: string) => `nodus-audio://voice/${encodeURIComponent(voiceId)}`;
