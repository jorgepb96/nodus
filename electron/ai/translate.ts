import { completeTextNeutral } from './aiClient';
import { translateMarkdownWith, type TranslateOptions } from '@shared/translationGeneration';
export { chunkMarkdown, titleFromMarkdown } from '@shared/translationGeneration';
export type { TranslateOptions } from '@shared/translationGeneration';

export async function translateMarkdown(options: TranslateOptions): Promise<string> {
  return translateMarkdownWith(options, completeTextNeutral);
}
