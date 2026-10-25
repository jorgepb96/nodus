import { validateResearchDocumentRead, type ResearchDocumentRead } from './researchCorpus';
import type { ResearchQuestionAssessment, ResearchQuestionIntent, ResearchStopReason } from './researchHarness';

/** Closed action vocabulary. Source text and free-form model prose never execute. */
export type ResearchAction =
  | { action: 'finish'; reason?: Extract<ResearchStopReason, 'sufficient' | 'diminishing_returns' | 'sources_exhausted'>; coverage?: ResearchQuestionAssessment[] }
  | { action: 'enqueue'; queries: Array<{ question: string; query: string; priority: number } & Partial<ResearchQuestionIntent>>; coverage?: ResearchQuestionAssessment[] }
  | { action: 'defer'; taskId: string; reason: string }
  | { action: 'search'; query: string; taskId?: string }
  | { action: 'read'; documentId: string; operation: ResearchDocumentRead }
  | { action: 'original'; documentId: string; from: number; to?: number; attachmentId?: string }
  | { action: 'web'; queries: string[]; intent: ResearchWebIntent }
  | { action: 'catalog'; author?: string; title?: string; keywords?: string };

/** Why the supervisor leaves the library: more coverage, a counter-position,
 * newer information than the corpus holds, or the user asked for the web. */
export type ResearchWebIntent = 'expand' | 'contrast' | 'update' | 'explicit';
const WEB_INTENTS: readonly string[] = ['expand', 'contrast', 'update', 'explicit'];
/** Recover a single repeated action envelope, never choose among different
 * actions or relax the permission/schema validator. Execute the result once. */
export function parseResearchAction(value: unknown, allowWeb = false, allowCatalog = false, allowAgenda = false): ResearchAction | null {
  let candidate = value;
  if (Array.isArray(candidate)) {
    const items = candidate;
    if (!items.length || items.length > 4 || !items.every(item => JSON.stringify(item) === JSON.stringify(items[0]))) return null;
    candidate = items[0];
  }
  return validResearchAction(candidate, allowWeb, allowCatalog, allowAgenda) ? candidate : null;
}
export function validResearchQuestionIntent(value: Record<string, unknown>): boolean {
  return value.purpose === undefined && value.relation === undefined
    || typeof value.purpose === 'string' && value.purpose.trim().length >= 3 && value.purpose.length <= 400
      && ['facet', 'context', 'contrast', 'mechanism'].includes(String(value.relation));
}

/** The web action exists only for runs that were granted it (Research Chat with web
 * search on), and the catalogue lookup only for Research Chat's agent; every other
 * caller keeps the library-only vocabulary. */
export function validResearchAction(value: unknown, allowWeb = false, allowCatalog = false, allowAgenda = false): value is ResearchAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowed = input.action === 'finish' ? (allowAgenda ? ['action', 'reason', 'coverage'] : ['action'])
    : input.action === 'enqueue' && allowAgenda ? ['action', 'queries', 'coverage'] : input.action === 'defer' && allowAgenda ? ['action', 'taskId', 'reason'] : input.action === 'search' ? (allowAgenda ? ['action', 'query', 'taskId'] : ['action', 'query'])
    : input.action === 'read' ? ['action', 'documentId', 'operation'] : input.action === 'original' ? ['action', 'documentId', 'from', 'to', 'attachmentId']
      : input.action === 'web' && allowWeb ? ['action', 'queries', 'intent'] : input.action === 'catalog' && allowCatalog ? ['action', 'author', 'title', 'keywords'] : [];
  if (!allowed.length || keys.some(key => !allowed.includes(key))) return false;
  if (input.coverage !== undefined && (!Array.isArray(input.coverage) || input.coverage.length > 32 || !input.coverage.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const q = item as Record<string, unknown>;
    return Object.keys(q).every(key => ['question', 'status', 'evidenceIds', 'purpose', 'relation'].includes(key)) && validResearchQuestionIntent(q)
      && typeof q.question === 'string' && q.question.trim().length > 0 && q.question.length <= 1000
      && ['pending', 'supported', 'partial', 'contradictory', 'unresolved'].includes(String(q.status))
      && Array.isArray(q.evidenceIds) && q.evidenceIds.length <= 24 && q.evidenceIds.every(id => typeof id === 'string' && id.length <= 512);
  }))) return false;
  if (input.action === 'finish') return input.reason === undefined || ['sufficient', 'diminishing_returns', 'sources_exhausted'].includes(String(input.reason));
  if (input.action === 'defer') return typeof input.taskId === 'string' && input.taskId.length <= 100 && typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 400;
  if (input.action === 'enqueue') return Array.isArray(input.queries) && input.queries.length > 0 && input.queries.length <= 4 && input.queries.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const q = item as Record<string, unknown>;
    return Object.keys(q).every(key => ['question', 'query', 'priority', 'purpose', 'relation'].includes(key)) && validResearchQuestionIntent(q) && typeof q.question === 'string' && q.question.trim().length > 0 && q.question.length <= 1000
      && typeof q.query === 'string' && q.query.trim().length > 0 && q.query.length <= 1000 && Number.isInteger(q.priority) && Number(q.priority) >= 0 && Number(q.priority) <= 3;
  });
  if (input.action === 'catalog') {
    const fields = ['author', 'title', 'keywords'].filter(key => input[key] !== undefined);
    return fields.length > 0 && fields.every(key => typeof input[key] === 'string' && (input[key] as string).trim().length >= 2 && (input[key] as string).length <= 200);
  }
  if (input.action === 'web') {
    return Array.isArray(input.queries) && input.queries.length >= 1 && input.queries.length <= 4
      && input.queries.every(query => typeof query === 'string' && query.trim().length >= 2 && query.length <= 200)
      && typeof input.intent === 'string' && WEB_INTENTS.includes(input.intent);
  }
  if (input.action === 'search') return typeof input.query === 'string' && input.query.trim().length > 0 && input.query.length <= 1000
    && (input.taskId === undefined || typeof input.taskId === 'string' && input.taskId.length > 0 && input.taskId.length <= 100);
  if (typeof input.documentId !== 'string' || !input.documentId || input.documentId.length > 512) return false;
  try {
    const operation = input.action === 'read' ? input.operation : { kind: 'pages', from: input.from, to: input.to, attachmentId: input.attachmentId };
    validateResearchDocumentRead(operation as ResearchDocumentRead);
    if (input.action === 'read') {
      const read = operation as ResearchDocumentRead;
      const permitted = { search: ['kind', 'query'], pages: ['kind', 'from', 'to', 'attachmentId'], context: ['kind', 'passageId', 'radius'], references: ['kind', 'query'] }[read.kind];
      if (Object.keys(read).some(key => !permitted.includes(key))) return false;
    }
    return true;
  } catch { return false; }
}
