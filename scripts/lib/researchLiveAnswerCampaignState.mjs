/** State helpers for the live answer campaign. No model or gold data is used. */
export const LIVE_ANSWER_KIND_ORDER = Object.freeze(['complex', 'hard', 'core', 'absence']);

export function researchLiveCaseKind(row) {
  if (['no-evidence', 'absence', 'insufficient'].includes(row.kind)) return 'absence';
  if (String(row.kind).startsWith('complex') || row.kind === 'historical-complex') return 'complex';
  if (['hard', 'hard-case', 'evaluation-hard', 'hard-negative'].includes(row.kind)) return 'hard';
  if (['core', 'answerable', 'monolingual', 'cross-language'].includes(row.kind)) return 'core';
  throw new Error(`Unrecognized non-gold cohort kind for ${row.id}: ${String(row.kind)}`);
}

export function planResearchLiveCases(cases) {
  const ranked = [...cases].sort((a, b) => LIVE_ANSWER_KIND_ORDER.indexOf(researchLiveCaseKind(a))
    - LIVE_ANSWER_KIND_ORDER.indexOf(researchLiveCaseKind(b)) || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const counts = Object.fromEntries(LIVE_ANSWER_KIND_ORDER.map(kind => [kind, ranked.filter(row => researchLiveCaseKind(row) === kind).length]));
  if (JSON.stringify(counts) !== JSON.stringify({ complex: 10, hard: 10, core: 40, absence: 20 })) {
    throw new Error('Cohort run order does not match the frozen 10/10/40/20 plan');
  }
  return ranked.map((row, index) => ({ ordinal: index + 1, caseId: row.id,
    kind: researchLiveCaseKind(row), sourceCaseHash: row.sourceCaseHash }));
}

export function pendingResearchLiveCases(plan, answers) {
  const attempted = new Set(answers.map(row => row.caseId));
  return { notAttempted: plan.filter(row => !attempted.has(row.caseId))
    .map(row => ({ caseId: row.caseId, ordinal: row.ordinal, sourceCaseHash: row.sourceCaseHash })) };
}

/** Explicit diagnostic subsets retain the full frozen order and cannot be
 * presented as a new full-cohort quality measurement. */
export function selectResearchLiveDiagnosticCases(plan, caseIds) {
  if (!Array.isArray(caseIds) || caseIds.length === 0 || caseIds.length >= plan.length
      || caseIds.some(id => typeof id !== 'string' || !/^R\d{3}$/u.test(id))
      || new Set(caseIds).size !== caseIds.length) throw new Error('Invalid diagnostic case selection');
  const selected = plan.filter(row => caseIds.includes(row.caseId));
  if (selected.length !== caseIds.length) throw new Error('Diagnostic case is outside the frozen roster');
  return selected;
}

/** Only accepted request IDs created after this case's baseline and still pending. */
export function newLiveAcceptedEvents(events, requestIdsBefore, preparedIds = new Set()) {
  const completed = new Set(events.filter(event => ['completed', 'abandoned'].includes(event.event)).map(event => event.id));
  return events.filter(event => event.event === 'accepted' && !requestIdsBefore.has(event.id)
    && !preparedIds.has(event.id) && !completed.has(event.id));
}

/** Stop admission between cases; an admitted application request can still finish. */
export function validateResearchLiveAdmissionStop(request, root) {
  if (request?.format !== 'nodus.live-answer-admission-stop/1' || request.root !== root) {
    throw new Error('Invalid QA admission-stop receipt');
  }
  return request;
}

/** Use the durable event stream after bridge.close(), including abandoned calls. */
export function summarizeResearchLiveTerminalEvents(events, prior = {}) {
  const count = type => new Set(events.filter(row => row.event === type).map(row => row.id)).size;
  return {
    bridgeAccepted: (prior.bridgeAccepted ?? 0) + count('accepted'),
    bridgeCompleted: (prior.bridgeCompleted ?? 0) + count('completed'),
    bridgeAbandoned: (prior.bridgeAbandoned ?? 0) + count('abandoned'),
  };
}
