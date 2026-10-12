import { matchingResearchWorkIds, normalizeResearchSourceFilter, type ResearchContextSources, type ResearchSourceFilter } from '@shared/researchContextFilters';
import { getDb } from '../db/database';

export function listResearchContextSources(): ResearchContextSources {
  const db = getDb();
  const rows = db.prepare('SELECT nodus_id, title, authors_json, year FROM works WHERE archived=0 ORDER BY title COLLATE NOCASE').all() as Array<{ nodus_id: string; title: string; authors_json: string; year: number | null }>;
  const links = db.prepare(`SELECT a.author_id, a.name, wa.nodus_id FROM authors a
    JOIN work_authors wa ON wa.author_id=a.author_id AND wa.role='author'
    JOIN works w ON w.nodus_id=wa.nodus_id WHERE w.archived=0 ORDER BY a.name COLLATE NOCASE`).all() as Array<{ author_id: string; name: string; nodus_id: string }>;
  const authors = new Map<string, ResearchContextSources['authors'][number]>();
  for (const row of links) {
    if (!authors.has(row.author_id)) authors.set(row.author_id, { id: row.author_id, name: row.name, workIds: [] });
    authors.get(row.author_id)!.workIds.push(row.nodus_id);
  }
  return { authors: [...authors.values()], works: rows.map(row => {
    let authors: string[] = [];
    try { const parsed = JSON.parse(row.authors_json); if (Array.isArray(parsed)) authors = parsed.filter(item => typeof item === 'string'); } catch { /* Legacy metadata. */ }
    return { id: row.nodus_id, title: row.title, authors, year: row.year };
  }) };
}

export interface ResearchSourceScope {
  workIds: Set<string>;
  ideaIds: Set<string>;
  themeIds: Set<string>;
  authorIds: Set<string>;
  edgeIds: Set<string>;
}

/** The works a source filter admits, or null when it does not restrict. `resolveResearchSourceScope`
 *  without the idea, theme, author and edge sets, which a caller wanting only the works paid for:
 *  ~0.24 s on a 14,000-work library, several times per research turn (scope checks). */
export function resolveResearchSourceWorkIds(value?: ResearchSourceFilter): Set<string> | null {
  const filter = normalizeResearchSourceFilter(value);
  if (!filter.enabled) return null;
  return new Set(matchingResearchWorkIds(listResearchContextSources(), filter));
}

export function resolveResearchSourceScope(value?: ResearchSourceFilter, strictProvenance = false): ResearchSourceScope | null {
  const filter = normalizeResearchSourceFilter(value);
  if (!filter.enabled) return null;
  const workIds = matchingResearchWorkIds(listResearchContextSources(), filter);
  const db = getDb();
  const bound = JSON.stringify(workIds);
  const ids = (sql: string) => new Set((db.prepare(sql).all(bound) as Array<{ id: string }>).map(row => row.id));
  return {
    workIds: new Set(workIds),
    ideaIds: ids(strictProvenance ? `WITH allowed AS (SELECT value FROM json_each(?))
      SELECT DISTINCT io.global_id id FROM idea_occurrences io WHERE io.nodus_id IN (SELECT value FROM allowed)
      AND NOT EXISTS (SELECT 1 FROM idea_occurrences other WHERE other.global_id=io.global_id AND other.nodus_id NOT IN (SELECT value FROM allowed))
      AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.global_id=io.global_id AND e.nodus_id NOT IN (SELECT value FROM allowed))`
      : 'SELECT DISTINCT global_id id FROM idea_occurrences WHERE nodus_id IN (SELECT value FROM json_each(?))'),
    themeIds: ids(`WITH allowed AS (SELECT value FROM json_each(?))
      SELECT DISTINCT theme_id id FROM work_themes WHERE nodus_id IN (SELECT value FROM allowed)
      UNION SELECT theme_id id FROM idea_theme_links WHERE nodus_id IN (SELECT value FROM allowed)`),
    authorIds: ids('SELECT DISTINCT author_id id FROM work_authors WHERE nodus_id IN (SELECT value FROM json_each(?)) AND role=\'author\''),
    edgeIds: ids('SELECT id FROM edges WHERE source_work IN (SELECT value FROM json_each(?))'),
  };
}

/** A mixed-work Idea's synthesized statement is never reusable under a narrower
 * scope. Its explicit quotation may route to an authorized current passage only
 * when the quoted bytes actually occur there. No global label or development text
 * crosses this adapter; nonseparable/paraphrased syntheses remain excluded.
 *
 * Two steps, with the same result as the single statement they replace (kept in
 * scripts/test-scoped-idea-evidence.mjs as the reference). That statement tested
 * `instr(p.text, e.quote)` for every qualifying quote against every passage of its work, and
 * re-lowered each quote once per query term: on a real 14,000-work library a research search
 * took 0.13-0.29 s of the main thread with the whole library in scope and 11-19 s with half of
 * it, once per search. Now the quotes are chosen first, then each candidate work's passages are
 * read once and searched for all of that work's quotes together. */
export function scopedIdeaEvidencePassages(query: string, workIds: string[], limit: number): import('./hierarchicalRetrieval').HierarchicalPassageHit[] {
  if (!workIds.length || limit <= 0) return [];
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 32);
  if (!terms.length) return [];
  const db = getDb();
  const allowed = JSON.stringify(workIds);
  // The quotes: explicit, of an allowed work, of an idea that also occurs outside the scope, and
  // naming a query term. Which ideas occur outside is one pass over the occurrences for a large
  // scope; for a small one, probing each of its few quotes' ideas is cheaper (measured: 17 ms
  // against 80 ms for 14,000 works, 43 ms against 10 ms for one).
  const outside = workIds.length >= 1000
    ? 'e.global_id IN (SELECT global_id FROM idea_occurrences WHERE nodus_id NOT IN (SELECT value FROM allowed))'
    : 'EXISTS (SELECT 1 FROM idea_occurrences other WHERE other.global_id=e.global_id AND other.nodus_id NOT IN (SELECT value FROM allowed))';
  const quotes = db.prepare(`WITH allowed AS (SELECT value FROM json_each(?)), terms AS (SELECT value FROM json_each(?))
    SELECT DISTINCT e.nodus_id,e.quote FROM evidence e
    WHERE e.nodus_id IN (SELECT value FROM allowed) AND e.kind='explicit' AND length(trim(e.quote))>=16 AND ${outside}
      AND EXISTS (SELECT 1 FROM terms WHERE instr(lower(e.quote),value)>0)`).all(allowed, JSON.stringify(terms)) as Array<{ nodus_id: string; quote: string }>;
  if (!quotes.length) return [];
  const byWork = new Map<string, QuoteMatcher>();
  for (const { nodus_id: work, quote } of quotes) {
    let matcher = byWork.get(work);
    if (!matcher) { matcher = new QuoteMatcher(); byWork.set(work, matcher); }
    matcher.add(quote);
  }
  const passages = db.prepare(`SELECT p.passage_id,p.nodus_id,p.text,p.page_label,p.source_ref,p.page_number,
      w.title,w.authors_json,w.year,w.zotero_key
    FROM passages p JOIN works w ON w.nodus_id=p.nodus_id
    WHERE p.nodus_id IN (SELECT value FROM json_each(?)) AND w.archived=0
      AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))`);
  const found: Array<import('../db/passagesRepo').SimilarPassage> = [];
  for (const row of passages.iterate(JSON.stringify([...byWork.keys()])) as Iterable<Omit<import('../db/passagesRepo').SimilarPassage, 'similarity'>>) {
    if (!byWork.get(row.nodus_id)!.occursIn(row.text)) continue;
    // SQLite's lower() folds ASCII letters only; instr() is a plain substring test.
    const lowered = row.text.replace(/[A-Z]+/g, letters => letters.toLowerCase());
    found.push({ ...row, similarity: terms.reduce((count, term) => count + Number(lowered.includes(term)), 0) });
  }
  // ORDER BY similarity DESC, passage_id: SQLite compares text by its UTF-8 bytes.
  found.sort((a, b) => b.similarity - a.similarity || Buffer.compare(Buffer.from(a.passage_id), Buffer.from(b.passage_id)));
  return found.slice(0, Math.min(500, limit)).map(row => ({ ...row, lanes: ['support'] }));
}

/** Whether a text contains any of a set of quotes, in one pass over the text: each position's
 *  first QUOTE_PREFIX code units are hashed as a rolling window and only a quote whose prefix has
 *  the same hash is compared. Every quote here is at least 16 characters long, so at least 16 code
 *  units; a shorter one is compared directly. */
const QUOTE_PREFIX = 16;
class QuoteMatcher {
  private readonly byPrefix = new Map<number, string[]>();
  /** The low 16 bits of every prefix hash: most positions are rejected here, without a Map lookup. */
  private readonly seen = new Uint8Array(65536);
  private readonly short: string[] = [];
  private power = 1;
  constructor() { for (let index = 1; index < QUOTE_PREFIX; index += 1) this.power = Math.imul(this.power, 31); }
  private static hash(text: string, from: number): number {
    let hash = 0;
    for (let index = from; index < from + QUOTE_PREFIX; index += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
    return hash;
  }
  add(quote: string): void {
    if (quote.length < QUOTE_PREFIX) { this.short.push(quote); return; }
    const key = QuoteMatcher.hash(quote, 0);
    this.seen[key & 0xffff] = 1;
    const list = this.byPrefix.get(key);
    if (list) list.push(quote); else this.byPrefix.set(key, [quote]);
  }
  occursIn(text: string): boolean {
    if (this.short.some(quote => text.includes(quote))) return true;
    if (!this.byPrefix.size || text.length < QUOTE_PREFIX) return false;
    let hash = QuoteMatcher.hash(text, 0);
    for (let at = 0; ; at += 1) {
      if (this.seen[hash & 0xffff]) {
        const candidates = this.byPrefix.get(hash);
        if (candidates && candidates.some(quote => text.startsWith(quote, at))) return true;
      }
      if (at + QUOTE_PREFIX >= text.length) return false;
      hash = (Math.imul(hash - Math.imul(text.charCodeAt(at), this.power), 31) + text.charCodeAt(at + QUOTE_PREFIX)) | 0;
    }
  }
}
