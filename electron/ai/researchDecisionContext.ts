import type { ResearchQuestionAssessment, ResearchTask } from '@shared/researchHarness';

export const RESEARCH_DECISION_POLICY = 'compact-evidence-v2';

export interface DecisionEvidence {
  id: string;
  documentId?: string;
  source?: string;
  text?: string;
  page?: string | null;
}

/** Only the supervisor's view is compacted. The evidence ledger and writer keep
 * their complete excerpts and original citation IDs. Aliases never grant evidence. */
export function researchDecisionContext(evidence: DecisionEvidence[], questions: ResearchQuestionAssessment[], tasks: ResearchTask[], compact = false) {
  const aliases = new Map(evidence.map((item, index) => [item.id, `e${index + 1}`]));
  const originals = new Map([...aliases].map(([id, alias]) => [alias, id]));
  const refs = (ids: string[]) => ids.flatMap(id => aliases.has(id) ? [aliases.get(id)!] : []);
  const words = [...new Set(questions.filter(q => q.status !== 'supported').flatMap(q => q.question.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))];
  const recentIds = new Set(tasks.filter(task => task.status === 'completed').slice(-1).flatMap(task => task.evidenceIds));
  const ranked = evidence.map((item, index) => ({ item, index, score: words.reduce((score, word) => score + Number(item.text?.toLocaleLowerCase().includes(word)), 0), recent: recentIds.has(item.id) }))
    .sort((a, b) => Number(b.recent) - Number(a.recent) || b.score - a.score || a.index - b.index);
  // Show distinct sources before more passages from one voice. New tool results
  // remain visible even when a long earlier excerpt matches more question words.
  const seen = new Set<string>();
  const diverse = ranked.filter(({ item }) => { const key = item.documentId ?? item.source ?? item.id; if (seen.has(key)) return false; seen.add(key); return true; });
  const chosen = [...diverse, ...ranked.filter(row => !diverse.includes(row))].slice(0, compact ? 4 : 10);
  const agenda = questions.map(q => ({ ...q, evidenceIds: refs(q.evidenceIds).slice(-2) }));
  const shown = new Set([...chosen.map(({ item }) => aliases.get(item.id)!), ...agenda.flatMap(q => q.evidenceIds)]);
  return {
    evidence: chosen.map(({ item }) => ({ ...item, id: aliases.get(item.id)!, text: item.text?.slice(0, compact ? 480 : 900) })),
    agenda,
    // Never hide a pending branch behind a long history. Old receipts stay in the
    // checkpoint; counts are retrieval progress, not a semantic support verdict.
    tasks: [...tasks.filter(task => task.status === 'pending' || task.status === 'running'), ...tasks.filter(task => task.status !== 'pending' && task.status !== 'running').slice(-6)]
      .map(task => ({ id: task.id, question: task.question, action: task.action, status: task.status, priority: task.priority,
        ...(task.purpose ? { purpose: task.purpose, relation: task.relation } : {}), newEvidence: task.evidenceIds.length, ...(task.note ? { note: task.note } : {}) })),
    restoreCoverage: (coverage: ResearchQuestionAssessment[], visible = shown) => coverage.map(q => ({ ...q, evidenceIds: q.evidenceIds.flatMap(alias => visible.has(alias) && originals.has(alias) ? [originals.get(alias)!] : []) })),
  };
}
