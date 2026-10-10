import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {TRANSLATION_LANGUAGES, type GenerateTranslationRequest} from '@shared/types';
import type {MobileTranslationContext, MobileTranslationSave} from '@shared/mobileTranslation';
import {assertTranslationIntegrity, titleFromMarkdown, researchTranslationSource} from '@shared/translationGeneration';
import {getDb} from '../db/database';
import {activeVaultDir} from '../vaults/vaultRegistry';
import * as translations from '../db/translationsRepo';

/** Read only the selected vault. A renderer cannot create translations for a
 * missing entity, and a changed source invalidates a pending phone result. */
function entitySource(request: GenerateTranslationRequest): unknown {
  const db = getDb();
  const id = request.entityId;
  switch (request.entityKind) {
    case 'deep_research': return db.prepare('SELECT title,draft_json FROM writing_saved_drafts WHERE id=?').get(id);
    case 'immersion': return db.prepare('SELECT title,topic,plan_json FROM immersion_sessions WHERE id=?').get(id);
    case 'study_document': return db.prepare('SELECT title,content_markdown FROM study_docs WHERE id=? AND deleted_at IS NULL').get(id);
    case 'study_transcript': return db.prepare('SELECT content_markdown FROM study_transcripts WHERE id=?').get(id);
    case 'study_subject': {
      const subject = db.prepare('SELECT name FROM study_subjects WHERE id=?').get(id);
      if (!subject) return undefined;
      return {subject, documents: db.prepare(`SELECT d.id,d.title,d.content_markdown FROM study_docs d JOIN study_placements p ON p.document_id=d.id
        WHERE p.subject_id=? AND p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.archived_at IS NULL ORDER BY d.id`).all(id)};
    }
    case 'study_question': return db.prepare('SELECT * FROM study_questions WHERE id=?').get(id);
    case 'study_assistant': {
      const file = path.join(activeVaultDir(), 'study-chat-history.json');
      if (!fs.existsSync(file)) return undefined;
      const history = JSON.parse(fs.readFileSync(file, 'utf8')) as {conversations?: Array<{messages?: Array<{id:string;content:string}>}>};
      return history.conversations?.flatMap(conversation => conversation.messages ?? []).find(message => message.id === id);
    }
    default: return undefined;
  }
}

export function mobileTranslationContext(request: GenerateTranslationRequest): MobileTranslationContext {
  if (!request || typeof request.entityId !== 'string' || !request.entityId || request.entityId.length > 256
    || typeof request.sourceTitle !== 'string' || request.sourceTitle.length > 10_000
    || typeof request.sourceMarkdown !== 'string' || !request.sourceMarkdown.trim() || Buffer.byteLength(request.sourceMarkdown) > 5_000_000
    || !request.model || typeof request.model.model !== 'string' || !request.model.model || typeof request.model.provider !== 'string') throw new Error('invalid_translation_request');
  const language = TRANSLATION_LANGUAGES.find(item => item.code === request.language);
  if (!language) throw new Error('unsupported_translation_language');
  const source = entitySource(request);
  if (!source) throw new Error('translation_source_unavailable');
  if (request.entityKind === 'deep_research') {
    const row = source as {title:string;draft_json:string};
    const draft = JSON.parse(row.draft_json);
    if (typeof draft.title !== 'string' || typeof draft.draftMarkdown !== 'string'
      || request.sourceTitle !== draft.title || request.sourceMarkdown !== researchTranslationSource(draft)) throw new Error('translation_source_mismatch');
  }
  const revision = createHash('sha256').update(JSON.stringify([request.entityKind,request.entityId,source,request.sourceTitle,request.sourceMarkdown])).digest('hex');
  return {revision, language};
}

export function beginMobileTranslation(request: GenerateTranslationRequest) {
  const {language} = mobileTranslationContext(request);
  return translations.beginContentTranslation({...request, languageLabel:language.nativeName, model:request.model ?? null});
}

export function saveMobileTranslation(input: MobileTranslationSave) {
  if (!input || typeof input.markdown !== 'string' || Buffer.byteLength(input.markdown) > 10_000_000
    || typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new Error('invalid_translation_result');
  const {revision, language} = mobileTranslationContext(input.request);
  if (revision !== input.revision) throw new Error('translation_generation_conflict');
  assertTranslationIntegrity(input.request.sourceMarkdown, input.markdown);
  return translations.upsertContentTranslation({...input.request, languageLabel:language.nativeName,
    title:titleFromMarkdown(input.markdown,input.request.sourceTitle), markdown:input.markdown, model:input.request.model ?? null});
}

export function failMobileTranslation(request: GenerateTranslationRequest, issue: string) {
  mobileTranslationContext(request);
  const pending = translations.listContentTranslations(request.entityKind,request.entityId).find(item => item.language === request.language && item.status === 'generating');
  if (pending) translations.failContentTranslation(pending.id,String(issue));
}
