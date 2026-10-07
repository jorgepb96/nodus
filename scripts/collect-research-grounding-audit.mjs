import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const destination = path.resolve(argument('output') ?? 'audit/research-chat-grounding');
const reviews = argument('reviews') ? JSON.parse(fs.readFileSync(argument('reviews'), 'utf8')) : [];
const revision = argument('revision');
assert(!revision || /^[a-f0-9]{8,40}$/.test(revision));
assert(Array.isArray(reviews));
const hash = value => createHash('sha256').update(value).digest('hex');
const baselineFile = 'audit/embeddinggemma-2/campaign.json';
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
fs.mkdirSync(destination, { recursive: true });
const artifacts = [];
const write = (name, value) => {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, name), bytes);
  artifacts.push({ file: name, sha256: hash(bytes), bytes: bytes.length });
};
const products = [];
for (const product of baseline.products) {
  const root = fs.realpathSync(product.root);
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  assert.equal(marker.root, root); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
  const reportFile = path.join(root, 'artifacts/grounding-evaluation.json');
  if (!fs.existsSync(reportFile)) { products.push({ profile: product.profile, pending: true, answers: [] }); continue; }
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.profile, product.profile); assert.equal(fs.realpathSync(report.root), root);
  const name = product.profile.replaceAll(/[^a-z0-9-]/g, '-');
  if (revision && !report.sourceVersion.gitHead.startsWith(revision)) {
    write(`diagnostic-${name}-${report.sourceVersion.gitHead.slice(0, 8)}.json`, report);
    products.push({ profile: product.profile, pending: true, excludedMeasuredRevision: report.sourceVersion.gitHead, answers: [] });
    continue;
  }
  const copy = file => {
    assert(fs.realpathSync(file).startsWith(root + path.sep), 'only an isolated campaign artifact can be copied');
    const relative = `screenshots/${name}-${path.basename(file)}`;
    fs.mkdirSync(path.join(destination, 'screenshots'), { recursive: true });
    const bytes = fs.readFileSync(file); fs.writeFileSync(path.join(destination, relative), bytes);
    artifacts.push({ file: relative, sha256: hash(bytes), bytes: bytes.length }); return relative;
  };
  const answers = report.answers.map(answer => {
    const key = `${product.profile}/${answer.name}/${answer.repetition}`;
    const answerSha256 = hash(answer.response?.answer ?? '');
    const sourcesSha256 = hash(JSON.stringify(answer.citations.map(citation => ({ id: citation.id, title: citation.passage?.work.title, text: citation.passage?.text }))));
    const evidenceSha256 = hash(JSON.stringify(answer.traces.filter(trace => trace.type === 'research-answer-grounding').at(-1)?.sources ?? []));
    const review = reviews.find(row => row.key === key);
    if (review) {
      assert.equal(review.answerSha256, answerSha256, `review must match the exact answer: ${key}`);
      assert.equal(review.sourcesSha256, sourcesSha256, `review must match the cited sources: ${key}`);
      assert.equal(review.evidenceSha256, evidenceSha256, `review must match the frozen audit evidence: ${key}`);
      assert.equal(typeof review.faithful, 'boolean'); assert.equal(typeof review.adequate, 'boolean');
      assert.equal(typeof review.notes, 'string');
    }
    return { ...answer, key, answerSha256, sourcesSha256, evidenceSha256, review: review ?? null,
      ...(answer.screenshot ? { screenshot: copy(answer.screenshot) } : {}) };
  });
  write(`${name}.json`, { ...report, answers });
  products.push({ profile: product.profile, sourceVersion: report.sourceVersion, file: `${name}.json`,
    completed: report.completed, budgetExhausted: Boolean(report.budgetExhausted), executionErrors: answers.filter(row => row.error).length,
    isolation: report.isolation, databaseIsolation: report.databaseIsolation, answers });
  // Preserve the first attempted review instead of overwriting its failures.
  for (const priorFile of fs.readdirSync(path.join(root, 'artifacts')).filter(file => /^grounding-evaluation-previous-\d+\.json$/.test(file))) {
    const prior = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', priorFile), 'utf8'));
    write(`diagnostic-${name}-${priorFile}`, prior);
  }
}
const all = products.flatMap(product => product.answers);
const factual = all.filter(row => !row.name.includes('absent'));
const absence = all.filter(row => row.name.includes('absent'));
const passed = row => !row.error && row.review?.faithful === true && row.review?.adequate === true;
const factualPassed = factual.filter(passed).length, absencePassed = absence.filter(passed).length;
const allExecuted = products.every(product => product.completed) && all.length === 120;
const allReviewed = allExecuted && all.every(row => row.error || row.review);
const citations = all.flatMap(row => row.citations);
const semantic = all.filter(row => !row.name.includes('absent') && !row.error).every(row => row.traces.some(trace =>
  trace.retrieval?.semantic?.some(candidate => trace.retrieval.selected?.some(selected => selected.semanticIds?.includes(candidate.id)))));
const ledgerFile = path.join(baseline.products[0].root, 'artifacts/product-report.json');
const original = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
const ledgerPath = path.join(original.campaignRoot, 'artifacts/cost-ledger.json');
const ledgerBytes = fs.readFileSync(ledgerPath), ledger = JSON.parse(ledgerBytes);
const factualRate = allReviewed ? factualPassed / 80 : null;
const absenceRate = allReviewed ? absencePassed / 40 : null;
const citationRate = citations.length ? citations.filter(row => row.resolvable).length / citations.length : null;
const versions = [...new Set(products.filter(product => product.sourceVersion).map(product => JSON.stringify({ files: product.sourceVersion.files, applicationEntry: product.sourceVersion.applicationEntry })))];
const runtimeFiles = ['electron/ai/researchAssistant.ts', 'electron/ai/researchClaimAudit.ts', 'electron/ai/researchChatGrounding.ts', 'electron/ai/researchTurnPlanner.ts', 'shared/researchChatGrounding.ts', 'shared/mainProcessErrors.ts'];
const candidate = { gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files: Object.fromEntries(runtimeFiles.map(file => [file, hash(fs.readFileSync(file))])), applicationEntry: hash(fs.readFileSync('dist-electron/application.js')) };
const candidateMatchesMeasured = products.filter(product => product.sourceVersion).every(product => JSON.stringify(product.sourceVersion.files) === JSON.stringify(candidate.files) && product.sourceVersion.applicationEntry === candidate.applicationEntry);
const gatesPassed = allReviewed && candidateMatchesMeasured && versions.length === 1 && factualRate >= .95 && absenceRate >= .9 && citationRate === 1 && semantic
  && products.every(product => product.databaseIsolation?.escaped === 0 && Object.values(product.isolation).filter(value => typeof value === 'boolean').every(Boolean));
const summary = {
  format: 'nodus.research-chat-grounding-campaign/1', collectedAt: new Date().toISOString(),
  baseline: { file: '../embeddinggemma-2/campaign.json', sha256: hash(fs.readFileSync(baselineFile)), directedReviewedFactual: { passed: 19, reviewed: 42 },
    comparisonLimit: 'The original directed failure review and revised questions are different samples. No population accuracy or paired percentage improvement is claimed.' },
  evaluation: { design: '12 scenarios × 2 repetitions × 5 isolated embedding profiles; previously attempted questions, repeated regression evaluation after fixes.',
    planned: { total: 120, factual: 80, insufficientEvidence: 40 }, executed: all.length, reviewed: all.filter(row => row.review).length,
    reviewedPublishedAnswers: all.filter(row => row.review && !row.error).length, reviewedFailureCases: all.filter(row => row.review && row.error).length,
    measuredRevision: revision ?? null, candidate, candidateMatchesMeasured,
    executionErrors: all.filter(row => row.error).length, pending: 120 - all.length, allExecuted, allReviewed, sameRuntime: versions.length === 1,
    observedReviewedFactual: { passed: factualPassed, reviewed: factual.filter(row => row.review).length }, observedReviewedAbsence: { passed: absencePassed, reviewed: absence.filter(row => row.review).length },
    factualPassed, absencePassed, factualSupportAndAdequacy: factualRate, insufficientEvidence: absenceRate,
    citations: { captured: citations.length, allResolvable: citationRate === 1, rate: citationRate }, semanticCandidatesSelected: semantic,
    gates: { factualSupportAndAdequacy: .95, insufficientEvidence: .9, resolvableCitations: 1, passed: gatesPassed },
    reviewer: 'Codex independent source inspection, separate from the application auditor; not an external human or blinded review.' },
  cost: { campaignRoot: original.campaignRoot, ledgerSha256: hash(ledgerBytes), limitUsd: ledger.limitUsd,
    cumulativeActualUsd: ledger.calls.reduce((sum, call) => sum + (call.actualUsd ?? 0), 0),
    cumulativeCommittedUsd: ledger.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0), calls: ledger.calls.length,
    note: 'Cumulative proxy accounting for the original campaign, including prior stages, using peak-price upper bounds where the provider supplies no cost. This is not a billing invoice. Unknown usage retains its full reservation. This collector never resets or changes the budget.' },
  hardware: baseline.hardware ?? null, products: products.map(({ answers: _answers, ...product }) => product), artifacts,
  release: { validatedProfiles: [], note: 'Grounding acceptance alone cannot validate an embedding profile. Original native Windows/Linux/macOS Intel EmbeddingGemma execution and remaining capacity gates stay pending.' },
};
write('manual-reviews.json', all.filter(row => row.review).map(row => ({ key: row.key, answerSha256: row.answerSha256, sourcesSha256: row.sourcesSha256, evidenceSha256: row.evidenceSha256, ...row.review })));
write('campaign.json', summary);
const percent = value => value === null ? 'pending' : `${(value * 100).toFixed(1)}%`;
write('README.md', `# Research Chat accuracy regression campaign\n\n${gatesPassed ? 'The measured documentary answer gates passed.' : 'Acceptance is not complete; no profile is promoted to validated.'}\n\n` +
  `Executed ${all.length}/120 planned cases; independently source-reviewed ${summary.evaluation.reviewedPublishedAnswers} published answers and triaged ${summary.evaluation.reviewedFailureCases} failures. Factual support **and answer adequacy**: ${percent(factualRate)}. Insufficient-evidence recognition with faithful wording: ${percent(absenceRate)}. Citation resolution: ${percent(citationRate)} (${citations.length} captured links). Errors and unavailable answers count as failures, never correct refusals.\n\n` +
  `The questions were already attempted before the latest fixes. This is a repeated regression sample, not a fresh blinded holdout or an estimate for arbitrary user documents. The original directed review (19/42 supported factual answers) is retained separately and uses a different sample.\n\n` +
  `Measured revision: ${revision ?? 'see profile reports'}. Candidate matches measured runtime: **${candidateMatchesMeasured}**. Subsequent fixes need another paid application run; unit tests do not establish the quality thresholds.\n\n` +
  `Review records bind to exact answer and cited-source SHA-256 values. Codex inspected source evidence independently of the application's own model judgement; no external human review is claimed. Reports retain literal sources, semantic retrieval selection, contracts, drafts, verdicts, repairs, coverage checks, resolved citations, UI screenshots and failed earlier attempts.\n\n` +
  `The shared campaign ledger records USD ${summary.cost.cumulativeActualUsd.toFixed(4)} consumed, ${summary.cost.cumulativeCommittedUsd.toFixed(4)} committed, within its USD ${ledger.limitUsd} global limit. Embeddings run locally; the generative provider is direct DeepSeek Flash. Source versions and actual request settings are in each profile report.\n\n` +
  `Generic grounding rules do not change vector contracts or require rebuilding indexes. Verification adds generative calls and latency; its stage timings are distinct from local embedding/search latency. Creative exercises, skills and direct multimodal attachment paths retain their existing behaviour. See [implementation notes](../../docs/research-chat-grounding.md). Native EmbeddingGemma execution on Windows, Linux and macOS Intel remains pending.\n`);
console.log(JSON.stringify({ destination, executed: all.length, reviewed: summary.evaluation.reviewed, gatesPassed, cost: summary.cost.cumulativeCommittedUsd }));
