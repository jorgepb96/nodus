import {normalizeDictionaryTerm} from './dictionary';
import type {DictionaryEntryDetail, DictionaryEntrySummary, DictionaryEvidenceItem, DictionaryEvidenceRequest, DictionaryFacets, DictionaryListRequest, DictionaryVersion} from './dictionary';

export interface CompanionDictionaryEntry {
  detail: DictionaryEntryDetail;
  evidence: DictionaryEvidenceItem[];
  versions: DictionaryVersion[];
}
export interface CompanionDictionaryCopy { version: 1; entries: CompanionDictionaryEntry[] }
export const companionDictionaryMethods = new Set([
  'listDictionaryEntries', 'listDictionaryFacets', 'getDictionaryEntry', 'listDictionaryEvidence', 'listDictionaryVersions',
]);
const fold = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Mirror the Desktop SQLite LIKE predicates, including wildcard escaping rules.
function like(pattern: string, value: unknown): boolean {
  const escaped = fold(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'su').test(fold(String(value ?? '')));
}
const contains = (query: string, values: unknown[]) => values.some(value => like(`%${query}%`, typeof value === 'string' ? value : JSON.stringify(value)));
function bounds(request: {offset: number; limit: number}) {
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || !Number.isSafeInteger(request.limit) || request.limit < 1)
    throw new Error('invalid_dictionary_page');
}

/** A selected, canonical DTO copy. Its coverage and source availability reflect
 * the download time; no indexing, retrieval or invented evidence happens here. */
export function companionDictionary(copy: CompanionDictionaryCopy) {
  if (copy?.version !== 1 || !Array.isArray(copy.entries)) throw new Error('invalid_companion_dictionary');
  const byId = new Map<string, CompanionDictionaryEntry>();
  for (const item of copy.entries) {
    const id = item?.detail?.entry?.id;
    if (!id || byId.has(id) || !Array.isArray(item.evidence) || !Array.isArray(item.versions) ||
        item.evidence.some(row => row.entryId !== id) || item.versions.some(row => row.entryId !== id))
      throw new Error('invalid_companion_dictionary');
    byId.set(id, item);
  }
  const required = (id: string) => {
    const value = byId.get(id);
    if (!value) throw new Error('Esta entrada no está descargada. Conecta con tu Mac para abrirla.');
    return value;
  };
  const included = (item: CompanionDictionaryEntry) => item.evidence.filter(row => row.decision === 'included');
  const summary = (item: CompanionDictionaryEntry): DictionaryEntrySummary => {
    const entry = item.detail.entry, rows = included(item);
    return {id: entry.id, name: entry.name, aliases: entry.aliases, shortDescription: entry.shortDescription, tags: entry.tags,
      authorCount: new Set(rows.flatMap(row => row.authors).map(author => author.id || normalizeDictionaryTerm(author.name))).size,
      workCount: new Set(rows.flatMap(row => row.works.length ? row.works.map(work => work.id) : [row.workId])).size,
      evidenceCount: rows.length, status: entry.status, insufficientEvidence: entry.insufficientEvidence,
      newEvidenceCount: entry.newEvidenceCount, createdAt: entry.createdAt, updatedAt: entry.updatedAt};
  };
  function list(request: DictionaryListRequest) {
    bounds(request);
    const query = normalizeDictionaryTerm(request.query ?? ''), tags = request.tags?.map(normalizeDictionaryTerm) ?? [];
    const matches = copy.entries.filter(item => {
      const entry = item.detail.entry, evidence = included(item);
      const name = normalizeDictionaryTerm(entry.name);
      if (query && !contains(query, [name, entry.aliases, entry.tags, entry.contentMarkdown]) && !item.evidence.some(row => contains(query, [row.workTitle, row.authors, row.tags]))) return false;
      if (request.letter === '#' && /^[a-z]/.test(name)) return false;
      if (request.letter && request.letter !== '#' && name[0] !== normalizeDictionaryTerm(request.letter)[0]) return false;
      if (request.statuses?.length && !request.statuses.includes(entry.status)) return false;
      if (request.hasNewEvidence !== undefined && (entry.newEvidenceCount > 0) !== request.hasNewEvidence) return false;
      if (request.insufficientEvidence !== undefined && entry.insufficientEvidence !== request.insufficientEvidence) return false;
      if (tags.some(tag => !contains(tag, [entry.tags]))) return false;
      if (request.authorIds?.some(id => !evidence.some(row => contains(id, [row.authors])))) return false;
      return !request.workIds?.some(id => !evidence.some(row => row.workId === id || contains(id, [row.works])));
    });
    const sort = request.sort ?? {key: 'updated', dir: 'desc'}, sign = sort.dir === 'asc' ? 1 : -1;
    const value = (item: CompanionDictionaryEntry): string | number => {
      const entry = item.detail.entry;
      switch (sort.key) {
        case 'name': return normalizeDictionaryTerm(entry.name);
        case 'created': return entry.createdAt;
        case 'updated': return entry.updatedAt;
        case 'authors': return new Set(included(item).flatMap(row => row.authors).map(author => author.id ?? fold(author.name))).size;
        case 'works': return new Set(included(item).flatMap(row => row.works.length ? row.works.map(work => work.id) : [row.workId])).size;
        case 'evidence': return included(item).length;
      }
    };
    matches.sort((a, b) => { const left = value(a), right = value(b); return (left < right ? -1 : left > right ? 1 : 0) * sign || compare(normalizeDictionaryTerm(a.detail.entry.name), normalizeDictionaryTerm(b.detail.entry.name)); });
    return {items: matches.slice(request.offset, request.offset + request.limit).map(summary), total: matches.length, offset: request.offset, limit: request.limit};
  }
  function listEvidence(request: DictionaryEvidenceRequest) {
    bounds(request);
    const query = request.query?.trim().toLocaleLowerCase();
    const rows = required(request.entryId).evidence.filter(row => {
      if (request.kinds?.length && !request.kinds.includes(row.kind) || request.decisions?.length && !request.decisions.includes(row.decision) || request.newOnly && !row.isNew) return false;
      if (query && !contains(query, [row.label, row.text, row.workTitle, row.authors, row.tags])) return false;
      if (request.workIds?.some(id => row.workId !== id && !contains(id, [row.works]))) return false;
      if (request.authorIds?.some(id => !contains(id, [row.authors]))) return false;
      return !request.tags?.some(tag => !contains(tag.toLocaleLowerCase(), [row.tags]));
    }).slice().sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.score - a.score || compare(fold(a.label), fold(b.label)));
    return {items: rows.slice(request.offset, request.offset + request.limit), total: rows.length, offset: request.offset, limit: request.limit};
  }
  function facets(): DictionaryFacets {
    const tags = new Map<string, number>(), authors = new Map<string, {name: string; entries: Set<string>}>(), works = new Map<string, {title: string; entries: Set<string>}>();
    for (const item of copy.entries) {
      const entry = item.detail.entry;
      for (const tag of entry.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      for (const row of included(item)) {
        for (const work of row.works.length ? row.works : row.workId ? [{id: row.workId, title: row.workTitle}] : []) {
          if (!work.id) continue;
          const value = works.get(work.id) ?? {title: work.title || work.id, entries: new Set<string>()}; value.entries.add(entry.id); works.set(work.id, value);
        }
        for (const author of row.authors) {
          const id = author.id || normalizeDictionaryTerm(author.name), value = authors.get(id) ?? {name: author.name, entries: new Set<string>()};
          value.entries.add(entry.id); authors.set(id, value);
        }
      }
    }
    return {letters: [...new Set(copy.entries.map(item => { const name = normalizeDictionaryTerm(item.detail.entry.name); return /^[a-z]/.test(name) ? name[0].toUpperCase() : '#'; }))].sort(),
      tags: [...tags].map(([label, count]) => ({label, count})).sort((a, b) => a.label.localeCompare(b.label)),
      authors: [...authors].map(([id, value]) => ({id, name: value.name, count: value.entries.size})).sort((a, b) => a.name.localeCompare(b.name)),
      works: [...works].map(([id, value]) => ({id, title: value.title, count: value.entries.size})).sort((a, b) => a.title.localeCompare(b.title))};
  }
  return {list, facets, detail: (id: string) => required(id).detail, listEvidence, listVersions: (id: string) => required(id).versions};
}
