import {createHash} from 'node:crypto';
import type {WritingWorkshopDraft, WritingWorkshopSavedDraft} from '@shared/types';
import {PROMPT_LANGUAGES} from '@shared/types';
import {normalizePromptLanguage} from '@shared/promptLanguageOptions';
import {mobileSourceRevisionInput} from '@shared/mobileOfflineSource';
import {WORKSHOP_SOURCE_GROUPS, normalizeMobileWorkshopSelection, type MobileWorkshopRequest,
  type MobileWorkshopSource, type MobileWorkshopSave, type WorkshopSourceGroup} from '@shared/mobileWritingWorkshop';
import {writingWorkshopPromptPack} from '@shared/writingWorkshopPromptPacks';
import {getSettings} from '../db/settingsRepo';
import {getDb} from '../db/database';
import {activeManualIdeaIds} from '../db/manualIdeaVisibility';
import {getContradictions} from '../graph/graphService';
import {listTutorRoutes} from '../db/tutorRepo';
import {getWritingWorkshopDraft, saveWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {selectedWritingWorkshopMaterial, finishMobileWritingWorkshop} from './writingWorkshop';

const hash = (value: unknown) => createHash('sha256').update(mobileSourceRevisionInput(value)).digest('hex');
const groups = Object.values(WORKSHOP_SOURCE_GROUPS);

export function mobileWritingWorkshopCatalogue(input: {selectionKey: string; query?: string; limit: number; offset: number}) {
  if (!input || !Object.hasOwn(WORKSHOP_SOURCE_GROUPS, input.selectionKey) || !Number.isSafeInteger(input.limit)
    || input.limit < 1 || input.limit > 200 || !Number.isSafeInteger(input.offset) || input.offset < 0
    || (input.query != null && (typeof input.query !== 'string' || input.query.length > 512))
    || Object.keys(input).some(key => !['selectionKey','query','limit','offset'].includes(key))) throw new Error('invalid_workshop_catalogue');
  const db = getDb();
  let rows: {selection_id: string; label: string}[];
  switch (input.selectionKey) {
    case 'workIds': rows = db.prepare('SELECT nodus_id AS selection_id, title AS label FROM works WHERE archived=0').all() as typeof rows; break;
    case 'ideaIds': {
      rows = db.prepare('SELECT global_id AS selection_id, label FROM ideas').all() as typeof rows;
      const active = getSettings().academicMode === 'manual' ? activeManualIdeaIds(db) : null;
      if (active) rows = rows.filter(row => active.has(row.selection_id));
      break;
    }
    case 'themeIds': rows = db.prepare('SELECT theme_id AS selection_id, label FROM themes').all() as typeof rows; break;
    case 'gapIds': rows = db.prepare('SELECT id AS selection_id, substr(statement,1,240) AS label FROM gaps').all() as typeof rows; break;
    case 'passageIds': rows = db.prepare(`SELECT p.passage_id AS selection_id, substr(p.text,1,240) AS label FROM passages p
      JOIN works w ON w.nodus_id=p.nodus_id WHERE w.archived=0
      AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))`).all() as typeof rows; break;
    case 'contradictionIds': rows = getContradictions().map(detail => ({selection_id: detail.edge.id, label: `${detail.fromLabel} ↔ ${detail.toLabel}`})); break;
    case 'tutorRouteIds': rows = listTutorRoutes().map(route => ({selection_id: route.id, label: route.route.title})); break;
    default: throw new Error('invalid_workshop_catalogue');
  }
  rows = rows.map(row => ({selection_id: String(row.selection_id), label: row.label ?? String(row.selection_id)}))
    .sort((a,b) => a.selection_id < b.selection_id ? -1 : a.selection_id > b.selection_id ? 1 : 0);
  const revision = hash([input.selectionKey, rows]);
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const needle = fold(input.query?.trim() ?? '');
  const matching = needle ? rows.filter(row => fold(row.label).includes(needle) || fold(row.selection_id).includes(needle)) : rows;
  const items = matching.slice(input.offset, input.offset + input.limit);
  return {items, total: matching.length, offset: input.offset, limit: input.limit,
    hasMore: input.offset + items.length < matching.length, revision};
}

export async function mobileWritingWorkshopSource(selectionInput: unknown): Promise<MobileWorkshopSource> {
  const selection = normalizeMobileWorkshopSelection(selectionInput);
  const promptLanguage = normalizePromptLanguage(getSettings().promptLanguage);
  const prompt = writingWorkshopPromptPack(promptLanguage);
  const configuration = {promptLanguage, system: prompt.system, contextRule: prompt.contextRule,
    kindLabels: prompt.kindLabels, maxOutputTokens: 16000};
  const material = await selectedWritingWorkshopMaterial(selection, promptLanguage);
  const sourceGroups = Object.fromEntries(Object.entries(WORKSHOP_SOURCE_GROUPS).map(([key, group]) => {
    const items = material[group];
    if (!Array.isArray(items)) throw new Error('invalid_workshop_source');
    const byId = new Map(items.map(value => [String(value.id), value as Record<string, unknown>]));
    const selected = selection[key as keyof typeof selection];
    const values = selected.map(id => {
      const value = byId.get(id);
      if (!value) throw new Error('workshop_source_unavailable');
      return {id, revision: hash([configuration, group, id, value]), value};
    });
    return [group, values];
  })) as Record<WorkshopSourceGroup, MobileWorkshopSource['groups'][WorkshopSourceGroup]>;
  const source: MobileWorkshopSource = {version: 1, configurationRevision: hash(configuration), ...configuration, groups: sourceGroups};
  if (Buffer.byteLength(JSON.stringify(source)) > 800_000) throw new Error('workshop_selected_context_too_large');
  return source;
}

function validateRequest(request: MobileWorkshopRequest): void {
  const brief = request?.brief;
  if (!brief || !['literature_review','theoretical_framework','debate','gap_justification','chapter_section','research_question'].includes(brief.kind)
    || typeof brief.objective !== 'string' || !brief.objective.trim() || brief.objective.length > 16_000
    || (brief.audience != null && (typeof brief.audience !== 'string' || brief.audience.length > 4000))
    || (brief.tone != null && !['academic','synthetic','critical','exploratory'].includes(brief.tone))
    || (brief.language != null && !(PROMPT_LANGUAGES as readonly string[]).includes(brief.language))
    || (request.title != null && (typeof request.title !== 'string' || request.title.length > 2000))
    || !request.model || typeof request.model.provider !== 'string' || !request.model.provider
    || typeof request.model.model !== 'string' || !request.model.model || request.model.model.length > 512) throw new Error('invalid_workshop_request');
  const selection = normalizeMobileWorkshopSelection(request.selection);
  if (Object.values(selection).every(ids => ids.length === 0)) throw new Error('workshop_sources_required');
}

/** Lost acknowledgements return the original saved draft even if its source was
 * edited later. A changed request cannot reuse the publication's UUID. */
export async function saveMobileWritingWorkshop(input: MobileWorkshopSave): Promise<WritingWorkshopSavedDraft> {
  if (!input || typeof input.raw !== 'string' || !input.raw.trim() || input.raw.length > 400_000
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)
    || !['linked_corpus','device_downloads'].includes(input.sourceScope)
    || !input.source || input.source.version !== 1 || Buffer.byteLength(JSON.stringify(input)) > 1_200_000) throw new Error('invalid_workshop_publication');
  validateRequest(input.request);
  const fingerprint = hash([input.request, input.source, input.raw, input.sourceScope]);
  const prior = getWritingWorkshopDraft(input.requestId);
  if (prior) {
    if (prior.draft.mobileGenerationReceipt?.inputHash !== fingerprint) throw new Error('workshop_idempotency_conflict');
    return prior;
  }
  const source = await mobileWritingWorkshopSource(input.request.selection);
  if (input.revision !== source.configurationRevision || hash(input.source) !== hash(source)) throw new Error('workshop_generation_conflict');
  const brief = input.request.brief;
  const selection = normalizeMobileWorkshopSelection(input.request.selection);
  const payload: Record<string, unknown> = {
    brief: {tipo: source.kindLabels[brief.kind], objetivo: brief.objective, audiencia: brief.audience ?? null,
      tono: brief.tone ?? 'academic', lengua: brief.language ?? 'es'},
    ...Object.fromEntries(groups.map(group => [group, source.groups[group].map(item => item.value)])), regla: source.contextRule,
  };
  const stats: WritingWorkshopDraft['stats'] = {
    selectedIdeas: source.groups.ideas.length, selectedThemes: source.groups.temas.length,
    selectedGaps: source.groups.huecos.length, selectedContradictions: source.groups.contradicciones.length,
    selectedWorks: source.groups.obras.length, selectedPassages: source.groups.pasajes_evidencia.length,
    selectedTutorRoutes: source.groups.rutas_tutor.length, contextChars: JSON.stringify(payload).length, truncated: false,
  };
  const draft = finishMobileWritingWorkshop(input.raw, brief, selection, payload, stats, source.promptLanguage);
  draft.generationModel = input.request.model;
  draft.mobileGenerationReceipt = {requestId: input.requestId, inputHash: fingerprint, sourceScope: input.sourceScope};
  if (input.sourceScope === 'device_downloads') {
    const notice = 'Generado en el móvil a partir de las fuentes descargadas y seleccionadas; no representa todo el vault.';
    draft.limitations = [notice, ...draft.limitations];
    draft.draftMarkdown = `> ${notice}\n\n${draft.draftMarkdown}`;
  }
  return saveWritingWorkshopDraft({draft, title: input.request.title, model: input.request.model}, input.requestId);
}
