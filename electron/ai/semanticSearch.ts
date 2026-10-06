import { findArchiveItemsSimilar } from '../db/archiveRepo';
import { globalSearch } from '../db/searchRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { searchHybridCorpus } from './hybridCorpusSearch';
import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
// Meaning-based search over the embedded corpus. The text search in
// db/searchRepo.ts matches characters (LIKE); this one matches meaning by
// embedding the query and ranking ideas, passages and works by cosine
// similarity. Requires an embedding provider configured in Settings — when none
// is available `available:false` is returned so the UI can explain why.
import type {
  GlobalSearchResult,
  PromptLanguage,
  SearchResultKind,
  SemanticSearchOptions,
  SemanticSearchResponse,
} from '@shared/types';
import { getDb } from '../db/database';
import { currentEmbeddingConfig, findSimilarIdeas, getIdea } from '../db/ideasRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { embedQuery } from './aiClient';
import { retrieveHierarchical } from './hierarchicalRetrieval';
import { getSettings } from '../db/settingsRepo';

const DEFAULT_KINDS: SearchResultKind[] = ['idea', 'passage', 'work'];
const SEMANTIC_KINDS: SearchResultKind[] = ['idea', 'passage', 'work', 'note', 'gap', 'theme', 'author', 'person', 'event', 'archive'];
const DEFAULT_LIMIT = 12;
const DEFAULT_MIN_SIMILARITY = 0.2;

const UNTITLED: Record<PromptLanguage, string> = {
  es: '(sin título)', en: '(untitled)', fr: '(sans titre)', de: '(ohne Titel)', pt: '(sem título)', 'pt-BR': '(sem título)', it: '(senza titolo)', tr: '(başlıksız)',
  'zh-Hans': '(无标题)', 'zh-Hant': '(無標題)', vi: '(không có tiêu đề)', ja: '(無題)', ru: '(без названия)', uk: '(без назви)', ko: '(제목 없음)',
};

function interfaceLanguage(): PromptLanguage {
  try {
    return normalizePromptLanguage(getSettings().uiLanguage);
  } catch {
    return 'es';
  }
}

function snippet(text: string | null | undefined, max = 200): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseAuthors(json: string | null): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    if (Array.isArray(value)) return value.map((a) => String(a)).filter(Boolean);
  } catch {
    /* ignore malformed author blobs */
  }
  return [];
}

function workSubtitle(authors: string[], year: number | null): string | null {
  return [authors.slice(0, 3).join('; ') || null, year ? String(year) : null].filter(Boolean).join(' · ') || null;
}

function rankByVector(
  vector: number[],
  kinds: Set<SearchResultKind>,
  limit: number,
  threshold: number,
  excludeIdeaIds: string[] = [],
  language: PromptLanguage = 'es',
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];

  if (kinds.has('idea')) {
    for (const r of findSimilarIdeas(vector, threshold, limit, { excludeIds: excludeIdeaIds })) {
      results.push({
        kind: 'idea',
        id: r.global_id,
        title: r.label,
        snippet: snippet(r.statement),
        ideaType: r.type,
        similarity: r.similarity,
      });
    }
  }

  if (kinds.has('passage')) {
    for (const p of findSimilarPassages(vector, threshold, limit)) {
      const authors = parseAuthors(p.authors_json);
      const sub = workSubtitle(authors, p.year);
      results.push({
        kind: 'passage',
        id: p.passage_id,
        title: p.title || UNTITLED[language],
        subtitle: [sub, p.page_label ? `p. ${p.page_label}` : null].filter(Boolean).join(' · ') || null,
        snippet: snippet(p.text),
        nodusId: p.nodus_id,
        zoteroKey: p.zotero_key,
        pageLabel: p.page_label,
        similarity: p.similarity,
      });
    }
  }

  if (kinds.has('work')) {
    const hits = findSimilarWorks(vector, threshold, limit);
    if (hits.length) {
      const ids = hits.map((h) => h.nodus_id);
      const meta = new Map(
        (
          getDb()
            .prepare(
              `SELECT nodus_id, title, authors_json, year, zotero_key FROM works
                WHERE nodus_id IN (${ids.map(() => '?').join(',')}) AND archived = 0`
            )
            .all(...ids) as {
            nodus_id: string;
            title: string;
            authors_json: string | null;
            year: number | null;
            zotero_key: string | null;
          }[]
        ).map((row) => [row.nodus_id, row])
      );
      for (const h of hits) {
        const m = meta.get(h.nodus_id);
        if (!m) continue;
        results.push({
          kind: 'work',
          id: h.nodus_id,
          title: m.title || UNTITLED[language],
          subtitle: workSubtitle(parseAuthors(m.authors_json), m.year),
          snippet: snippet(h.summary),
          zoteroKey: m.zotero_key,
          similarity: h.similarity,
        });
      }
    }
  }

  return results;
}

export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResponse> {
  const q = query.trim();
  if (q.length < 2) return { available: true, results: [] };

  const db = getDb();
  const config = JSON.stringify(currentEmbeddingConfig());
  const vaultType = getActiveVault().type;
  const allowed: SearchResultKind[] = vaultType === 'genealogy'
    ? ['person', 'event', 'archive', 'work', 'passage', 'note']
    : ['idea', 'passage', 'work', 'note', 'gap', 'theme', 'author'];
  const requested = (options.kinds ?? DEFAULT_KINDS).filter((kind) => SEMANTIC_KINDS.includes(kind) && allowed.includes(kind));
  if (!requested.length) return { available: true, results: [] };
  const kinds = new Set<SearchResultKind>(requested);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const threshold = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const vector = await embedQuery(q);
  if (!vector || getDb() !== db || !db.open || JSON.stringify(currentEmbeddingConfig()) !== config) return { available: false, results: [] };

  const language = interfaceLanguage();
  const results = rankByVector(vector, kinds, limit, threshold, [], language);
  let available = true;
  if (kinds.has('work')) {
    // Whole-document and section vectors complement the historical summary vector.
    // Keep one search-result row per work; its snippet may now come from the most
    // relevant audited document field or section.
    const hierarchy = await retrieveHierarchical(q, {
      embedding: vector,
      documentLimit: limit * 2,
      ideaLimit: 0,
      passageLimit: 0,
      minDocumentSimilarity: threshold,
    });
    const topDocumentScore = hierarchy.documents[0]?.retrievalScore ?? 0;
    for (const hit of hierarchy.documents) {
      // RRF is ordinal. Normalise it inside this result set before comparing it
      // with cosine scores; a fixed multiplier made a lexical match look like a
      // near-perfect vector match and destabilised the legacy work ranking.
      const routedStrength = topDocumentScore > 0
        ? 0.65 * (hit.retrievalScore / topDocumentScore)
        : 0;
      results.push({
        kind: 'work',
        id: hit.nodusId,
        title: hit.title || UNTITLED[language],
        subtitle: workSubtitle(hit.authors, hit.year),
        snippet: snippet(hit.text),
        similarity: Math.max(hit.similarity, routedStrength),
      });
    }
  }
  if (kinds.has('archive')) {
    for (const hit of await findArchiveItemsSimilar(vector, { limit, minSimilarity: threshold })) {
      results.push({ kind: 'archive', id: hit.itemId, title: hit.title, snippet: snippet(hit.description), similarity: hit.similarity });
    }
  }
  const derivedKinds = new Set([...kinds].filter((kind) => !['idea', 'passage', 'work', 'archive'].includes(kind)));
  if (derivedKinds.size && getDb() === db && db.open) {
    const derived = await searchHybridCorpus(q, globalSearch('', -1, true, derivedKinds), derivedKinds, limit, vector);
    available = derived.semanticAvailable;
    results.push(...derived.results.map((hit) => ({ ...hit, snippet: snippet(hit.snippet) })));
  }
  if (getDb() !== db || !db.open) return { available: false, results: [] };
  const unique = new Map<string, GlobalSearchResult>();
  for (const result of results) {
    const key = `${result.kind}:${result.id}`;
    const previous = unique.get(key);
    if (!previous || (result.similarity ?? 0) > (previous.similarity ?? 0)) unique.set(key, result);
  }
  return {
    available,
    results: [...unique.values()].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, limit),
  };
}

/** "Ideas parecidas a esta": rank ideas by similarity to one already-embedded idea. */
export async function findSimilarToIdea(globalId: string, limit = DEFAULT_LIMIT): Promise<SemanticSearchResponse> {
  const idea = getIdea(globalId);
  if (!idea?.embedding || idea.embedding.length === 0) return { available: false, results: [] };
  const results = rankByVector(idea.embedding, new Set(['idea']), limit, DEFAULT_MIN_SIMILARITY, [globalId], interfaceLanguage());
  return { available: true, results };
}
