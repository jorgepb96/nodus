import { normalizeDictionaryTerm } from './dictionary';
import type { DictionaryEntry, DictionaryEntryDetail, DictionaryEvidenceItem, DictionaryEvidencePage, DictionaryEvidenceRequest, DictionaryFacets, DictionaryListRequest, DictionaryRelation, DictionaryVersion } from './dictionary';
import { buildAuthors, buildWorks, parseJson, toEntry, toVersion, type EntryRow, type EvidenceRow, type VersionRow } from './dictionaryRows';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const fold = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const key = (row: EvidenceRow) => `${row.kind}:${row.ref_id}`;
function like(pattern: string, value: unknown) {
  const escaped = fold(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'su').test(fold(String(value ?? '')));
}
function cleanStrings(values: string[] = []) {
  const used = new Set<string>();
  return values.map(value => value.trim()).filter(value => { const normalized = normalizeDictionaryTerm(value); if (!normalized || used.has(normalized)) return false; used.add(normalized); return true; });
}
function group<T>(rows: T[], field: keyof T) {
  const map = new Map<string, T[]>();
  for (const row of rows) { const id = String(row[field]); const list = map.get(id) ?? []; list.push(row); map.set(id, list); }
  return map;
}

/** Consultation of the authored Dictionary in an immutable downloaded corpus.
 * No retrieval, indexing, provider calls or changes to the snapshot take place. */
export async function dictionarySnapshot(tables: Tables) {
  const required = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error(`La copia publicada no incluye la tabla ${table}. Descarga una publicación compatible.`);
    return tables[table];
  };
  const entries = required('dictionary_entries') as unknown as EntryRow[];
  const evidence = required('dictionary_evidence') as unknown as EvidenceRow[];
  const versions = required('dictionary_versions') as unknown as VersionRow[];
  const relations = required('dictionary_relations');
  if (evidence.some(row => typeof row.score !== 'number')) throw new Error('La copia del diccionario no incluye la relevancia de las evidencias. Actualiza la publicación.');
  const byId = new Map(entries.map(row => [row.id, row]));
  const evidenceByEntry = group(evidence, 'entry_id');
  const versionsByEntry = group(versions, 'entry_id');
  const versionById = new Map(versions.map(row => [row.id, toVersion(row)]));
  const ideas = new Set((tables.ideas ?? []).map(row => row.global_id));
  const works = new Map((tables.works ?? []).map(row => [row.nodus_id, row]));
  const passages = new Map((tables.passages ?? []).map(row => [row.passage_id, row]));
  const unavailable = new Map<EvidenceRow, boolean>();
  const revisions = new Map<string, Promise<string>>();
  const digest = (text: string) => {
    if (!revisions.has(text)) revisions.set(text, crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('')));
    return revisions.get(text)!;
  };
  await Promise.all(evidence.map(async row => {
    if (row.kind === 'idea') { unavailable.set(row, !ideas.has(row.ref_id)); return; }
    const passage = passages.get(row.ref_id), work = passage && works.get(passage.nodus_id);
    const current = work && work.archived === 0 && (work.resolved_text_hash != null ? passage?.content_hash === work.resolved_text_hash : work.deep_hash == null || passage?.content_hash === work.deep_hash);
    unavailable.set(row, !current || !row.source_revision || await digest(String(passage?.text ?? '')) !== row.source_revision);
  }));
  function counts(id: string, catalogue = false) {
    const rows = (evidenceByEntry.get(id) ?? []).filter(row => row.decision === 'included');
    const authors = new Set<string>(), relatedWorks = new Set<string>();
    for (const row of rows) {
      const linked = parseJson<Array<{id: string}>>(row.works_json, []);
      for (const work of linked) if (work.id || catalogue) relatedWorks.add(work.id);
      if (!linked.length && (row.work_id || catalogue)) relatedWorks.add(row.work_id);
      for (const author of parseJson<DictionaryEvidenceItem['authors']>(row.authors_json, [])) authors.add(author.id || normalizeDictionaryTerm(author.name));
    }
    return { authors: authors.size, works: relatedWorks.size, evidence: rows.length };
  }
  function entry(id: string): DictionaryEntry | null { const row = byId.get(id); return row ? toEntry(row, counts(id)) : null; }
  function list(request: DictionaryListRequest) {
    const query = normalizeDictionaryTerm(request.query ?? ''), tags = cleanStrings(request.tags);
    const rows = entries.filter(row => {
      const ev = evidenceByEntry.get(row.id) ?? [], included = ev.filter(item => item.decision === 'included');
      if (query && ![row.normalized_name, row.aliases_json, row.tags_json, row.content_markdown].some(value => like(`%${query}%`, value)) && !ev.some(item => [item.work_title, item.authors_json, item.tags_json].some(value => like(`%${query}%`, value)))) return false;
      if (request.letter === '#' && /^[a-z]/.test(row.normalized_name)) return false;
      if (request.letter && request.letter !== '#' && row.normalized_name[0] !== normalizeDictionaryTerm(request.letter)[0]) return false;
      if (request.statuses?.length && !request.statuses.includes(row.status)) return false;
      if (request.hasNewEvidence !== undefined && (request.hasNewEvidence ? row.new_evidence_count <= 0 : row.new_evidence_count !== 0)) return false;
      if (request.insufficientEvidence !== undefined && row.insufficient_evidence !== Number(request.insufficientEvidence)) return false;
      if (tags.some(tag => !like(`%${normalizeDictionaryTerm(tag)}%`, row.tags_json))) return false;
      if (request.authorIds?.some(id => !included.some(item => like(`%${id}%`, item.authors_json)))) return false;
      return !request.workIds?.some(id => !included.some(item => item.work_id === id || like(`%${id}%`, item.works_json)));
    });
    const sort = request.sort ?? {key:'updated', dir:'desc'}, sign = sort.dir === 'asc' ? 1 : -1;
    const sortValue = (row: EntryRow): string | number => {
      switch (sort.key) {
        case 'name': return row.normalized_name;
        case 'created': return row.created_at;
        case 'updated': return row.updated_at;
        case 'authors': { const set = new Set((evidenceByEntry.get(row.id) ?? []).filter(item => item.decision === 'included').flatMap(item => parseJson<DictionaryEvidenceItem['authors']>(item.authors_json, [])).map(author => author.id ?? fold(author.name))); return set.size; }
        case 'works': return counts(row.id, true).works;
        case 'evidence': return counts(row.id, true).evidence;
      }
    };
    rows.sort((a,b) => { const left = sortValue(a), right = sortValue(b); return (left < right ? -1 : left > right ? 1 : 0) * sign || compare(a.normalized_name, b.normalized_name); });
    return {items:rows.slice(request.offset, request.offset + request.limit).map(row => toEntry(row, counts(row.id, true))), total:rows.length, offset:request.offset, limit:request.limit};
  }
  function listVersions(id: string): DictionaryVersion[] {
    return (versionsByEntry.get(id) ?? []).map((row, position) => ({row, position})).sort((a,b) => compare(b.row.generated_at, a.row.generated_at) || b.position - a.position).map(item => toVersion(item.row));
  }
  function evidenceItem(row: EvidenceRow): DictionaryEvidenceItem {
    const current = entry(row.entry_id)?.currentVersionId, version = current ? versionById.get(current) : null;
    return {entryId:row.entry_id, kind:row.kind, id:row.ref_id, label:row.label, text:row.evidence_text, score:row.score, reason:row.reason, decision:row.decision, isNew:!!row.is_new,
      usedInCurrentVersion:!!version?.evidence.some(ref => `${ref.kind}:${ref.id}` === key(row)), citedInCurrentVersion:!!version?.citations.some(ref => `${ref.kind}:${ref.id}` === key(row)), unavailable:unavailable.get(row) ?? true,
      sourceRevision:row.source_revision, workId:row.work_id, workTitle:row.work_title, zoteroKey:row.zotero_key, works:parseJson(row.works_json, []), pageLabel:row.page_label, authors:parseJson(row.authors_json, []), tags:parseJson(row.tags_json, [])};
  }
  function listEvidence(request: DictionaryEvidenceRequest): DictionaryEvidencePage {
    const query = request.query?.trim().toLocaleLowerCase();
    const rows = (evidenceByEntry.get(request.entryId) ?? []).filter(row => {
      if (request.kinds?.length && !request.kinds.includes(row.kind) || request.decisions?.length && !request.decisions.includes(row.decision) || request.newOnly && row.is_new !== 1) return false;
      if (query && ![row.label,row.evidence_text,row.work_title,row.authors_json,row.tags_json].some(value => like(`%${query}%`, value))) return false;
      if (request.workIds?.some(id => row.work_id !== id && !like(`%${id}%`, row.works_json))) return false;
      if (request.authorIds?.some(id => !like(`%${id}%`, row.authors_json))) return false;
      return !request.tags?.some(tag => !like(`%${tag.toLocaleLowerCase()}%`, row.tags_json));
    }).slice().sort((a,b) => b.is_new - a.is_new || b.score - a.score || compare(fold(a.label),fold(b.label)));
    return {items:rows.slice(request.offset,request.offset + request.limit).map(evidenceItem),total:rows.length,offset:request.offset,limit:request.limit};
  }
  function detail(id: string): DictionaryEntryDetail | null {
    const item = entry(id); if (!item) return null;
    const rows = evidenceByEntry.get(id) ?? [], currentVersion = item.currentVersionId ? versionById.get(item.currentVersionId) ?? null : null;
    const used = new Set(currentVersion?.evidence.map(ref => `${ref.kind}:${ref.id}`) ?? []), latest = listVersions(id)[0];
    const linked = relations.filter(row => (row.from_entry_id === id || row.to_entry_id === id) && row.status !== 'dismissed').flatMap(row => {
      const other = byId.get(String(row.from_entry_id === id ? row.to_entry_id : row.from_entry_id)); if (!other) return [];
      return [{id:String(row.id),fromEntryId:String(row.from_entry_id),toEntryId:String(row.to_entry_id),type:row.type as DictionaryRelation['type'],origin:row.origin as DictionaryRelation['origin'],status:row.status as DictionaryRelation['status'],createdAt:String(row.created_at),updatedAt:String(row.updated_at),direction:row.from_entry_id === id ? 'outgoing' as const : 'incoming' as const,entry:{id:other.id,name:other.name},sort:other.normalized_name}];
    }).sort((a,b) => compare(a.sort,b.sort) || compare(a.type,b.type) || compare(a.id,b.id)).map(({sort:_, ...row}) => row);
    return {entry:item,currentVersion,proposedVersion:item.proposedVersionId ? versionById.get(item.proposedVersionId) ?? null : null,latestDegradedVersion:latest?.outcome === 'degraded' ? latest : null,
      coverage:{included:rows.filter(row => row.decision === 'included' && !unavailable.get(row)).length,cited:new Set(currentVersion?.citations.map(ref => `${ref.kind}:${ref.id}`) ?? []).size,unused:rows.filter(row => row.decision === 'unused').length,excluded:rows.filter(row => row.decision === 'excluded').length,newEvidence:rows.filter(row => row.is_new).length,unavailable:rows.filter(row => unavailable.get(row)).length},
      authors:buildAuthors(rows.filter(row => used.has(key(row))),currentVersion?.authorSummaries ?? []),works:buildWorks(rows.filter(row => used.has(key(row)))),relations:linked};
  }
  function facets(): DictionaryFacets {
    const tags = new Map<string,number>(), authors = new Map<string,{name:string;entries:Set<string>}>(), works = new Map<string,{title:string;entries:Set<string>}>();
    for (const row of entries) for (const tag of parseJson<string[]>(row.tags_json,[])) tags.set(tag,(tags.get(tag) ?? 0)+1);
    for (const row of evidence.filter(row => row.decision === 'included')) {
      const related = parseJson<Array<{id:string;title:string}>>(row.works_json,[]);
      for (const work of related.length ? related : row.work_id ? [{id:row.work_id,title:row.work_title}] : []) {
        if (!work.id) continue; const value = works.get(work.id) ?? {title:work.title || work.id,entries:new Set<string>()}; value.entries.add(row.entry_id); works.set(work.id,value);
      }
      for (const author of parseJson<DictionaryEvidenceItem['authors']>(row.authors_json,[])) { const id = author.id || normalizeDictionaryTerm(author.name), value = authors.get(id) ?? {name:author.name,entries:new Set<string>()}; value.entries.add(row.entry_id); authors.set(id,value); }
    }
    return {letters:[...new Set(entries.map(row => /^[a-z]/.test(row.normalized_name) ? row.normalized_name[0].toUpperCase() : '#'))].sort(),tags:[...tags].map(([label,count]) => ({label,count})).sort((a,b) => a.label.localeCompare(b.label)),authors:[...authors].map(([id,value]) => ({id,name:value.name,count:value.entries.size})).sort((a,b) => a.name.localeCompare(b.name)),works:[...works].map(([id,value]) => ({id,title:value.title,count:value.entries.size})).sort((a,b) => a.title.localeCompare(b.title))};
  }
  return {entry,list,detail,listEvidence,listVersions,facets};
}
