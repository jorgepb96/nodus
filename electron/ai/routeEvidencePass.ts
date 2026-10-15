import type { ModelRef } from '@shared/types';
import { buildPrecedentQueries, countRouteSteps } from '@shared/moleculeInspection';
import { formatEvidenceBrief, ordByStep, stepReaction, type StepEvidence } from '@shared/routeEvidence';
import { relevantExcerpt, textbookQueryForClass } from '@shared/synthesisEvidence';
import { lookupReactionPrecedent, resolveNamedRoute, chemistryRunner } from './moleculeInspection';
import { synthesisEvidenceWorkIds, textbookPassages } from './synthesisEvidence';
import { searchSearxng } from '../websearch/searxngService';
import type { ChemistryEvidenceScope } from './chemistryEvidenceScope';

interface RouteEvidenceOptions {
  model?: ModelRef | null;
  target?: string | null;
  question?: string;
  signal?: AbortSignal;
  locale?: string;
  evidenceScope?: ChemistryEvidenceScope;
  /** The conversation's capability scope (see moleculeInspection's InspectOptions). */
  scope?: string;
}

/** Per-step evidence pass (route quality, option A): after the first draft of a new route,
 *  look up each step in the Open Reaction Database index, the textbooks and the web, and give
 *  the model one chance to revise the draft with that evidence before the route checks run.
 *  Off unless NODUS_ROUTE_EVIDENCE_PASS=1, so the harness can measure it against the baseline. */
export function routeEvidencePassEnabled(): boolean {
  return process.env.NODUS_ROUTE_EVIDENCE_PASS === '1';
}

const MAX_STEPS = 12;
const WEB_RESULTS = 3;
const WEB_STEPS = 6;
const EXCERPT_CHARS = 320;
const SNIPPET_CHARS = 200;

export { revisionUserMessage } from '@shared/routeEvidence';

async function webFor(reaction: string, signal?: AbortSignal): Promise<StepEvidence['web']> {
  try {
    const response = await searchSearxng(`${reaction.replace(/→/g, 'to')} synthesis`, {}, signal);
    return response.results.slice(0, WEB_RESULTS).map((result) => ({
      title: result.title, url: result.url, snippet: (result.content ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS),
    }));
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[route-evidence] web search unavailable:', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export async function gatherRouteEvidence(draft: string, options: RouteEvidenceOptions): Promise<StepEvidence[]> {
  options.signal?.throwIfAborted();
  const started = Date.now();
  const { runner, dispose } = chemistryRunner(options);
  try {
    const resolved = await resolveNamedRoute(draft, draft, { ...options, runner });
    if (resolved.legacy || !resolved.labels.length) return [];
    const labels = resolved.labels.slice(0, MAX_STEPS);
    const evidence: StepEvidence[] = labels.map((entries, step) => ({ step, reaction: stepReaction(entries) }));

    const queries = buildPrecedentQueries(labels);
    const found = await lookupReactionPrecedent(runner, queries.map((query) => query.query), options);
    if (found) for (const [step, ord] of ordByStep(found.precedent, queries.map((query) => query.step))) evidence[step].ord = ord;

    const byClass = new Map<string, number[]>();
    for (const item of evidence) {
      const name = item.ord?.classes.find((entry) => textbookQueryForClass(entry));
      if (name) byClass.set(name, [...(byClass.get(name) ?? []), item.step]);
    }
    const textbook = (async () => {
      if (!byClass.size) return;
      const classNames = [...byClass.keys()];
      const passages = await textbookPassages(classNames.map((name) => textbookQueryForClass(name)!), synthesisEvidenceWorkIds(options.evidenceScope), options.signal, 1);
      for (const passage of passages) {
        const name = classNames.find((entry) => textbookQueryForClass(entry) === passage.retrievedFor);
        if (!name) continue;
        const excerpt = relevantExcerpt(name, passage.text, EXCERPT_CHARS);
        for (const step of byClass.get(name) ?? []) evidence[step].textbook = { title: passage.work.title, location: passage.location ?? '', about: name, excerpt };
      }
    })().catch((error) => {
      if (options.signal?.aborted) throw error;
      console.warn('[route-evidence] textbook lookup failed:', error instanceof Error ? error.message : String(error));
    });
    // The web is asked about the steps with the least support first.
    const webSteps = [...evidence].sort((a, b) => (a.ord?.recorded ?? 0) - (b.ord?.recorded ?? 0)).slice(0, WEB_STEPS);
    const web = options.evidenceScope?.web === false ? Promise.resolve([]) : Promise.all(webSteps.map(async (item) => { item.web = await webFor(item.reaction, options.signal); }));
    await Promise.all([textbook, web]);
    options.signal?.throwIfAborted();
    console.log(`[route-evidence] ${evidence.length} steps: ord ${evidence.filter((item) => item.ord).length}, textbook ${evidence.filter((item) => item.textbook).length}, web ${evidence.filter((item) => item.web?.length).length} (${Date.now() - started} ms)`);
    return evidence;
  } finally {
    await dispose();
  }
}

/** Runs the pass: gathers the evidence and asks the model to revise. Returns the draft when
 *  nothing was found or the revision is not a route (so the pass can never lose an answer). */
export async function reviseRouteWithEvidence(
  draft: string,
  options: RouteEvidenceOptions,
  complete: (user: string) => Promise<string>,
): Promise<string> {
  try {
    const evidence = await gatherRouteEvidence(draft, options);
    const brief = formatEvidenceBrief(evidence);
    if (!brief) return draft;
    const revised = (await complete(brief)).trim();
    if (!revised || countRouteSteps(revised) === 0) {
      console.warn('[route-evidence] revision had no route; keeping the draft');
      return draft;
    }
    console.log(`[route-evidence] revised: ${countRouteSteps(draft)} → ${countRouteSteps(revised)} steps, ${revised === draft.trim() ? 'unchanged' : 'changed'}`);
    return revised;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[route-evidence] pass failed; keeping the draft:', error instanceof Error ? error.message : String(error));
    return draft;
  }
}
