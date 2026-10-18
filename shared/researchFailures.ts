/** A repeated unchanged request cannot repair revoked access, configuration,
 * exhausted allowance or a deliberate cancellation. Keep this policy shared. */
export function researchFailureRequiresStop(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: string; config?: boolean; name?: string; message?: string };
  return row.config === true || row.name === 'AbortError'
    || ['auth', 'budget_exhausted', 'ai_model_required', 'context_overflow'].includes(row.code ?? '')
    || /research_run_(?:budget_exhausted|cancelled|paused|closed|not_authorized|context_changed)|scope.*changed/iu.test(row.message ?? '');
}
