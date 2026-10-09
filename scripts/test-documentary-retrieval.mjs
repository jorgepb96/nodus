import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

const reportArgument = process.argv.find(argument => argument.startsWith('--report='));
if (reportArgument) process.env.NODUS_DOCUMENTARY_RETRIEVAL_REPORT = reportArgument.slice('--report='.length);
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-retrieval-test')) process.exit(0);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-retrieval-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = (file) => require(path.join(repoRoot, file));
const { DocumentaryStore } = load('electron/db/documentaryStore.ts');
const noNetwork = () => { throw new Error('network access is forbidden in documentary retrieval fixtures'); };
globalThis.fetch = noNetwork;

const workerFile = path.join(root, 'documentaryRetrievalWorker.cjs');
const baselineWorkerFile = path.join(root, 'documentaryRetrievalWorker-baseline.cjs');
const sharedAliases = {
  name: 'repo-shared-imports',
  setup(api) {
    api.onResolve({ filter: /^@shared\// }, (args) => {
      const relative = args.path.slice('@shared/'.length);
      return { path: path.join(repoRoot, 'shared', path.extname(relative) ? relative : `${relative}.ts`) };
    });
  },
};
await build({
  entryPoints: [path.join(repoRoot, 'electron/workers/documentaryRetrievalWorker.ts')],
  outfile: workerFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3'],
  plugins: [sharedAliases],
});
// This frozen file is byte-for-byte the production worker at af66e85f. Keeping
// it in the checkout makes the paired comparison reproducible in shallow CI.
const baselineSource = fs.readFileSync(path.join(repoRoot, 'scripts/fixtures/documentary-retrieval-baseline-af66e85f.ts'), 'utf8');
assert.equal(createHash('sha256').update(baselineSource).digest('hex'),
  '3a4c41878b9f09f22182a828d81b293e57f5b579dc35376d5a88908d43072895',
  'historical worker fixture must retain its exact committed bytes');
await build({
  stdin: {
    contents: baselineSource,
    resolveDir: path.join(repoRoot, 'electron/workers'),
    sourcefile: 'documentaryRetrievalWorker.baseline.ts',
    loader: 'ts',
  },
  outfile: baselineWorkerFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3'],
  plugins: [sharedAliases],
});

const stores = [];
const comparisons = [];
function makeStore(label) {
  const store = new DocumentaryStore(path.join(root, `${label}.sqlite`));
  stores.push(store);
  return store;
}

let timestamp = 1_800_000_000_000;
function index(store, { documentId, revision = 'r1', attachmentId = 'source', chunks, vectors = null, dimensions = 2 }) {
  const identity = {
    coverage: 'fulltext', documentId, attachmentId, attachmentRevision: `${attachmentId}-bytes`, revision,
    textFingerprint: `${documentId}-${revision}-${attachmentId}`, chunkerVersion: 'fixture', processingVersion: 'fixture',
    embedding: vectors ? { provider: 'fixture', model: 'fixture-space', dimensions, metric: 'cosine', parameters: {} } : null,
  };
  const now = timestamp++;
  const key = store.enqueue(identity, {}, 0, now);
  const job = store.claim(now, 60000, key);
  assert.ok(job, `synthetic index ${key} is claimable`);
  store.saveChunks(job, chunks, now + 1);
  store.publishLexical(job, now + 2);
  if (vectors) store.publishEmbeddings(job, vectors, now + 3);
  else store.complete(job, now + 3);
  return key;
}

function settings(overrides = {}) {
  return {
    preset: 'custom', candidates: 20, passagesPerRound: 8, evidenceTokens: 4000,
    rounds: 1, autoExpand: false, threshold: { mode: 'automatic' }, ...overrides,
  };
}

function chunk(text, pageNumber = 1, sourceRef = 'fixture') {
  return { text, pageLabel: `p. ${pageNumber}`, pageNumber, sourceRef };
}

function runWorker(filename, input, selectedWorker = workerFile) {
  return new Promise((resolve, reject) => {
    const child = fork(selectedWorker, [], {
      cwd: repoRoot,
      env: { ...process.env, NODE_PATH: path.join(repoRoot, 'node_modules'), ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    let settled = false;
    let stderr = '';
    let response;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('documentary worker did not finish within 20 seconds'));
    }, 20_000);
    child.stderr?.on('data', (data) => { stderr += data; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error);
    });
    child.once('message', (message) => {
      if (settled) return;
      response = message;
      child.disconnect();
    });
    // Wait for actual process exit, including SQLite handles, before
    // resolving. Otherwise Windows may still lock the disposable database files.
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (code !== 0 || !response) reject(new Error(`documentary worker exited ${code} without a successful reply${stderr ? `: ${stderr}` : ''}`));
      else if (response.error) reject(new Error(response.error));
      else resolve(response);
    });
    child.send({ filename, ...input }, (error) => {
      if (error && !settled) {
        settled = true;
        clearTimeout(deadline);
        child.kill();
        reject(error);
      }
    });
  });
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function expansionMetrics(result, seedIds) {
  const expanded = result.passages.filter((passage) => !seedIds.has(passage.id));
  const works = new Set(expanded.map((passage) => passage.document_id));
  return { expandedPassages: expanded, expandedPassageCount: expanded.length, expandedWorkCount: works.size,
    expandedWorkIds: [...works].sort(), evidenceBytes: result.traversal.evidenceTokens };
}
async function runComparison(label, store, input, expected, fixture) {
  const [baseline, current] = await Promise.all([
    runWorker(store.db.name, input, baselineWorkerFile),
    runWorker(store.db.name, input, workerFile),
  ]);
  const measured = { ...expected(baseline, current), fixtureHash: digest({ fixture, input }) };
  comparisons.push({ label, ...measured });
  return { baseline, current, measured };
}

function evidenceBytes(result) {
  return result.passages.reduce((sum, passage) => sum + Buffer.byteLength(passage.text), 0);
}

try {
  // Each planned facet gets an independent real FTS ranking and contributes to one
  // lexical lane. Distinctive fixture tokens make this deterministic without a model.
  {
    const store = makeStore('facets');
    const key = index(store, {
      documentId: 'facet-work',
      chunks: [
        chunk('facetalphaquartz captures the first independent clause.'),
        chunk('facetbetaberyl captures the second independent clause.', 2),
        chunk('facetgammacobalt captures the third independent clause.', 3),
        chunk('facetdeltazinc captures the fourth independent clause.', 4),
      ],
    });
    const lexicalQueries = ['facetalphaquartz', 'facetbetaberyl', 'facetgammacobalt', 'facetdeltazinc'];
    const result = await runWorker(store.db.name, {
      query: 'goal phrase absent from fixture', lexicalQueries, lexicalKeys: [key], vectorKeys: [], vector: null,
      settings: settings({ passagesPerRound: 4 }), threshold: -1,
    });
    const byQuery = new Map(result.retrievalTrace.lexicalQueries.map((item) => [item.query, item.candidates]));
    for (const query of lexicalQueries) assert.equal(byQuery.get(query)?.length, 1, `${query} has its own FTS result`);
    assert.ok(result.retrievalTrace.lexicalQueries.length >= lexicalQueries.length, 'the goal query and four planned facets are independently traceable');
    assert.equal(new Set(result.passages.map((passage) => passage.text)).size, 4, 'all four lexical facets survive the merged lane');
    const comparison = await runComparison('planned-facets', store, {
      query: 'goal phrase absent from fixture', lexicalQueries, lexicalKeys: [key], vectorKeys: [], vector: null,
      settings: settings({ passagesPerRound: 4 }), threshold: -1,
    }, (baseline, current) => {
      const facetTokens = lexicalQueries;
      const baselineCoverage = facetTokens.filter(token => baseline.passages.some(passage => passage.text.includes(token))).length;
      const currentCoverage = facetTokens.filter(token => current.passages.some(passage => passage.text.includes(token))).length;
      const baselineIndependentProbes = baseline.retrievalTrace.lexicalQueries?.filter(item => facetTokens.includes(item.query)).length ?? 0;
      const currentIndependentProbes = current.retrievalTrace.lexicalQueries?.filter(item => facetTokens.includes(item.query)).length ?? 0;
      assert.equal(baselineCoverage, 0, 'baseline drops all planned facets when the goal query has no match');
      assert.equal(currentCoverage, 4, 'current worker returns evidence for all four planned facets');
      assert.equal(baselineIndependentProbes, 0, 'baseline worker has no independent facet FTS lanes');
      assert.equal(currentIndependentProbes, 4, 'current worker independently searches all four facets');
      return { plannedFacetCount: 4, baseline: { returnedFacetCoverage: baselineCoverage, independentFacetProbes: baselineIndependentProbes },
        current: { returnedFacetCoverage: currentCoverage, independentFacetProbes: currentIndependentProbes } };
    }, { chunks: [
      'facetalphaquartz captures the first independent clause.', 'facetbetaberyl captures the second independent clause.',
      'facetgammacobalt captures the third independent clause.', 'facetdeltazinc captures the fourth independent clause.',
    ] });
    assert.equal(comparison.measured.current.returnedFacetCoverage, 4);
  }

  // Semantic cosine scores are computed from deterministic fixture vectors and
  // both semantic and lexical reads honor the supplied index-key boundary.
  {
    const store = makeStore('scoped-cosine');
    const allowed = index(store, {
      documentId: 'allowed-work',
      chunks: [chunk('semanticaligned cobalt passage'), chunk('semanticorthogonal violet passage', 2)],
      vectors: [[1, 0], [0, 1]],
    });
    const foreignSameSpace = index(store, {
      documentId: 'foreign-work',
      chunks: [chunk('semanticforeign amber passage')],
      vectors: [[1, 0]],
    });
    const foreignDimension = index(store, {
      documentId: 'foreign-dimension-work',
      chunks: [chunk('semanticwrongdimension jade passage')],
      vectors: [[1, 0, 0]], dimensions: 3,
    });
    const result = await runWorker(store.db.name, {
      query: 'semantic query', lexicalQueries: ['lexicalnomatch'], lexicalKeys: [allowed],
      vectorKeys: [allowed], vector: [1, 0], settings: settings({ passagesPerRound: 8 }), threshold: 0.75,
    });
    assert.ok(result.retrievalTrace.semantic.some((hit) => hit.id.startsWith(`${allowed}:`)), 'matching cosine candidate is present');
    assert.ok(!result.passages.some((passage) => passage.id.startsWith(`${foreignSameSpace}:`)), 'same-dimension foreign index key is excluded');
    assert.ok(!result.passages.some((passage) => passage.id.startsWith(`${foreignDimension}:`)), 'foreign vector dimensions cannot match the query space');
    assert.ok(!result.passages.some((passage) => passage.text.includes('semanticorthogonal')), 'cosine threshold removes the orthogonal fixture');
    assert.ok(result.passages.some((passage) => passage.text.includes('semanticaligned')), 'cosine ranks the aligned fixture');
  }

  // Candidate count, passage count and UTF-8 evidence budget are all hard bounds.
  {
    const store = makeStore('budgets');
    const key = index(store, {
      documentId: 'budget-work',
      chunks: Array.from({ length: 5 }, (_, i) => chunk(`budgetmarker ${String(i)} ${'é'.repeat(90)}`, i + 1)),
    });
    const result = await runWorker(store.db.name, {
      query: 'budgetmarker', lexicalQueries: ['budgetmarker'], lexicalKeys: [key], vectorKeys: [], vector: null,
      settings: settings({ candidates: 3, passagesPerRound: 3, evidenceTokens: 256 }), threshold: -1,
    });
    assert.ok(result.retrievalTrace.lexical.length <= 3, 'FTS candidate limit is applied');
    assert.ok(result.passages.length <= 3, 'per-round passage limit is applied');
    assert.ok(evidenceBytes(result) <= 256, 'UTF-8 evidence bytes stay within budget');
    assert.equal(result.traversal.evidenceTokens, evidenceBytes(result), 'budget reports only unique returned evidence');
  }

  // Explicit page/context reads use their direct store queries and do not run
  // the query's broad lexical probes as an extra retrieval step.
  {
    const store = makeStore('direct-reads');
    const key = index(store, {
      documentId: 'read-work',
      chunks: [chunk('pageone marker first'), chunk('pagetwo marker second', 2), chunk('pagethree marker third', 3)],
    });
    const pages = await runWorker(store.db.name, {
      query: 'mustnotsearch', lexicalQueries: ['facetone', 'facettwo', 'facethree', 'facetfour'], lexicalKeys: [key], vectorKeys: [], vector: null,
      settings: settings(), threshold: -1, read: { kind: 'pages', from: 2, to: 2 },
    });
    assert.deepEqual(pages.retrievalTrace.lexicalQueries, [], 'page read does not execute planned FTS probes');
    assert.deepEqual(pages.passages.map((passage) => passage.id), [`${key}:1`]);
    const context = await runWorker(store.db.name, {
      query: 'mustnotsearch', lexicalQueries: ['facetone', 'facettwo'], lexicalKeys: [key], vectorKeys: [], vector: null,
      settings: settings(), threshold: -1, read: { kind: 'context', passageId: `${key}:1`, radius: 1 },
    });
    assert.deepEqual(context.retrievalTrace.lexicalQueries, [], 'context read does not execute planned FTS probes');
    assert.deepEqual(context.passages.map((passage) => passage.id), [`${key}:0`, `${key}:1`, `${key}:2`]);
  }

  // Different attachment aliases can produce the same neighbor text and locator.
  // It must be returned and charged once even though its stored passage IDs differ.
  {
    const store = makeStore('alias-dedup');
    const common = chunk('aliasneighbor same content and page locator', 2);
    const first = index(store, {
      documentId: 'alias-work', attachmentId: 'attachment-a',
      chunks: [chunk('aliasanchor alpha aliasquery', 1), common],
    });
    const second = index(store, {
      documentId: 'alias-work', attachmentId: 'attachment-b',
      chunks: [chunk('aliasanchor beta aliasquery', 1), common],
    });
    const result = await runWorker(store.db.name, {
      query: 'aliasquery', lexicalQueries: ['aliasquery'], lexicalKeys: [first, second], vectorKeys: [], vector: null,
      settings: settings({ candidates: 10, passagesPerRound: 2, evidenceTokens: 2000, rounds: 2, autoExpand: true }), threshold: -1,
    });
    const duplicateText = result.passages.filter((passage) => passage.text === common.text);
    assert.equal(duplicateText.length, 1, 'duplicate content across attachment keys is selected once');
    assert.equal(result.traversal.evidenceTokens, evidenceBytes(result), 'duplicate aliases are not charged twice');
    const input = {
      query: 'aliasquery', lexicalQueries: ['aliasquery'], lexicalKeys: [first, second], vectorKeys: [], vector: null,
      settings: settings({ candidates: 10, passagesPerRound: 2, evidenceTokens: 2000, rounds: 2, autoExpand: true }), threshold: -1,
    };
    const comparison = await runComparison('alias-neighbor-dedup', store, input, (baseline, current) => {
      const seedIds = new Set(baseline.retrievalTrace.lexical.map(hit => hit.id));
      const old = expansionMetrics(baseline, seedIds), fresh = expansionMetrics(current, seedIds);
      const baselineDuplicateCount = old.expandedPassages.filter(passage => passage.text === common.text).length;
      const currentDuplicateCount = fresh.expandedPassages.filter(passage => passage.text === common.text).length;
      assert.equal(baselineDuplicateCount, 2, 'baseline accepts both alias rows with distinct IDs');
      assert.equal(currentDuplicateCount, 1, 'current worker content-deduplicates the alias neighbor');
      assert.equal(old.evidenceBytes - fresh.evidenceBytes, Buffer.byteLength(common.text), 'dedup removes exactly one duplicate neighbor charge');
      return { duplicateText: common.text, baseline: { duplicateNeighborCount: baselineDuplicateCount, chargedEvidenceBytes: old.evidenceBytes },
        current: { duplicateNeighborCount: currentDuplicateCount, chargedEvidenceBytes: fresh.evidenceBytes } };
    }, { documentId: 'alias-work', chunks: [
      ['aliasanchor alpha aliasquery', 1, 'attachment-a'], [common.text, 2, 'attachment-a'],
      ['aliasanchor beta aliasquery', 1, 'attachment-b'], [common.text, 2, 'attachment-b'],
    ] });
    assert.equal(comparison.measured.current.duplicateNeighborCount, 1);
  }

  // Expansion spends one neighbor slot per selected anchor before a second
  // neighbor from the first anchor, even when both anchors have full queues.
  {
    const store = makeStore('fair-expansion');
    const a = index(store, {
      documentId: 'work-a',
      chunks: [chunk('a left context'), chunk('a seed fairanchor', 2), chunk('a right context', 3)],
    });
    const b = index(store, {
      documentId: 'work-b',
      chunks: [chunk('b left context'), chunk('b seed fairanchor', 2), chunk('b right context', 3)],
    });
    const result = await runWorker(store.db.name, {
      query: 'fairanchor', lexicalQueries: ['fairanchor'], lexicalKeys: [a, b], vectorKeys: [], vector: null,
      settings: settings({ candidates: 10, passagesPerRound: 2, evidenceTokens: 4000, rounds: 2, autoExpand: true }), threshold: -1,
    });
    const selectedById = new Map(result.passages.map((passage) => [passage.id, passage]));
    const neighbors = result.retrievalTrace.selected.filter((passage) => passage.expandedFrom);
    assert.equal(neighbors.length, 2, 'one expansion round fills its two passage slots');
    const origins = neighbors.flatMap((passage) => Array.isArray(passage.expandedFrom) ? passage.expandedFrom : [passage.expandedFrom]);
    assert.equal(new Set(origins).size, 2, 'both selected anchors contribute before either spends another slot');
    assert.deepEqual(new Set(neighbors.map((passage) => selectedById.get(passage.id).document_id)), new Set(['work-a', 'work-b']));
    const input = {
      query: 'fairanchor', lexicalQueries: ['fairanchor'], lexicalKeys: [a, b], vectorKeys: [], vector: null,
      settings: settings({ candidates: 10, passagesPerRound: 2, evidenceTokens: 4000, rounds: 2, autoExpand: true }), threshold: -1,
    };
    const comparison = await runComparison('fair-neighbor-expansion', store, input, (baseline, current) => {
      const seedIds = new Set(baseline.retrievalTrace.lexical.map(hit => hit.id));
      const old = expansionMetrics(baseline, seedIds), fresh = expansionMetrics(current, seedIds);
      assert.equal(old.expandedWorkCount, 1, 'baseline consumes both expansion slots on the first anchor');
      assert.equal(fresh.expandedWorkCount, 2, 'current worker gives each anchor one neighbor slot');
      return { baseline: { expandedPassageCount: old.expandedPassageCount, expandedWorkCount: old.expandedWorkCount, expandedWorkIds: old.expandedWorkIds },
        current: { expandedPassageCount: fresh.expandedPassageCount, expandedWorkCount: fresh.expandedWorkCount, expandedWorkIds: fresh.expandedWorkIds } };
    }, { workA: ['a left context', 'a seed fairanchor', 'a right context'], workB: ['b left context', 'b seed fairanchor', 'b right context'] });
    assert.equal(comparison.measured.current.expandedWorkCount, 2);
  }

  const reportPath = reportArgument?.slice('--report='.length) ?? process.env.NODUS_DOCUMENTARY_RETRIEVAL_REPORT;
  if (reportPath) {
    assert.ok(path.isAbsolute(reportPath), '--report must name an absolute path');
    const firstCpu = os.cpus()[0];
    const report = {
      measuredAt: new Date().toISOString(),
      baselineCommit: 'af66e85fd76554322980686a5b54d9c0adc57410',
      baselineSource: { path: 'scripts/fixtures/documentary-retrieval-baseline-af66e85f.ts',
        sha256: createHash('sha256').update(baselineSource).digest('hex') },
      currentSources: Object.fromEntries([
        'electron/workers/documentaryRetrievalWorker.ts', 'electron/db/documentaryRetrieval.ts',
        'electron/ai/documentaryPreparation.ts', 'electron/ai/researchCorpusRun.ts',
        'shared/researchRetrievalBudget.ts', 'shared/retrievalChunks.ts',
      ].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')])),
      comparisonMethod: 'Same temporary SQLite fixture database and same serialized input are run through the committed baseline worker and current worker; both are bundled from their actual TypeScript sources.',
      limits: ['Deterministic fixture vectors validate cosine mechanics and scope only; they do not measure embedding accuracy.', 'Lexical facets, expansion, deduplication and byte counts are synthetic regressions, not generative answer quality or representative-corpus recall.'],
      runtime: { platform: process.platform, arch: process.arch, release: os.release(), cpuModel: firstCpu?.model ?? null,
        logicalCpus: os.cpus().length, node: process.versions.node, electron: process.versions.electron ?? null, sqlite: process.versions.sqlite ?? null },
      comparisons,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log('Documentary retrieval worker: baseline regressions plus four lexical facets, local cosine and key scope, byte limits, direct reads, alias deduplication and fair expansion passed.');
} finally {
  for (const store of stores) { try { store.close(); } catch { /* cleanup continues */ } }
  fs.rmSync(root, { recursive: true, force: true });
}
