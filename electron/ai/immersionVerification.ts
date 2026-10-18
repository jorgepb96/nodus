import type { ImmersionPlan, ImmersionQuizQuestion, ModelRef } from '@shared/types';
import type { ResearchDocumentPart, ResearchDocumentReview } from '@shared/researchDocumentReview';
import { researchExcerptHasProse } from '@shared/researchDocumentReview';
import { researchAnswerReviewLimitation } from '@shared/researchAnswerReview';
import { reviewResearchDocument } from './researchDocumentReview';
import { currentResearchHarness } from './researchHarnessRuntime';
import { extractCitationRefs } from './citationSanitize';

/** The lesson schema belongs to Immersion; proof/repair belongs to the harness.
 * Stable field IDs prevent a revision from moving an answer into another quiz. */
export async function verifyImmersionPlan(plan: ImmersionPlan, model: ModelRef | null, signal?: AbortSignal): Promise<ImmersionPlan> {
  const parts: ResearchDocumentPart[] = [];
  const apply = new Map<string, (text: string) => void>();
  const add = (id: string, text: string, remit: string, set: (text: string) => void, evidenceIds?: string[], context?: string, strictEvidence = false) => {
    if (!text.trim()) return;
    parts.push({ id, text, remit, evidenceIds, context, strictEvidence }); apply.set(id, set);
  };
  add('overview', plan.overview, `Orientation to ${plan.topic}; explain only the supported outline of this lesson, with coherent paragraphs.`, text => { plan.overview = text; });
  plan.keyTerms.forEach((term, index) => add(`term:${index}`, term.definition, `Define ${term.term} as used in this lesson.`, text => { term.definition = text; }));
  const quizParts = new Map<ImmersionQuizQuestion, string>();
  const quiz = (questions: ImmersionQuizQuestion[], prefix: string, evidence: string[]) => questions.forEach((question, index) => {
    const key = `${prefix}:quiz:${index}`, field = question.kind === 'choice' ? 'explanation' : 'expected';
    const text = question[field] || (question.correctIndex === null ? '' : question.options[question.correctIndex]) || '';
    quizParts.set(question, key);
    add(key, text, 'Explain the supported correct answer to this question, without changing its choices or inventing factual presuppositions.', value => { question[field] = value; }, evidence,
      JSON.stringify({ question: question.question, options: question.options, correctIndex: question.correctIndex }));
  });
  for (const [index, station] of plan.stations.entries()) {
    const prefix = `station:${index}`, ids = [...station.citations.map(citation => citation.passageId), ...station.ideaIds.map(id => `idea:${id}`)];
    const context = JSON.stringify({ title: station.title, question: station.question });
    add(`${prefix}:context`, station.context, 'Frame this station question. Stand alone coherently; do not claim the whole investigation was answered.', text => { station.context = text; }, ids, context);
    add(`${prefix}:synthesis`, station.synthesis, `Write a connected lesson answering this station question: ${station.question}. Acknowledge a specific consulted-excerpt limit if needed.`, text => { station.synthesis = text; }, ids, context);
    station.takeaways.forEach((text, i) => add(`${prefix}:takeaway:${i}`, text, 'One concise supported takeaway of this station.', value => { station.takeaways[i] = value; }, ids, context));
    station.positions.forEach((position, i) => add(`${prefix}:position:${i}`, position.position, `Attribute only what the supplied evidence or attributed notes establish about ${position.name}.`, text => { position.position = text; }, ids, context));
    station.citations = station.citations.filter(citation => researchExcerptHasProse(citation.text));
    station.citations.forEach((citation, i) => {
      const remit = `Explain this exact literal passage, its meaning and its relevance to the station. Other passages cannot supply what this passage does not say.`;
      add(`${prefix}:citation:${i}:commentary`, citation.commentary, remit, text => { citation.commentary = text; }, [citation.passageId], context, true);
      add(`${prefix}:citation:${i}:why`, citation.whyItMatters, remit, text => { citation.whyItMatters = text; }, [citation.passageId], context, true);
    });
    quiz(station.quiz, prefix, ids);
  }
  plan.contrasts.rows.forEach((row, i) => row.cells.forEach((cell, j) => add(`contrast:${i}:${j}`, cell.stance, `State only ${cell.author}'s evidenced position on this station question, preserving attribution.`, text => { cell.stance = text; })));
  quiz(plan.exam.questions, 'exam', []);
  add('exercise', plan.exam.feynman, 'An instructional synthesis exercise. Verify any factual presuppositions; keep it an instruction, not an asserted historical conclusion.', text => { plan.exam.feynman = text; });
  // Prove the lesson's substantive core before spending on optional teaching
  // details. Both passes share the same harness, evidence and consumed allowance.
  const coreParts = parts.filter(part => /^station:\d+:synthesis$/u.test(part.id));
  const core = await reviewResearchDocument(coreParts, model, signal);
  core.parts = core.parts.map(part => part.status === 'verified' && !part.claims.some(claim => claim.status === 'supported' && claim.kind !== 'nonfactual' && claim.evidence.length)
    ? { ...part, status: 'limited', text: '', issues: ['non_substantive_synthesis'] } : part);
  if (core.parts.some(part => part.status !== 'verified')) core.status = 'limited';
  const retained = new Set(core.parts.filter(part => part.status === 'verified').map(part => Number(part.id.split(':')[1])));
  const retainedIds = new Set(plan.stations.filter((_, index) => retained.has(index)).map(station => station.id));
  const outline = plan.stations.filter((_, index) => retained.has(index)).map(station => ({ title: station.title, question: station.question }));
  const detailParts = parts.filter(part => {
    if (coreParts.includes(part)) return false;
    const station = /^station:(\d+):/u.exec(part.id);
    if (station) return retained.has(Number(station[1]));
    const contrast = /^contrast:(\d+):/u.exec(part.id);
    return !contrast || retainedIds.has(plan.contrasts.rows[Number(contrast[1])]?.stationId);
  }).map(part => part.id === 'overview' || part.id.startsWith('exam:') || part.id === 'exercise'
    ? { ...part, context: JSON.stringify({ fieldContext: part.context, retainedOutline: outline }),
      remit: part.remit + ' This lesson retains only retainedOutline. Do not promise omitted stations or test material outside that outline. The outline is coverage context, never documentary evidence.' } : part);
  const details: ResearchDocumentReview = !core.technicalFailure && retained.size
    ? await reviewResearchDocument(detailParts, model, signal)
    : { parts: [] as typeof core.parts, status: 'limited' as const };
  const byId = new Map([...core.parts, ...details.parts].map(part => [part.id, part]));
  const review: ResearchDocumentReview = { parts: parts.map(part => byId.get(part.id) ?? { id: part.id, text: '', status: 'limited', claims: [], issues: [core.technicalFailure ?? 'unverified_field'] }),
    status: core.status === 'verified' && details.status === 'verified' ? 'verified' : 'limited',
    ...((core.technicalFailure ?? details.technicalFailure) ? { technicalFailure: core.technicalFailure ?? details.technicalFailure } : {}) };
  const harness = currentResearchHarness();
  if (harness) { harness.record.checkpoint.documentReview = { policy: 'immersion-core-first-v1', ...review }; harness.record.checkpoint.validationLimited = review.status !== 'verified'; harness.persist(); }

  const verified = new Set(review.parts.filter(part => part.status === 'verified').map(part => part.id));
  for (const part of review.parts) apply.get(part.id)?.(part.status === 'verified' ? part.text : '');
  const keepQuiz = (questions: ImmersionQuizQuestion[]) => questions.filter(question => verified.has(quizParts.get(question) ?? ''));
  plan.stations = plan.stations.filter((station, index) => {
    station.takeaways = station.takeaways.filter(Boolean);
    station.positions = station.positions.filter(position => position.position.trim());
    station.quiz = keepQuiz(station.quiz);
    return verified.has(`station:${index}:synthesis`);
  });
  plan.keyTerms = plan.keyTerms.filter(term => term.definition.trim());
  plan.exam.questions = keepQuiz(plan.exam.questions);
  const stations = new Set(plan.stations.map(station => station.id));
  plan.contrasts.rows = plan.contrasts.rows.filter(row => stations.has(row.stationId));
  const columns = plan.contrasts.authors.map((_, index) => index).filter(index => plan.contrasts.rows.some(row => row.cells[index]?.stance.trim()));
  plan.contrasts.authors = columns.map(index => plan.contrasts.authors[index]);
  plan.contrasts.rows.forEach(row => { row.cells = columns.map(index => row.cells[index]); });
  const ideas = new Set(plan.stations.flatMap(station => station.ideaIds));
  plan.ideaIndex = plan.ideaIndex.filter(idea => ideas.has(idea.id));
  const works = new Set(plan.ideaIndex.flatMap(idea => idea.workTitles ?? []));
  const authors = new Set(plan.ideaIndex.flatMap(idea => idea.authors ?? []));
  const corpus = currentResearchHarness()?.corpus;
  const references = review.parts.filter(part => part.status === 'verified').flatMap(part => extractCitationRefs(part.text))
    .concat(plan.stations.flatMap(station => station.citations.map(citation => ({ kind: 'passage' as const, id: citation.passageId }))));
  for (const ref of references) {
    const workId = ref.kind === 'work' ? ref.id : ref.kind === 'passage' ? corpus?.evidence.get(ref.id)?.nodus_id : undefined;
    const document = corpus?.scope.documents.find(document => document.workId === workId);
    if (document) { works.add(document.title); document.authors.forEach(author => authors.add(author)); }
  }
  plan.stats = { ...plan.stats, works: works.size, authors: authors.size, stations: plan.stations.length, ideas: ideas.size, citations: plan.stations.reduce((n, station) => n + station.citations.length, 0),
    quizQuestions: plan.exam.questions.length + plan.stations.reduce((n, station) => n + station.quiz.length, 0) };
  if (review.status !== 'verified') plan.stoppedReason = [plan.stoppedReason, researchAnswerReviewLimitation(plan.language)].filter(Boolean).join(' · ');
  if (!plan.stations.length) throw new Error('immersion_verification_incomplete');
  return plan;
}
