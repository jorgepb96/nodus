// SPDX-License-Identifier: AGPL-3.0-only
// Podcast episodes: the lane (queue, review, retry) and the saved gallery. Paired with
// shared/api/podcast.ts and electron/preload/podcast.ts. Every channel belongs to the main
// frame of the main Nodus window only.
import fs from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import type { PodcastRequest, PodcastScript } from '@shared/podcast';
import { podcastTranscriptMarkdown } from '@shared/podcastTranscript';
import { dialogTitle } from '../dialogTitles';
import { getSettings } from '../db/settingsRepo';
import {
  deletePodcastEpisode, failInterruptedPodcastImages, getPodcastEpisode, getPodcastImageBytes, listPodcastEpisodes, listPodcastImages,
  renamePodcastEpisode, setPodcastListenPosition,
} from '../db/podcastRepo';
import { audioDir } from '../audio/audioPaths';
import { podcastAudioPath, podcastLane } from '../podcast/podcastLane';
import { regeneratePodcastImage } from '../podcast/podcastImages';
import type { IpcContext } from './context';
import { assertTrustedNodusMainFrame } from './trust';

function safeFileName(title: string, extension: string): string {
  const printable = [...title].map((char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  const base = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'podcast';
  return `${base}.${extension}`;
}

export function registerPodcastIpc({ h, getWindow }: IpcContext): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => assertTrustedNodusMainFrame(event, getWindow());
  // Images a quit interrupted can be retried; a job a quit interrupted resumes now, not
  // only once the Podcast view is opened.
  try { failInterruptedPodcastImages(); } catch { /* no vault open yet */ }
  podcastLane();
  const changed = (episodeId: string) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('podcast:changed', { episodeId });
  };

  h('podcast:queue:list', async (event) => { trusted(event); return podcastLane().list(); });
  h('podcast:queue:enqueue', async (event, request: PodcastRequest) => { trusted(event); return podcastLane().enqueue(request); });
  h('podcast:queue:cancel', async (event, jobId: string) => { trusted(event); podcastLane().cancel(String(jobId)); });
  h('podcast:queue:retry', async (event, jobId: string) => { trusted(event); return podcastLane().retry(String(jobId)); });
  h('podcast:queue:clear', async (event) => { trusted(event); podcastLane().clearFinished(); });
  h('podcast:queue:updateScript', async (event, jobId: string, script: PodcastScript) => { trusted(event); return podcastLane().updateScript(String(jobId), script); });
  h('podcast:queue:approve', async (event, jobId: string) => { trusted(event); return podcastLane().approve(String(jobId)); });

  h('podcast:episodes:list', async (event) => { trusted(event); return listPodcastEpisodes(); });
  h('podcast:episodes:get', async (event, episodeId: string) => { trusted(event); return getPodcastEpisode(String(episodeId)); });
  h('podcast:episodes:rename', async (event, episodeId: string, title: string) => { trusted(event); renamePodcastEpisode(String(episodeId), String(title ?? '')); changed(String(episodeId)); });
  h('podcast:episodes:position', async (event, episodeId: string, positionS: number) => { trusted(event); setPodcastListenPosition(String(episodeId), Number(positionS)); });
  h('podcast:episodes:delete', async (event, episodeId: string) => {
    trusted(event);
    const file = deletePodcastEpisode(String(episodeId));
    if (file) {
      const root = audioDir();
      const target = path.join(root, file);
      if (!path.relative(root, target).startsWith('..')) fs.rmSync(target, { force: true });
    }
    changed(String(episodeId));
  });

  h('podcast:images:list', async (event, episodeId: string) => { trusted(event); return listPodcastImages(String(episodeId)); });
  h('podcast:images:data', async (event, episodeId: string, slot: number, variant: 'image' | 'thumbnail') => {
    trusted(event);
    const found = getPodcastImageBytes(String(episodeId), Number(slot), variant === 'image' ? 'image' : 'thumbnail');
    return found ? `data:${found.mime};base64,${Buffer.from(found.bytes).toString('base64')}` : null;
  });
  h('podcast:images:regenerate', async (event, episodeId: string, slot: number) => {
    trusted(event);
    const id = String(episodeId);
    const image = listPodcastImages(id).find((entry) => entry.slot === Number(slot));
    if (!image) throw new Error('PODCAST_IMAGE_NOT_FOUND');
    regeneratePodcastImage(id, image.slot, image.chapterIndex, image.prompt, getPodcastEpisode(id)?.request.imageStyle ?? 'contemporary_editorial', () => changed(id));
  });

  h('podcast:export:audio', async (event, episodeId: string) => {
    trusted(event);
    const id = String(episodeId);
    const episode = getPodcastEpisode(id);
    const source = podcastAudioPath(id);
    if (!episode || !source || !fs.existsSync(source)) throw new Error('PODCAST_AUDIO_MISSING');
    const extension = path.extname(source).slice(1) || 'm4a';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('saveAudio', getSettings().uiLanguage),
      defaultPath: safeFileName(episode.title, extension),
      filters: [{ name: extension === 'm4a' ? 'MPEG-4 Audio' : 'Ogg Opus', extensions: [extension] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.copyFileSync(source, picked.filePath);
    return picked.filePath;
  });
  h('podcast:audio:bytes', async (event, episodeId: string) => {
    trusted(event);
    const source = podcastAudioPath(String(episodeId));
    if (!source || !fs.existsSync(source)) throw new Error('PODCAST_AUDIO_MISSING');
    return new Uint8Array(await fs.promises.readFile(source));
  });
  h('podcast:export:wav', async (event, episodeId: string, wav: Uint8Array) => {
    trusted(event);
    const episode = getPodcastEpisode(String(episodeId));
    if (!episode) throw new Error('PODCAST_NOT_FOUND');
    const bytes = Buffer.from(wav instanceof Uint8Array ? wav : new Uint8Array(0));
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('PODCAST_BAD_WAV');
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('saveAudio', getSettings().uiLanguage),
      defaultPath: safeFileName(episode.title, 'wav'),
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, bytes);
    return picked.filePath;
  });
  h('podcast:export:transcript', async (event, episodeId: string) => {
    trusted(event);
    const episode = getPodcastEpisode(String(episodeId));
    if (!episode) throw new Error('PODCAST_NOT_FOUND');
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: dialogTitle('exportReport', getSettings().uiLanguage),
      defaultPath: safeFileName(episode.title, 'md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, podcastTranscriptMarkdown(episode), 'utf8');
    return picked.filePath;
  });
}
