// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The podcast's research step: the same engines the rest of Nodus trusts, reduced to one
 * dossier (`PodcastEvidence`) the script writer can cite by short ids.
 *
 * - Academic vaults run Research Chat's agent: a planned turn, the opening searches, the
 *   catalogue floor, the supervisor's reads and, when the user allowed it, the web.
 * - Study and teaching vaults run the learning-corpus retrieval of Study Deep Research and
 *   add the idea network's disagreements as tensions.
 */
import type { ModelRef } from '@shared/types';
import type { PodcastEvidence, PodcastRequest, PodcastSource, PodcastTension } from '@shared/podcast';
import { RESEARCH_CHAT_AGENT_DECISION_BYTES, RESEARCH_CHAT_AGENT_SETTINGS, RESEARCH_CHAT_LIGHT_AGENT_SETTINGS, validateRetrievalSettings } from '@shared/researchCorpus';
import { ResearchCorpusRun, resolveAcademicRunScope } from '../ai/researchCorpusRun';
import { ResearchWebGrant, webDepth } from '../ai/researchWebStep';
import { planResearchTurn } from '../ai/researchTurnPlanner';
import { retrieveStudyAssistantEntries } from '../ai/studySearch';
import { buildStudyResearchSources } from '../ai/studyDeepResearch';
import { listStudyIdeasForSources } from '../db/studyKnowledgeRepo';
import { clip, dossierFromSnapshot } from './podcastDossier';

export async function gatherAcademicEvidence(request: PodcastRequest, model: ModelRef | null, signal: AbortSignal, report: (message: string) => void): Promise<PodcastEvidence> {
  const light = request.thinkingEffort === 'off' || request.thinkingEffort === 'none' || request.thinkingEffort === 'minimal';
  const settings = validateRetrievalSettings({ ...(light ? RESEARCH_CHAT_LIGHT_AGENT_SETTINGS : RESEARCH_CHAT_AGENT_SETTINGS) });
  const run = new ResearchCorpusRun(resolveAcademicRunScope(request.notebookId), settings, signal, true);
  if (!run.harness) run.budget.decisionTokenLimit = RESEARCH_CHAT_AGENT_DECISION_BYTES;
  run.web = new ResearchWebGrant(request.webSearch ?? 'off', webDepth(settings), request.objective, signal, model, Math.floor(run.budget.evidenceTokenLimit / 3));
  report('plan');
  const plan = await planResearchTurn([{ role: 'user', content: request.objective }], model, signal);
  // A podcast always needs sources: the planner may judge a short topic answerable as is.
  run.agent = { plan: { ...plan, needsSources: true }, question: request.objective, compact: false, minSources: 3 };
  report('library');
  await run.investigate(plan.goal || request.objective, model);
  // Longer episodes have more ground to cover: one extra search per planned facet left unread.
  if (request.durationCapMin >= 15) {
    for (const query of plan.queries.slice(0, request.durationCapMin >= 30 ? 3 : 2)) {
      signal.throwIfAborted();
      try { await run.retrieve(query, 1); } catch { run.budget.partial = true; }
    }
  }
  if (run.web.enabled) {
    report('web');
    await run.web.afterLibrary({ evidence: run.evidence.size, matched: run.matchedDocuments.size, supervised: run.supervised,
      titles: run.scope.documents.filter((document) => run.matchedDocuments.has(document.id)).map((document) => document.title) });
    run.syncWebEvidence();
  }
  const snapshot = run.snapshotFromEvidence({ kind: 'research_question', objective: request.objective, language: request.language });
  return dossierFromSnapshot(snapshot, run.web.contextPassages(), run.researchLog().join('\n'));
}

export async function gatherStudyEvidence(request: PodcastRequest, signal: AbortSignal, report: (message: string) => void): Promise<PodcastEvidence> {
  report('library');
  const limit = request.durationCapMin >= 20 ? 72 : 48;
  const entries = await retrieveStudyAssistantEntries(request.objective, { kinds: ['material', 'document', 'transcript'] }, [], limit);
  signal.throwIfAborted();
  const built = buildStudyResearchSources(entries, request.language, request.durationCapMin >= 15 ? 24 : 18);
  const sources: PodcastSource[] = built.map((source) => ({
    id: source.id,
    kind: source.kind === 'transcript' ? 'material' : source.kind === 'document' ? 'note' : 'material',
    title: source.title,
    ...(source.location ? { location: source.location } : {}),
    excerpt: clip(source.text, 2_400),
    link: source.url,
  }));
  const knowledge = listStudyIdeasForSources(built.map((source) => `${source.kind}:${source.sourceId}`));
  const labels = new Map(knowledge.ideas.map((idea) => [idea.id, idea]));
  const tensions: PodcastTension[] = knowledge.connections
    .filter((edge) => edge.type === 'contrasts')
    .slice(0, 6)
    .flatMap((edge) => {
      const from = labels.get(edge.fromId);
      const to = labels.get(edge.toId);
      return from && to ? [{ id: `${edge.fromId}:${edge.toId}`, summary: clip(`${from.label}: ${from.statement} / ${to.label}: ${to.statement}`, 600), sourceIds: [] }] : [];
    });
  const log = built.length
    ? `Searched the learning materials, documents and transcripts for «${request.objective.slice(0, 160)}»: ${built.map((source) => `«${source.title}»`).join('; ')}.`
    : 'No learning material matched.';
  return { sources, tensions, gaps: [], log };
}
