import type { ResearchWebActivityDetail, ResearchWebPageOutcome } from '@shared/researchActivity';
import {
  bm25Scores, boilerplateScore, canonicalWebUrl, chunkWebText, fuseRanks, rankWebResults, selectPagesToRead, selectWebPassages, termCoverage, webDomain, webTerms,
  type RankedWebResult, type WebQueryRun, type WebSearchHit,
} from '@shared/webResearchRanking';
import type { ExtractedWebPage } from './webPageExtract';
import type { FetchedWebPage, WebFetchFailure } from './webFetch';

export type WebDepth = 'fast' | 'balanced' | 'deep';
export interface WebResearchLimits {
  rounds: number; firstQueries: number; followQueries: number; maxQueries: number;
  pagesPerRound: number; maxPages: number; passages: number; targetPassages: number; minDomains: number;
  deadlineMs: number; evidenceBytes: number; fetchConcurrency: number;
}
/** Bounded per preset so the web step never dominates a chat turn. */
export const WEB_RESEARCH_LIMITS: Record<WebDepth, WebResearchLimits> = {
  fast: { rounds: 1, firstQueries: 3, followQueries: 0, maxQueries: 3, pagesPerRound: 4, maxPages: 5, passages: 5, targetPassages: 3, minDomains: 2, deadlineMs: 25_000, evidenceBytes: 7000, fetchConcurrency: 4 },
  balanced: { rounds: 2, firstQueries: 4, followQueries: 3, maxQueries: 7, pagesPerRound: 6, maxPages: 10, passages: 8, targetPassages: 5, minDomains: 3, deadlineMs: 40_000, evidenceBytes: 11000, fetchConcurrency: 4 },
  deep: { rounds: 3, firstQueries: 4, followQueries: 3, maxQueries: 10, pagesPerRound: 7, maxPages: 14, passages: 12, targetPassages: 7, minDomains: 4, deadlineMs: 60_000, evidenceBytes: 16000, fetchConcurrency: 4 },
};

export interface PlannedQuery { q: string; scholarly: boolean }
export interface WebSearchResponse { results: WebSearchHit[]; unresponsive: Array<[string, string]> }
export interface WebActivity {
  start(operation: 'plan' | 'query' | 'results' | 'fetch' | 'reformulate' | 'select' | 'finish', subject?: string, detail?: ResearchWebActivityDetail):
    (status?: 'completed' | 'failed' | 'cancelled', count?: number, detail?: ResearchWebActivityDetail) => void;
}
export interface WebResearchDeps {
  search(query: string, category: 'general' | 'science', signal: AbortSignal): Promise<WebSearchResponse>;
  fetchPage(url: string, signal: AbortSignal): Promise<FetchedWebPage>;
  extract(page: FetchedWebPage, signal: AbortSignal): Promise<ExtractedWebPage>;
  /** The open-API record of a scholarly page that answered with a bot check. */
  fallback?(url: string, signal: AbortSignal): Promise<FetchedWebPage | null>;
  /** Query planning and reformulation. Null when the model is unavailable. */
  planQueries(input: { question: string; today: string; library: string; hint: string[]; intent: string; count: number }, signal: AbortSignal): Promise<{ search: boolean; queries: PlannedQuery[] } | null>;
  reformulate(input: { question: string; tried: string[]; found: Array<{ title: string; domain: string }>; missing: string[]; count: number }, signal: AbortSignal): Promise<PlannedQuery[] | null>;
  /** The model picks which of the best-ranked results to open. Null: heuristic order. */
  pickResults?(input: { question: string; candidates: Array<{ i: number; title: string; site: string; snippet: string }>; count: number }, signal: AbortSignal): Promise<number[] | null>;
  /** The model rates candidate passages 0-2. Null: heuristic relevance only. */
  ratePassages?(input: { question: string; passages: Array<{ i: number; source: string; text: string }> }, signal: AbortSignal): Promise<Array<{ i: number; r: number }> | null>;
  /** Optional semantic lane: vectors for the question and the passages, same order. */
  embed?(texts: string[], signal: AbortSignal): Promise<number[][] | null>;
  now(): number;
}
export interface WebResearchInput {
  question: string;
  depth: WebDepth;
  /** Queries the supervisor proposed, or none. */
  hint?: string[];
  intent: 'expand' | 'contrast' | 'update' | 'explicit' | 'fallback';
  /** Plain summary of what the library already supplied (titles), to avoid repeating it. */
  library: string;
  /** Evidence budget left for web passages in this turn (UTF-8 bytes). */
  evidenceBytes?: number;
  /** Pages already read by an earlier web step in the same turn. */
  visited?: Set<string>;
  signal: AbortSignal;
  activity: WebActivity;
}
export interface WebEvidence {
  key: string;
  pageKey: string;
  url: string;
  finalUrl: string;
  title: string;
  siteName: string | null;
  domain: string;
  byline: string | null;
  publishedAt: string | null;
  doi: string | null;
  kind: 'html' | 'pdf';
  pageNumber: number | null;
  heading: string | null;
  text: string;
  relevance: number;
  retrievedAt: string;
}
export interface WebConsultedPage { key: string; url: string; title: string; domain: string; outcome: ResearchWebPageOutcome; passages: number; round: number }
export interface WebResearchOutcome {
  searched: boolean;
  queries: Array<{ query: string; category: 'general' | 'science'; round: number; results: number; failed?: boolean }>;
  found: number;
  consulted: WebConsultedPage[];
  evidence: WebEvidence[];
  rounds: number;
  limitations: string[];
  reason: NonNullable<ResearchWebActivityDetail['reason']>;
  durationMs: number;
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2; }
  return left && right ? dot / Math.sqrt(left * right) : 0;
};

/** Normalise model-written queries: plain words, no duplicates, bounded length. */
export function cleanQueries(queries: PlannedQuery[], tried: Iterable<string>, limit: number): PlannedQuery[] {
  const seen = new Set([...tried].map(query => webTerms(query).sort().join(' ')));
  const out: PlannedQuery[] = [];
  for (const query of queries) {
    const q = query.q.replace(/["“”«»]/g, ' ').replace(/\b(site|inurl|intitle|filetype):\S+/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const key = webTerms(q).sort().join(' ');
    if (!q || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ q, scholarly: !!query.scholarly });
    if (out.length >= limit) break;
  }
  return out;
}

/** Deterministic plan when the model cannot write one: the question itself,
 * without its interrogative scaffolding. */
export function fallbackQueries(question: string, hint: string[] = []): PlannedQuery[] {
  const terms = webTerms(question).slice(0, 10).join(' ');
  return [...hint.map(q => ({ q, scholarly: false })), ...(terms ? [{ q: terms, scholarly: false }] : [])];
}

async function pool<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await run(items[index]); }
  }));
  return results;
}

interface PageRecord { result: RankedWebResult; page: ExtractedWebPage; finalUrl: string; round: number }

/** One web step: plan complementary queries, discover through SearXNG, merge and
 * rank the results, read the best pages, extract passages and keep the relevant,
 * diverse ones. When the evidence is thin it reformulates and follows new sources
 * (including a landing page's own full-text PDF) within fixed limits. */
export async function runWebResearch(input: WebResearchInput, deps: WebResearchDeps): Promise<WebResearchOutcome> {
  const limits = { ...WEB_RESEARCH_LIMITS[input.depth] };
  if (input.evidenceBytes !== undefined) limits.evidenceBytes = Math.max(0, Math.min(limits.evidenceBytes, input.evidenceBytes));
  const started = deps.now();
  const deadline = AbortSignal.timeout(limits.deadlineMs);
  const signal = AbortSignal.any([input.signal, deadline]);
  const outcome: WebResearchOutcome = { searched: false, queries: [], found: 0, consulted: [], evidence: [], rounds: 0, limitations: [], reason: 'exhausted', durationMs: 0 };
  const runs: WebQueryRun[] = [];
  const visited = input.visited ?? new Set<string>();
  const readDomains = new Map<string, number>();
  const pages: PageRecord[] = [];
  const followUps: RankedWebResult[] = [];
  const ratings = new Map<string, number>();
  let ranked: RankedWebResult[] = [];
  const finishStep = (reason: WebResearchOutcome['reason']) => { outcome.reason = reason; outcome.durationMs = deps.now() - started; return outcome; };

  // 1. Plan.
  const finishPlan = input.activity.start('plan', input.question.slice(0, 200));
  let plan = await deps.planQueries({ question: input.question, today: new Date(deps.now()).toISOString().slice(0, 10), library: input.library,
    hint: input.hint ?? [], intent: input.intent, count: limits.firstQueries }, signal).catch(() => null);
  if (signal.aborted) { finishPlan('cancelled'); throw input.signal.reason ?? new Error('cancelled'); }
  if (!plan) { outcome.limitations.push('web_plan_unavailable'); plan = { search: true, queries: fallbackQueries(input.question, input.hint) }; }
  if (!plan.search && input.intent === 'fallback') { finishPlan('completed', 0, { reason: 'not_needed' }); return finishStep('not_needed'); }
  let queries = cleanQueries([...(input.hint ?? []).map(q => ({ q, scholarly: false })), ...plan.queries], [], limits.firstQueries);
  if (!queries.length) queries = cleanQueries(fallbackQueries(input.question), [], limits.firstQueries);
  finishPlan('completed', queries.length);
  outcome.searched = true;

  const readPages = (selected: RankedWebResult[], round: number) => pool(selected, limits.fetchConcurrency, async result => {
    visited.add(result.key);
    readDomains.set(result.domain, (readDomains.get(result.domain) ?? 0) + 1);
    const finish = input.activity.start('fetch', result.title || result.domain, { round, url: result.url, domain: result.domain });
    const record = (code: ResearchWebPageOutcome, title = result.title) => {
      outcome.consulted.push({ key: result.key, url: result.url, title: title || result.domain, domain: result.domain, outcome: code, passages: 0, round });
    };
    try {
      if (signal.aborted) throw new Error('cancelled');
      let fetched = await deps.fetchPage(result.url, signal);
      let page = await deps.extract(fetched, signal);
      if (page.challenge) {
        // Never around the check: only through the service's documented API.
        const alternative = await deps.fallback?.(result.url, signal).catch(() => null);
        if (!alternative) { record('blocked'); finish('failed', 0, { outcome: 'blocked' }); return; }
        fetched = alternative;
        page = await deps.extract(fetched, signal);
      }
      const chars = page.blocks.reduce((sum, block) => sum + block.text.length, 0);
      pages.push({ result, page, finalUrl: fetched.finalUrl, round });
      // A scholarly landing page with only its abstract declares its full text.
      if (page.pdfUrl && chars < 4000) {
        const key = canonicalWebUrl(page.pdfUrl);
        if (key && !visited.has(key) && !followUps.some(item => item.key === key)) followUps.push({ ...result, key, url: page.pdfUrl, title: page.title || result.title });
      }
      const code: ResearchWebPageOutcome = chars >= 200 ? 'read' : 'empty';
      record(code, page.title || result.title);
      finish('completed', page.blocks.length, { outcome: code });
    } catch (error) {
      const reason = (error as { reason?: WebFetchFailure }).reason;
      const code: ResearchWebPageOutcome = input.signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout'
        : reason && reason !== 'cancelled' ? reason : /timeout/.test(String((error as Error)?.message)) ? 'timeout' : 'failed';
      record(code);
      finish(input.signal.aborted ? 'cancelled' : 'failed', 0, { outcome: code });
    }
  });
  /** Sites that already answered with a bot check or a login wall (a deliberate
   * refusal) or failed twice in this step keep none of the remaining read budget:
   * every wasted slot is a source the answer never sees. */
  const refusedDomains = () => {
    const strikes = new Map<string, number>();
    for (const page of outcome.consulted) {
      if (page.outcome === 'blocked') strikes.set(page.domain, (strikes.get(page.domain) ?? 0) + 2);
      else if (page.outcome !== 'read' && page.outcome !== 'cancelled') strikes.set(page.domain, (strikes.get(page.domain) ?? 0) + 1);
    }
    return new Set([...strikes].filter(([, count]) => count >= 2).map(([domain]) => domain));
  };
  const readable = () => followUps.some(item => !visited.has(item.key) && !refusedDomains().has(item.domain))
    || selectPagesToRead(ranked, visited, readDomains, 1, 2, 0.12, 0.1, refusedDomains()).length > 0;

  for (let round = 1; round <= limits.rounds; round++) {
    outcome.rounds = round;
    // 2. Discover. Every query runs on the general engines; scholarly ones also on
    // the science engines, whose results merge with the rest by canonical URL.
    if (queries.length) {
      const tasks = queries.flatMap(query => [{ query, category: 'general' as const }, ...(query.scholarly ? [{ query, category: 'science' as const }] : [])]);
      await Promise.all(tasks.map(async task => {
        const finish = input.activity.start('query', task.query.q, { round });
        try {
          const response = await deps.search(task.query.q, task.category, signal);
          runs.push({ query: task.query.q, category: task.category, round, results: response.results });
          outcome.queries.push({ query: task.query.q, category: task.category, round, results: response.results.length });
          if (response.unresponsive.some(([, reason]) => /captcha|access denied|too many/i.test(reason)) && !outcome.limitations.includes('web_engine_blocked')) outcome.limitations.push('web_engine_blocked');
          finish('completed', response.results.length);
        } catch {
          outcome.queries.push({ query: task.query.q, category: task.category, round, results: 0, failed: true });
          finish(input.signal.aborted ? 'cancelled' : 'failed', 0);
        }
      }));
      if (input.signal.aborted) throw input.signal.reason ?? new Error('cancelled');
      // Stable order: the completion order of concurrent searches must not change ranking.
      runs.sort((a, b) => a.round - b.round || (a.query < b.query ? -1 : a.query > b.query ? 1 : a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
      ranked = rankWebResults(runs, input.question);
      outcome.found = ranked.length;
      const finishResults = input.activity.start('results', undefined, { round });
      finishResults(ranked.length ? 'completed' : 'failed', ranked.length, { round, found: ranked.slice(0, 8).map(item => ({ title: item.title.slice(0, 160), domain: item.domain, url: item.url })) });
      if (!ranked.length && outcome.queries.every(query => query.failed)) { outcome.limitations.push('web_search_unavailable'); return finishStep('unavailable'); }
    }

    // 3. Read. Declared full texts come first: they extend a page already judged relevant.
    const room = Math.min(limits.pagesPerRound, limits.maxPages - outcome.consulted.length);
    const follow = followUps.splice(0).filter(item => !visited.has(item.key) && !refusedDomains().has(item.domain));
    const pool = selectPagesToRead(ranked, visited, readDomains, Math.max(room, 15), 3, 0.12, 0.1, refusedDomains());
    let chosen = pool.slice(0, room);
    if (deps.pickResults && pool.length > 1 && room - follow.length > 0) {
      const picked = await deps.pickResults({ question: input.question, count: room - follow.length,
        candidates: pool.map((item, i) => ({ i, title: item.title.slice(0, 200), site: item.domain, snippet: item.snippet.slice(0, 300) })) }, signal).catch(() => null);
      if (picked) {
        const perDomain = new Map(readDomains);
        chosen = [...new Set(picked)].filter(i => i >= 0 && i < pool.length).map(i => pool[i]).filter(item => {
          const count = perDomain.get(item.domain) ?? 0;
          if (count >= 2) return false;
          perDomain.set(item.domain, count + 1);
          return true;
        });
      }
    }
    const selected = [...follow, ...chosen].slice(0, room);
    if (!selected.length && round === 1) outcome.limitations.push('web_no_relevant_results');
    if (!selected.length && !queries.length) break;
    // A page that refuses or fails leaves its slot empty; the next best candidate
    // from a site that has not refused yet takes it, so the step does not end short
    // of evidence because the budget went to pages with nothing behind them. Every
    // attempt spends a slot and only a failed one gives it back: the round never
    // reads more pages than it was allowed, which would only dilute the evidence.
    let slots = selected.length;
    let attempt = selected;
    for (let pass = 0; attempt.length && pass < 3 && !signal.aborted; pass++) {
      const before = outcome.consulted.length;
      await readPages(attempt, round);
      const outcomes = outcome.consulted.slice(before);
      slots -= outcomes.length - outcomes.filter(page => page.outcome !== 'read').length;
      if (slots <= 0 || signal.aborted) break;
      attempt = selectPagesToRead(ranked, visited, readDomains, Math.max(slots, 6), 3, 0.12, 0.1, refusedDomains()).slice(0, slots);
    }
    if (input.signal.aborted) throw input.signal.reason ?? new Error('cancelled');

    // 4. Passages.
    const finishSelect = input.activity.start('select', undefined, { round });
    outcome.evidence = await choosePassages(input, deps, pages, limits, signal, ratings);
    const byPage = new Map<string, number>();
    for (const item of outcome.evidence) byPage.set(item.pageKey, (byPage.get(item.pageKey) ?? 0) + 1);
    for (const page of outcome.consulted) page.passages = byPage.get(page.key) ?? 0;
    finishSelect('completed', outcome.evidence.length, { round, sources: byPage.size });

    // 5. Sufficiency, then reformulation.
    const domains = new Set(outcome.evidence.map(item => item.domain)).size;
    const strong = outcome.evidence.filter(item => ratings.size ? ratings.get(item.key) === 2 : item.relevance >= 0.5).length;
    if (strong >= limits.targetPassages && domains >= Math.min(limits.minDomains, 2)) return finishStep('sufficient');
    if (deadline.aborted) { outcome.limitations.push('web_deadline'); return finishStep('deadline'); }
    if (round >= limits.rounds || outcome.consulted.length >= limits.maxPages) break;
    const budget = Math.min(limits.followQueries, limits.maxQueries - new Set(outcome.queries.map(query => query.query)).size);
    queries = [];
    if (budget > 0) {
      const finishReformulate = input.activity.start('reformulate', undefined, { round: round + 1 });
      const covered = new Set(webTerms(outcome.evidence.map(item => item.text).join(' ')));
      const missing = [...new Set(webTerms(input.question))].filter(term => !covered.has(term)).slice(0, 12);
      const proposed = await deps.reformulate({ question: input.question, tried: [...new Set(outcome.queries.map(query => query.query))],
        found: ranked.slice(0, 12).map(item => ({ title: item.title.slice(0, 120), domain: item.domain })), missing, count: budget }, signal).catch(() => null);
      if (signal.aborted && !input.signal.aborted) { finishReformulate('failed', 0); outcome.limitations.push('web_deadline'); return finishStep('deadline'); }
      queries = cleanQueries(proposed ?? [], outcome.queries.map(query => query.query), budget);
      finishReformulate(proposed ? 'completed' : 'failed', queries.length);
    }
    // Unread good results remain worth a read-only round when nothing new is searched.
    if (!queries.length && !readable()) break;
  }
  if (!outcome.evidence.length) outcome.limitations.push('web_no_evidence');
  return finishStep(outcome.consulted.length >= limits.maxPages || outcome.queries.length >= limits.maxQueries ? 'limits' : 'exhausted');
}

/** Score every passage of every page read so far against the question and the
 * queries, lexically and (when a provider exists) semantically, and keep the
 * relevant, non-redundant ones within the byte budget. */
async function choosePassages(input: WebResearchInput, deps: WebResearchDeps, pages: PageRecord[], limits: WebResearchLimits, signal: AbortSignal, ratings: Map<string, number>): Promise<WebEvidence[]> {
  const retrievedAt = new Date(deps.now()).toISOString();
  const candidates: Array<WebEvidence & { lexical: number; coverage: number }> = [];
  for (const record of pages) {
    const pageKey = record.result.key;
    for (const passage of chunkWebText(record.page.blocks)) {
      const text = passage.heading && !passage.text.startsWith(passage.heading) ? passage.text : passage.text;
      candidates.push({ key: `${pageKey}#${passage.index}`, pageKey, url: record.result.url, finalUrl: record.finalUrl, title: record.page.title || record.result.title,
        siteName: record.page.siteName, domain: record.result.domain, byline: record.page.byline, publishedAt: record.page.publishedAt ?? record.result.publishedDate,
        doi: record.page.doi, kind: record.page.kind, pageNumber: passage.pageNumber, heading: passage.heading, text, relevance: 0, retrievedAt, lexical: 0, coverage: 0 });
    }
  }
  if (!candidates.length) return [];
  const questionTerms = webTerms(input.question);
  const queryTerms = [...questionTerms, ...questionTerms, ...[...new Set(pages.flatMap(page => page.result.queries))].flatMap(webTerms)];
  const lexical = bm25Scores(candidates.map(item => `${item.heading ?? ''} ${item.text}`), queryTerms);
  candidates.forEach((item, index) => { item.lexical = lexical[index]; item.coverage = termCoverage(`${item.heading ?? ''} ${item.title} ${item.text}`, input.question); });
  const lexicalOrder = [...candidates].sort((a, b) => b.lexical - a.lexical || (a.key < b.key ? -1 : 1));
  const orderings = [lexicalOrder.map(item => item.key)];
  const semantic = new Map<string, number>();
  if (deps.embed) {
    const pool = lexicalOrder.slice(0, 48);
    const vectors = await deps.embed([input.question, ...pool.map(item => item.text.slice(0, 1800))], signal).catch(() => null);
    if (vectors && vectors.length === pool.length + 1) {
      pool.forEach((item, index) => semantic.set(item.key, cosine(vectors[0], vectors[index + 1])));
      orderings.push([...pool].sort((a, b) => semantic.get(b.key)! - semantic.get(a.key)! || (a.key < b.key ? -1 : 1)).map(item => item.key));
    }
  }
  const fused = fuseRanks(orderings);
  const maxFused = Math.max(...fused.values());
  const maxLexical = Math.max(...candidates.map(item => item.lexical), 1e-9);
  for (const item of candidates) {
    const rank = (fused.get(item.key) ?? 0) / maxFused;
    const sem = semantic.get(item.key);
    // Rank fusion orders; coverage and absolute lexical strength decide whether a
    // passage is about the question at all (a best-of-bad passage stays low).
    item.relevance = (0.45 * rank + 0.3 * item.coverage + 0.25 * (sem !== undefined ? Math.max(0, (sem - 0.35) / 0.4) : item.lexical / maxLexical)) * (1 - boilerplateScore(item.text));
  }
  const floor = 0.3;
  let pool = candidates.filter(item => item.relevance > floor && (item.coverage > 0 || (semantic.get(item.key) ?? 0) > 0.55));
  if (deps.ratePassages && pool.length) {
    // The model reads the strongest candidates and says which actually answer the
    // question; ratings persist across rounds so a passage is judged once.
    const shortlist = [...pool].sort((a, b) => b.relevance - a.relevance || (a.key < b.key ? -1 : 1)).slice(0, 18);
    const unrated = shortlist.filter(item => !ratings.has(item.key));
    if (unrated.length) {
      const result = await deps.ratePassages({ question: input.question, passages: unrated.map((item, i) => ({ i, source: `${item.title} (${item.domain})`, text: item.text.slice(0, 1200) })) }, signal).catch(() => null);
      if (result) for (const { i, r } of result) if (unrated[i]) ratings.set(unrated[i].key, r);
    }
    if (shortlist.some(item => ratings.has(item.key))) {
      pool = shortlist.filter(item => (ratings.get(item.key) ?? 0) >= 1);
      for (const item of pool) item.relevance = (ratings.get(item.key) === 2 ? 0.7 : 0.4) + 0.3 * item.relevance;
      // The model's own reading decides: at most a third of the evidence may be
      // background that does not answer the question, however many such passages
      // the pages offered. An answer made of background reads as an answer about
      // the subject rather than to the question.
      const strong = pool.filter(item => ratings.get(item.key) === 2);
      const background = pool.filter(item => ratings.get(item.key) !== 2);
      pool = [...strong, ...background.slice(0, Math.max(1, Math.floor(limits.passages / 3)))];
    }
  }
  const chosen = selectWebPassages(pool, limits.passages, { perPage: 3, perDomain: 3, floor: 0 });
  const accepted: WebEvidence[] = [];
  let bytes = 0;
  for (const { lexical: _lexical, coverage: _coverage, ...item } of chosen) {
    const size = new TextEncoder().encode(item.text).byteLength;
    if (bytes + size > limits.evidenceBytes) continue;
    bytes += size;
    accepted.push(item);
  }
  return accepted;
}

export { webDomain };
