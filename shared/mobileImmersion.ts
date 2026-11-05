import type {ImmersionRequest, ImmersionScope, ImmersionScopeRequest, PromptLanguage} from './types';
import {IMMERSION_PROMPT_LANGUAGES} from './immersionGeneration';
import {resolveStationCount, type ImmersionMaterial} from '../electron/ai/immersionCore';
import {hashMobileSource, mobileSourceRevisionInput, type MobileSourceHasher} from './mobileOfflineSource';

export function mobileImmersionLanguage(value: unknown): PromptLanguage {
  return IMMERSION_PROMPT_LANGUAGES.includes(value as PromptLanguage) ? value as PromptLanguage : 'es';
}

export function immersionScopeFromMaterial(request: ImmersionScopeRequest, material: ImmersionMaterial,
  aiKeyAvailable: boolean, warnings: string[]): ImmersionScope {
  return {topic: material.topic, generatedAt: new Date().toISOString(), embeddingAvailable: material.embeddingAvailable, aiKeyAvailable,
    ideas: material.ideas.map(idea => ({id: idea.id, type: idea.type as ImmersionScope['ideas'][number]['type'], label: idea.label,
      statement: idea.statement, score: idea.score, themes: idea.themes, authors: idea.authors, workIds: idea.works.map(work => work.nodusId)})),
    works: material.works.map(work => ({nodusId: work.nodusId, title: work.title, authors: work.authors, year: work.year,
      zoteroKey: work.zoteroKey, score: work.score, ideaCount: work.ideaCount})),
    authors: material.authors, themes: material.themes, debateCount: material.debates.length, gapCount: material.gaps.length,
    passageCount: material.passages.length, graph: material.graph,
    estimatedStations: resolveStationCount(request.minutes ?? 150, material.ideas.length), warnings};
}

export interface MobileImmersionGenerationContext {
  material: ImmersionMaterial;
  revision: string;
  scope: ImmersionScope;
  offlineSourceVersion?: 1;
}
export interface MobileImmersionOfflineSource {
  version: 1;
  topic: string;
  language: PromptLanguage;
  material: ImmersionMaterial;
  warnings: string[];
}

/** A topic's downloaded evidence is independent of duration, quiz and model.
 * Changing the topic or material language requires its own explicit download. */
export async function immersionContextFromCopy(request: Pick<ImmersionRequest, 'topic' | 'language' | 'minutes'>,
  copy: MobileImmersionOfflineSource, hash: MobileSourceHasher = hashMobileSource): Promise<MobileImmersionGenerationContext> {
  if (!request || typeof request.topic !== 'string' || !request.topic.trim() || request.topic.length > 10_000
    || !Number.isFinite(request.minutes) || request.minutes < 1 || request.minutes > 1440) throw new Error('invalid_immersion_request');
  if (!copy || copy.version !== 1 || copy.topic !== request.topic.trim() || copy.language !== mobileImmersionLanguage(request.language)
    || copy.material?.topic !== copy.topic || !Array.isArray(copy.material.ideas) || !Array.isArray(copy.material.passages)
    || !Array.isArray(copy.material.works) || !Array.isArray(copy.material.authors) || !Array.isArray(copy.material.themes)
    || !Array.isArray(copy.material.debates) || !Array.isArray(copy.material.gaps) || !Array.isArray(copy.material.edges)
    || !Array.isArray(copy.material.graph?.nodes) || !Array.isArray(copy.material.graph?.edges)
    || !Array.isArray(copy.warnings) || copy.warnings.some(warning => typeof warning !== 'string')) throw new Error('immersion_offline_source_unavailable');
  return {material: copy.material, revision: await hash(mobileSourceRevisionInput(copy.material)), offlineSourceVersion: 1,
    scope: immersionScopeFromMaterial(request, copy.material, true, copy.warnings)};
}
