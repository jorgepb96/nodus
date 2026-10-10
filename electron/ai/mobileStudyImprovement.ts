import {createHash} from 'node:crypto';
import type {StudyImproveRequest, StudyImproveResult} from '@shared/studyImprove';
import type {MobileStudyImprovementContext, MobileStudyImprovementSave} from '@shared/mobileStudyImprovement';
import {prepareStudyImprovement, finishStudyImprovement} from '@shared/studyImprovementGeneration';
import {normalizePromptLanguage} from '@shared/promptLanguageOptions';
import {getDb} from '../db/database';
import {getSettings} from '../db/settingsRepo';
import {getStudyStyle, listStudyImprovementLog, recordStudyImprovement} from '../db/studyStylesRepo';

const hash = (text:string) => createHash('sha256').update(text).digest('hex');
export function mobileStudyImprovementContext(request: StudyImproveRequest): MobileStudyImprovementContext {
  if (!request || typeof request.text !== 'string' || typeof request.styleId !== 'string'
    || !['selection','paragraph','section','document'].includes(request.scope)
    || !['minimal','moderate','deep'].includes(request.level)
    || !['similar','shorter','develop'].includes(request.length) || !['preserve','free'].includes(request.mode)
    || !request.model || typeof request.model.provider !== 'string' || !request.model.provider
    || typeof request.model.model !== 'string' || !request.model.model
    || (request.protectedTerms !== undefined && (!Array.isArray(request.protectedTerms) || request.protectedTerms.length > 1000
      || request.protectedTerms.some(term => typeof term !== 'string' || term.length > 10_000)))
    || Buffer.byteLength(JSON.stringify(request)) > 500_000) throw new Error('invalid_study_improvement_request');
  const target = request.noteId || request.documentId;
  if (Boolean(request.noteId) === Boolean(request.documentId) || typeof target !== 'string' || target.length > 256) throw new Error('invalid_study_improvement_target');
  const source = request.noteId
    ? getDb().prepare('SELECT id,title,content FROM notes WHERE id=? AND trashed_at IS NULL').get(target)
    : getDb().prepare('SELECT id,title,content_markdown FROM study_docs WHERE id=? AND deleted_at IS NULL').get(target);
  if (!source) throw new Error('study_improvement_source_unavailable');
  const style = getStudyStyle(request.styleId);
  if (!style) throw new Error('study_improvement_style_unavailable');
  const settings = getSettings();
  const promptLanguage = normalizePromptLanguage(request.promptLanguage ?? settings.promptLanguage);
  prepareStudyImprovement(request,style,promptLanguage);
  return {revision:hash(JSON.stringify([request,source,style,promptLanguage])),style,promptLanguage,
    uiLanguage:normalizePromptLanguage(settings.uiLanguage),maxOutputTokens:Math.min(style.maxOutputTokens,settings.studyAiMaxOutputTokens)};
}

/** The phone supplies only the generated preview. The editor applies it through
 * its normal revision-aware save; generating never rewrites the source. */
export function saveMobileStudyImprovement(input: MobileStudyImprovementSave): StudyImproveResult {
  if (!input || typeof input.raw !== 'string' || input.raw.length > 200_000
    || typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new Error('invalid_study_improvement_result');
  const context = mobileStudyImprovementContext(input.request);
  if (context.revision !== input.revision) throw new Error('study_improvement_generation_conflict');
  const result = finishStudyImprovement(input.request,context.style,input.raw,context.promptLanguage,context.uiLanguage);
  const originalHash = hash(input.request.text.replace(/\r\n/g,'\n')), resultHash = hash(result.text);
  const prior = listStudyImprovementLog((input.request.noteId ?? input.request.documentId)!).find(log => log.id === input.requestId);
  if (prior && (prior.originalHash !== originalHash || prior.resultHash !== resultHash || prior.styleId !== context.style.id
    || prior.modelProvider !== input.request.model!.provider || prior.modelName !== input.request.model!.model)) throw new Error('study_improvement_idempotency_conflict');
  if (!prior) recordStudyImprovement({documentId:input.request.documentId ?? null,noteId:input.request.noteId ?? null,
    styleId:context.style.id,scope:input.request.scope,mode:input.request.mode,level:input.request.level,length:input.request.length,
    modelProvider:input.request.model!.provider,modelName:input.request.model!.model,originalHash,resultHash,
    originalChars:input.request.text.replace(/\r\n/g,'\n').length,resultChars:result.text.length,warnings:result.warnings,action:'generated'},input.requestId);
  return {...result,logId:input.requestId,styleId:context.style.id,modelProvider:input.request.model!.provider,
    modelName:input.request.model!.model,originalHash,resultHash};
}
