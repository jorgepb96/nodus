// "Writing copilot" engine: given an arbitrary paragraph (coming from Word), find
// how it relates to the whole library — typed (supports/contradicts/refines/…),
// with a verifiable citation and the Zotero item to cite. This is the ad-hoc,
// symmetric counterpart of the per-chapter relation analysis, reusing the same
// candidate retrieval + relation typing as electron/ai/chapterIdeas.ts.
import type { EdgeDetail, Idea, LiveRelation, LiveRelationsResult, ModelRef, PromptLanguage } from '@shared/types';
import { completeText, embedQuery } from './aiClient';
import {
  clamp01,
  gatherCandidates,
  normalizeRelationType,
  resolveTarget,
  typeRelations,
  type Candidate,
} from './chapterIdeas';
import { getSettings } from '../db/settingsRepo';
import { findSimilarIdeas, getIdeaDetail, getIdeaEdges, getIdeaSummary } from '../db/ideasRepo';
import { embeddedPassageCount, findSimilarPassages, getPassageDetail } from '../db/passagesRepo';
import { getWork } from '../db/worksRepo';
import { getDb } from '../db/database';
import { liveRelationsPromptPack } from '../../shared/researchPromptPacks';

const PSEUDO_ID = 'paragraph';
const LIVE_RESULT_LIMIT = 36;
const LIVE_SEMANTIC_IDEA_LIMIT = 90;
const LIVE_LEXICAL_IDEA_LIMIT = 90;
const LIVE_GRAPH_SEED_LIMIT = 18;
const LIVE_IDEA_MIN_SIMILARITY = 0.18;

type CandidateSource = 'semantic' | 'lexical' | 'graph' | 'support';

interface RankedCandidate extends Candidate {
  rankScore: number;
  source: CandidateSource;
  targetStatement: string | null;
}

interface WeightedTerm {
  term: string;
  weight: number;
}

interface LexicalIdeaRow {
  global_id: string;
  type: Idea['type'];
  label: string;
  statement: string;
  developments: string | null;
  evidence: string | null;
  titles: string | null;
  authors: string | null;
  years: string | null;
  work_count: number;
}

const STOPWORDS = new Set([
  'a',
  'al',
  'algo',
  'ante',
  'asi',
  'aun',
  'cada',
  'como',
  'con',
  'contra',
  'cual',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'dos',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'eran',
  'es',
  'esa',
  'ese',
  'eso',
  'esta',
  'este',
  'esto',
  'fue',
  'han',
  'hay',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'mismo',
  'muchas',
  'muy',
  'no',
  'o',
  'para',
  'pero',
  'por',
  'que',
  'se',
  'sin',
  'solian',
  'son',
  'su',
  'sus',
  'tambien',
  'tan',
  'todo',
  'una',
  'unas',
  'uno',
  'unos',
  'veces',
  'y',
]);

const TERM_EXPANSIONS: { roots: string[]; terms: string[]; weight: number }[] = [
  {
    roots: ['fotograf', 'imagen', 'visual', 'album'],
    terms: ['fotograf', 'imagen', 'visual', 'album', 'iconograf', 'representacion', 'mirada'],
    weight: 1.25,
  },
  {
    roots: ['mostr', 'represent', 'registr'],
    terms: ['mostr', 'represent', 'registr', 'imagen', 'visual', 'relato'],
    weight: 0.8,
  },
  {
    roots: ['pobrez', 'pobre', 'miseria', 'hambre', 'precar', 'carencia'],
    terms: ['pobrez', 'pobre', 'miseria', 'hambre', 'precar', 'privacion', 'carencia', 'desigualdad'],
    weight: 1.35,
  },
  {
    roots: ['elud', 'omit', 'omis', 'ignora', 'invisibil', 'ocult', 'censur', 'silenci'],
    terms: ['elud', 'omit', 'omis', 'ignora', 'invisibil', 'ocult', 'censur', 'silenci', 'exclusion'],
    weight: 1.25,
  },
  {
    roots: ['viajer', 'turist', 'extranj'],
    terms: ['viajer', 'turist', 'extranj', 'visitante'],
    weight: 1.05,
  },
  {
    roots: ['texto', 'relato', 'narrativ', 'literatur', 'escritur'],
    terms: ['texto', 'relato', 'narrativ', 'literatur', 'escritur', 'discurso'],
    weight: 0.9,
  },
  {
    roots: ['cuidad', 'prudenc', 'cautel'],
    terms: ['cuidad', 'prudenc', 'cautel', 'neutralidad', 'compostura'],
    weight: 0.8,
  },
];

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

/**
 * Rejects PDF extraction output whose character map has already collapsed into
 * replacement/box glyphs. Presenting that as a quotation would be misleading;
 * the clean reader can rebuild the source with OCR before it becomes citable.
 */
export function readableCopilotPassageText(value: string): string {
  const text = [...String(value ?? '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
  if (!text) return '';
  const suspicious = text.match(/[\uFFFD\u25A1\u2610\u2612]/g)?.length ?? 0;
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return suspicious > 2 && suspicious > meaningful * 0.12 ? '' : text;
}

function normalizeSearchText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addWeightedTerm(terms: Map<string, number>, term: string, weight: number): void {
  const clean = normalizeSearchText(term).replace(/\s+/g, '');
  if (clean.length < 3 || STOPWORDS.has(clean)) return;
  terms.set(clean, Math.max(terms.get(clean) ?? 0, weight));
  if (clean.length > 5 && clean.endsWith('es')) terms.set(clean.slice(0, -2), Math.max(terms.get(clean.slice(0, -2)) ?? 0, weight * 0.9));
  if (clean.length > 4 && clean.endsWith('s')) terms.set(clean.slice(0, -1), Math.max(terms.get(clean.slice(0, -1)) ?? 0, weight * 0.9));
}

function weightedTermsForQuery(text: string): WeightedTerm[] {
  const terms = new Map<string, number>();
  const normalized = normalizeSearchText(text);
  for (const token of normalized.split(/\s+/)) {
    if (!token || STOPWORDS.has(token) || token.length < 3) continue;
    addWeightedTerm(terms, token, 1);
    for (const expansion of TERM_EXPANSIONS) {
      if (expansion.roots.some((root) => token.includes(root))) {
        for (const expanded of expansion.terms) addWeightedTerm(terms, expanded, expansion.weight);
      }
    }
  }
  return [...terms.entries()].map(([term, weight]) => ({ term, weight }));
}

function lexicalIdeaRows(): LexicalIdeaRow[] {
  return getDb()
    .prepare(
      `SELECT i.global_id,
              i.type,
              i.label,
              i.statement,
              occ.developments,
              ev.evidence,
              occ.titles,
              occ.authors,
              occ.years,
              COALESCE(occ.work_count, 0) AS work_count
         FROM ideas i
         LEFT JOIN (
           SELECT o.global_id,
                  group_concat(o.development, ' ') AS developments,
                  group_concat(w.title, ' ') AS titles,
                  group_concat(w.authors_json, ' ') AS authors,
                  group_concat(CAST(w.year AS TEXT), ' ') AS years,
                  COUNT(DISTINCT o.nodus_id) AS work_count
             FROM idea_occurrences o
             LEFT JOIN works w ON w.nodus_id = o.nodus_id AND w.archived = 0
            GROUP BY o.global_id
         ) occ ON occ.global_id = i.global_id
         LEFT JOIN (
           SELECT global_id, group_concat(quote, ' ') AS evidence
             FROM evidence
            GROUP BY global_id
         ) ev ON ev.global_id = i.global_id`
    )
    .all() as LexicalIdeaRow[];
}

function fieldHitScore(field: string, term: WeightedTerm, weight: number): number {
  if (!field || !field.includes(term.term)) return 0;
  return term.weight * weight;
}

function lexicalIdeaScore(row: LexicalIdeaRow, terms: WeightedTerm[], normalizedQuery: string): number {
  if (terms.length === 0) return 0;
  const label = normalizeSearchText(row.label);
  const statement = normalizeSearchText(row.statement);
  const developments = normalizeSearchText(row.developments);
  const evidence = normalizeSearchText(row.evidence);
  const titles = normalizeSearchText(row.titles);
  const authors = normalizeSearchText(row.authors);
  const combined = [label, statement, developments, evidence, titles, authors].join(' ');
  let raw = 0;
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const term of terms) {
    totalWeight += term.weight;
    const score =
      fieldHitScore(label, term, 5.2) +
      fieldHitScore(statement, term, 4.2) +
      fieldHitScore(developments, term, 2.8) +
      fieldHitScore(evidence, term, 2.2) +
      fieldHitScore(titles, term, 1.4) +
      fieldHitScore(authors, term, 1.1);
    if (score > 0) {
      raw += score;
      matchedWeight += term.weight;
    }
  }

  if (normalizedQuery.includes('pobrez') && /(hambre|miseria|pobrez|precar|carencia|privacion)/.test(combined)) raw += 4.5;
  if (normalizedQuery.includes('fotograf') && /(fotograf|album|imagen|visual|iconograf)/.test(combined)) raw += 4;
  if (/(elud|omit|omis|invisibil|ocult|ignora)/.test(normalizedQuery) && /(omit|omis|invisibil|ocult|ignora|silenci|censur|exclusion)/.test(combined)) raw += 5;
  if (/(viajer|extranj)/.test(normalizedQuery) && /(viajer|turist|extranj|visitante)/.test(combined)) raw += 2;
  if (/(texto|relato)/.test(normalizedQuery) && /(texto|relato|narrativ|literatur|discurso)/.test(combined)) raw += 1.5;
  if (row.work_count > 1) raw += Math.min(2, Math.log2(row.work_count + 1) * 0.45);

  const coverage = matchedWeight / Math.max(totalWeight, 1);
  const density = Math.min(1, raw / Math.max(Math.sqrt(totalWeight) * 12, 1));
  return raw < 4 ? 0 : clamp01(0.18 + density * 0.58 + coverage * 0.26);
}

/** "Surname, Year" from a Zotero-style "Surname, Given" author plus a year. */
function authorYearLabel(authors: string[] | undefined, year: number | null | undefined): string | null {
  const raw = authors?.[0]?.trim();
  if (!raw && !year) return null;
  const surname = raw ? (raw.includes(',') ? raw.split(',')[0] : raw.split(/\s+/).slice(-1)[0]).trim() : 'Autor';
  return year ? `${surname}, ${year}` : surname;
}

/** A precise Zotero quick-search string: first author + year + a few title words. */
function searchString(authors: string[] | undefined, year: number | null | undefined, title: string): string {
  const author = authors?.[0]?.trim();
  const surname = author ? (author.includes(',') ? author.split(',')[0] : author.split(/\s+/).slice(-1)[0]).trim() : '';
  return [surname, year ? String(year) : '', title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CitationMeta {
  zoteroKey: string | null;
  authorYear: string | null;
  searchString: string | null;
}

/** Resolve the underlying work (for the Zotero bridge) behind a relation target. */
function citationMeta(kind: Candidate['kind'], id: string): CitationMeta {
  try {
    if (kind === 'work') {
      const work = getWork(id);
      if (!work) return { zoteroKey: null, authorYear: null, searchString: null };
      return {
        zoteroKey: work.zotero_key || null,
        authorYear: authorYearLabel(work.authors, work.year),
        searchString: searchString(work.authors, work.year, work.title),
      };
    }
    if (kind === 'idea') {
      const work = getIdeaDetail(id)?.occurrences[0]?.work;
      if (!work) return { zoteroKey: null, authorYear: null, searchString: null };
      return {
        zoteroKey: work.zotero_key || null,
        authorYear: authorYearLabel(work.authors, work.year),
        searchString: searchString(work.authors, work.year, work.title),
      };
    }
    if (kind === 'passage') {
      const detail = getPassageDetail(id);
      if (!detail) return { zoteroKey: null, authorYear: null, searchString: null };
      const { authors, year, title, zotero_key } = detail.work;
      return {
        zoteroKey: zotero_key || null,
        authorYear: authorYearLabel(authors, year),
        searchString: searchString(authors, year, title),
      };
    }
  } catch {
    /* fall through to empty meta */
  }
  // Notes (and unresolved targets) have no Zotero item to cite.
  return { zoteroKey: null, authorYear: null, searchString: null };
}

export interface CopilotIdeaSearchResult {
  globalId: string;
  type: Idea['type'];
  label: string;
  statement: string;
  workCount: number;
  authors: string[];
  years: number[];
  sourceLabel: string | null;
  authorYear: string | null;
  zoteroKey: string | null;
  searchString: string | null;
  similarity: number | null;
}

export interface CopilotIdeaConnection {
  edgeId: string;
  type: string;
  basis: string;
  confidence: number;
  direction: 'out' | 'in';
  otherId: string;
  otherLabel: string;
  otherStatement: string | null;
  rationale: string | null;
  citation: string;
}

export interface CopilotIdeaDetail {
  idea: {
    globalId: string;
    type: Idea['type'];
    label: string;
    statement: string;
  };
  citation: string;
  authorYear: string | null;
  zoteroKey: string | null;
  searchString: string | null;
  occurrences: {
    nodusId: string;
    role: string;
    development: string;
    confidence: number;
    workTitle: string;
    authors: string[];
    year: number | null;
    authorYear: string | null;
    zoteroKey: string | null;
    searchString: string | null;
  }[];
  evidence: {
    id: string;
    quote: string;
    location: string | null;
    kind: string;
  }[];
  connections: CopilotIdeaConnection[];
}

export interface CopilotInsertionResult {
  text: string;
  citation: string;
  authorYear: string | null;
}

function statementForCandidate(candidate: Candidate): string | null {
  try {
    if (candidate.kind === 'idea') return getIdeaSummary(candidate.id)?.statement ?? null;
    if (candidate.kind === 'passage') return clip(getPassageDetail(candidate.id)?.text ?? candidate.text, 700);
  } catch {
    /* best effort */
  }
  return null;
}

function upsertCandidate(byKey: Map<string, RankedCandidate>, candidate: Candidate, rankScore: number, source: CandidateSource): void {
  const key = `${candidate.kind}:${candidate.id}`;
  const safeRank = clamp01(rankScore);
  const current = byKey.get(key);
  if (!current) {
    byKey.set(key, {
      ...candidate,
      similarity: clamp01(candidate.similarity),
      rankScore: safeRank,
      source,
      targetStatement: statementForCandidate(candidate),
    });
    return;
  }
  current.similarity = Math.max(current.similarity, clamp01(candidate.similarity));
  if (safeRank >= current.rankScore) {
    current.rankScore = safeRank;
    current.source = source;
    current.text = candidate.text || current.text;
    current.targetStatement = statementForCandidate(candidate) ?? current.targetStatement;
  }
}

function lexicalIdeaCandidates(text: string): RankedCandidate[] {
  const terms = weightedTermsForQuery(text);
  if (terms.length === 0) return [];
  const normalizedQuery = normalizeSearchText(text);
  const candidates: RankedCandidate[] = [];
  for (const row of lexicalIdeaRows()) {
    const rankScore = lexicalIdeaScore(row, terms, normalizedQuery);
    if (rankScore <= 0) continue;
    candidates.push({
      kind: 'idea',
      id: row.global_id,
      similarity: rankScore,
      rankScore,
      source: 'lexical',
      targetStatement: row.statement,
      text: `${row.label}: ${row.statement}`,
    });
  }
  return candidates
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, LIVE_LEXICAL_IDEA_LIMIT);
}

function addGraphNeighbors(byKey: Map<string, RankedCandidate>): void {
  const seeds = [...byKey.values()]
    .filter((candidate) => candidate.kind === 'idea')
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, LIVE_GRAPH_SEED_LIMIT);
  for (const seed of seeds) {
    for (const edge of getIdeaEdges(seed.id)) {
      const otherId = edge.edge.from_id === seed.id ? edge.edge.to_id : edge.edge.from_id;
      if (!otherId || otherId === seed.id) continue;
      const other = getIdeaSummary(otherId);
      if (!other) continue;
      const inheritedScore = seed.rankScore * 0.62 + edge.edge.confidence * 0.12;
      const edgeScore = clamp01(Math.min(seed.rankScore * 0.88, inheritedScore));
      upsertCandidate(
        byKey,
        {
          kind: 'idea',
          id: other.global_id,
          similarity: Math.max(0.01, seed.similarity * 0.82),
          text: `${other.label}: ${other.statement}`,
        },
        edgeScore,
        'graph'
      );
    }
  }
}

function gatherLiveCandidates(text: string, vector: number[]): RankedCandidate[] {
  const byKey = new Map<string, RankedCandidate>();

  for (const hit of findSimilarIdeas(vector, LIVE_IDEA_MIN_SIMILARITY, LIVE_SEMANTIC_IDEA_LIMIT)) {
    upsertCandidate(
      byKey,
      {
        kind: 'idea',
        id: hit.global_id,
        similarity: hit.similarity,
        text: `${hit.label}: ${hit.statement}`,
      },
      clamp01(0.18 + hit.similarity * 0.78),
      'semantic'
    );
  }

  for (const candidate of lexicalIdeaCandidates(text)) upsertCandidate(byKey, candidate, candidate.rankScore, candidate.source);

  addGraphNeighbors(byKey);

  for (const candidate of gatherCandidates(vector)) {
    const isIdea = candidate.kind === 'idea';
    upsertCandidate(byKey, candidate, clamp01(candidate.similarity * (isIdea ? 0.9 : 0.72)), isIdea ? 'semantic' : 'support');
  }

  return [...byKey.values()]
    .sort((a, b) => b.rankScore - a.rankScore || b.similarity - a.similarity)
    .slice(0, LIVE_RESULT_LIMIT);
}

function detailForSearchResult(globalId: string, similarity: number | null = null): CopilotIdeaSearchResult | null {
  const detail = getIdeaDetail(globalId);
  if (!detail) return null;
  const authors = new Set<string>();
  const years = new Set<number>();
  for (const occurrence of detail.occurrences) {
    occurrence.work.authors.forEach((author) => {
      if (author) authors.add(author);
    });
    if (occurrence.work.year) years.add(occurrence.work.year);
  }
  const firstWork = detail.occurrences[0]?.work;
  const meta = citationMeta('idea', globalId);
  return {
    globalId,
    type: detail.idea.type,
    label: detail.idea.label,
    statement: detail.idea.statement,
    workCount: detail.occurrences.length,
    authors: [...authors].slice(0, 6),
    years: [...years].sort((a, b) => a - b),
    sourceLabel: firstWork ? [firstWork.title, firstWork.year ? String(firstWork.year) : null].filter(Boolean).join(' · ') : null,
    authorYear: meta.authorYear,
    zoteroKey: meta.zoteroKey,
    searchString: meta.searchString,
    similarity,
  };
}

function lexicalIdeaIds(query: string, limit: number): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return (getDb()
      .prepare(
        `SELECT i.global_id
           FROM ideas i
           LEFT JOIN idea_occurrences o ON o.global_id = i.global_id
           LEFT JOIN works w ON w.nodus_id = o.nodus_id AND w.archived = 0
          GROUP BY i.global_id
          ORDER BY COUNT(DISTINCT o.nodus_id) DESC, i.created_at DESC
          LIMIT ?`
      )
      .all(limit) as { global_id: string }[]).map((row) => row.global_id);
  }

  const like = `%${q}%`;
  return (getDb()
    .prepare(
      `SELECT i.global_id,
              MAX(
                CASE
                  WHEN lower(i.label) = ? THEN 80
                  WHEN lower(i.label) LIKE ? THEN 60
                  WHEN lower(i.statement) LIKE ? THEN 44
                  WHEN lower(o.development) LIKE ? THEN 32
                  WHEN lower(w.authors_json) LIKE ? THEN 28
                  WHEN lower(w.title) LIKE ? THEN 22
                  ELSE 1
                END
              ) AS rank,
              COUNT(DISTINCT o.nodus_id) AS work_count
         FROM ideas i
         LEFT JOIN idea_occurrences o ON o.global_id = i.global_id
         LEFT JOIN works w ON w.nodus_id = o.nodus_id AND w.archived = 0
        WHERE lower(i.label) LIKE ?
           OR lower(i.statement) LIKE ?
           OR lower(o.development) LIKE ?
           OR lower(w.authors_json) LIKE ?
           OR lower(w.title) LIKE ?
        GROUP BY i.global_id
        ORDER BY rank DESC, work_count DESC, lower(i.label)
        LIMIT ?`
    )
    .all(q, like, like, like, like, like, like, like, like, like, like, limit) as {
    global_id: string;
  }[]).map((row) => row.global_id);
}

export async function searchCopilotIdeas(query: string, limit = 30): Promise<CopilotIdeaSearchResult[]> {
  const cleanLimit = Math.max(1, Math.min(60, Math.floor(limit)));
  const ids = lexicalIdeaIds(query, cleanLimit);
  const similarity = new Map<string, number | null>();

  const trimmed = query.trim();
  if (trimmed.length >= 8) {
    const vector = await embedQuery(trimmed);
    if (vector) {
      for (const hit of findSimilarIdeas(vector, LIVE_IDEA_MIN_SIMILARITY, cleanLimit)) {
        if (!ids.includes(hit.global_id)) ids.push(hit.global_id);
        similarity.set(hit.global_id, hit.similarity);
      }
    }
  }

  return ids
    .slice(0, cleanLimit)
    .map((id) => detailForSearchResult(id, similarity.get(id) ?? null))
    .filter((item): item is CopilotIdeaSearchResult => item !== null);
}

function connectionSummary(edgeDetail: EdgeDetail, globalId: string): CopilotIdeaConnection | null {
  const isFrom = edgeDetail.edge.from_id === globalId;
  const otherId = isFrom ? edgeDetail.edge.to_id : edgeDetail.edge.from_id;
  if (!otherId || otherId === globalId) return null;
  const other = getIdeaSummary(otherId);
  return {
    edgeId: edgeDetail.edge.id,
    type: edgeDetail.edge.type,
    basis: edgeDetail.edge.basis,
    confidence: edgeDetail.edge.confidence,
    direction: isFrom ? 'out' : 'in',
    otherId,
    otherLabel: isFrom ? edgeDetail.toLabel : edgeDetail.fromLabel,
    otherStatement: other?.statement ?? null,
    rationale: edgeDetail.explanation ?? edgeDetail.trace?.rationale ?? null,
    citation: `nodus://idea/${otherId}`,
  };
}

export function getCopilotIdeaDetail(globalId: string): CopilotIdeaDetail | null {
  const detail = getIdeaDetail(globalId);
  if (!detail) return null;
  const meta = citationMeta('idea', globalId);
  return {
    idea: {
      globalId: detail.idea.global_id,
      type: detail.idea.type,
      label: detail.idea.label,
      statement: detail.idea.statement,
    },
    citation: `nodus://idea/${globalId}`,
    authorYear: meta.authorYear,
    zoteroKey: meta.zoteroKey,
    searchString: meta.searchString,
    occurrences: detail.occurrences.map((occurrence) => ({
      nodusId: occurrence.nodus_id,
      role: occurrence.role,
      development: occurrence.development,
      confidence: occurrence.confidence,
      workTitle: occurrence.work.title,
      authors: occurrence.work.authors,
      year: occurrence.work.year,
      authorYear: authorYearLabel(occurrence.work.authors, occurrence.work.year),
      zoteroKey: occurrence.work.zotero_key || null,
      searchString: searchString(occurrence.work.authors, occurrence.work.year, occurrence.work.title),
    })),
    evidence: detail.evidence.map((evidence) => ({
      id: evidence.id,
      quote: evidence.quote,
      location: evidence.location,
      kind: evidence.kind,
    })),
    connections: getIdeaEdges(globalId)
      .map((edge) => connectionSummary(edge, globalId))
      .filter((item): item is CopilotIdeaConnection => item !== null),
  };
}

function normalizeAiInsertion(raw: string, authorYear: string | null): string {
  let clean = raw
    .replace(/\[([^\]]+)\]\(nodus:\/\/[^)]+\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  clean = clean.replace(/^["“”]+|["“”]+$/g, '').trim();
  if (authorYear && !new RegExp(`\\(${escapeRegExp(authorYear)}\\)`).test(clean) && !clean.includes(authorYear)) {
    clean = `${clean.replace(/[.;:,\s]+$/g, '')} (${authorYear})`;
  }
  if (clean && !/[.!?)]$/.test(clean)) clean += '.';
  return clean;
}

export async function composeCopilotIdeaInsertion(input: {
  ideaId: string;
  paragraphText: string;
  selectionText?: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
}): Promise<CopilotInsertionResult> {
  const detail = getCopilotIdeaDetail(input.ideaId);
  if (!detail) throw new Error('No se encontró la idea en Nodus.');
  const settings = getSettings();
  const model = input.model ?? settings.synthesisModel;
  const language = input.language ?? settings.promptLanguage ?? 'es';
  const authorYear = detail.authorYear ?? detail.occurrences[0]?.authorYear ?? null;
  const source = detail.occurrences[0] ?? null;
  const text = await completeText(
    {
      system: liveRelationsPromptPack(language).ideaInsertion + '\n' + (authorYear ? citationRequirement(language, authorYear) : noCitationRequirement(language)),
      user: JSON.stringify(
        {
          parrafo_actual: clip(input.paragraphText, 2200),
          seleccion_actual: clip(input.selectionText ?? '', 600),
          idea: detail.idea,
          cita_requerida: authorYear ? `(${authorYear})` : null,
          fuente_principal: source
            ? {
                titulo: source.workTitle,
                autores: source.authors,
                ano: source.year,
                desarrollo: clip(source.development, 900),
              }
            : null,
          evidencias: detail.evidence.slice(0, 3).map((evidence) => ({
            tipo: evidence.kind,
            ubicacion: evidence.location,
            cita_o_parafrasis: clip(evidence.quote, 500),
          })),
          conexiones: detail.connections.slice(0, 6).map((connection) => ({
            tipo: connection.type,
            otra_idea: connection.otherLabel,
            enunciado: clip(connection.otherStatement ?? '', 320),
          })),
          salida: {
            extension: '1-2 frases, maximo 90 palabras',
            tono: 'continua el parrafo actual sin sonar a nota al margen',
          },
        },
        null,
        2
      ),
      temperature: 0.2,
      maxTokens: 320,
    },
    model
  );
  const normalized = normalizeAiInsertion(text, authorYear);
  if (!normalized) throw new Error('La IA no devolvió texto insertable.');
  return {
    text: normalized,
    citation: detail.citation,
    authorYear,
  };
}

/**
 * Analyze an arbitrary paragraph and return its typed relations with the library.
 * Returns `available:false` when no embedding provider/key is configured.
 */
export async function analyzeText(text: string, model?: ModelRef | null, language: PromptLanguage = getSettings().promptLanguage ?? 'es'): Promise<LiveRelationsResult> {
  const trimmed = text.trim();
  if (trimmed.length < 12) return { available: true, relations: [] };

  const vector = await embedQuery(trimmed);
  if (!vector) return { available: false, relations: [] };

  const candidates = gatherLiveCandidates(trimmed, vector);
  if (candidates.length === 0) return { available: true, relations: [] };

  // One LLM pass to type the paragraph↔candidate relations (degrades to 'related'
  // by similarity if the model/typing is unavailable).
  const typed = await typeRelations(
    [{ id: PSEUDO_ID, label: clip(trimmed, 80), statement: trimmed }],
    new Map([[PSEUDO_ID, candidates]]),
    model,
    language
  );

  const relations: LiveRelation[] = candidates.map((candidate) => {
    const hit = typed.get(`${PSEUDO_ID}|${candidate.kind}:${candidate.id}`);
    const target = resolveTarget(candidate.kind, candidate.id);
    const meta = citationMeta(candidate.kind, candidate.id);
    const typedConfidence = hit ? clamp01(hit.confidence) : candidate.rankScore;
    const rankScore = clamp01(candidate.rankScore * 0.86 + typedConfidence * 0.14);
    return {
      relation: normalizeRelationType(hit?.relation),
      targetKind: candidate.kind,
      targetId: candidate.id,
      targetLabel: target.label,
      targetSubtitle: target.subtitle,
      similarity: candidate.similarity,
      confidence: rankScore,
      rankScore,
      targetStatement: candidate.targetStatement,
      source: candidate.source,
      rationale: clip(hit?.rationale ?? '', 300),
      zoteroKey: meta.zoteroKey,
      authorYear: meta.authorYear,
      searchString: meta.searchString,
      citation: `nodus://${candidate.kind}/${candidate.id}`,
      proposedText: null,
    };
  }).sort((a, b) => b.rankScore - a.rankScore || b.similarity - a.similarity);

  return { available: true, relations };
}

// ── Full-text passage search (citable source excerpts) ──────────────────────────
const LIVE_PASSAGE_MIN_SIMILARITY = 0.18;

export interface CopilotPassageSearchResult {
  passageId: string;
  nodusId: string;
  similarity: number;
  pageLabel: string | null;
  /** Short excerpt for the card; `text` carries the full chunk for quoting. */
  snippet: string;
  text: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  authorYear: string | null;
  zoteroKey: string | null;
  attachmentKey: string | null;
  searchString: string | null;
}

export interface CopilotPassageSearchResponse {
  /** False when no embedding provider/key is configured (cannot embedQuery the query). */
  available: boolean;
  /** False when the corpus has no embedded passages for the current model. */
  indexed: boolean;
  passages: CopilotPassageSearchResult[];
}

function parseAuthorsJson(json: string): string[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string' && a.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Semantic search over the corpus full text. Returns citable passage excerpts —
 * the writer's counterpart to searchCopilotIdeas, but over the underlying source
 * text (what you actually quote) rather than derived claims.
 */
export async function searchCopilotPassages(query: string, limit = 20): Promise<CopilotPassageSearchResponse> {
  const cleanLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const trimmed = query.trim();
  if (trimmed.length < 2) return { available: true, indexed: true, passages: [] };

  // Embed first: with no provider we can report "not available" without touching
  // the passage tables, which keeps the branch cheap and side-effect free.
  const vector = await embedQuery(trimmed);
  if (!vector) return { available: false, indexed: false, passages: [] };

  const indexed = embeddedPassageCount() > 0;
  if (!indexed) return { available: true, indexed: false, passages: [] };

  const hits = findSimilarPassages(vector, LIVE_PASSAGE_MIN_SIMILARITY, cleanLimit);
  const attachmentForSource = getDb().prepare(
    'SELECT attachment_key FROM work_text_sources WHERE nodus_id = ? AND source_ref = ? AND active = 1 LIMIT 1',
  );
  const passages = hits.flatMap((hit) => {
    const text = readableCopilotPassageText(hit.text);
    if (!text) return [];
    const authors = parseAuthorsJson(hit.authors_json);
    const source = hit.source_ref
      ? attachmentForSource.get(hit.nodus_id, hit.source_ref) as { attachment_key: string | null } | undefined
      : undefined;
    return [{
      passageId: hit.passage_id,
      nodusId: hit.nodus_id,
      similarity: hit.similarity,
      pageLabel: hit.page_label,
      snippet: clip(text, 320),
      text,
      workTitle: hit.title,
      authors,
      year: hit.year,
      authorYear: authorYearLabel(authors, hit.year),
      zoteroKey: hit.zotero_key || null,
      attachmentKey: source?.attachment_key || null,
      searchString: searchString(authors, hit.year, hit.title),
    }];
  });
  return { available: true, indexed, passages };
}

// ── Compose over the user's selection (rewrite / expand / counter) ───────────────
export type CopilotComposeMode = 'rewrite' | 'expand' | 'counter';

export interface CopilotComposeCitation {
  label: string;
  authorYear: string | null;
  zoteroKey: string | null;
  searchString: string | null;
}

export interface CopilotComposeResult {
  /** False when no embedding provider is configured (relations cannot be found). */
  available: boolean;
  mode: CopilotComposeMode;
  text: string;
  citations: CopilotComposeCitation[];
}

const COMPOSE_MAX_CONTEXT = 5;

function localizedComposeSystemPrompt(mode: CopilotComposeMode, language: PromptLanguage): string {
  const pack = liveRelationsPromptPack(language);
  return pack.composeBase + '\n' + pack.output[mode];
}

function localizedComposeOutputHint(mode: CopilotComposeMode, language: PromptLanguage): string {
  const hints: Record<PromptLanguage, Record<CopilotComposeMode, string>> = {
    es: { rewrite: 'Versión reescrita de la selección (la sustituye).', expand: '1-3 frases nuevas que continúan el texto (se añaden tras la selección).', counter: '1-3 frases de contraargumento con su(s) cita(s) (se añaden tras la selección).' },
    en: { rewrite: 'Rewritten version of the selection (it replaces it).', expand: '1-3 new sentences continuing the text (added after the selection).', counter: '1-3 counterargument sentences with citation(s) (added after the selection).' },
    fr: { rewrite: 'Version réécrite de la sélection (elle la remplace).', expand: '1 à 3 phrases nouvelles qui prolongent le texte (ajoutées après la sélection).', counter: '1 à 3 phrases de contre-argument avec citation(s) (ajoutées après la sélection).' },
    de: { rewrite: 'Überarbeitete Fassung der Auswahl (sie ersetzt die Auswahl).', expand: '1–3 neue Sätze, die den Text fortsetzen (nach der Auswahl eingefügt).', counter: '1–3 Sätze eines Gegenarguments mit Zitat(en) (nach der Auswahl eingefügt).' },
    pt: { rewrite: 'Versão reescrita da seleção (substitui a seleção).', expand: '1–3 frases novas que continuam o texto (acrescentadas depois da seleção).', counter: '1–3 frases de contra-argumento com citação(ões) (acrescentadas depois da seleção).' },
    'pt-BR': { rewrite: 'Versão reescrita da seleção (substitui a seleção).', expand: '1–3 frases novas que continuam o texto (adicionadas após a seleção).', counter: '1–3 frases de contra-argumento com citação(ões) (adicionadas após a seleção).' },
    it: { rewrite: 'Versione riscritta della selezione (la sostituisce).', expand: '1–3 frasi nuove che continuano il testo (aggiunte dopo la selezione).', counter: '1–3 frasi di controargomentazione con citazione/i (aggiunte dopo la selezione).' },
    tr: { rewrite: 'Seçimin yeniden yazılmış sürümü (seçimin yerini alır).', expand: 'Metni sürdüren 1-3 yeni cümle (seçimin ardından eklenir).', counter: 'Alıntı(lar) içeren 1-3 karşı argüman cümlesi (seçimin ardından eklenir).' },
    'zh-Hans': { rewrite: '所选内容的改写版本（将替换所选内容）。', expand: '承接原文的 1–3 句新内容（追加于所选内容之后）。', counter: '1–3 句带引用的反驳论述（追加于所选内容之后）。' },
    'zh-Hant': { rewrite: '所選內容的改寫版本（將取代所選內容）。', expand: '承接原文的 1–3 句新內容（附加於所選內容之後）。', counter: '1–3 句帶引用的反駁論述（附加於所選內容之後）。' },
    vi: { rewrite: 'Bản viết lại của phần đã chọn (thay thế phần đã chọn).', expand: '1–3 câu mới tiếp nối văn bản (được thêm vào sau phần đã chọn).', counter: '1–3 câu phản biện kèm trích dẫn (được thêm vào sau phần đã chọn).' },
    ja: { rewrite: '選択範囲を書き直した版（選択範囲を置き換えます）。', expand: 'テキストを続ける新しい文を 1-3 文（選択範囲の後に追加されます）。', counter: '引用を付した反論の文を 1-3 文（選択範囲の後に追加されます）。' },
    ru: { rewrite: 'Переписанный вариант выделенного фрагмента (заменяет его).', expand: '1–3 новых предложения, продолжающих текст (добавляются после выделенного фрагмента).', counter: '1–3 предложения контраргумента со ссылкой(ами) (добавляются после выделенного фрагмента).' },
    uk: { rewrite: 'Переписаний варіант виділеного фрагмента (замінює його).', expand: '1–3 нових речення, що продовжують текст (додаються після виділеного фрагмента).', counter: '1–3 речення контраргументу з посиланням(ями) (додаються після виділеного фрагмента).' },
    ko: { rewrite: '선택한 내용을 다시 쓴 버전(선택한 내용을 대체합니다).', expand: '텍스트를 이어 가는 새 문장 1~3개(선택한 내용 뒤에 추가됩니다).', counter: '인용을 포함한 반론 문장 1~3개(선택한 내용 뒤에 추가됩니다).' },
  };
  return hints[language][mode];
}

function citationRequirement(language: PromptLanguage, authorYear: string): string {
  const text: Record<PromptLanguage, string> = {
    es: 'La respuesta debe incluir exactamente esta cita parentética en texto plano: (' + authorYear + ').',
    en: 'The response must include exactly this parenthetical citation in plain text: (' + authorYear + ').',
    fr: 'La réponse doit inclure exactement cette citation parenthétique en texte brut : (' + authorYear + ').',
    de: 'Die Antwort muss genau diese Klammerzitation als Klartext enthalten: (' + authorYear + ').',
    pt: 'A resposta deve incluir exatamente esta citação parentética em texto simples: (' + authorYear + ').',
    'pt-BR': 'A resposta deve incluir exatamente esta citação entre parênteses em texto simples: (' + authorYear + ').',
    it: 'La risposta deve includere esattamente questa citazione parentetica in testo semplice: (' + authorYear + ').',
    tr: 'Yanıt düz metin olarak tam şu parantez içi alıntıyı içermeli: (' + authorYear + ').',
    'zh-Hans': '回答必须准确包含以下括号引用，且须为纯文本：(' + authorYear + ')。',
    'zh-Hant': '回答必須準確包含以下括號引用，且須為純文字：(' + authorYear + ')。',
    vi: 'Câu trả lời phải chứa chính xác trích dẫn trong ngoặc sau đây dưới dạng văn bản thuần: (' + authorYear + ').',
    ja: '回答には、次の括弧内引用をプレーンテキストで正確に含めてください：(' + authorYear + ')。',
    ru: 'Ответ должен содержать ровно эту ссылку в скобках в виде простого текста: (' + authorYear + ').',
    uk: 'Відповідь має містити саме це посилання в дужках у вигляді простого тексту: (' + authorYear + ').',
    ko: '응답에는 다음 괄호 인용을 일반 텍스트로 정확히 포함해야 합니다: (' + authorYear + ').',
  };
  return text[language];
}

function noCitationRequirement(language: PromptLanguage): string {
  const text: Record<PromptLanguage, string> = {
    es: 'Si no hay autor-año, no inventes cita bibliográfica.',
    en: 'If there is no author-year, do not invent a bibliographic citation.',
    fr: 'Sans auteur-année, n’invente pas de référence bibliographique.',
    de: 'Wenn kein Autor-Jahr vorliegt, erfinde keine bibliografische Angabe.',
    pt: 'Se não houver autor-ano, não inventes uma citação bibliográfica.',
    'pt-BR': 'Se não houver autor-ano, não invente uma citação bibliográfica.',
    it: 'Senza autore-anno, non inventare una citazione bibliografica.',
    tr: 'Yazar-yıl yoksa bibliyografik alıntı uydurma.',
    'zh-Hans': '如果没有作者-年份，不要编造文献引用。',
    'zh-Hant': '如果沒有作者-年份，請勿杜撰文獻引用。',
    vi: 'Nếu không có tác giả và năm, đừng bịa ra trích dẫn thư mục.',
    ja: '著者と年の記載がない場合は、文献の引用を捏造しないでください。',
    ru: 'Если автор и год не указаны, не выдумывайте библиографическую ссылку.',
    uk: 'Якщо автор і рік не вказані, не вигадуйте бібліографічне посилання.',
    ko: '저자와 연도가 없으면 서지 인용을 만들어내지 마십시오.',
  };
  return text[language];
}

function normalizeComposeText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\(nodus:\/\/[^)]+\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\r?\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^["“”«»]+|["“”«»]+$/g, '')
    .trim();
}

/**
 * Draft text FROM the user's selection, grounded in the library: rewrite it,
 * expand it, or build a cited counterargument. Reuses analyzeText's typed
 * relations so 'counter' can prefer the ideas that contradict/refine the claim.
 */
export async function composeFromSelection(input: {
  mode: CopilotComposeMode;
  selectionText: string;
  paragraphText: string;
  model?: ModelRef | null;
  language?: PromptLanguage;
}): Promise<CopilotComposeResult> {
  const { mode } = input;
  const selection = (input.selectionText ?? '').trim();
  const paragraph = (input.paragraphText ?? '').trim();
  const focus = selection || paragraph;
  if (focus.length < 12) {
    throw new Error('Selecciona (o sitúate en) un fragmento con algo más de texto para trabajarlo.');
  }

  const language = input.language ?? getSettings().promptLanguage ?? 'es';
  const analysis = await analyzeText(focus, input.model ?? null, language);
  if (!analysis.available) return { available: false, mode, text: '', citations: [] };

  const relations = analysis.relations.slice();
  let chosen: LiveRelation[];
  if (mode === 'counter') {
    const opposing = relations.filter((r) => r.relation === 'contradicts' || r.relation === 'refines');
    chosen = (opposing.length ? opposing : relations).slice(0, COMPOSE_MAX_CONTEXT);
  } else {
    chosen = relations.slice(0, COMPOSE_MAX_CONTEXT);
  }

  const context = chosen.map((r) => ({
    relacion: r.relation,
    idea: r.targetLabel,
    enunciado: clip(r.targetStatement ?? r.rationale ?? '', 320),
    cita: r.authorYear,
  }));

  const model = input.model ?? getSettings().synthesisModel;
  const raw = await completeText(
    {
      system: localizedComposeSystemPrompt(mode, language),
      user: JSON.stringify(
        {
          seleccion: clip(selection, 1400),
          parrafo: clip(paragraph, 2200),
          ideas_de_la_biblioteca: context,
          salida: localizedComposeOutputHint(mode, language),
        },
        null,
        2
      ),
      temperature: 0.25,
      maxTokens: 480,
    },
    model
  );

  const text = normalizeComposeText(raw);
  if (!text) throw new Error('La IA no devolvió texto insertable.');

  const citations: CopilotComposeCitation[] = [];
  const seen = new Set<string>();
  for (const r of chosen) {
    if (!r.authorYear && !r.zoteroKey) continue;
    const key = r.zoteroKey || r.authorYear || r.targetLabel;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      label: r.targetLabel,
      authorYear: r.authorYear,
      zoteroKey: r.zoteroKey,
      searchString: r.searchString,
    });
  }

  return { available: true, mode, text, citations };
}
