/** Versioned, opt-in quality metrics for blinded research answer reviews. */
export const RESEARCH_ANSWER_QUALITY_POLICY = 'research-answer-quality/3';
export const DEFAULT_RESEARCH_QUALITY_PREREGISTRATION = Object.freeze({ minimumAnswerableSample: 60 });

const REQUIRED_BOOLEAN_FIELDS = [
  'correct', 'complete', 'noMaterialUnsupportedClaims', 'insufficientEvidenceHandled',
];

/**
 * Score separately authored reviews against the fixed planned outcomes. Reviews
 * are keyed and hash-bound so they cannot silently migrate to another answer.
 */
export function evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished = false,
  productInvariantEvidence = null, preregistration = DEFAULT_RESEARCH_QUALITY_PREREGISTRATION }) {
  if (!Array.isArray(outcomes) || !Array.isArray(reviews)) throw new Error('Quality outcomes and reviews must be arrays');
  if (!preregistration || !Number.isSafeInteger(preregistration.minimumAnswerableSample)
      || preregistration.minimumAnswerableSample < 1) throw new Error('Quality preregistration must define a positive minimumAnswerableSample');
  const byId = new Map(outcomes.map(row => [row.reviewId, row]));
  if (byId.size !== outcomes.length) throw new Error('Quality outcome review IDs must be unique');
  const checked = new Map();
  for (const review of reviews) {
    if (!review || typeof review !== 'object' || Array.isArray(review) || !byId.has(review.reviewId)) {
      throw new Error('Quality review contains an unknown review ID');
    }
    if (checked.has(review.reviewId)) throw new Error('Quality review IDs must be unique');
    const outcome = byId.get(review.reviewId);
    if (review.answerSha256 !== outcome.answerSha256 || review.sourceHash !== outcome.sourceHash) {
      throw new Error('Quality review hashes do not bind to the packed answer and sources');
    }
    if (typeof review.reviewer !== 'string' || !review.reviewer.trim() || review.reviewer.length > 200
        || typeof review.notes !== 'string' || review.notes.length > 20_000
        || REQUIRED_BOOLEAN_FIELDS.some(field => typeof review[field] !== 'boolean')) {
      throw new Error('Quality review fields are invalid');
    }
    checked.set(review.reviewId, review);
  }

  const rows = outcomes.map(outcome => ({ outcome, review: checked.get(outcome.reviewId) ?? null }));
  const measured = rows.filter(row => row.review !== null);
  const complete = measured.length === rows.length;
  const ratios = (passed, planned) => ({ passed, planned, rate: planned ? passed / planned : null });
  const arms = [...new Set(rows.map(({ outcome }) => outcome.arm))].sort();
  if (arms.length === 0 || arms.some(arm => typeof arm !== 'string' || !arm)) throw new Error('Quality outcomes must identify at least one arm');
  const byArm = Object.fromEntries(arms.map(arm => {
    const armRows = rows.filter(({ outcome }) => outcome.arm === arm);
    const supported = armRows.filter(({ outcome }) => outcome.positive);
    const absent = armRows.filter(({ outcome }) => !outcome.positive);
    const supportedPassed = supported.filter(({ outcome, review }) => outcome.answered && review?.correct === true && review?.complete === true).length;
    const published = armRows.filter(({ outcome }) => outcome.answered);
    const fidelityPassed = published.filter(({ review }) => review?.noMaterialUnsupportedClaims === true).length;
    const absentPassed = absent.filter(({ outcome, review }) => outcome.answered && review?.insufficientEvidenceHandled === true).length;
    const metrics = {
      answerableCorrectAndComplete: ratios(supportedPassed, supported.length),
      publishedAnswersWithoutMaterialUnsupportedClaims: ratios(fidelityPassed, published.length),
      insufficientEvidenceHandling: ratios(absentPassed, absent.length),
    };
    const thresholds = {
      answerableCorrectAndComplete: supported.length > 0 && supportedPassed / supported.length >= 0.85,
      publishedAnswersWithoutMaterialUnsupportedClaims: published.length > 0 && fidelityPassed / published.length >= 0.95,
      insufficientEvidenceHandling: absent.length > 0 && absentPassed / absent.length >= 0.9,
    };
    return [arm, { denominators: { answerablePlanned: supported.length, publishedAnswers: published.length,
      insufficientEvidencePlanned: absent.length }, metrics, thresholds,
    sampleSufficiency: { minimumAnswerableSample: preregistration.minimumAnswerableSample,
      observedAnswerablePlanned: supported.length, sufficient: supported.length >= preregistration.minimumAnswerableSample },
    acceptance: Object.values(thresholds).every(Boolean)
      && supported.length >= preregistration.minimumAnswerableSample }];
  }));
  const ready = campaignFinished && complete;
  const sampleSufficiency = { minimumAnswerableSamplePerArm: preregistration.minimumAnswerableSample,
    sufficientForEveryArm: arms.every(arm => byArm[arm].sampleSufficiency.sufficient),
    arms: Object.fromEntries(arms.map(arm => [arm, byArm[arm].sampleSufficiency])) };
  const answerQualityAcceptance = ready && sampleSufficiency.sufficientForEveryArm
    ? arms.every(arm => byArm[arm].acceptance) : null;
  const invariants = evaluateProductInvariants({ productInvariantEvidence, planned: rows.length });
  const overallReady = ready && sampleSufficiency.sufficientForEveryArm && invariants.status === 'measured';
  return {
    policy: RESEARCH_ANSWER_QUALITY_POLICY,
    status: overallReady ? 'measured' : 'pending',
    answerQualityStatus: ready ? 'measured' : 'pending',
    preregistration: { ...preregistration },
    sampleSufficiency,
    denominators: { planned: rows.length, reviewed: measured.length },
    arms: byArm,
    answerQualityAcceptance,
    productInvariants: invariants,
    acceptance: overallReady ? Boolean(answerQualityAcceptance && invariants.acceptance) : null,
    limitations: [`Per-arm planned denominators are ${arms.map(arm => `${arm}: ${byArm[arm].denominators.answerablePlanned} answerable / ${byArm[arm].denominators.insufficientEvidencePlanned} insufficient-evidence`).join('; ')}; these counts limit statistical interpretation.`,
      'Unexecuted, transport-failed, and withheld answerable items remain in the answerable denominator and score as failures.',
      'Fidelity is conditional on published answers; its denominator and answerable utility are reported separately.',
      'This answer-quality policy does not score passage-level retrieval or packaged-platform availability.',
      'Meeting these directed-sample targets does not establish a population-level rate or universal industry standard.'],
  };
}

function evaluateProductInvariants({ productInvariantEvidence, planned }) {
  if (productInvariantEvidence === null) return { status: 'pending', acceptance: null,
    reason: 'Product runtime citation-resolution and scope/contract isolation receipts were not supplied.' };
  const { citationResolution, scopeContractIsolation } = productInvariantEvidence;
  if (productInvariantEvidence.evidenceType !== 'product-runtime-receipt'
      || typeof productInvariantEvidence.evidenceSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(productInvariantEvidence.evidenceSha256)) {
    return { status: 'pending', acceptance: null,
      reason: 'Invariant evidence is not a hash-bound product runtime receipt.' };
  }
  if (!citationResolution || !Number.isSafeInteger(citationResolution.captured) || citationResolution.captured < 0
      || !Number.isSafeInteger(citationResolution.resolved) || citationResolution.resolved < 0
      || citationResolution.resolved > citationResolution.captured
      || typeof citationResolution.resolver !== 'string' || !citationResolution.resolver.trim()
      || !scopeContractIsolation || scopeContractIsolation.checkedOutcomes !== planned
      || !Number.isSafeInteger(scopeContractIsolation.observedScopeLeaks) || scopeContractIsolation.observedScopeLeaks < 0
      || !Number.isSafeInteger(scopeContractIsolation.observedContractLeaks) || scopeContractIsolation.observedContractLeaks < 0
      || typeof scopeContractIsolation.checksRun !== 'boolean' || !scopeContractIsolation.checksRun) {
    throw new Error('Product runtime invariant evidence is malformed or incomplete');
  }
  const citationRate = citationResolution.captured ? citationResolution.resolved / citationResolution.captured : null;
  const hasCitations = citationResolution.captured > 0;
  const zeroLeaks = scopeContractIsolation.observedScopeLeaks === 0 && scopeContractIsolation.observedContractLeaks === 0;
  const acceptance = hasCitations && citationRate === 1 && zeroLeaks;
  return { status: 'measured', acceptance,
    citationResolution: { captured: citationResolution.captured, resolved: citationResolution.resolved,
      rate: citationRate, resolver: citationResolution.resolver },
    scopeContractIsolation: { checkedOutcomes: scopeContractIsolation.checkedOutcomes,
      observedScopeLeaks: scopeContractIsolation.observedScopeLeaks,
      observedContractLeaks: scopeContractIsolation.observedContractLeaks, checksRun: true },
    thresholds: { allCitationTargetsResolvable: hasCitations && citationRate === 1, zeroScopeOrContractLeaks: zeroLeaks },
  };
}
