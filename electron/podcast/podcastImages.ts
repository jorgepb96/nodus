// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The cover and chapter images of a saved episode. They are generated after the episode is
 * saved, one at a time and outside the lane, so a slow or failing image provider never
 * delays the audio; each image lands in the gallery as soon as it is ready.
 */
import type { DecorativeImageStyle } from '@shared/types';
import type { PodcastImagePlan } from '@shared/podcast';
import { buildDecorativeImagePrompt } from '@shared/imageStyles';
import { vaultTypeImagePrompt, type VaultType } from '@shared/vaultTypes';
import { getSettings } from '../db/settingsRepo';
import { callImageProvider, prepareGeneratedImage } from '../ai/decorativeImages';
import { putPodcastImagePlaceholder, setPodcastImageData, setPodcastImageStatus } from '../db/podcastRepo';

const DEFAULT_STYLE: DecorativeImageStyle = 'contemporary_editorial';

let chain: Promise<void> = Promise.resolve();

export function podcastImagePrompt(idea: string, title: string, style: DecorativeImageStyle, vaultType: VaultType): string {
  const scene = idea.trim() || title;
  return buildDecorativeImagePrompt(style, `Podcast episode artwork: ${scene}`, vaultTypeImagePrompt(vaultType));
}

/** Writes placeholders now and generates the images in the background, in order. */
export function queuePodcastImages(input: {
  episodeId: string;
  title: string;
  images: PodcastImagePlan[];
  style?: DecorativeImageStyle;
  vaultType: VaultType;
  onChanged: () => void;
}): void {
  if (!input.images.length) return;
  const style = input.style ?? DEFAULT_STYLE;
  const prompts = input.images.map((image) => ({ ...image, prompt: podcastImagePrompt(image.idea, input.title, style, input.vaultType) }));
  for (const image of prompts) putPodcastImagePlaceholder(input.episodeId, image.slot, image.chapterIndex, image.prompt, style);
  input.onChanged();
  chain = chain.then(async () => {
    for (const image of prompts) await generateOne(input.episodeId, image.slot, image.prompt, input.onChanged);
  }).catch(() => {});
}

/** Regenerates one image with its stored prompt (or a new one). */
export function regeneratePodcastImage(episodeId: string, slot: number, chapterIndex: number | null, prompt: string, style: string, onChanged: () => void): void {
  putPodcastImagePlaceholder(episodeId, slot, chapterIndex, prompt, style);
  onChanged();
  chain = chain.then(() => generateOne(episodeId, slot, prompt, onChanged)).catch(() => {});
}

async function generateOne(episodeId: string, slot: number, prompt: string, onChanged: () => void): Promise<void> {
  const settings = getSettings();
  try {
    if (!settings.imageProvider || !settings.imageModel) throw new Error('No hay proveedor o modelo de imagen seleccionado.');
    setPodcastImageStatus(episodeId, slot, 'generating');
    onChanged();
    const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt, undefined, slot === 0 ? '1:1' : '16:9');
    const stored = prepareGeneratedImage(generated);
    setPodcastImageData(episodeId, slot, {
      mime: stored.mimeType, image: stored.image, thumbnail: stored.thumbnail, thumbnailMime: stored.thumbnailMimeType,
      provider: settings.imageProvider, model: settings.imageModel,
    });
  } catch (error) {
    try { setPodcastImageStatus(episodeId, slot, 'failed', error instanceof Error ? error.message : String(error)); } catch { /* the episode was deleted meanwhile */ }
  }
  onChanged();
}
