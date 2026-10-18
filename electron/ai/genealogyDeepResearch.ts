import type {DeepResearchApproach} from '@shared/deepResearchApproaches';
import type {DeepResearchProgress,DeepResearchReport,DeepResearchRequest} from '@shared/types';
import {normalizeDeepResearchApproach} from '@shared/deepResearchApproaches';
import {normalizePromptLanguage} from '@shared/editorAiPrompts';
import {genealogyDeepResearchRuntimeCopy} from '@shared/genealogyDeepResearchPromptPacks';
import {planApproachRetrieval} from './deepResearchApproaches';
import {portableGenealogyDeepResearch,type GenSource,type FamilyFacts,type FocusPerson,type CompanionGenealogyRunOptions} from '@shared/portableGenealogyDeepResearch';
export {applyGenealogyCitations,buildReferences} from '@shared/portableGenealogyDeepResearch';
export type {GenSource,FamilyFacts,FocusPerson,GenPlanSection,GenPlan,GenPlanInput,GenSectionInput,GenFinalizeInput,GenFinalizeResult,GenDeepDeps,CompanionGenealogyRunOptions} from '@shared/portableGenealogyDeepResearch';
import { getSettings } from '../db/settingsRepo';
import { listPersons, getPerson, listEvents, listEvidenceFor } from '../db/entitiesRepo';
import { allRelationships } from '../db/relationshipsRepo';
import { allSocialRelations } from '../db/socialRepo';
import { listItems, listItemsForPerson, findArchiveItemsSimilar } from '../db/archiveRepo';
import { findSimilarWorksPaged } from '../db/workSummariesRepo';
import { getWork,listWorksPage } from '../db/worksRepo';
import type {GenealogyResearchCapture} from '@shared/mobileGenealogyResearch';
import {getLibraryReaderRawContent} from '../libraryReader/libraryReaderStore';
import {libraryMarkdownWithPageMarkers,readDocumentarySourceMap} from '../library/librarySourcePages';
import { resolveWorkText } from '../extraction/textExtractor';
import { LOCAL_USER_ID } from '../zotero/zoteroClient';
import { completeJson, completeText, embedQuery } from './aiClient';
const MAX_DOC_SOURCES = 24;
const MAX_WORK_SOURCES = 10;
const DOC_SNIPPET = 300;
const MAX_PERSONS_CONTEXT = 200;
const MAX_EVENTS_CONTEXT = 200;
/** Build the family-facts block (bounded) shared by the plan and every section. */
export function buildFamilyFacts(): FamilyFacts {
  const persons = listPersons();
  const nameById = new Map(persons.map((p) => [p.personId, p.displayName]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v?: string) => {
    if (v) (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  for (const r of allRelationships()) {
    if (r.type === 'parent') {
      push(children, r.fromPerson, nameById.get(r.toPerson));
      push(parents, r.toPerson, nameById.get(r.fromPerson));
    } else if (r.type === 'spouse') {
      push(spouses, r.fromPerson, nameById.get(r.toPerson));
      push(spouses, r.toPerson, nameById.get(r.fromPerson));
    }
  }
  return {
    personas: persons.slice(0, MAX_PERSONS_CONTEXT).map((p) => ({
      id: p.personId,
      nombre: p.displayName,
      nacimiento: p.birthDate,
      defuncion: p.deathDate,
      padres: parents.get(p.personId) ?? [],
      conyuges: spouses.get(p.personId) ?? [],
      hijos: children.get(p.personId) ?? [],
    })),
    eventos: listEvents()
      .slice(0, MAX_EVENTS_CONTEXT)
      .map((e) => ({
        tipo: e.type,
        fecha: e.date,
        lugar: e.placeName,
        participantes: e.participants.map((pt) => pt.displayName ?? nameById.get(pt.personId) ?? ''),
      })),
    relaciones_sociales: allSocialRelations().slice(0, 200).map((relation) => ({
      persona: relation.personName,
      contacto: relation.targetName,
      tipo_contacto: relation.targetKind,
      relacion: relation.role,
      notas: relation.notes,
    })),
  };
}

/** The focus person's own entry from the family facts, enriched with their biography. */
export function buildFocusPerson(personId: string, family: FamilyFacts): FocusPerson | null {
  const entry = family.personas.find((p) => p.id === personId);
  if (!entry) return null;
  const person = getPerson(personId);
  return { ...entry, biografia: person?.biography ?? null };
}

/** Retrieve the sources relevant to the question by meaning (embeddings), with a
 *  lexical/recency fallback when no embedding provider is configured. When a focus
 *  person is given, every document already linked to them is guaranteed into the
 *  pool (even if it wouldn't rank high by similarity) and the retrieval query is
 *  biased toward their name. */
export async function buildGenealogySourcePool(objective: string, focusPersonId?: string | null, promptLanguage?: string): Promise<GenSource[]> {
  const sources: GenSource[] = [];
  const seen = new Set<string>();
  const runtimeCopy = genealogyDeepResearchRuntimeCopy(normalizePromptLanguage(promptLanguage ?? getSettings().promptLanguage ?? 'es'));

  const addDoc = (item: { itemId: string; title: string; docType: string | null; extractedText: string | null; description: string | null; linkedPersons: { displayName: string }[] }) => {
    if (seen.has(item.itemId) || sources.filter((s) => s.kind === 'document').length >= MAX_DOC_SOURCES) return;
    seen.add(item.itemId);
    const text = (item.extractedText ?? item.description ?? '').trim();
    sources.push({
      id: `doc:${item.itemId}`,
      kind: 'document',
      refId: item.itemId,
      title: item.title,
      label: item.docType ?? runtimeCopy.document,
      persons: item.linkedPersons.map((p) => p.displayName),
      snippet: clip(text, DOC_SNIPPET),
      fullText: text,
    });
  };

  const focusPerson = focusPersonId ? getPerson(focusPersonId) : null;
  if (focusPerson) for (const item of listItemsForPerson(focusPerson.personId)) addDoc(item);

  const queryText = focusPerson ? `${objective.trim()}\n${focusPerson.displayName}`.trim() : objective.trim();
  const objVec = queryText ? await embedQuery(queryText) : null;
  if (objVec) for (const item of await findArchiveItemsSimilar(objVec, { limit: MAX_DOC_SOURCES, minSimilarity: 0.2 })) addDoc(item);
  // Fallback / backfill: recent documents so the report always has primary material.
  for (const item of listItems({}).slice(0, MAX_DOC_SOURCES)) addDoc(item);

  // Zotero library (secondary sources), if any, retrieved by summary similarity.
  if (objVec) {
    // Paged, so gathering the sources does not freeze the window (see db/vectorScan.ts).
    for (const row of await findSimilarWorksPaged(objVec, 0.2, MAX_WORK_SOURCES)) {
      const w = getWork(row.nodus_id);
      if (!w) continue;
      const authors = parseAuthors((w as { authors_json?: string }).authors_json ?? '[]');
      sources.push({
        id: `work:${w.nodus_id}`,
        kind: 'work',
        refId: w.nodus_id,
        title: w.title,
        label: authorYear(authors[0], w.year, runtimeCopy.author),
        persons: [],
        snippet: clip(w.title, DOC_SNIPPET),
        fullText: '', // resolved on demand while writing the section it's assigned to
      });
    }
  }
  return sources;
}

/** Explicit bounded source preparation for an autonomous report. No embed,
 * provider, OCR, extraction, indexing or model planning is invoked here. */
export function captureGenealogyResearchSource(request:DeepResearchRequest):GenealogyResearchCapture {
  const family=buildFamilyFacts(),focusPerson=request.focusPersonId?buildFocusPerson(request.focusPersonId,family):null;
  if(request.focusPersonId&&!focusPerson)throw new Error('genealogy_focus_not_captured');
  const language=normalizePromptLanguage(request.language??getSettings().promptLanguage??'es'),copy=genealogyDeepResearchRuntimeCopy(language);
  const terms=new Set(`${request.objective} ${focusPerson?.nombre??''}`.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>2));
  const all=listItems({}),linked=new Set(focusPerson?listItemsForPerson(focusPerson.id).map(item=>item.itemId):[]);
  const ranked=all.map((item,index)=>({item,index,score:[...terms].filter(term=>`${item.title} ${item.description??''} ${item.extractedText??''}`.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(term)).length})).sort((a,b)=>Number(linked.has(b.item.itemId))-Number(linked.has(a.item.itemId))||b.score-a.score||a.index-b.index);
  const documents=ranked.filter(({item})=>(item.extractedText??item.description??'').trim()).slice(0,MAX_DOC_SOURCES);
  const sources:GenSource[]=documents.map(({item})=>{const text=(item.extractedText??item.description??'').trim();return {id:`doc:${item.itemId}`,kind:'document',refId:item.itemId,title:item.title,label:item.docType??copy.document,persons:item.linkedPersons.map(person=>person.displayName),snippet:clip(text,DOC_SNIPPET),fullText:text};});
  const works=listWorksPage({},{limit:100,offset:0});
  for(const work of works.items){
    if(sources.filter(source=>source.kind==='work').length>=MAX_WORK_SOURCES)break;
    const prepared=getLibraryReaderRawContent(work.zotero_key);if(!prepared?.markdown?.trim())continue;
    const text=libraryMarkdownWithPageMarkers(prepared.markdown,readDocumentarySourceMap(prepared.folder,prepared.sourceMapFile));
    const authors=parseAuthors((work as {authors_json?:string}).authors_json??'[]');
    sources.push({id:`work:${work.nodus_id}`,kind:'work',refId:work.nodus_id,title:work.title,label:authorYear(authors[0],work.year,copy.author),persons:[],snippet:clip(work.title,DOC_SNIPPET),fullText:text});
  }
  if(!sources.length)throw new Error('genealogy_research_prepared_sources_missing');
  const evidence:GenealogyResearchCapture['evidence']=[],names=new Set(sources.flatMap(source=>source.persons));if(focusPerson)names.add(focusPerson.nombre);
  for(const person of listPersons().filter(person=>names.has(person.displayName)))for(const item of listEvidenceFor('person',person.personId).filter(item=>item.quote).slice(0,30))evidence.push({personId:person.personId,persona:person.displayName,cita:item.quote!,localizacion:item.location});
  return {language,sources,family,focusPerson,evidence,selection:{retrieval:'lexical',documentLimit:MAX_DOC_SOURCES,workLimit:MAX_WORK_SOURCES,documentsConsidered:all.length,worksConsidered:works.items.length,worksAvailable:works.total,bounded:documents.length<all.length||works.total>sources.filter(source=>source.kind==='work').length}};
}
const genealogyEngine=portableGenealogyDeepResearch({getSettings,completeJson,completeText,evidenceForPersons,resolveWorkFullText:async(nodusId,companion)=>{
      const w = getWork(nodusId);
      if (!w) return '';
      if(companion?.sourceOnly){
        const prepared=getLibraryReaderRawContent(w.zotero_key);
        if(!prepared?.markdown?.trim())throw new Error('desktop_preparation_required');
        const text=libraryMarkdownWithPageMarkers(prepared.markdown,readDocumentarySourceMap(prepared.folder,prepared.sourceMapFile));
        companion.onWorkText?.(nodusId,text);return text;
      }
      const settings = getSettings();
      const doc = await resolveWorkText(
        settings.zoteroUserId || LOCAL_USER_ID,
        w.zotero_key,
        settings.zoteroStoragePath,
        null,
        w.doi ?? null,
        { unpaywallEmail: settings.unpaywallEmail, preferZoteroFulltext: settings.preferZoteroFulltext, ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages } },
        w.item_type
      ).catch(() => ({ text: '' }));
      return doc.text ?? '';
}});
const {realDeps,specializedGenealogyDeps}=genealogyEngine;
/** Retain the existing Desktop API; portable code runs the identical loop. */
export function orchestrateGenealogyDeepResearch(...args:Parameters<typeof genealogyEngine.orchestrateGenealogyDeepResearch>):Promise<DeepResearchReport>{return genealogyEngine.orchestrateGenealogyDeepResearch(...args);}
export async function generateGenealogyDeepResearchReport(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void,
  signal?: AbortSignal,
  companion?: CompanionGenealogyRunOptions,
): Promise<DeepResearchReport> {
  signal?.throwIfAborted();
  const settings = getSettings();
  const language = normalizePromptLanguage(request.language ?? settings.promptLanguage ?? 'es');
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  const approach = normalizeDeepResearchApproach(request.approach);
  const [ordinarySources, family] = await Promise.all([
    buildGenealogySourcePool(request.objective, request.focusPersonId, language),
    Promise.resolve(buildFamilyFacts()),
  ]);
  const focusPerson = request.focusPersonId ? buildFocusPerson(request.focusPersonId, family) : null;
  // The historical General path remains byte-for-byte the same after source gathering.
  if (approach === 'general') {
    companion?.onSources?.(ordinarySources,family);
    return orchestrateGenealogyDeepResearch(request, ordinarySources, family, realDeps(model, signal, companion), onProgress, focusPerson, signal);
  }
  const retrieval = await planApproachRetrieval({
    approach,
    variant: 'genealogy',
    objective: request.objective,
    language,
    model,
    corpusPreview: {
      focusPerson,
      persons: family.personas.slice(0, 40),
      events: family.eventos.slice(0, 60),
      sources: ordinarySources.map((source) => ({ kind: source.kind, title: source.title, label: source.label, persons: source.persons, snippet: source.snippet })),
    },
  });
  const supplementalPools = await Promise.all(
    retrieval.probes.slice(0, 6).map((probe) => buildGenealogySourcePool(probe, request.focusPersonId, language)),
  );
  const sources = mergeGenealogyApproachSources(ordinarySources, supplementalPools.flat(), approach);
  signal?.throwIfAborted();
  companion?.onSources?.(sources,family);
  return orchestrateGenealogyDeepResearch(
    request,
    sources,
    family,
    specializedGenealogyDeps(model, approach, retrieval, language, signal, companion),
    onProgress,
    focusPerson,
    signal,
  );
}

function mergeGenealogyApproachSources(
  ordinary: GenSource[],
  supplemental: GenSource[],
  approach: DeepResearchApproach,
): GenSource[] {
  const seen = new Set(ordinary.map((source) => source.id));
  const additions = supplemental.filter((source) => !seen.has(source.id) && Boolean(seen.add(source.id))).slice(0, 24);
  const merged = [...ordinary, ...additions];
  if (approach === 'literature_review') {
    return [...merged.filter((source) => source.kind === 'work'), ...merged.filter((source) => source.kind === 'document')];
  }
  if (approach === 'chronological') {
    const dated = (source: GenSource) => /\b(?:1[5-9]|20)\d{2}\b/.test(`${source.label} ${source.title} ${source.snippet}`) ? 1 : 0;
    return [...merged].sort((a, b) => dated(b) - dated(a));
  }
  return merged;
}

function evidenceForPersons(names: Set<string>): { persona: string; cita: string; localizacion: string | null }[] {
  if (names.size === 0) return [];
  const out: { persona: string; cita: string; localizacion: string | null }[] = [];
  for (const p of listPersons()) {
    if (!names.has(p.displayName)) continue;
    for (const ev of listEvidenceFor('person', p.personId)) {
      if (ev.quote) out.push({ persona: p.displayName, cita: ev.quote, localizacion: ev.location });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

function clip(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}
function parseAuthors(json: string): string[] {
  try {
    const p = JSON.parse(json || '[]');
    return Array.isArray(p) ? p.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}
function authorYear(author: string | undefined, year: number | null, fallbackAuthor: string): string {
  const raw = (author ?? '').trim();
  const surname = raw.includes(',') ? raw.split(',')[0].trim() : raw.split(/\s+/).slice(-1)[0] || raw;
  return year ? `${surname || fallbackAuthor} (${year})` : surname || fallbackAuthor;
}
