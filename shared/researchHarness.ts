import type { ModelRef, ResearchContextSelection } from './types';
import type { ResearchAction } from './researchActions';

export type ResearchHarnessVersion = 'legacy' | 'v1';
export type ResearchRunMode = 'chat' | 'deep-research' | 'immersion' | 'dictionary';
export type ResearchStopReason = 'sufficient' | 'diminishing_returns' | 'sources_exhausted' | 'budget' | 'technical' | 'interrupted' | 'context_changed';
export type ResearchRunStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type ResearchQuestionStatus = 'pending' | 'supported' | 'partial' | 'contradictory' | 'unresolved';
export interface ResearchQuestionIntent {
  /** Why this provisional line could help answer the original objective. Not evidence. */
  purpose: string;
  relation: 'facet' | 'context' | 'contrast' | 'mechanism';
}
export interface ResearchQuestionAssessment extends Partial<ResearchQuestionIntent> {
  question: string;
  status: ResearchQuestionStatus;
  evidenceIds: string[];
}
export interface ResearchRunContext {
  mode: ResearchRunMode;
  entryId?: string;
  vaultId: string;
  scopeId: string;
  notebookId: string | null;
  objective: string;
  model: ModelRef | null;
  effort: string;
  explorationMode?: import('./researchExploration').ResearchExplorationMode;
  policyKey?: string;
  options?: { selection: ResearchContextSelection; skillIds: string[] };
  capabilities: {
    ideas: boolean; indexed: boolean; documents: boolean; web: boolean;
    attachments: string[]; skills: string[]; restricted: boolean;
  };
}
export type ResearchTaskAction = Exclude<ResearchAction, { action: 'finish' | 'enqueue' | 'defer' }>;
export interface ResearchTask extends Partial<ResearchQuestionIntent> {
  id: string;
  question: string;
  action: ResearchTaskAction;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'deferred';
  evidenceIds: string[];
  note?: string;
}
export interface ResearchRunSummary {
  id: string;
  conversationId?: string;
  entryId?: string;
  version: 'v1';
  mode: ResearchRunMode;
  objective: string;
  explorationMode?: import('./researchExploration').ResearchExplorationMode;
  status: ResearchRunStatus;
  stopReason?: ResearchStopReason;
  questions: ResearchQuestionAssessment[];
  tasks: ResearchTask[];
  usage: { rounds: number; evidenceBytes: number; decisionBytes: number; modelCalls?: number };
  updatedAt: string;
}

const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
/** Stable ordering makes request and action identities independent of object key order. */
export function researchCanonical(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : input;
  return JSON.stringify(normalize(value));
}
export function researchTaskKey(action: ResearchTaskAction): string {
  return researchCanonical(action.action === 'search' ? { action: 'search', query: fold(action.query) } : action);
}

/** Pure agenda. Source counts and model confidence never establish documentary support. */
export class ResearchAgenda {
  tasks: ResearchTask[] = [];
  questions: ResearchQuestionAssessment[] = [];
  stagnant = 0;
  strategyChanges = 0;
  private sequence = 0;
  constructor(readonly objective: string) {}
  addQuestion(question: string, intent?: ResearchQuestionIntent): void {
    const text = question.trim().slice(0, 1000);
    const prior = this.questions.find(q => fold(q.question) === fold(text));
    if (prior && intent) Object.assign(prior, intent);
    if (text && this.questions.length < 32 && !prior) this.questions.push({ question: text, status: 'pending', evidenceIds: [], ...intent });
  }
  enqueue(action: ResearchTaskAction, question = this.objective, priority = 1, intent?: ResearchQuestionIntent): ResearchTask | undefined {
    const key = researchTaskKey(action);
    const prior = this.tasks.find(task => researchTaskKey(task.action) === key);
    if (prior) {
      if (prior.status === 'pending') {
        prior.priority = Math.max(prior.priority, priority);
        if (intent) { Object.assign(prior, intent); this.addQuestion(prior.question, intent); }
      }
      return prior;
    }
    if (this.tasks.length >= 64) return undefined;
    this.addQuestion(question, intent);
    const task: ResearchTask = { id: `task-${++this.sequence}`, action, question: question.slice(0, 1000), priority: Math.max(0, Math.min(3, priority)), status: 'pending', evidenceIds: [], ...intent };
    this.tasks.push(task);
    return task;
  }
  next(): ResearchTask | undefined { return this.tasks.filter(task => task.status === 'pending').sort((a, b) => b.priority - a.priority)[0]; }
  /** Refine a queued probe without losing its question, purpose or completion. */
  refineSearch(taskId: string, query: string): ResearchTask | undefined {
    const task = this.tasks.find(t => t.id === taskId && t.status === 'pending' && t.action.action === 'search');
    const action: ResearchTaskAction = { action: 'search', query };
    if (!task || this.tasks.some(other => other !== task && researchTaskKey(other.action) === researchTaskKey(action))) return undefined;
    task.action = action;
    return task;
  }
  complete(task: ResearchTask, evidenceIds: string[], failed = false): void {
    task.status = failed ? 'failed' : 'completed'; task.evidenceIds = [...new Set(evidenceIds)];
    const question = this.questions.find(question => fold(question.question) === fold(task.question));
    if (question && ['pending', 'partial'].includes(question.status) && evidenceIds.length) {
      question.status = 'partial'; question.evidenceIds = [...new Set([...question.evidenceIds, ...evidenceIds])];
    }
    this.stagnant = evidenceIds.length ? 0 : this.stagnant + 1;
    if (evidenceIds.length) this.strategyChanges = 0;
  }
  /** Closing a completed investigation is not evidence that every branch was answered. */
  finalize(reason?: ResearchStopReason): void {
    for (const task of this.tasks) if (task.status === 'pending' || task.status === 'running') {
      task.status = 'deferred'; task.note = `investigation_finished:${reason ?? 'sources_exhausted'}`;
    }
    for (const question of this.questions) if (question.status === 'pending') question.status = 'unresolved';
  }
  assess(questions: ResearchQuestionAssessment[], authorizedEvidence: Set<string>): void {
    for (const input of questions) {
      const question = this.questions.find(q => fold(q.question) === fold(input.question));
      if (!question) continue;
      const evidenceIds = [...new Set(input.evidenceIds.filter(id => authorizedEvidence.has(id)))];
      question.evidenceIds = evidenceIds;
      question.status = ['supported', 'contradictory'].includes(input.status) && !evidenceIds.length ? 'partial' : input.status;
    }
  }
  canFinish(): boolean {
    const required = this.questions.filter(question => {
      if (!question.purpose) return true;
      const tasks = this.tasks.filter(task => fold(task.question) === fold(question.question));
      return !tasks.length || tasks.some(task => task.status !== 'deferred');
    });
    return required.length > 0 && required.every(question => question.status === 'supported');
  }
  restore(snapshot: { tasks: ResearchTask[]; questions: ResearchQuestionAssessment[]; stagnant: number; strategyChanges: number }): void {
    this.tasks = structuredClone(snapshot.tasks); this.questions = structuredClone(snapshot.questions);
    for (const task of this.tasks) if (task.status === 'running') task.status = 'pending';
    this.sequence = Math.max(0, ...this.tasks.map(task => Number(task.id.split('-')[1]) || 0));
    this.stagnant = snapshot.stagnant; this.strategyChanges = snapshot.strategyChanges;
  }
}
