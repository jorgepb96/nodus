import { parseJson, toEntry, toVersion, buildAuthors, buildWorks, type EntryRow, type EvidenceRow, type VersionRow } from '@shared/dictionaryRows';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { normalizeDictionaryTerm } from '@shared/dictionary';
import type {
  DictionaryAuthorView,
  DictionaryCitationRecord,
  DictionaryDuplicateMatch,
  DictionaryEntry,
  DictionaryEntryDetail,
  DictionaryEntryInput,
  DictionaryEntryPage,
  DictionaryEntryPatch,
  DictionaryEvidenceDecision,
  DictionaryEvidenceItem,
  DictionaryEvidencePage,
  DictionaryEvidenceRef,
  DictionaryEvidenceRequest,
  DictionaryFacets,
  DictionaryGenerationRequest,
  DictionaryGenerationOutcome,
  DictionaryDegradationReason,
  DictionaryListRequest,
  DictionaryRelation,
  DictionaryRelationType,
  DictionaryScope,
  DictionaryVersion,
  DictionaryVersionState,
  DictionaryVersionTrigger,
} from '@shared/dictionary';
import type { ModelRef } from '@shared/types';
import { getDb } from './database';
import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';
import { getWebPassageDetail } from './researchWebRepo';

export interface DictionaryEvidenceUpsert {
  kind: DictionaryEvidenceRef['kind'];
  refId: string;
  decision: DictionaryEvidenceDecision;
  score: number;
  reason: string;
  label: string;
  text: string;
  workId: string;
  workTitle: string;
  zoteroKey: string | null;
  works: DictionaryEvidenceItem['works'];
  pageLabel: string | null;
  authors: DictionaryEvidenceItem['authors'];
  tags: string[];
  sourceRevision: string | null;
  isNew?: boolean;
}

export interface SaveDictionaryVersionInput {
  entryId: string;
  contentMarkdown: string;
  evidence: DictionaryEvidenceRef[];
  citations: DictionaryCitationRecord[];
  authorSummaries: DictionaryAuthorView[];
  model: ModelRef | null;
  trigger: DictionaryVersionTrigger;
  state: DictionaryVersionState;
  outcome: DictionaryGenerationOutcome;
  degradationReason: DictionaryDegradationReason | null;
  generationAttempts: number;
  generationProblems: string[];
  insufficientEvidence: boolean;
}

const now = () => new Date().toISOString();

export { normalizeDictionaryTerm } from '@shared/dictionary';

function cleanStrings(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim();
    const key = normalizeDictionaryTerm(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key); out.push(value);
  }
  return out;
}

function entryCounts(entryId: string): { authors: number; works: number; evidence: number } {
  const rows = getDb().prepare(
    `SELECT authors_json, work_id, works_json FROM dictionary_evidence
      WHERE entry_id = ? AND decision = 'included'`
  ).all(entryId) as { authors_json: string; work_id: string; works_json: string }[];
  const authors = new Set<string>(); const works = new Set<string>();
  for (const row of rows) {
    const rowWorks = parseJson<Array<{ id: string }>>(row.works_json, []);
    for (const work of rowWorks) if (work.id) works.add(work.id);
    if (!rowWorks.length && row.work_id) works.add(row.work_id);
    for (const author of parseJson<Array<{ id: string | null; name: string }>>(row.authors_json, [])) {
      authors.add(author.id || normalizeDictionaryTerm(author.name));
    }
  }
  return { authors: authors.size, works: works.size, evidence: rows.length };
}

export function createDictionaryEntry(input: DictionaryEntryInput): DictionaryEntry {
  const name = input.name.trim();
  if (!name) throw new Error('El concepto necesita un nombre.');
  const stamp = now(); const id = uuid();
  const aliases = cleanStrings(input.aliases).filter((alias) => normalizeDictionaryTerm(alias) !== normalizeDictionaryTerm(name));
  const scope = normalizeScope(input.scope);
  getDb().prepare(
    `INSERT INTO dictionary_entries (
       id, name, normalized_name, aliases_json, focus_prompt, scope_kind, scope_json,
       output_language, detail_level, tags_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, normalizeDictionaryTerm(name), JSON.stringify(aliases), input.focusPrompt.trim(), scope.kind,
    JSON.stringify(scope), input.outputLanguage, input.detailLevel, JSON.stringify(cleanStrings(input.tags)), stamp, stamp);
  markDictionaryRetrievalStale(id);
  return getDictionaryEntry(id)!;
}

export function getDictionaryEntry(id: string): DictionaryEntry | null {
  const row = getDb().prepare('SELECT * FROM dictionary_entries WHERE id = ?').get(id) as EntryRow | undefined;
  return row ? toEntry(row, entryCounts(id)) : null;
}

function normalizeScope(scope: DictionaryScope): DictionaryScope {
  if (scope.kind === 'authors') return { kind: 'authors', authorIds: cleanStrings(scope.authorIds) };
  if (scope.kind === 'works') return { kind: 'works', workIds: cleanStrings(scope.workIds) };
  if (scope.kind === 'tags_collections') return {
    kind: 'tags_collections', zoteroTags: cleanStrings(scope.zoteroTags), collectionKeys: cleanStrings(scope.collectionKeys),
  };
  return { kind: 'vault' };
}

export function listDictionaryEntries(request: DictionaryListRequest): DictionaryEntryPage {
  const clauses: string[] = []; const params: unknown[] = [];
  const query = normalizeDictionaryTerm(request.query ?? '');
  if (query) {
    clauses.push(`(
      e.normalized_name LIKE ? OR lower(e.aliases_json) LIKE ? OR lower(e.tags_json) LIKE ? OR
      lower(e.content_markdown) LIKE ? OR EXISTS (
        SELECT 1 FROM dictionary_evidence de WHERE de.entry_id=e.id AND
          (lower(de.work_title) LIKE ? OR lower(de.authors_json) LIKE ? OR lower(de.tags_json) LIKE ?)
      ))`);
    const pattern = `%${query}%`; params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (request.letter) {
    if (request.letter === '#') clauses.push("substr(e.normalized_name,1,1) NOT GLOB '[a-z]'");
    else { clauses.push('substr(e.normalized_name,1,1) = ?'); params.push(normalizeDictionaryTerm(request.letter).slice(0, 1)); }
  }
  if (request.statuses?.length) {
    clauses.push(`e.status IN (${request.statuses.map(() => '?').join(',')})`); params.push(...request.statuses);
  }
  if (request.hasNewEvidence !== undefined) clauses.push(request.hasNewEvidence ? 'e.new_evidence_count > 0' : 'e.new_evidence_count = 0');
  if (request.insufficientEvidence !== undefined) { clauses.push('e.insufficient_evidence = ?'); params.push(request.insufficientEvidence ? 1 : 0); }
  for (const tag of cleanStrings(request.tags)) { clauses.push('lower(e.tags_json) LIKE ?'); params.push(`%${normalizeDictionaryTerm(tag)}%`); }
  for (const authorId of request.authorIds ?? []) {
    clauses.push("EXISTS (SELECT 1 FROM dictionary_evidence de WHERE de.entry_id=e.id AND de.decision='included' AND de.authors_json LIKE ?)");
    params.push(`%${authorId}%`);
  }
  for (const workId of request.workIds ?? []) {
    clauses.push("EXISTS (SELECT 1 FROM dictionary_evidence de WHERE de.entry_id=e.id AND de.decision='included' AND (de.work_id=? OR de.works_json LIKE ?))");
    params.push(workId, `%${workId}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM dictionary_entries e ${where}`).get(...params) as { n: number }).n;
  const sort = request.sort ?? { key: 'updated', dir: 'desc' as const };
  const direction = sort.dir === 'asc' ? 'ASC' : 'DESC';
  const sortExpr: Record<typeof sort.key, string> = {
    name: 'e.normalized_name', created: 'e.created_at', updated: 'e.updated_at',
    authors: 'author_count', works: 'work_count', evidence: 'evidence_count',
  };
  const rows = getDb().prepare(
    `SELECT e.*,
       (SELECT COUNT(DISTINCT COALESCE(json_extract(author.value, '$.id'), lower(json_extract(author.value, '$.name'))))
          FROM dictionary_evidence author_evidence
          JOIN json_each(author_evidence.authors_json) AS author
            ON TRUE
         WHERE author_evidence.entry_id=e.id
           AND author_evidence.decision='included') AS author_count,
       (SELECT COUNT(DISTINCT COALESCE(json_extract(work.value, '$.id'), work_evidence.work_id))
          FROM dictionary_evidence work_evidence
          LEFT JOIN json_each(work_evidence.works_json) AS work
            ON TRUE
         WHERE work_evidence.entry_id=e.id
           AND work_evidence.decision='included') AS work_count,
       COUNT(DISTINCT CASE WHEN de.decision='included' THEN de.kind || ':' || de.ref_id END) AS evidence_count
       FROM dictionary_entries e LEFT JOIN dictionary_evidence de ON de.entry_id=e.id
       ${where} GROUP BY e.id ORDER BY ${sortExpr[sort.key]} ${direction}, e.normalized_name ASC LIMIT ? OFFSET ?`
  ).all(...params, request.limit, request.offset) as Array<EntryRow & { author_count: number; work_count: number; evidence_count: number }>;
  const items = rows.map((row) => {
    const counts = entryCounts(row.id);
    return toEntry(row, { ...counts, works: row.work_count, evidence: row.evidence_count });
  });
  return { items, total, offset: request.offset, limit: request.limit };
}

export function listDictionaryFacets(): DictionaryFacets {
  const db = getDb();
  const entries = db.prepare('SELECT id, normalized_name, tags_json FROM dictionary_entries').all() as Array<{ id: string; normalized_name: string; tags_json: string }>;
  const letters = [...new Set(entries.map((row) => /^[a-z]/.test(row.normalized_name) ? row.normalized_name[0].toUpperCase() : '#'))].sort();
  const tagCounts = new Map<string, number>();
  for (const entry of entries) for (const tag of parseJson<string[]>(entry.tags_json, [])) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const evidence = db.prepare("SELECT entry_id, work_id, work_title, authors_json, works_json FROM dictionary_evidence WHERE decision='included'").all() as Array<{ entry_id: string; work_id: string; work_title: string; authors_json: string; works_json: string }>;
  const authorEntries = new Map<string, { name: string; entries: Set<string> }>();
  const workEntries = new Map<string, { title: string; entries: Set<string> }>();
  for (const item of evidence) {
    const relatedWorks = parseJson<Array<{ id: string; title: string }>>(item.works_json, []);
    if (relatedWorks.length) for (const related of relatedWorks) {
      if (!related.id) continue;
      const work = workEntries.get(related.id) ?? { title: related.title || related.id, entries: new Set<string>() };
      work.entries.add(item.entry_id); workEntries.set(related.id, work);
    } else if (item.work_id) {
      const work = workEntries.get(item.work_id) ?? { title: item.work_title, entries: new Set<string>() };
      work.entries.add(item.entry_id); workEntries.set(item.work_id, work);
    }
    for (const author of parseJson<Array<{ id: string | null; name: string }>>(item.authors_json, [])) {
      const id = author.id || normalizeDictionaryTerm(author.name); const current = authorEntries.get(id) ?? { name: author.name, entries: new Set<string>() };
      current.entries.add(item.entry_id); authorEntries.set(id, current);
    }
  }
  return {
    letters,
    tags: [...tagCounts].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label)),
    authors: [...authorEntries].map(([id, item]) => ({ id, name: item.name, count: item.entries.size })).sort((a, b) => a.name.localeCompare(b.name)),
    works: [...workEntries].map(([id, item]) => ({ id, title: item.title, count: item.entries.size })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function updateDictionaryEntry(id: string, patch: DictionaryEntryPatch, expectedUpdatedAt: string): DictionaryEntry {
  const current = getDictionaryEntry(id);
  if (!current) throw new Error('La entrada de Dictionary ya no existe.');
  if (current.updatedAt !== expectedUpdatedAt) throw new Error('La entrada cambió en otra ventana o dispositivo. Recárgala antes de guardar.');
  const name = patch.name?.trim() || current.name;
  const aliases = cleanStrings(patch.aliases ?? current.aliases).filter((alias) => normalizeDictionaryTerm(alias) !== normalizeDictionaryTerm(name));
  const scope = normalizeScope(patch.scope ?? current.scope); const stamp = now();
  const content = patch.contentMarkdown ?? current.contentMarkdown;
  validateDictionaryMarkdown(id, content, current.currentVersionId);
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE dictionary_entries SET name=?, normalized_name=?, aliases_json=?, focus_prompt=?, scope_kind=?, scope_json=?,
      output_language=?, detail_level=?, tags_json=?, content_markdown=?, notes=?, status=?, updated_at=? WHERE id=?`)
      .run(name, normalizeDictionaryTerm(name), JSON.stringify(aliases), patch.focusPrompt ?? current.focusPrompt, scope.kind, JSON.stringify(scope),
        patch.outputLanguage ?? current.outputLanguage, patch.detailLevel ?? current.detailLevel, JSON.stringify(cleanStrings(patch.tags ?? current.tags)),
        content, patch.notes ?? current.notes, patch.status ?? current.status, stamp, id);
    const evidence = includedEvidenceRefs(id);
    const citations = citationRecordsForMarkdown(id, content);
    const versionId = insertVersion({ entryId: id, contentMarkdown: content, evidence, citations,
      authorSummaries: currentVersionAuthorSummaries(current.currentVersionId), model: null, trigger: 'manual_edit', state: 'applied',
      outcome: current.insufficientEvidence ? 'insufficient' : 'synthesis', degradationReason: null,
      generationAttempts: 1, generationProblems: [],
      insufficientEvidence: current.insufficientEvidence }, stamp);
    db.prepare('UPDATE dictionary_entries SET current_version_id=?, proposed_version_id=NULL WHERE id=?').run(versionId, id);
    if (patch.focusPrompt !== undefined || patch.scope !== undefined) markDictionaryRetrievalStale(id, db);
  })();
  return getDictionaryEntry(id)!;
}

export function deleteDictionaryEntries(ids: string[]): number {
  const clean = [...new Set(ids.filter(Boolean))]; if (!clean.length) return 0;
  const db = getDb(); const placeholders = clean.map(() => '?').join(',');
  return db.transaction(() => {
    db.prepare(`DELETE FROM dictionary_relations WHERE from_entry_id IN (${placeholders}) OR to_entry_id IN (${placeholders})`).run(...clean, ...clean);
    db.prepare(`DELETE FROM dictionary_versions WHERE entry_id IN (${placeholders})`).run(...clean);
    db.prepare(`DELETE FROM dictionary_evidence WHERE entry_id IN (${placeholders})`).run(...clean);
    db.prepare(`DELETE FROM dictionary_retrieval_state WHERE entry_id IN (${placeholders})`).run(...clean);
    return db.prepare(`DELETE FROM dictionary_entries WHERE id IN (${placeholders})`).run(...clean).changes;
  })();
}

export function detectDictionaryDuplicates(name: string, aliases: string[]): DictionaryDuplicateMatch[] {
  const sought = new Set([name, ...aliases].map(normalizeDictionaryTerm).filter(Boolean));
  if (!sought.size) return [];
  const rows = getDb().prepare('SELECT * FROM dictionary_entries ORDER BY updated_at DESC').all() as EntryRow[];
  const out: DictionaryDuplicateMatch[] = [];
  for (const row of rows) {
    const entryName = normalizeDictionaryTerm(row.name); const entryAliases = parseJson<string[]>(row.aliases_json, []).map(normalizeDictionaryTerm);
    if (sought.has(entryName)) out.push({ entry: toEntry(row, entryCounts(row.id)), match: 'exact' });
    else if (entryAliases.some((alias) => sought.has(alias)) || [...sought].some((term) => entryAliases.includes(term))) {
      out.push({ entry: toEntry(row, entryCounts(row.id)), match: 'alias' });
    }
  }
  return out;
}

export function upsertDictionaryEvidence(entryId: string, items: DictionaryEvidenceUpsert[]): void {
  if (!getDictionaryEntry(entryId)) throw new Error('La entrada de Dictionary ya no existe.');
  const stamp = now(); const db = getDb();
  const stmt = db.prepare(`INSERT INTO dictionary_evidence (
    entry_id,kind,ref_id,decision,score,reason,label,evidence_text,work_id,work_title,zotero_key,works_json,page_label,
    authors_json,tags_json,source_revision,is_new,first_seen_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id,kind,ref_id) DO UPDATE SET
    score=excluded.score, reason=excluded.reason, label=excluded.label, evidence_text=excluded.evidence_text,
    work_id=excluded.work_id, work_title=excluded.work_title, zotero_key=excluded.zotero_key,
    works_json=excluded.works_json, page_label=excluded.page_label, authors_json=excluded.authors_json, tags_json=excluded.tags_json,
    source_revision=excluded.source_revision, is_new=MAX(dictionary_evidence.is_new, excluded.is_new), updated_at=excluded.updated_at`);
  db.transaction(() => {
    for (const item of items) stmt.run(entryId, item.kind, item.refId, item.decision, item.score, item.reason, item.label,
      item.text, item.workId, item.workTitle, item.zoteroKey, JSON.stringify(item.works), item.pageLabel, JSON.stringify(item.authors), JSON.stringify(cleanStrings(item.tags)),
      item.sourceRevision, item.isNew ? 1 : 0, stamp, stamp);
    refreshNewEvidenceCount(entryId, db);
  })();
}

export function setDictionaryEvidenceDecision(entryId: string, refs: DictionaryEvidenceRef[], decision: DictionaryEvidenceDecision): void {
  const db = getDb(); const stamp = now();
  db.transaction(() => {
    const stmt = db.prepare('UPDATE dictionary_evidence SET decision=?, is_new=0, updated_at=? WHERE entry_id=? AND kind=? AND ref_id=?');
    for (const ref of refs) stmt.run(decision, stamp, entryId, ref.kind, ref.id);
    refreshNewEvidenceCount(entryId, db);
  })();
}

function versionEvidenceSets(entryId: string): { used: Set<string>; cited: Set<string> } {
  const entry = getDictionaryEntry(entryId); const used = new Set<string>(); const cited = new Set<string>();
  const version = entry?.currentVersionId ? getDictionaryVersion(entry.currentVersionId) : null;
  for (const ref of version?.evidence ?? []) used.add(`${ref.kind}:${ref.id}`);
  for (const ref of version?.citations ?? []) cited.add(`${ref.kind}:${ref.id}`);
  return { used, cited };
}

function evidenceUnavailable(row: EvidenceRow): boolean {
  if (row.kind === 'idea') {
    return !getDb().prepare('SELECT 1 FROM ideas WHERE global_id=?').get(row.ref_id);
  }
  if (/^(documentary|scoped|web):/.test(row.ref_id)) {
    const current = row.ref_id.startsWith('documentary:') ? getDocumentaryPassageDetail(row.ref_id)
      : row.ref_id.startsWith('scoped:') ? getScopedLegacyPassageDetail(row.ref_id)
        : getWebPassageDetail(row.ref_id);
    return !current || !row.source_revision
      || createHash('sha256').update(current.text).digest('hex') !== row.source_revision;
  }
  // Passage ids are stable (`work#chunk`) and are deliberately reused by a
  // reindex. Existence alone therefore cannot prove that the copied Dictionary
  // text still describes the current passage. Require both a current source
  // generation and the exact text revision captured when evidence was retrieved.
  const current = getDb().prepare(`
    SELECT p.text
      FROM passages p
      JOIN works w ON w.nodus_id=p.nodus_id
     WHERE p.passage_id=?
       AND w.archived=0
       AND (
         (w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
         OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash))
       )
  `).get(row.ref_id) as { text: string } | undefined;
  if (!current || !row.source_revision) return true;
  return createHash('sha256').update(current.text).digest('hex') !== row.source_revision;
}

function evidenceReferenceUnavailable(
  entryId: string,
  kind: DictionaryEvidenceRef['kind'],
  id: string,
): boolean {
  const row = getDb().prepare(
    'SELECT * FROM dictionary_evidence WHERE entry_id=? AND kind=? AND ref_id=?',
  ).get(entryId, kind, id) as EvidenceRow | undefined;
  return !row || evidenceUnavailable(row);
}

function toEvidenceItem(row: EvidenceRow, sets: { used: Set<string>; cited: Set<string> }): DictionaryEvidenceItem {
  const key = `${row.kind}:${row.ref_id}`;
  return {
    entryId: row.entry_id, kind: row.kind, id: row.ref_id, label: row.label, text: row.evidence_text,
    score: row.score, reason: row.reason, decision: row.decision, isNew: !!row.is_new,
    usedInCurrentVersion: sets.used.has(key), citedInCurrentVersion: sets.cited.has(key), unavailable: evidenceUnavailable(row),
    sourceRevision: row.source_revision, workId: row.work_id, workTitle: row.work_title, zoteroKey: row.zotero_key, works: parseJson(row.works_json, []),
    pageLabel: row.page_label, authors: parseJson(row.authors_json, []), tags: parseJson(row.tags_json, []),
  };
}

export function listDictionaryEvidence(request: DictionaryEvidenceRequest): DictionaryEvidencePage {
  const clauses = ['entry_id=?']; const params: unknown[] = [request.entryId];
  if (request.kinds?.length) { clauses.push(`kind IN (${request.kinds.map(() => '?').join(',')})`); params.push(...request.kinds); }
  if (request.decisions?.length) { clauses.push(`decision IN (${request.decisions.map(() => '?').join(',')})`); params.push(...request.decisions); }
  if (request.newOnly) clauses.push('is_new=1');
  if (request.query?.trim()) { clauses.push('(lower(label) LIKE ? OR lower(evidence_text) LIKE ? OR lower(work_title) LIKE ? OR lower(authors_json) LIKE ? OR lower(tags_json) LIKE ?)'); const q = `%${request.query.trim().toLocaleLowerCase()}%`; params.push(q, q, q, q, q); }
  for (const workId of request.workIds ?? []) { clauses.push('(work_id=? OR works_json LIKE ?)'); params.push(workId, `%${workId}%`); }
  for (const authorId of request.authorIds ?? []) { clauses.push('authors_json LIKE ?'); params.push(`%${authorId}%`); }
  for (const tag of request.tags ?? []) { clauses.push('lower(tags_json) LIKE ?'); params.push(`%${tag.toLocaleLowerCase()}%`); }
  const where = clauses.join(' AND '); const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM dictionary_evidence WHERE ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM dictionary_evidence WHERE ${where} ORDER BY is_new DESC, score DESC, label COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...params, request.limit, request.offset) as EvidenceRow[];
  const sets = versionEvidenceSets(request.entryId);
  return { items: rows.map((row) => toEvidenceItem(row, sets)), total, offset: request.offset, limit: request.limit };
}

export function includedEvidence(entryId: string): DictionaryEvidenceItem[] {
  const rows = getDb().prepare("SELECT * FROM dictionary_evidence WHERE entry_id=? AND decision='included' ORDER BY score DESC").all(entryId) as EvidenceRow[];
  const sets = versionEvidenceSets(entryId); return rows.map((row) => toEvidenceItem(row, sets));
}

function includedEvidenceRefs(entryId: string): DictionaryEvidenceRef[] {
  return includedEvidence(entryId).filter((item) => !item.unavailable).map((item) => ({ kind: item.kind, id: item.id }));
}

export function saveDictionaryVersion(input: SaveDictionaryVersionInput): DictionaryVersion {
  const stamp = now(); const db = getDb();
  const versionId = db.transaction(() => {
    const id = insertVersion(input, stamp);
    if (input.state === 'applied') {
      db.prepare(`UPDATE dictionary_entries SET current_version_id=?, proposed_version_id=NULL, content_markdown=?,
        insufficient_evidence=?, status=CASE WHEN status='draft' THEN 'active' ELSE status END, updated_at=? WHERE id=?`)
        .run(id, input.contentMarkdown, input.insufficientEvidence ? 1 : 0, stamp, input.entryId);
      db.prepare("UPDATE dictionary_versions SET state='applied', updated_at=? WHERE entry_id=? AND id<>? AND state='proposed'").run(stamp, input.entryId, id);
      db.prepare("UPDATE dictionary_evidence SET is_new=0, updated_at=? WHERE entry_id=? AND decision='included'").run(stamp, input.entryId);
      refreshNewEvidenceCount(input.entryId, db);
    } else if (input.state === 'proposed') {
      db.prepare('UPDATE dictionary_entries SET proposed_version_id=?, updated_at=? WHERE id=?').run(id, stamp, input.entryId);
    } else {
      // Degraded attempts remain auditable in Versions, but never replace the
      // current definition or become an accept-able proposal.
      db.prepare('UPDATE dictionary_entries SET updated_at=? WHERE id=?').run(stamp, input.entryId);
    }
    return id;
  })();
  return getDictionaryVersion(versionId)!;
}

function insertVersion(input: SaveDictionaryVersionInput, stamp: string): string {
  const entry = getDictionaryEntry(input.entryId); if (!entry) throw new Error('La entrada de Dictionary ya no existe.');
  const outcome = input.outcome ?? (input.insufficientEvidence ? 'insufficient' : 'synthesis');
  const degradationReason = input.degradationReason ?? null;
  const generationAttempts = Math.max(1, input.generationAttempts ?? 1);
  const generationProblems = input.generationProblems ?? [];
  const id = uuid(); const snapshots = includedEvidence(input.entryId).filter((item) => input.evidence.some((ref) => ref.kind === item.kind && ref.id === item.id));
  getDb().prepare(`INSERT INTO dictionary_versions (
    id,entry_id,content_markdown,evidence_json,evidence_snapshot_json,citations_json,author_summaries_json,
    focus_prompt,scope_json,output_language,detail_level,model_json,generated_at,trigger,state,outcome,degradation_reason,
    generation_attempts,generation_problems_json,insufficient_evidence,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.entryId, input.contentMarkdown, JSON.stringify(input.evidence), JSON.stringify(snapshots),
    JSON.stringify(input.citations), JSON.stringify(input.authorSummaries), entry.focusPrompt, JSON.stringify(entry.scope), entry.outputLanguage,
    entry.detailLevel, input.model ? JSON.stringify(input.model) : null, stamp, input.trigger, input.state, outcome,
    degradationReason, generationAttempts, JSON.stringify(generationProblems),
    input.insufficientEvidence ? 1 : 0, stamp, stamp);
  return id;
}

export function getDictionaryVersion(id: string): DictionaryVersion | null {
  const row = getDb().prepare('SELECT * FROM dictionary_versions WHERE id=?').get(id) as VersionRow | undefined;
  return row ? toVersion(row) : null;
}

export function listDictionaryVersions(entryId: string): DictionaryVersion[] {
  return (getDb().prepare('SELECT * FROM dictionary_versions WHERE entry_id=? ORDER BY generated_at DESC, rowid DESC').all(entryId) as VersionRow[]).map(toVersion);
}

export function acceptDictionaryVersion(entryId: string, versionId: string, expectedCurrentVersionId: string | null): DictionaryEntryDetail {
  const entry = getDictionaryEntry(entryId); const version = getDictionaryVersion(versionId);
  if (!entry || !version || version.entryId !== entryId || version.state !== 'proposed') throw new Error('La propuesta ya no está disponible.');
  if (entry.currentVersionId !== expectedCurrentVersionId) throw new Error('La entrada cambió mientras revisabas la propuesta.');
  const stamp = now(); getDb().transaction(() => {
    getDb().prepare("UPDATE dictionary_versions SET state='applied', updated_at=? WHERE id=?").run(stamp, versionId);
    getDb().prepare(`UPDATE dictionary_entries SET current_version_id=?, proposed_version_id=NULL, content_markdown=?,
      insufficient_evidence=?, status=CASE WHEN status='draft' THEN 'active' ELSE status END, updated_at=? WHERE id=?`)
      .run(versionId, version.contentMarkdown, version.insufficientEvidence ? 1 : 0, stamp, entryId);
    getDb().prepare("UPDATE dictionary_evidence SET is_new=0, updated_at=? WHERE entry_id=? AND decision='included'").run(stamp, entryId);
    refreshNewEvidenceCount(entryId);
  })();
  return getDictionaryEntryDetail(entryId)!;
}

export function restoreDictionaryVersion(entryId: string, versionId: string, expectedCurrentVersionId: string | null): DictionaryEntryDetail {
  const entry = getDictionaryEntry(entryId); const source = getDictionaryVersion(versionId);
  if (!entry || !source || source.entryId !== entryId) throw new Error('No se encontró esa versión.');
  if (source.outcome === 'degraded') throw new Error('Una generación degradada no puede restaurarse como definición.');
  if (entry.currentVersionId !== expectedCurrentVersionId) throw new Error('La entrada cambió antes de restaurarla.');
  for (const citation of source.citations) if (evidenceReferenceUnavailable(entryId, citation.kind, citation.id)) throw new Error('La versión contiene fuentes que ya no existen y no puede restaurarse de forma verificable.');
  getDb().transaction(() => {
    getDb().prepare('UPDATE dictionary_entries SET focus_prompt=?, scope_kind=?, scope_json=?, output_language=?, detail_level=? WHERE id=?')
      .run(source.focusPrompt, source.scope.kind, JSON.stringify(source.scope), source.outputLanguage, source.detailLevel, entryId);
    const id = insertVersion({ entryId, contentMarkdown: source.contentMarkdown, evidence: source.evidence, citations: source.citations,
      authorSummaries: source.authorSummaries, model: source.model, trigger: 'restore', state: 'applied',
      outcome: source.insufficientEvidence ? 'insufficient' : 'synthesis', degradationReason: null,
      generationAttempts: 1, generationProblems: [], insufficientEvidence: source.insufficientEvidence }, now());
    getDb().prepare('UPDATE dictionary_entries SET current_version_id=?, proposed_version_id=NULL, content_markdown=?, insufficient_evidence=?, updated_at=? WHERE id=?')
      .run(id, source.contentMarkdown, source.insufficientEvidence ? 1 : 0, now(), entryId);
  })();
  return getDictionaryEntryDetail(entryId)!;
}

function currentVersionAuthorSummaries(versionId: string | null): DictionaryAuthorView[] {
  return versionId ? getDictionaryVersion(versionId)?.authorSummaries ?? [] : [];
}

function citationRecordsForMarkdown(entryId: string, markdown: string): DictionaryCitationRecord[] {
  const evidence = new Map(includedEvidence(entryId).map((item) => [`${item.kind}:${item.id}`, item]));
  const records: DictionaryCitationRecord[] = [];
  for (const match of markdown.matchAll(/\[([^\]]*)\]\(nodus:\/\/(idea|passage)\/([^)]+)\)/g)) {
    const kind = match[2] as DictionaryEvidenceRef['kind']; let id = match[3];
    try { id = decodeURIComponent(id); } catch { /* use raw id */ }
    const item = evidence.get(`${kind}:${id}`); if (!item) continue;
    if (!records.some((record) => record.kind === kind && record.id === id)) records.push({ kind, id, label: match[1], tags: kind === 'idea' ? item.tags : [] });
  }
  return records;
}

function validateDictionaryMarkdown(entryId: string, markdown: string, currentVersionId: string | null): void {
  if (!markdown.includes('nodus://')) return;
  const allowedRefs = [...(currentVersionId ? getDictionaryVersion(currentVersionId)?.evidence ?? [] : []), ...includedEvidenceRefs(entryId)];
  const allowed = new Set(allowedRefs.map((ref) => `${ref.kind}:${ref.id}`));
  const proper = /\[[^\]]*\]\(nodus:\/\/(idea|passage)\/([^)]+)\)/g; const consumed = markdown.replace(proper, '');
  if (consumed.includes('nodus://')) throw new Error('Hay una cita Nodus incompleta o con un formato no permitido.');
  for (const match of markdown.matchAll(proper)) {
    const kind = match[1] as DictionaryEvidenceRef['kind']; let id = match[2]; try { id = decodeURIComponent(id); } catch { /* raw */ }
    if (!allowed.has(`${kind}:${id}`) || evidenceReferenceUnavailable(entryId, kind, id)) throw new Error('La descripción contiene una cita inexistente o ajena a la evidencia de esta versión.');
  }
}

export function getDictionaryEntryDetail(id: string): DictionaryEntryDetail | null {
  const entry = getDictionaryEntry(id); if (!entry) return null;
  const evidence = getDb().prepare('SELECT * FROM dictionary_evidence WHERE entry_id=?').all(id) as EvidenceRow[];
  const currentVersion = entry.currentVersionId ? getDictionaryVersion(entry.currentVersionId) : null;
  const proposedVersion = entry.proposedVersionId ? getDictionaryVersion(entry.proposedVersionId) : null;
  const latestVersion = (getDb().prepare(
    'SELECT * FROM dictionary_versions WHERE entry_id=? ORDER BY generated_at DESC, rowid DESC LIMIT 1',
  ).get(id) as VersionRow | undefined);
  const latestDegradedVersion = latestVersion?.outcome === 'degraded' ? toVersion(latestVersion) : null;
  const used = new Set((currentVersion?.evidence ?? []).map((ref) => `${ref.kind}:${ref.id}`));
  const cited = new Set((currentVersion?.citations ?? []).map((ref) => `${ref.kind}:${ref.id}`));
  const unavailable = new Set(evidence.filter((item) => evidenceUnavailable(item)).map((item) => `${item.kind}:${item.ref_id}`));
  // `included` describes the live selection that the next generation will use.
  // Counting the current version's snapshot here made every new draft report zero
  // available evidence even after retrieval had selected twenty usable items.
  const coverage = { included: evidence.filter((item) => item.decision === 'included' && !unavailable.has(`${item.kind}:${item.ref_id}`)).length,
    cited: cited.size, unused: evidence.filter((item) => item.decision === 'unused').length,
    excluded: evidence.filter((item) => item.decision === 'excluded').length, newEvidence: evidence.filter((item) => item.is_new).length,
    unavailable: unavailable.size };
  const authors = buildAuthors(evidence.filter((item) => used.has(`${item.kind}:${item.ref_id}`)), currentVersion?.authorSummaries ?? []);
  const works = buildWorks(evidence.filter((item) => used.has(`${item.kind}:${item.ref_id}`)));
  const relations = (getDb().prepare(`SELECT r.*, e.id AS other_id, e.name AS other_name
    FROM dictionary_relations r JOIN dictionary_entries e
      ON e.id=CASE WHEN r.from_entry_id=? THEN r.to_entry_id ELSE r.from_entry_id END
    WHERE (r.from_entry_id=? OR r.to_entry_id=?) AND r.status<>'dismissed'
    ORDER BY e.normalized_name, r.type, r.id`).all(id,id,id) as Array<Record<string,unknown>>).map(row => ({
      id:String(row.id),fromEntryId:String(row.from_entry_id),toEntryId:String(row.to_entry_id),
      type:row.type as DictionaryRelationType,origin:row.origin as DictionaryRelation['origin'],status:row.status as DictionaryRelation['status'],
      createdAt:String(row.created_at),updatedAt:String(row.updated_at),direction:row.from_entry_id===id ? 'outgoing' as const : 'incoming' as const,
      entry:{id:String(row.other_id),name:String(row.other_name)},
    }));
  return { entry, coverage, authors, works, currentVersion, proposedVersion, latestDegradedVersion, relations };
}

function refreshNewEvidenceCount(entryId: string, db = getDb()): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM dictionary_evidence WHERE entry_id=? AND is_new=1').get(entryId) as { n: number }).n;
  db.prepare('UPDATE dictionary_entries SET new_evidence_count=? WHERE id=?').run(count, entryId);
}

export function markDictionaryEvidenceScanned(entryId: string, changeSeq: number): void {
  const stamp = now(); const db = getDb();
  db.prepare('UPDATE dictionary_entries SET last_evidence_scan_at=?, last_change_seq=?, updated_at=? WHERE id=?').run(stamp, changeSeq, stamp, entryId);
  db.prepare('UPDATE dictionary_retrieval_state SET last_change_seq=?, needs_full_scan=0, updated_at=? WHERE entry_id=?').run(changeSeq, stamp, entryId);
  const floor = (db.prepare('SELECT MIN(last_change_seq) AS seq FROM dictionary_entries').get() as { seq: number | null }).seq;
  if (floor && floor > 0) db.prepare('DELETE FROM dictionary_corpus_changes WHERE seq <= ?').run(floor);
}

export function markDictionaryRetrievalStale(entryId: string, db = getDb()): void {
  const entry = db.prepare('SELECT name,aliases_json,focus_prompt,scope_json FROM dictionary_entries WHERE id=?').get(entryId) as { name: string; aliases_json: string; focus_prompt: string; scope_json: string } | undefined;
  if (!entry) return; const hash = createHash('sha256').update(`${entry.name}\n${entry.aliases_json}\n${entry.focus_prompt}\n${entry.scope_json}`).digest('hex');
  db.prepare(`INSERT INTO dictionary_retrieval_state(entry_id,query_hash,last_change_seq,needs_full_scan,updated_at) VALUES(?,?,0,1,?)
    ON CONFLICT(entry_id) DO UPDATE SET query_hash=excluded.query_hash, needs_full_scan=1, updated_at=excluded.updated_at`).run(entryId, hash, now());
}

export function currentDictionaryChangeSequence(): number {
  return (getDb().prepare('SELECT COALESCE(MAX(seq),0) AS n FROM dictionary_corpus_changes').get() as { n: number }).n;
}

export function entriesNeedingDictionaryScan(limit = 20): string[] {
  const seq = currentDictionaryChangeSequence();
  return (getDb().prepare(`SELECT e.id FROM dictionary_entries e
    LEFT JOIN dictionary_retrieval_state state ON state.entry_id=e.id
    WHERE e.last_change_seq < ? OR COALESCE(state.needs_full_scan,0)=1
    ORDER BY e.updated_at DESC LIMIT ?`).all(seq, limit) as { id: string }[]).map((row) => row.id);
}

export function addDictionaryRelation(fromEntryId: string, toEntryId: string, type: DictionaryRelationType = 'related', origin: 'manual' | 'ai' = 'manual', status: 'suggested' | 'confirmed' = 'confirmed'): DictionaryRelation {
  if (fromEntryId === toEntryId) throw new Error('Una entrada no puede relacionarse consigo misma.');
  const stamp = now(); const id = uuid();
  getDb().prepare(`INSERT INTO dictionary_relations(id,from_entry_id,to_entry_id,type,origin,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(from_entry_id,to_entry_id,type) DO UPDATE SET origin=excluded.origin,status=excluded.status,updated_at=excluded.updated_at`)
    .run(id, fromEntryId, toEntryId, type, origin, status, stamp, stamp);
  const row = getDb().prepare('SELECT * FROM dictionary_relations WHERE from_entry_id=? AND to_entry_id=? AND type=?').get(fromEntryId, toEntryId, type) as Record<string, unknown>;
  return { id: String(row.id), fromEntryId, toEntryId, type, origin: row.origin as 'manual' | 'ai', status: row.status as DictionaryRelation['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function generationTrigger(request: DictionaryGenerationRequest): DictionaryVersionTrigger {
  return request.mode === 'creation' ? 'creation' : request.mode === 'update' ? 'update' : 'regeneration';
}
