// Derived analysis status for a library work.
//
// The library used to show one column per pipeline field (light, deep, summary,
// embeddings, passages) because that is how the analysis is stored. A reader has
// a single question — "can I use this work yet?" — so this module folds those
// five fields into one readiness value plus a per-step breakdown.
//
// It deliberately holds NO user-facing strings: labels live next to their `t()`
// call in the components, which is what keeps them inside the i18n coverage scan.
import type { QueueItem, WorkEmbeddingStatus, WorkPassageStatus, WorkReadiness, WorkView } from '@shared/types';

export type { WorkReadiness };

/** The five things that can be done to a work, in pipeline order. */
export type StepId = 'themes' | 'ideas' | 'summary' | 'semantic' | 'citable';

export type StepState =
  /** Finished and current. */
  | 'done'
  /** Started but not complete — partially embedded, or outdated, or abstract-only. */
  | 'partial'
  /** Never run, and it could be. */
  | 'missing'
  /** Persisted for resumption or waiting in the live queue. */
  | 'pending'
  /** Currently being processed. */
  | 'running'
  | 'failed'
  /** Impossible until something outside Nodus changes (no full text available). */
  | 'blocked'
  /** Not applicable — e.g. embedding a work that has no ideas to embed. */
  | 'na';

// WorkReadiness lives in shared/types.ts because the works repository filters by
// it in SQL; see electron/db/readinessFilters.ts for the predicates that must
// stay in step with `deriveWorkStatus` below.

export const STEP_ORDER: readonly StepId[] = ['themes', 'ideas', 'summary', 'semantic', 'citable'];

/**
 * Steps that must be `done` for a work to count as ready.
 *
 * All five pipeline steps gate the green. A work whose summary or semantic index is
 * missing is genuinely not finished, and the earlier exclusions let it read as
 * "Listo" while its own step breakdown said otherwise. The SQL preset evaluates the
 * same five (see electron/db/readinessFilters.ts): semantic freshness is available
 * there through the `idea_embedding_text_hash` function registered on the connection
 * from the same helper the embedding pipeline uses, so the pill and the preset stay
 * in step. A step that is `na` (e.g. no ideas to embed) never counts as missing.
 */
export const READY_STEPS: readonly StepId[] = ['themes', 'ideas', 'summary', 'semantic', 'citable'];

export interface StepStatus {
  id: StepId;
  state: StepState;
  /** Progress numbers where the step has them (embedded ideas, indexed passages). */
  done?: number;
  total?: number;
  reason?: 'analysis_text_changed' | WorkPassageStatus['outdatedReason'];
}

export interface WorkStatus {
  readiness: WorkReadiness;
  steps: Record<StepId, StepStatus>;
  /** Ready-steps that are actionable and not finished — what "incomplete · N" counts. */
  missing: StepId[];
}

/**
 * Step states a reader can repair by re-running it.
 *
 * `blocked` and `na` are terminal — retrying cannot change the outcome — and
 * `pending`/`running` are already in the queue, so retrying those would be a
 * no-op. Shared so the per-work status modal and the Library's bulk action
 * repair exactly the same set instead of drifting apart.
 */
export const RETRYABLE_STEP_STATES: readonly StepState[] = ['partial', 'missing', 'failed'];

/** The retryable steps of one work, in pipeline order. */
export function retryableSteps(status: WorkStatus): StepId[] {
  return STEP_ORDER.filter((id) => RETRYABLE_STEP_STATES.includes(status.steps[id].state));
}

/** Queue kinds map onto the three steps that run through the scan queue. */
const QUEUE_KIND_STEP: Partial<Record<QueueItem['kind'], StepId>> = {
  light: 'themes',
  deep: 'ideas',
  summary: 'summary',
};

/**
 * True when Nodus has no full text for this work, whether extraction was skipped
 * or Zotero only ever offered an abstract. Passages can never be indexed in that
 * state, so such a work must not be reported as "incomplete" — retrying costs
 * tokens and cannot succeed until the PDF/EPUB reaches Zotero.
 */
export function hasNoFullText(work: WorkView): boolean {
  const currentSource = work.resolved_source_type ?? work.source_type;
  return (
    work.deep_status === 'skipped_no_text' ||
    work.summary_status === 'skipped_no_text' ||
    currentSource === 'none' ||
    currentSource === 'abstract_only'
  );
}

/** The deep analysis ran, but against the abstract alone. Re-scannable once the file exists. */
export function isAbstractOnly(work: WorkView): boolean {
  const currentSource = work.resolved_source_type ?? work.source_type;
  return work.deep_status === 'done'
    && (work.source_type === 'abstract_only' || work.source_type === 'none')
    && (currentSource === 'abstract_only' || currentSource === 'none');
}

function themesState(work: WorkView): StepState {
  switch (work.light_status) {
    case 'done':
      return 'done';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    default:
      return 'missing';
  }
}

function ideasState(work: WorkView): StepState {
  if (work.deep_error) return 'failed';
  switch (work.deep_status) {
    case 'done':
      // Done, but only the abstract was read: real but degraded.
      return isAbstractOnly(work)
        || Boolean(work.resolved_text_hash && work.deep_hash !== work.resolved_text_hash)
        ? 'partial'
        : 'done';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'skipped_no_text':
      return 'blocked';
    default:
      return 'missing';
  }
}

function summaryState(work: WorkView): StepState {
  switch (work.summary_status) {
    case 'done':
      return 'done';
    case 'pending':
      // A persisted summary marker may outlive its job. Only the live queue can
      // disable its recovery action; an orphan must remain retryable.
      return 'missing';
    case 'failed':
      return 'failed';
    case 'skipped_no_text':
      return 'blocked';
    default:
      return 'missing';
  }
}

function semanticStep(work: WorkView, embedding: WorkEmbeddingStatus | undefined): StepStatus {
  // Nothing to embed until the deep pass has produced ideas.
  if (work.deep_status !== 'done' || !embedding || embedding.totalIdeas === 0) {
    return { id: 'semantic', state: 'na' };
  }
  if (embedding.complete) {
    return { id: 'semantic', state: 'done', done: embedding.embeddedIdeas, total: embedding.totalIdeas };
  }
  return { id: 'semantic', state: 'partial', done: embedding.embeddedIdeas, total: embedding.totalIdeas };
}

function citableStep(work: WorkView, passage: WorkPassageStatus | undefined): StepStatus {
  if (hasNoFullText(work)) return { id: 'citable', state: 'blocked' };
  if (!passage || passage.status === 'missing') return { id: 'citable', state: 'missing' };
  if (passage.status === 'complete') return { id: 'citable', state: 'done', total: passage.totalPassages };
  return { id: 'citable', state: 'partial', total: passage.totalPassages, reason: passage.outdatedReason };
}

/**
 * Fold a work's five pipeline fields (plus any live queue activity) into one
 * readable status.
 *
 * `queued` is the set of scan-queue items for this work. The persisted
 * `*_status` fields go 'pending' when a job is enqueued but never distinguish
 * "waiting in line" from "running right now", so the queue is the only source
 * that can say a work is being worked on this instant.
 */
export function deriveWorkStatus(
  work: WorkView,
  embedding: WorkEmbeddingStatus | undefined,
  passage: WorkPassageStatus | undefined,
  queued: readonly QueueItem[] = []
): WorkStatus {
  const steps: Record<StepId, StepStatus> = {
    themes: { id: 'themes', state: themesState(work) },
    ideas: {
      id: 'ideas',
      state: ideasState(work),
      reason: work.deep_status === 'done' && work.resolved_text_hash && work.deep_hash !== work.resolved_text_hash
        ? 'analysis_text_changed'
        : undefined,
    },
    summary: { id: 'summary', state: summaryState(work) },
    semantic: semanticStep(work, embedding),
    citable: citableStep(work, passage),
  };

  // A live queue entry outranks whatever the row last persisted, and is the only
  // authority that may call a step `running`.
  if (work.summary_status === 'pending' && queued.some(item => item.kind === 'deep' && (item.state === 'queued' || item.state === 'running'))) {
    // A required summary can belong to the deep chain without its own queue row.
    // An explicit summary row below still wins, regardless of the queue's order.
    steps.summary = { id: 'summary', state: 'pending' };
  }
  for (const item of queued) {
    if (item.state !== 'queued' && item.state !== 'running') continue;
    const step = QUEUE_KIND_STEP[item.kind];
    if (step) steps[step] = { ...steps[step], state: item.state === 'running' ? 'running' : 'pending' };
  }

  const states = STEP_ORDER.map((id) => steps[id].state);
  const missing = READY_STEPS.filter((id) => steps[id].state === 'missing' || steps[id].state === 'partial');

  // Precedence: what is happening now beats what failed, which beats what is
  // merely absent. The two text-shortage states sit above `incomplete` so a work
  // Nodus cannot finish is never presented as one retry away from done.
  let readiness: WorkReadiness;
  if (states.includes('running')) readiness = 'running';
  else if (states.includes('pending')) readiness = 'pending';
  else if (states.includes('failed')) readiness = 'failed';
  else if (work.light_status === 'none' && work.deep_status === 'none') readiness = 'unstarted';
  else if (isAbstractOnly(work)) readiness = 'abstractOnly';
  else if (hasNoFullText(work)) readiness = 'noText';
  else if (missing.length === 0) readiness = 'ready';
  else readiness = 'incomplete';

  return { readiness, steps, missing };
}

/** Index live queue items by the work they belong to, for per-row lookup. */
export function queueItemsByWork(items: readonly QueueItem[]): Map<string, QueueItem[]> {
  const map = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (item.state !== 'queued' && item.state !== 'running') continue;
    const list = map.get(item.nodus_id);
    if (list) list.push(item);
    else map.set(item.nodus_id, [item]);
  }
  return map;
}
