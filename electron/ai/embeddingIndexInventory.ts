import { createHash } from 'node:crypto';
import type { EmbeddingIndexProfile } from '@shared/embeddingIndexes';
import { isEmbeddingGemma2, prepareEmbeddingGemma2Input } from '@shared/embeddingGemma2';
import { evaluateAccess } from '@shared/testimonyAccess';
import { archiveEmbeddingText } from '@shared/archiveDiscovery';
import { getDb } from '../db/database';
import { EMBEDDING_FAMILIES } from '../db/embeddingIndexSchema';
import { embeddingTextForIdea, embeddingTextHash, IDEA_EMBEDDING_THEME_LABELS_SQL } from '../db/ideaEmbeddingText';
import { noteEmbeddingText } from '../db/notesRepo';
import { getSettings } from '../db/settingsRepo';
import { EMPTY_STUDY_BIBLIOGRAPHY } from '@shared/studyMaterials';
import { studyMaterialEmbeddingText } from './studyMaterialIndex';
import { accessContextFor } from '../db/testimonyRepo';
import { segmentsToIndex } from '../db/testimonyEmbeddingsRepo';
import { archiveEmbeddingAllowed } from '../archive/archiveDiscovery';
import { collectStudySearchEntries, studySearchExcludedSourceIds } from './studySearch';
import { chapterIdeaEmbeddingText } from './chapterIdeas';

export interface EmbeddingIndexInput {
  family: string;
  entityId: string;
  text: string;
  textHash: string;
  title?: string;
  excluded?: string;
  interviewId?: string;
  transcriptId?: string;
  sourceStamp?: string;
  sourceFields?: string[];
  workId?: string;
}
const str = (row: Record<string, unknown>, key: string): string => row[key] == null ? '' : String(row[key]);
export const externalEmbeddingProfile = (profile: EmbeddingIndexProfile) => !['nodus', 'ollama', 'lmstudio'].includes(profile.provider);

/** No file extraction, OCR, analysis or provider calls. This is also the preview inventory. */
export function collectEmbeddingIndexInputs(profile: EmbeddingIndexProfile): EmbeddingIndexInput[] {
  const db = getDb();
  const inputs: EmbeddingIndexInput[] = [];
  const settings = getSettings();
  const workTitles = new Map((db.prepare('SELECT nodus_id,title FROM works WHERE archived=0').all() as Array<{ nodus_id: string; title: string }>).map(row => [row.nodus_id, row.title]));
  for (const family of EMBEDDING_FAMILIES) {
    if (family.table === 'testimony_segment_embeddings') continue;
    const columns = (db.pragma(`table_info("${family.table}")`) as Array<{ name: string; type: string }>).filter(column => column.type.toUpperCase() !== 'BLOB');
    const rows = family.table === 'ideas'
      ? db.prepare(`SELECT i.*,${IDEA_EMBEDDING_THEME_LABELS_SQL} theme_labels FROM ideas i WHERE i.orphaned_at IS NULL`).all()
      : db.prepare(`SELECT ${columns.map(column => `"${column.name}"`).join(',')} FROM "${family.table}"`).all();
    for (const row of rows as Array<Record<string, unknown>>) {
      const entityId = str(row, family.id);
      let text = '', title: string | undefined;
      let excluded: string | undefined;
      if (['work_summaries', 'passages', 'document_vectors'].includes(family.table) && !workTitles.has(str(row, 'nodus_id'))) continue;
      if (row.deleted_at || row.archived_at || row.trashed_at) continue;
      switch (family.table) {
        case 'ideas': text = embeddingTextForIdea({ type: str(row, 'type'), label: str(row, 'label'), statement: str(row, 'statement'), themes: str(row, 'theme_labels').split(',').filter(Boolean) }); break;
        case 'work_summaries': text = str(row, 'summary'); title = workTitles.get(str(row, 'nodus_id')); break;
        case 'passages': case 'document_vectors': text = str(row, 'text'); title = workTitles.get(str(row, 'nodus_id')); break;
        case 'project_chapter_chunks': text = str(row, 'text').slice(0, 2000); break;
        case 'project_chapter_ideas': text = chapterIdeaEmbeddingText({ type: str(row, 'type'), label: str(row, 'label'), statement: str(row, 'statement') }); break;
        case 'notes': text = noteEmbeddingText({ title: str(row, 'title'), content: str(row, 'content') }); break;
        case 'archive_items':
          text = archiveEmbeddingText({ title: str(row, 'title'), description: str(row, 'description'), extractedText: str(row, 'extracted_text'), docType: str(row, 'doc_type') });
          if (!archiveEmbeddingAllowed(entityId, profile.provider)) excluded = 'source_policy';
          break;
        case 'study_docs': text = `${str(row, 'title')}\n${str(row, 'content_markdown')}`; break;
        case 'study_materials': {
          let metadata = {}, bibliography = { ...EMPTY_STUDY_BIBLIOGRAPHY };
          try { metadata = JSON.parse(str(row, 'metadata_json')); } catch { /* metadata is optional */ }
          try { bibliography = { ...bibliography, ...JSON.parse(str(row, 'bibliography_json')) }; } catch { /* bibliography is optional */ }
          text = studyMaterialEmbeddingText({ title: str(row, 'title'), description: str(row, 'description'), visualDescription: str(row, 'visual_description'), metadata, bibliography, extractedText: str(row, 'extracted_text') }); title = str(row, 'title'); break;
        }
        case 'study_ideas': text = `${str(row, 'type')}\n${str(row, 'label')}\n${str(row, 'statement')}`; break;
      }
      if (!text.trim()) excluded = 'no_text';
      const hashText = family.table === 'work_summaries' && profile.provider === 'nodus' && isEmbeddingGemma2(profile.model)
        ? prepareEmbeddingGemma2Input(text, 'document', title) : text;
      const textHash = family.table === 'document_vectors' ? createHash('sha256').update(text).digest('hex')
        : family.table === 'study_ideas' ? embeddingTextHash(`${str(row, 'label')}\n${str(row, 'statement')}`) : embeddingTextHash(hashText);
      const sourceFields: string[] = family.table === 'ideas' ? [...family.content, 'theme_labels'] : [...family.content];
      inputs.push({ family: family.table, entityId, text, title, textHash, excluded, sourceFields,
        sourceStamp: JSON.stringify(sourceFields.map(field => row[field] ?? null)), workId: str(row, 'nodus_id') || undefined });
    }
  }
  const interviews = db.prepare('SELECT id FROM testimony_interviews WHERE deleted_at IS NULL').all() as Array<{ id: string }>;
  for (const { id } of interviews) {
    const access = accessContextFor(id);
    const options = { now: new Date(), policy: { allowExternalProviders: settings.testimonyAllowExternalProviders } };
    const decision = evaluateAccess(access, 'embeddingIndex', options);
    const externalDecision = externalEmbeddingProfile(profile) ? evaluateAccess(access, 'externalAi', options) : decision;
    const excluded = !decision.allowed ? decision.reason : !externalDecision.allowed ? externalDecision.reason
      : decision.requiresPseudonymization || externalDecision.requiresPseudonymization ? 'pseudonymization_required' : undefined;
    for (const segment of segmentsToIndex(id)) inputs.push({ family: 'testimony_segment_embeddings', entityId: segment.id,
      text: segment.text, textHash: embeddingTextHash(segment.text), interviewId: id, transcriptId: segment.transcriptId, excluded });
  }
  const excludedStudySources = new Set(studySearchExcludedSourceIds());
  for (const entry of collectStudySearchEntries()) inputs.push({ family: 'study_search', entityId: entry.indexId,
    text: `${entry.title}\n${entry.text}`, textHash: entry.contentHash, excluded: excludedStudySources.has(entry.sourceId) ? 'user_excluded' : undefined });
  return inputs;
}

export function embeddingInputStillCurrent(input: EmbeddingIndexInput, profile: EmbeddingIndexProfile, studyEntries?: Map<string, string>): boolean {
  const db = getDb();
  if (input.family === 'study_search') return studyEntries?.get(input.entityId) === input.textHash;
  if (input.family === 'testimony_segment_embeddings') {
    const segment = db.prepare('SELECT text,transcript_id FROM testimony_transcript_segments WHERE id=?').get(input.entityId) as { text: string; transcript_id: string } | undefined;
    if (!segment || segment.text !== input.text || segment.transcript_id !== input.transcriptId) return false;
    const options = { now: new Date(), policy: { allowExternalProviders: getSettings().testimonyAllowExternalProviders } };
    const access = accessContextFor(input.interviewId!);
    const decision = evaluateAccess(access, 'embeddingIndex', options);
    const external = externalEmbeddingProfile(profile) ? evaluateAccess(access, 'externalAi', options) : decision;
    return decision.allowed && !decision.requiresPseudonymization && external.allowed && !external.requiresPseudonymization;
  }
  const family = EMBEDDING_FAMILIES.find(family => family.table === input.family);
  if (!family) return false;
  const fields = family.content.map(field => `i."${field}"`);
  if (family.table === 'ideas') fields.push(`${IDEA_EMBEDDING_THEME_LABELS_SQL} theme_labels`);
  const row = db.prepare(`SELECT ${fields.join(',')} FROM "${family.table}" i WHERE i."${family.id}"=?`).get(input.entityId) as Record<string, unknown> | undefined;
  if (!row || JSON.stringify(input.sourceFields!.map(field => row[field] ?? null)) !== input.sourceStamp) return false;
  if (input.workId) {
    const work = db.prepare('SELECT title FROM works WHERE nodus_id=? AND archived=0').get(input.workId) as { title: string } | undefined;
    if (!work || (input.title !== undefined && work.title !== input.title)) return false;
  }
  return family.table !== 'archive_items' || archiveEmbeddingAllowed(input.entityId, profile.provider);
}
