// SPDX-License-Identifier: AGPL-3.0-only
// The podcast half of the renderer bridge, paired with electron/ipc/podcast.ts.
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PodcastApi } from '@shared/api/podcast';
import type { PodcastJob } from '@shared/podcast';

export const podcastApi: PodcastApi = {
  podcastQueueList: () => ipcRenderer.invoke('podcast:queue:list'),
  podcastEnqueue: (request) => ipcRenderer.invoke('podcast:queue:enqueue', request),
  podcastCancel: (jobId) => ipcRenderer.invoke('podcast:queue:cancel', jobId),
  podcastRetry: (jobId) => ipcRenderer.invoke('podcast:queue:retry', jobId),
  podcastClearFinished: () => ipcRenderer.invoke('podcast:queue:clear'),
  podcastUpdateScript: (jobId, script) => ipcRenderer.invoke('podcast:queue:updateScript', jobId, script),
  podcastApproveScript: (jobId) => ipcRenderer.invoke('podcast:queue:approve', jobId),
  podcastEpisodes: () => ipcRenderer.invoke('podcast:episodes:list'),
  podcastEpisode: (episodeId) => ipcRenderer.invoke('podcast:episodes:get', episodeId),
  podcastDeleteEpisode: (episodeId) => ipcRenderer.invoke('podcast:episodes:delete', episodeId),
  podcastRenameEpisode: (episodeId, title) => ipcRenderer.invoke('podcast:episodes:rename', episodeId, title),
  podcastSetPosition: (episodeId, positionS) => ipcRenderer.invoke('podcast:episodes:position', episodeId, positionS),
  podcastImages: (episodeId) => ipcRenderer.invoke('podcast:images:list', episodeId),
  podcastImageData: (episodeId, slot, variant) => ipcRenderer.invoke('podcast:images:data', episodeId, slot, variant),
  podcastRegenerateImage: (episodeId, slot) => ipcRenderer.invoke('podcast:images:regenerate', episodeId, slot),
  podcastExportAudio: (episodeId) => ipcRenderer.invoke('podcast:export:audio', episodeId),
  podcastExportTranscript: (episodeId) => ipcRenderer.invoke('podcast:export:transcript', episodeId),
  podcastAudioBytes: (episodeId) => ipcRenderer.invoke('podcast:audio:bytes', episodeId),
  podcastExportWav: (episodeId, wav) => ipcRenderer.invoke('podcast:export:wav', episodeId, wav),
  onPodcastQueue: (listener) => {
    const handler = (_event: IpcRendererEvent, jobs: PodcastJob[]) => listener(jobs);
    ipcRenderer.on('podcast:queue', handler);
    return () => { ipcRenderer.removeListener('podcast:queue', handler); };
  },
  onPodcastChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: { episodeId?: string }) => listener(payload ?? {});
    ipcRenderer.on('podcast:changed', handler);
    return () => { ipcRenderer.removeListener('podcast:changed', handler); };
  },
};
