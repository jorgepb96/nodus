import { normalizeDictionaryTerm } from './dictionary';
import type { DictionaryEntry, DictionaryScope, DictionaryEvidenceRef, DictionaryEvidenceDecision, DictionaryEvidenceItem, DictionaryVersion, DictionaryVersionTrigger, DictionaryVersionState, DictionaryGenerationOutcome, DictionaryDegradationReason, DictionaryAuthorView, DictionaryWorkView } from './dictionary';
import type { ModelRef, PromptLanguage } from './types';

// The same pure row mapping is used by Desktop and a downloaded mobile corpus.
export type EntryRow = {
  id: string; name: string; normalized_name: string; aliases_json: string; focus_prompt: string;
  scope_kind: DictionaryScope['kind']; scope_json: string; output_language: PromptLanguage;
  detail_level: DictionaryEntry['detailLevel']; tags_json: string; content_markdown: string; notes: string;
  status: DictionaryEntry['status']; current_version_id: string | null; proposed_version_id: string | null;
  insufficient_evidence: number; new_evidence_count: number; last_evidence_scan_at: string | null;
  last_change_seq: number; created_at: string; updated_at: string;
};

export type EvidenceRow = {
  entry_id: string; kind: DictionaryEvidenceRef['kind']; ref_id: string; decision: DictionaryEvidenceDecision;
  score: number; reason: string; label: string; evidence_text: string; work_id: string; work_title: string;
  zotero_key: string | null; works_json: string; page_label: string | null; authors_json: string; tags_json: string;
  source_revision: string | null; is_new: number; first_seen_at: string; updated_at: string;
};

export type VersionRow = {
  id: string; entry_id: string; content_markdown: string; evidence_json: string; evidence_snapshot_json: string;
  citations_json: string; author_summaries_json: string; focus_prompt: string; scope_json: string;
  output_language: PromptLanguage; detail_level: DictionaryEntry['detailLevel']; model_json: string | null;
  generated_at: string; trigger: DictionaryVersionTrigger; state: DictionaryVersionState;
  outcome: DictionaryGenerationOutcome; degradation_reason: DictionaryDegradationReason | null;
  generation_attempts: number; generation_problems_json: string;
  insufficient_evidence: number; created_at: string; updated_at: string;
};

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function scopeFromRow(row: EntryRow): DictionaryScope {
  const decoded = parseJson<DictionaryScope>(row.scope_json, { kind: 'vault' });
  return decoded?.kind === row.scope_kind ? decoded : { kind: 'vault' };
}

function stripMarkdown(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*_>`~]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function shortDescription(markdown: string): string {
  const text = stripMarkdown(markdown);
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

export function toEntry(row: EntryRow, counts?: { authors: number; works: number; evidence: number }): DictionaryEntry {
  return {
    id: row.id,
    name: row.name,
    aliases: parseJson<string[]>(row.aliases_json, []),
    shortDescription: shortDescription(row.content_markdown),
    tags: parseJson<string[]>(row.tags_json, []),
    authorCount: counts?.authors ?? 0,
    workCount: counts?.works ?? 0,
    evidenceCount: counts?.evidence ?? 0,
    status: row.status,
    insufficientEvidence: !!row.insufficient_evidence,
    newEvidenceCount: row.new_evidence_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    focusPrompt: row.focus_prompt,
    scope: scopeFromRow(row),
    outputLanguage: row.output_language,
    detailLevel: row.detail_level,
    contentMarkdown: row.content_markdown,
    notes: row.notes,
    currentVersionId: row.current_version_id,
    proposedVersionId: row.proposed_version_id,
    lastEvidenceScanAt: row.last_evidence_scan_at,
  };
}

export function toVersion(row: VersionRow): DictionaryVersion {
  return { id: row.id, entryId: row.entry_id, contentMarkdown: row.content_markdown, evidence: parseJson(row.evidence_json, []),
    citations: parseJson(row.citations_json, []), authorSummaries: parseJson(row.author_summaries_json, []), focusPrompt: row.focus_prompt,
    scope: parseJson(row.scope_json, { kind: 'vault' }), outputLanguage: row.output_language, detailLevel: row.detail_level,
    model: parseJson<ModelRef | null>(row.model_json, null), generatedAt: row.generated_at, trigger: row.trigger, state: row.state,
    outcome: row.outcome, degradationReason: row.degradation_reason, generationAttempts: row.generation_attempts,
    generationProblems: parseJson(row.generation_problems_json, []),
    insufficientEvidence: !!row.insufficient_evidence };
}

export function buildAuthors(rows: EvidenceRow[], summaries: DictionaryAuthorView[]): DictionaryAuthorView[] {
  const summaryById = new Map(summaries.map((item) => [item.id, item]));
  const map = new Map<string, { name: string; ideas: Set<string>; works: Set<string>; basis?: 'author' | 'editor_only' }>();
  for (const row of rows) {
    const relatedWorks = parseJson<Array<{ id: string }>>(row.works_json, []);
    const workIds = relatedWorks.length ? relatedWorks.map((work) => work.id).filter(Boolean) : row.work_id ? [row.work_id] : [];
    for (const author of parseJson<DictionaryEvidenceItem['authors']>(row.authors_json, [])) {
      const id = author.id || normalizeDictionaryTerm(author.name); const item = map.get(id) ?? { name: author.name, ideas: new Set(), works: new Set(), basis: author.attributionBasis };
      if (row.kind === 'idea') item.ideas.add(row.ref_id);
      for (const workId of workIds) item.works.add(workId);
      map.set(id, item);
    }
  }
  return [...map].map(([id, item]) => ({ id, name: item.name, ideaCount: item.ideas.size, workCount: item.works.size,
    summaryMarkdown: summaryById.get(id)?.summaryMarkdown ?? `Relacionado mediante ${item.ideas.size} idea(s) y ${item.works.size} obra(s) seleccionadas.`, attributionBasis: item.basis }));
}

export function buildWorks(rows: EvidenceRow[]): DictionaryWorkView[] {
  const map = new Map<string, { title: string; authors: Set<string>; evidence: Set<string>; tags: Set<string>; zoteroKey: string | null }>();
  for (const row of rows) {
    const works = parseJson<DictionaryEvidenceItem['works']>(row.works_json, []);
    for (const work of works.length ? works : [{ id: row.work_id, title: row.work_title, zoteroKey: row.zotero_key, authors: [] as string[], year: null }]) {
      if (!work.id) continue; const current = map.get(work.id) ?? { title: work.title, authors: new Set(), evidence: new Set(), tags: new Set(), zoteroKey: work.zoteroKey };
      for (const author of work.authors) current.authors.add(author);
      for (const tag of parseJson<string[]>(row.tags_json, [])) current.tags.add(tag);
      current.evidence.add(`${row.kind}:${row.ref_id}`); map.set(work.id, current);
    }
  }
  return [...map].map(([id, item]) => ({ id, title: item.title, authors: [...item.authors], evidenceCount: item.evidence.size, tags: [...item.tags], zoteroKey: item.zoteroKey }));
}
