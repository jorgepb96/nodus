import assert from 'node:assert/strict';

const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))]))
  : value);
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

/** Offline, paired measurements. Counts come from a common independent review,
 * never a run's confidence, number of sources or self-assessed agenda coverage. */
export function compareResearchHarness(cases) {
  assert.ok(Array.isArray(cases) && cases.length, 'Supply at least one paired case');
  const seen = new Set();
  return cases.map(item => {
    assert.ok(typeof item.caseId === 'string' && item.caseId && !seen.has(item.caseId), 'Unique caseId required'); seen.add(item.caseId);
    const { legacy, v1 } = item;
    assert.ok(legacy && v1, `${item.caseId}: both versions are required`);
    for (const run of [legacy, v1]) {
      for (const key of ['mode', 'objective', 'scopeId', 'model', 'effort', 'retrieval', 'web', 'language']) assert.ok(Object.hasOwn(run.context ?? {}, key), `Missing matched context: ${key}`);
      assert.ok(['chat', 'deep-research', 'immersion'].includes(run.context.mode), 'Academic mode required');
      for (const key of ['requiredQuestions', 'answeredQuestions', 'claims', 'supportedClaims', 'citationErrors', 'modelCalls', 'elapsedMs']) {
        assert.ok(Number.isFinite(run.metrics?.[key]) && run.metrics[key] >= 0, `Invalid metric: ${key}`);
      }
      const m = run.metrics;
      assert.ok(m.requiredQuestions > 0 && m.claims > 0, 'An empty answer is not a quality pass');
      assert.ok(m.answeredQuestions <= m.requiredQuestions && m.supportedClaims <= m.claims, 'Counts exceed their denominators');
    }
    assert.equal(canonical(legacy.context), canonical(v1.context), `${item.caseId}: scope, model, effort and budgets must match`);
    assert.equal(legacy.metrics.requiredQuestions, v1.metrics.requiredQuestions, 'Use the same review rubric');
    assert.ok(item.blindPreference == null || ['legacy', 'v1', 'tie'].includes(item.blindPreference), 'Invalid blind preference');
    const measure = ({ metrics: m }) => ({ supportedCoverage: ratio(m.answeredQuestions, m.requiredQuestions),
      unsupportedRate: ratio(m.claims - m.supportedClaims, m.claims), citationErrors: m.citationErrors, modelCalls: m.modelCalls, elapsedMs: m.elapsedMs });
    const before = measure(legacy), after = measure(v1);
    return { caseId: item.caseId, mode: legacy.context.mode, legacy: before, v1: after,
      delta: Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]])),
      noQualityRegression: after.supportedCoverage >= before.supportedCoverage && after.unsupportedRate <= before.unsupportedRate && after.citationErrors <= before.citationErrors,
      blindPreference: item.blindPreference ?? null };
  });
}
