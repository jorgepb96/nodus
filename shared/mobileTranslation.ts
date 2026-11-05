import type {ContentTranslationSummary, GenerateTranslationRequest, TranslationLanguage} from './types';
import {TRANSLATION_LANGUAGES} from './types';
import {researchTranslationSource} from './translationGeneration';
import {hashMobileSource, mobileSourceRevisionInput, type MobileSourceHasher} from './mobileOfflineSource';

export interface MobileTranslationContext {
  revision: string;
  language: TranslationLanguage;
  offlineSourceVersion?: 1;
}
export interface MobileTranslationSave {
  request: GenerateTranslationRequest;
  revision: string;
  markdown: string;
  requestId: string;
  offlineSourceVersion?: 1;
}
export type MobileTranslationResult = ContentTranslationSummary;

export interface MobileTranslationOfflineSource {
  version: 1;
  entityKind: GenerateTranslationRequest['entityKind'];
  entityId: string;
  source: unknown;
}

export async function translationContextFromCopy(request: GenerateTranslationRequest, copy: MobileTranslationOfflineSource,
  hash: MobileSourceHasher = hashMobileSource): Promise<MobileTranslationContext> {
  if (!request || typeof request.entityId !== 'string' || !request.entityId || request.entityId.length > 256
    || typeof request.sourceTitle !== 'string' || request.sourceTitle.length > 10_000
    || typeof request.sourceMarkdown !== 'string' || new TextEncoder().encode(request.sourceMarkdown).length > 5_000_000
    || !request.model?.model || typeof request.model.provider !== 'string') throw new Error('invalid_translation_request');
  if (!copy || copy.version !== 1 || copy.entityKind !== request.entityKind || copy.entityId !== request.entityId
    || !copy.source || typeof copy.source !== 'object' || !request.sourceMarkdown?.trim()) throw new Error('translation_offline_source_unavailable');
  const language = TRANSLATION_LANGUAGES.find(item => item.code === request.language);
  if (!language) throw new Error('unsupported_translation_language');
  if (request.entityKind === 'deep_research') {
    const row = copy.source as {draft_json: string};
    const draft = JSON.parse(row.draft_json);
    if (typeof draft.title !== 'string' || typeof draft.draftMarkdown !== 'string'
      || request.sourceTitle !== draft.title || request.sourceMarkdown !== researchTranslationSource(draft)) throw new Error('translation_source_mismatch');
  }
  return {revision: await hash(mobileSourceRevisionInput([request.entityKind, request.entityId, copy.source, request.sourceTitle, request.sourceMarkdown])),
    language, offlineSourceVersion: 1};
}
