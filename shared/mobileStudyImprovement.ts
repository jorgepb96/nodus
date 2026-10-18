import type {PromptLanguage} from './types';
import type {StudyImproveRequest, StudyImproveResult, StudyStyle} from './studyImprove';
import {prepareStudyImprovement} from './studyImprovementGeneration';
import {normalizePromptLanguage} from './promptLanguageOptions';
import {hashMobileSource, mobileSourceRevisionInput, type MobileSourceHasher} from './mobileOfflineSource';

export interface MobileStudyImprovementContext {
  revision: string;
  style: StudyStyle;
  promptLanguage: PromptLanguage;
  uiLanguage: PromptLanguage;
  maxOutputTokens: number;
  offlineSourceVersion?: 1;
}
export interface MobileStudyImprovementSave {
  request: StudyImproveRequest;
  revision: string;
  raw: string;
  requestId: string;
  offlineSourceVersion?: 1;
}
export type MobileStudyImprovementResult = StudyImproveResult;

/** One explicitly selected source, never a vault snapshot. Styles and settings
 * are the same read-only configuration used to prepare a Mac context. */
export interface MobileStudyImprovementOfflineSource {
  version: 1;
  noteId?: string;
  documentId?: string;
  source: {id: string; title: string; content?: string; content_markdown?: string};
  styles: StudyStyle[];
  promptLanguage: PromptLanguage;
  uiLanguage: PromptLanguage;
  maxOutputTokens: number;
}

export async function studyImprovementContextFromCopy(request: StudyImproveRequest, copy: MobileStudyImprovementOfflineSource,
  hash: MobileSourceHasher = hashMobileSource): Promise<MobileStudyImprovementContext> {
  if (!request || typeof request.text !== 'string' || typeof request.styleId !== 'string'
    || !['selection','paragraph','section','document'].includes(request.scope)
    || !['minimal','moderate','deep'].includes(request.level) || !['similar','shorter','develop'].includes(request.length)
    || !['preserve','free'].includes(request.mode) || !request.model?.provider || !request.model.model
    || new TextEncoder().encode(JSON.stringify(request)).length > 500_000) throw new Error('invalid_study_improvement_request');
  if (!copy || copy.version !== 1 || Boolean(request.noteId) === Boolean(request.documentId)
    || request.noteId !== copy.noteId || request.documentId !== copy.documentId
    || copy.source?.id !== (request.noteId ?? request.documentId)
    || typeof copy.source.title !== 'string'
    || typeof (request.noteId ? copy.source.content : copy.source.content_markdown) !== 'string'
    || !Array.isArray(copy.styles) || !Number.isFinite(copy.maxOutputTokens) || copy.maxOutputTokens < 128) throw new Error('writing_offline_source_unavailable');
  const style = copy.styles.find(item => item.id === request.styleId);
  if (!style) throw new Error('study_improvement_style_unavailable');
  const promptLanguage = normalizePromptLanguage(request.promptLanguage ?? copy.promptLanguage);
  prepareStudyImprovement(request, style, promptLanguage);
  return {revision: await hash(mobileSourceRevisionInput([request, copy.source, style, promptLanguage])), style, promptLanguage,
    uiLanguage: copy.uiLanguage, maxOutputTokens: Math.min(style.maxOutputTokens, copy.maxOutputTokens), offlineSourceVersion: 1};
}
