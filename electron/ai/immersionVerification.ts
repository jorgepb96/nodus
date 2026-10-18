import type { ImmersionPlan, ImmersionQuizQuestion, ModelRef } from '@shared/types';
import type { ResearchDocumentPart } from '@shared/researchDocumentReview';
import { researchExcerptHasProse } from '@shared/researchDocumentReview';
import { researchAnswerReviewLimitation } from '@shared/researchAnswerReview';
import { reviewResearchDocument } from './researchDocumentReview';

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
  const review = await reviewResearchDocument(parts, model, signal);
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
  const ideas = new Set(plan.stations.flatMap(station => station.ideaIds));
  plan.ideaIndex = plan.ideaIndex.filter(idea => ideas.has(idea.id));
  plan.stats = { ...plan.stats, stations: plan.stations.length, ideas: ideas.size, citations: plan.stations.reduce((n, station) => n + station.citations.length, 0),
    quizQuestions: plan.exam.questions.length + plan.stations.reduce((n, station) => n + station.quiz.length, 0) };
  if (review.status !== 'verified') plan.stoppedReason = [plan.stoppedReason, researchAnswerReviewLimitation(plan.language)].filter(Boolean).join(' · ');
  if (!plan.stations.length) throw new Error('immersion_verification_incomplete');
  return plan;
}
