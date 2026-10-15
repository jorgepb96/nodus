import type { ModelRef, ResearchWebSearchMode, ResearchWebSearchStats, ResearchWebSource } from '@shared/types';
import type { ResearchWebIntent } from '@shared/researchActions';
import type { RetrievalSettings } from '@shared/researchCorpus';
import { webTerms } from '@shared/webResearchRanking';
import { completeJson, embedMany } from './aiClient';
import { startResearchActivity } from './researchActivity';
import { runWebResearch, type WebDepth, type WebEvidence, type WebResearchDeps, type WebResearchOutcome } from '../websearch/webResearch';
import { searchSearxng } from '../websearch/searxngService';
import { fetchScholarlyFallback, fetchWebPage } from '../websearch/webFetch';
import { extractScholarlyRecord } from '../websearch/webPageExtract';
import { WebExtractionHost } from '../websearch/webExtraction';
import { recordWebPassage } from '../db/researchWebRepo';
import { PICK_SYSTEM, PLAN_SYSTEM, RATE_SYSTEM, REFORMULATE_SYSTEM, validPick, validPlan, validQueries, validRatings } from '../websearch/webPlanning';

/** The user asked for the internet in so many words. Deliberately narrow: a
 * question that merely mentions a website is not a request to search. */
const EXPLICIT_WEB = new RegExp([
  String.raw`\b(busca|buscar|búscame|buscame|buscad|investiga|consulta|mira|revisa|comprueba|contrasta)\b[^.?!\n]{0,60}\b(en\s+)?(internet|la\s+web|la\s+red|google|online|en\s+l[ií]nea|fuentes\s+web)\b`,
  String.raw`\b(search|look\s+up|check|browse|find)\b[^.?!\n]{0,60}\b(the\s+)?(web|internet|online|google)\b`,
  String.raw`\b(b[uú]squeda\s+web|web\s+search|internet\s+search|recherche\s+web|websuche|ricerca\s+web|pesquisa\s+na\s+web)\b`,
  String.raw`\b(cherche|recherche)\b[^.?!\n]{0,60}\b(sur\s+)?(internet|le\s+web|en\s+ligne)\b`,
  String.raw`\b(suche|recherchiere)\b[^.?!\n]{0,60}\b(im\s+)?(internet|netz|web)\b`,
  String.raw`\b(pesquise|procure|busque)\b[^.?!\n]{0,60}\b(na\s+)?(internet|web)\b`,
  String.raw`\b(cerca)\b[^.?!\n]{0,60}\b(su\s+|in\s+)?(internet|web|rete)\b`,
  String.raw`(搜索|查一下|上网|網上|ウェブで|検索して|웹에서|검색해)`,
].join('|'), 'iu');
export function explicitWebRequest(question: string): boolean { return EXPLICIT_WEB.test(question); }

/** Questions about the present or the latest state of something. */
const RECENCY = /\b(20[2-3]\d|actual(es|mente)?|hoy|reciente(s|mente)?|[uú]ltim[oa]s?|novedades|noticias|latest|recent(ly)?|current(ly)?|today|this\s+year|news|nowadays|aujourd'hui|récent|aktuell|neueste|atual(mente)?|attuale)\b/iu;

export function webDepth(settings: RetrievalSettings): WebDepth {
  return settings.preset === 'fast' ? 'fast' : settings.preset === 'deep' ? 'deep' : 'balanced';
}

const OUTCOME_LIMITATIONS: Record<string, string> = {
  web_search_unavailable: 'web_unavailable', web_plan_unavailable: 'web_partial', web_deadline: 'web_partial', web_engine_blocked: 'web_partial', web_no_evidence: 'web_no_evidence',
};

/** Grants a Research Chat turn or Dictionary investigation the web step.
 * Callers without a grant are never offered a web action. */
export class ResearchWebGrant {
  readonly evidence = new Map<string, { id: string; item: WebEvidence }>();
  private readonly outcomes: Array<WebResearchOutcome & { trigger: 'supervisor' | 'explicit' | 'fallback' }> = [];
  private readonly visited = new Set<string>();
  private steps = 0;
  readonly explicit: boolean;
  constructor(readonly mode: ResearchWebSearchMode, readonly depth: WebDepth, readonly question: string, readonly signal: AbortSignal | undefined,
    readonly model: ModelRef | null | undefined, private readonly evidenceBytes: number, private readonly deps: Partial<WebResearchDeps> = {},
    /** The user's own words, when the search question is derived from them (a route's target and classes). */
    asked = question) {
    this.explicit = explicitWebRequest(asked);
  }
  get enabled(): boolean { return this.mode !== 'off'; }
  /** The supervisor may choose web at most once (fast/balanced) or twice (deep). */
  get available(): boolean { return this.enabled && this.steps < (this.depth === 'deep' ? 2 : 1) && this.bytesLeft() > 600; }
  get used(): number { return this.steps; }
  private bytesLeft(): number { return this.evidenceBytes - [...this.evidence.values()].reduce((sum, entry) => sum + Buffer.byteLength(entry.item.text), 0); }

  async search(queries: string[], intent: ResearchWebIntent | 'fallback', trigger: 'supervisor' | 'explicit' | 'fallback', library: string): Promise<WebResearchOutcome | null> {
    if (!this.enabled || (trigger !== 'fallback' && !this.available) || (trigger === 'fallback' && this.steps > 0)) return null;
    this.steps++;
    const controller = new AbortController();
    const signal = this.signal ? AbortSignal.any([this.signal, controller.signal]) : controller.signal;
    const extraction = new WebExtractionHost();
    const model = this.model;
    const deps: WebResearchDeps = {
      search: async (query, category, stepSignal) => {
        const response = await searchSearxng(query, { categories: category }, stepSignal);
        return { results: response.results, unresponsive: response.unresponsive };
      },
      fetchPage: (url, stepSignal) => fetchWebPage(url, stepSignal),
      extract: async (page, stepSignal) => page.record ? extractScholarlyRecord(page.record) : extraction.extract(page, stepSignal),
      fallback: (url, stepSignal) => fetchScholarlyFallback(url, stepSignal),
      planQueries: async (input, stepSignal) => completeJson({ system: PLAN_SYSTEM, user: JSON.stringify({ ...input, requested: input.count }), maxTokens: 400,
        temperature: 0, noRetry: true, signal: stepSignal, timeoutMs: 20_000 }, validPlan, model),
      reformulate: async (input, stepSignal) => (await completeJson({ system: REFORMULATE_SYSTEM, user: JSON.stringify({ ...input, requested: input.count }), maxTokens: 300,
        temperature: 0, noRetry: true, signal: stepSignal, timeoutMs: 20_000 }, validQueries, model)).queries,
      pickResults: async (input, stepSignal) => (await completeJson({ system: PICK_SYSTEM, user: JSON.stringify(input), maxTokens: 120,
        temperature: 0, noRetry: true, signal: stepSignal, timeoutMs: 20_000 }, validPick, model)).read,
      ratePassages: async (input, stepSignal) => (await completeJson({ system: RATE_SYSTEM, user: JSON.stringify(input), maxTokens: 60 + input.passages.length * 16,
        temperature: 0, noRetry: true, signal: stepSignal, timeoutMs: 25_000 }, validRatings, model)).ratings,
      embed: async (texts, stepSignal) => {
        const vectors = await embedMany(texts, stepSignal).catch(() => null);
        return vectors && vectors.every(vector => Array.isArray(vector)) ? vectors as number[][] : null;
      },
      now: () => Date.now(),
      ...this.deps,
    };
    // The closing row appears when the step ends, carrying why it ended.
    const finishStep: ReturnType<typeof startResearchActivity> = (...args) => startResearchActivity('web', 'finish')(...args);
    try {
      const outcome = await runWebResearch({ question: this.question, depth: this.depth, hint: queries, intent, library, evidenceBytes: this.bytesLeft(),
        visited: this.visited, signal, activity: { start: (operation, subject, detail) => startResearchActivity('web', operation, subject, detail) } }, deps);
      for (const item of outcome.evidence) {
        const id = recordWebPassage({ url: item.url, finalUrl: item.finalUrl, title: item.title, siteName: item.siteName, domain: item.domain, byline: item.byline,
          publishedAt: item.publishedAt, doi: item.doi, kind: item.kind, pageNumber: item.pageNumber, heading: item.heading, text: item.text, retrievedAt: item.retrievedAt });
        this.evidence.set(id, { id, item });
      }
      this.outcomes.push({ ...outcome, trigger });
      finishStep(outcome.reason === 'unavailable' ? 'failed' : 'completed', this.evidence.size, { reason: outcome.reason, sources: new Set([...this.evidence.values()].map(entry => entry.item.pageKey)).size });
      return outcome;
    } catch (error) {
      finishStep(this.signal?.aborted ? 'cancelled' : 'failed', 0, { reason: 'unavailable' });
      if (this.signal?.aborted) throw error;
      this.outcomes.push({ searched: false, queries: [], found: 0, consulted: [], evidence: [], rounds: 0, limitations: ['web_search_unavailable'], reason: 'unavailable', durationMs: 0, trigger });
      return null;
    } finally {
      controller.abort();
      await extraction.close();
    }
  }

  /** After the library pass: honour an explicit request the supervisor did not act
   * on, and consult the web when the library had (almost) nothing to offer or the
   * question is about the present. The planner may still decide it is not needed. */
  async afterLibrary(library: { evidence: number; matched: number; titles: string[]; supervised: boolean }): Promise<void> {
    if (!this.enabled || this.steps > 0) return;
    const summary = library.titles.slice(0, 8).join(' | ');
    if (this.explicit) { await this.search([], 'explicit', 'explicit', summary); return; }
    if (webTerms(this.question).length < 2) return;
    const thin = library.evidence <= 1 || library.matched === 0;
    const recent = RECENCY.test(this.question);
    // A supervisor that saw the evidence and declined the web keeps its decision
    // unless the library was essentially empty.
    if (thin || (recent && !library.supervised)) await this.search([], recent && !thin ? 'update' : 'fallback', 'fallback', summary);
  }

  /** Context entries the answer model receives; each cites its own receipt. */
  contextPassages() {
    return [...this.evidence.values()].map(({ id, item }) => ({
      id, citation: `nodus://passage/${encodeURIComponent(id)}`, provenance: 'web', title: item.title, site: item.siteName ?? item.domain, url: item.url,
      published: item.publishedAt, retrieved_at: item.retrievedAt, ...(item.pageNumber ? { page: item.pageNumber } : {}), ...(item.heading ? { section: item.heading } : {}), text: item.text,
    }));
  }

  stats(): ResearchWebSearchStats {
    const outcomes = this.outcomes;
    const consulted = new Map<string, ResearchWebSearchStats['consulted'][number]>();
    for (const outcome of outcomes) for (const page of outcome.consulted) consulted.set(page.key, { url: page.url, title: page.title, domain: page.domain, outcome: page.outcome, passages: page.passages });
    const limitations = [...new Set(outcomes.flatMap(outcome => outcome.limitations.map(code => OUTCOME_LIMITATIONS[code] ?? code)))];
    return { mode: this.mode, searched: outcomes.some(outcome => outcome.searched), ...(outcomes[0] ? { trigger: outcomes[0].trigger } : {}),
      queries: outcomes.flatMap(outcome => outcome.queries), rounds: outcomes.reduce((sum, outcome) => sum + outcome.rounds, 0),
      found: outcomes.reduce((sum, outcome) => sum + outcome.found, 0), consulted: [...consulted.values()], limitations,
      durationMs: outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0) };
  }

  sources(): ResearchWebSource[] {
    const pages = new Map<string, ResearchWebSource>();
    for (const { id, item } of this.evidence.values()) {
      const current = pages.get(item.pageKey) ?? { url: item.url, title: item.title, siteName: item.siteName, domain: item.domain, retrievedAt: item.retrievedAt, publishedAt: item.publishedAt, passageIds: [] };
      current.passageIds.push(id);
      pages.set(item.pageKey, current);
    }
    return [...pages.values()];
  }
}
