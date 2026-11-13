// SPDX-License-Identifier: AGPL-3.0-only
// The podcast slice of the window.nodus contract, paired with electron/ipc/podcast.ts and
// electron/preload/podcast.ts. Audio is served by `nodus-audio://podcast/<episodeId>`.
import type {
  PodcastEpisode, PodcastEpisodeSummary, PodcastImageInfo, PodcastJob, PodcastRequest, PodcastScript,
} from '../podcast';

export interface PodcastApi {
  podcastQueueList(): Promise<PodcastJob[]>;
  podcastEnqueue(request: PodcastRequest): Promise<PodcastJob>;
  podcastCancel(jobId: string): Promise<void>;
  /** Queues a failed job again; finished stages (research, script) are kept. */
  podcastRetry(jobId: string): Promise<PodcastJob>;
  podcastClearFinished(): Promise<void>;
  /** Replaces the script of a job waiting for review. */
  podcastUpdateScript(jobId: string, script: PodcastScript): Promise<PodcastJob>;
  /** Sends a reviewed script to recording. */
  podcastApproveScript(jobId: string): Promise<PodcastJob>;
  podcastEpisodes(): Promise<PodcastEpisodeSummary[]>;
  podcastEpisode(episodeId: string): Promise<PodcastEpisode | null>;
  podcastDeleteEpisode(episodeId: string): Promise<void>;
  podcastRenameEpisode(episodeId: string, title: string): Promise<void>;
  podcastSetPosition(episodeId: string, positionS: number): Promise<void>;
  podcastImages(episodeId: string): Promise<PodcastImageInfo[]>;
  /** A ready image as a data: URL, or null. */
  podcastImageData(episodeId: string, slot: number, variant: 'image' | 'thumbnail'): Promise<string | null>;
  podcastRegenerateImage(episodeId: string, slot: number): Promise<void>;
  /** Save dialogs; resolve with the written path, or null when cancelled. */
  podcastExportAudio(episodeId: string): Promise<string | null>;
  podcastExportTranscript(episodeId: string): Promise<string | null>;
  /** The episode's compressed audio, for decoding in the renderer (WAV download). */
  podcastAudioBytes(episodeId: string): Promise<Uint8Array>;
  /** Saves an uncompressed WAV the renderer decoded from the episode's audio. */
  podcastExportWav(episodeId: string, wav: Uint8Array): Promise<string | null>;
  onPodcastQueue(listener: (jobs: PodcastJob[]) => void): () => void;
  onPodcastChanged(listener: (event: { episodeId?: string }) => void): () => void;
}
