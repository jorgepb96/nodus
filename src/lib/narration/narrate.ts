// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioEntityKind, AudioSegmentRequest } from '@shared/types';
import type { TtsLanguageSetting } from '@shared/ttsModels';
import {
  audioGenerationJobKey, cancelAudioGeneration, startAudioGeneration, subscribeBackgroundJob,
  type AudioGenerationJob, type SegmentNarrator,
} from '../../backgroundJobs';
import type { LiveNarration, NarrationSource, PlayerTrack } from '../../components/AudioPlayer';
import { speak } from './ttsClient';

/**
 * Starts narrating an item: one Ming job per speakable segment, each saved as a clip of the
 * item when it finishes. With a live handle, every generated fragment joins the player's
 * queue as it arrives, so listening starts long before the whole text is done.
 */
export interface NarrationInput {
  kind: AudioEntityKind;
  id: string;
  title: string;
  segmentRequest?: AudioSegmentRequest;
  voiceId?: string;
  language?: TtsLanguageSetting;
  labels: { preparing: string; noText: string };
  /** Play without saving: no clip, no database row. The fragments stay in the engine's live
   *  folder, which removes them shortly after the job ends (Scriptor's read-the-selection). */
  ephemeral?: boolean;
}

/** Live playback outranks generation nobody is listening to yet. */
const LISTENING_PRIORITY = 10;

export function segmentNarrator(input: Pick<NarrationInput, 'voiceId' | 'language' | 'ephemeral'>, live: LiveNarration | null): SegmentNarrator {
  // Estimated length of the whole narration, refined as fragments arrive: audio per character
  // generated so far × characters in all segments.
  let charsDone = 0;
  let audioDone = 0;
  let totalChars = 0;
  return async (segment, context) => {
    if (!totalChars) totalChars = Math.max(segment.text.length, 1) * context.total;
    let segmentAudio = 0;
    const handle = await speak({
      text: segment.text,
      voiceId: input.voiceId || undefined,
      language: input.language,
      priority: live ? LISTENING_PRIORITY : 0,
      ...(input.ephemeral ? {} : { save: { kind: context.request.entityKind, id: context.request.entityId, segmentIndex: segment.index, segmentLabel: segment.label } }),
    }, {
      onFragment: (fragment) => {
        segmentAudio += fragment.durationS;
        const track: PlayerTrack = { id: `${fragment.jobId}:${fragment.index}`, label: segment.label, url: fragment.url, durationS: fragment.durationS };
        live?.append(track);
        const fractionOfSegment = fragment.total ? (fragment.index + 1) / fragment.total : 1;
        const secondsPerChar = (audioDone + segmentAudio) / Math.max(1, charsDone + segment.text.length * fractionOfSegment);
        live?.progress({ estimatedTotalS: secondsPerChar * totalChars });
      },
      onProgress: (progress) => {
        context.report({ fragmentsDone: progress.done, fragmentsTotal: progress.total, rtf: progress.rtf, etaS: progress.etaS });
        live?.progress({
          state: progress.state === 'done' ? 'generating' : progress.state,
          done: progress.done, total: progress.total, rtf: progress.rtf, etaS: progress.etaS,
          segmentsDone: context.index, segmentsTotal: context.total,
        });
      },
    }, context.signal);
    const result = await handle.done;
    charsDone += segment.text.length;
    audioDone += segmentAudio;
    return !result.cancelled && (input.ephemeral || !!result.clip);
  };
}

export interface NarrationPlayer {
  startLive(source: NarrationSource, options: { autoplay: boolean; cancel: () => void }): LiveNarration;
}

export function startNarration(player: NarrationPlayer | null, input: NarrationInput, source?: NarrationSource): AudioGenerationJob {
  const key = source?.key ?? `${input.kind}:${input.id}`;
  const live = player?.startLive(source ?? { key, title: input.title }, {
    autoplay: true,
    cancel: () => cancelAudioGeneration(input.kind, input.id),
  }) ?? null;
  const job = startAudioGeneration({
    entityKind: input.kind,
    entityId: input.id,
    voiceId: input.voiceId,
    segmentRequest: input.segmentRequest ?? {},
    labels: input.labels,
  }, segmentNarrator(input, live));
  if (live) {
    void waitForJob(input.kind, input.id).then((settled) => {
      if (settled.status === 'failed') live.fail(settled.error ?? '');
      else live.finish();
    });
  }
  return job;
}

function waitForJob(kind: AudioEntityKind, id: string): Promise<{ status: string; error?: string }> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    unsubscribe = subscribeBackgroundJob(audioGenerationJobKey(kind, id), (job) => {
      if (!job || job.status === 'running') return;
      resolve({ status: job.status, error: job.error ?? undefined });
      queueMicrotask(() => unsubscribe?.());
    });
  });
}
