import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const unique = values => [...new Set(values)];
function scores(ranked, relevant) {
  const ranks = ranked.map((id, index) => relevant.includes(id) ? index + 1 : 0).filter(Boolean);
  const ideal = Array.from({ length: Math.min(10, relevant.length) }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
  return { recall5: ranks.filter(rank => rank <= 5).length / relevant.length, recall10: ranks.filter(rank => rank <= 10).length / relevant.length,
    mrr10: ranks[0] <= 10 ? 1 / ranks[0] : 0, ndcg10: ranks.filter(rank => rank <= 10).reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0) / ideal };
}
function aggregate(rows) {
  const heldout = rows.filter(row => row.split === 'evaluation' && row.metrics);
  return { queries: heldout.length, ...Object.fromEntries(['recall5', 'recall10', 'mrr10', 'ndcg10'].map(metric => [metric, heldout.length ? heldout.reduce((sum, row) => sum + row.metrics[metric], 0) / heldout.length : null])) };
}
/** Gold stays in the preparer/report process; only plain questions cross IPC. */
export async function auditProductRetrieval(harness, report, documents, items, save) {
  const gold = JSON.parse(fs.readFileSync(path.join(harness.root, 'artifacts/queries-gold.json'), 'utf8'));
  const map = new Map(documents.map(document => [items.find(item => item.attachments.some(attachment => attachment.sha256 === document.sha256)).id, document]));
  const settings = { preset: 'custom', candidates: 60, passagesPerRound: 12, evidenceTokens: 8000, rounds: 1, autoExpand: false, threshold: { mode: 'automatic' } };
  const scopes = {};
  for (const language of [null, ...unique(gold.map(query => query.filterLanguage).filter(Boolean))]) {
    const ids = [...map].filter(([, document]) => !language || document.language === language).map(([id]) => id);
    scopes[language ?? 'all'] = await harness.page.evaluate(({ ids, settings, name }) => window.nodus.saveResearchNotebook({ name, mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), settings, exclusions: [] }), { ids, settings, name: `QA product retrieval ${language ?? 'all'}` });
  }
  const traceFile = path.join(harness.root, 'profile/embedding-trace.jsonl'), rows = [], latencies = [], memory = [];
  const file = path.join(harness.root, 'artifacts/product-retrieval.json');
  const update = () => fs.writeFileSync(file, JSON.stringify({ profile: report.profile, settings, rows, latencies, memory, completed: rows.length === gold.length * 3,
    note: 'Actual extracted/OCR text and native notebook retrieval. Multiple passages are ranked once per document; controlled excerpt metrics are a separate lane.' }, null, 2));
  for (const query of gold) {
    const startOffset = fs.statSync(traceFile).size, began = performance.now();
    const result = await harness.page.evaluate(({ id, question }) => window.nodus.searchResearchNotebook(id, question), { id: scopes[query.filterLanguage ?? 'all'].id, question: query.question });
    latencies.push({ queryId: query.id, elapsedMs: performance.now() - began });
    const traces = fs.readFileSync(traceFile).subarray(startOffset).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const trace = traces.filter(trace => trace.type === 'documentary-retrieval' && trace.query === query.question).at(-1);
    assert(trace, 'product retrieval leaves a provenance trace'); assert.equal(trace.profile.model, report.profile);
    for (const [lane, candidates] of [['semantic', trace.retrieval.semantic], ['lexical', trace.retrieval.lexical], ['hybrid', trace.retrieval.selected]]) {
      const ranked = unique(candidates.map(candidate => map.get(candidate.documentId)?.id).filter(Boolean));
      rows.push({ ...query, lane, ranked, metrics: query.relevant.length ? scores(ranked, query.relevant) : null,
        ...(lane === 'hybrid' ? { partial: result.partial, evidence: result.evidence.map(evidence => ({ id: evidence.id, documentId: evidence.documentId, locator: evidence.locator })) } : {}) });
    }
    if (latencies.length % 10 === 0) { memory.push(await harness.app.evaluate(({ app }) => ({ at: Date.now(), processes: app.getAppMetrics().map(metric => ({ type: metric.type, pid: metric.pid, memory: metric.memory })) }))); update(); }
  }
  const metrics = Object.fromEntries(['semantic', 'lexical', 'hybrid'].map(lane => {
    const selected = rows.filter(row => row.lane === lane);
    return [lane, { metrics: aggregate(selected), byLanguage: Object.fromEntries(unique(selected.map(row => row.language)).map(language => [language, aggregate(selected.filter(row => row.language === language))])),
      byDifficulty: Object.fromEntries(unique(selected.map(row => row.kind)).map(kind => [kind, aggregate(selected.filter(row => row.kind === kind))])),
      byFormat: Object.fromEntries(unique(documents.map(document => document.format)).map(format => [format, aggregate(selected.filter(row => row.relevant.some(id => documents.find(document => document.id === id)?.format === format)))])) }];
  }));
  update(); const values = latencies.map(row => row.elapsedMs).sort((a, b) => a - b);
  report.checks.productRetrieval = { file, metrics, queries: gold.length, p50Ms: values[Math.ceil(values.length * .5) - 1], p95Ms: values[Math.ceil(values.length * .95) - 1],
    indexedChunks: report.preparation.reduce((sum, document) => sum + document.preparation.passages, 0), memory,
    limitation: 'This 40-document corpus is not the separate 10,000-generated-chunk Desktop performance gate.' }; save();
}
