import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-summary-resilience-'));
const virtual = new Map([
  ['./aiClient', `
    export class AiError extends Error {
      constructor(message, retriable = false, config = false, code = null) { super(message); this.retriable = retriable; this.config = config; this.code = code; }
    }
    globalThis.__SummaryAiError = AiError;
    export const completeText = (...args) => globalThis.__summaryComplete(...args);
    export const embed = (...args) => globalThis.__summaryEmbed(...args);
  `],
  ['./prompts', `export const coreStructuredPrompt = () => 'summary-system';`],
  ['../db/database', `export const getDb = () => globalThis.__summaryDb;`],
  ['../db/settingsRepo', `export const getSettings = () => ({
    summaryModel: { provider: 'test', model: 'summary-model' }, synthesisModel: null,
    zoteroUserId: '0', zoteroStoragePath: '', unpaywallEmail: '', preferZoteroFulltext: true,
    ocrEnabled: false, ocrLanguages: ['eng'], ocrMaxPages: 1,
  });`],
  ['../db/worksRepo', `export const setSummaryResult = (...args) => globalThis.__summaryEvents.results.push(args);`],
  ['../zotero/zoteroClient', `export const getItem = async () => ({ abstract: 'A source abstract.' });`],
  ['../extraction/textExtractor', `export const resolveWorkText = async () => { throw new Error('text fallback should not run'); };`],
  ['../db/workSummariesRepo', `
    export const upsertWorkSummary = (input) => globalThis.__summaryEvents.upserts.push(input);
    export const updateWorkSummaryEmbedding = (...args) => globalThis.__summaryEvents.embeddings.push(args);
  `],
  ['../library/libraryVaultProvenance', `
    export const recordLinkedLibraryAnalysis = (input) => {
      globalThis.__summaryEvents.provenance.push(input);
      if (globalThis.__summaryProvenanceFails) throw new Error('provenance unavailable');
    };
  `],
  ['../db/libraryAnalysisProvenance', `
    export const analysisModelFingerprint = () => 'summary-model-fingerprint';
    export const isLocalAnalysisCurrent = () => globalThis.__summaryCurrent === true;
    export const recordLocalAnalysisProvenance = (input) => globalThis.__summaryEvents.localProvenance.push(input);
  `],
  ['@shared/localAiModels', `export const modelRefSupportsCapability = () => true;`],
  ['../perf', `export const startPerf = () => (result) => globalThis.__summaryEvents.perf.push(result);`],
]);

try {
  const output = path.join(scratch, 'summary-scan.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/summaryScan.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'summary-dependencies',
      setup(builder) {
        for (const specifier of virtual.keys()) {
          const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          builder.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({ path: specifier, namespace: 'summary-stub' }));
        }
        builder.onLoad({ filter: /.*/, namespace: 'summary-stub' }, ({ path: specifier }) => ({
          contents: virtual.get(specifier),
          loader: 'js',
        }));
      },
    }],
  });
  const scan = await import(pathToFileURL(output).href);
  const work = {
    nodus_id: 'work-1', title: 'A work', authors_json: '[]', year: 2026, item_type: 'article',
    zotero_key: 'Z1', doi: null, deep_hash: 'deep-hash', light_hash: 'light-hash',
    deep_status: 'done', summary_status: 'pending', summary_hash: null,
  };
  const freshEvents = () => ({ results: [], upserts: [], embeddings: [], provenance: [], localProvenance: [], perf: [], transactions: 0, completes: [] });
  globalThis.__summaryDb = {
    prepare: () => ({ all: () => [], get: () => globalThis.__summaryStored }),
    transaction: (operation) => () => {
      globalThis.__summaryEvents.transactions += 1;
      return operation();
    },
  };

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    // Reproduce Galant 2017: the chain marks the DB pending but still passes the
    // earlier done snapshot. Reusing its valid summary must settle the marker.
    const cachedWork = { ...work, summary_status: 'done', summary_hash: scan.summaryContentHash(work) };
    globalThis.__summaryCurrent = true;
    globalThis.__summaryStored = { exists: 1 };
    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new Error('A current summary must not call the provider'); };
    await scan.runSummaryScan(cachedWork);
    assert.deepEqual(globalThis.__summaryEvents.results, [[work.nodus_id, 'done', cachedWork.summary_hash]],
      'a cached return restores done after the chain set pending');
    assert.equal(globalThis.__summaryEvents.upserts.length, 0, 'reuse preserves the saved text');
    globalThis.__summaryEvents = freshEvents();
    await scan.runSummaryScan({ ...cachedWork, summary_status: 'pending' });
    assert.equal(globalThis.__summaryEvents.results[0][1], 'done', 'an orphan pending summary also recovers without inference');

    globalThis.__summaryStored = undefined;
    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => 'Recovered missing summary text.';
    globalThis.__summaryEmbed = async () => [1, 0];
    await scan.runSummaryScan(cachedWork);
    assert.equal(globalThis.__summaryEvents.upserts.length, 1, 'provenance without readable text cannot masquerade as a cached summary');
    globalThis.__summaryCurrent = false;

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => 'A committed orientation summary.';
    globalThis.__summaryEmbed = async () => { throw new Error('embedding runtime unavailable'); };
    globalThis.__summaryProvenanceFails = true;
    await scan.runSummaryScan(work);
    assert.equal(globalThis.__summaryEvents.results.length, 1);
    assert.equal(globalThis.__summaryEvents.results[0][1], 'done');
    assert.match(globalThis.__summaryEvents.results[0][2], /^[a-f0-9]{40}$/);
    assert.equal(globalThis.__summaryEvents.results.some((entry) => entry[1] === 'failed'), false,
      'an optional embedding/provenance failure cannot revoke a committed summary');
    assert.equal(globalThis.__summaryEvents.upserts.length, 1);
    assert.equal(globalThis.__summaryEvents.embeddings.length, 0);
    assert.equal(globalThis.__summaryEvents.transactions, 1, 'summary text and status publish atomically');
    assert.deepEqual(globalThis.__summaryEvents.perf.at(-1), { status: 'ok', embedding: 'deferred' });

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new Error('generation exploded'); };
    globalThis.__summaryEmbed = async () => [1, 0];
    globalThis.__summaryProvenanceFails = false;
    await assert.rejects(scan.runSummaryScan(work), /generation exploded/);
    assert.equal(globalThis.__summaryEvents.upserts.length, 0);
    assert.equal(globalThis.__summaryEvents.results[0][1], 'failed');
    assert.match(globalThis.__summaryEvents.results[0][2], /^[a-f0-9]{40}$/);
    assert.equal(globalThis.__summaryEvents.results[0][3], 'generation exploded',
      'the actual generation error is persisted for the status modal');

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new Error('refresh generation exploded'); };
    await assert.rejects(scan.runSummaryScan({ ...work, summary_status: 'done' }, undefined, { force: true }), /refresh generation exploded/);
    assert.equal(globalThis.__summaryEvents.results.length, 0,
      'a failed forced refresh preserves the previously committed summary and status');

    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async () => { throw new globalThis.__SummaryAiError('configuration missing', false, true); };
    await assert.rejects(scan.runSummaryScan(work), /configuration missing/);
    assert.equal(globalThis.__summaryEvents.results.length, 0,
      'a configuration pause remains pending so the queue can resume after settings are fixed');

    // A reasoning model spends the first output ceiling on its thinking trace and stops
    // mid-sentence. The summary must retry with the app's default ceiling instead of
    // storing the clipped text as a finished summary (issue #809).
    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async (opts) => {
      globalThis.__summaryEvents.completes.push(opts);
      if (globalThis.__summaryEvents.completes.length === 1) {
        throw new globalThis.__SummaryAiError('La respuesta se cortó al alcanzar el límite de 2.400 tokens de salida.', true, false, 'output_truncated');
      }
      return 'Un resumen completo tras ampliar el presupuesto.';
    };
    globalThis.__summaryEmbed = async () => [1, 0];
    globalThis.__summaryProvenanceFails = false;
    await scan.runSummaryScan(work);
    assert.deepEqual(
      globalThis.__summaryEvents.completes.map((opts) => opts.maxTokens),
      [2400, 8000],
      'a truncated summary is retried once with the app default ceiling',
    );
    assert.ok(
      globalThis.__summaryEvents.completes.every((opts) => opts.requireCompleteOutput === true),
      'every summary attempt opts into the complete-output contract',
    );
    assert.ok(
      globalThis.__summaryEvents.completes.every((opts) => opts.reasoning === 'off'),
      'a summary never inherits the chat reasoning setting',
    );
    assert.equal(globalThis.__summaryEvents.upserts[0].summary, 'Un resumen completo tras ampliar el presupuesto.');
    assert.equal(globalThis.__summaryEvents.results[0][1], 'done');

    // If the provider budget is genuinely too small, the reader must see a failure
    // instead of a silently stored half-sentence.
    globalThis.__summaryEvents = freshEvents();
    globalThis.__summaryComplete = async (opts) => {
      globalThis.__summaryEvents.completes.push(opts);
      throw new globalThis.__SummaryAiError('La respuesta se cortó al alcanzar el límite de 8.000 tokens de salida.', true, false, 'output_truncated');
    };
    await assert.rejects(scan.runSummaryScan(work), /se cortó/);
    assert.equal(globalThis.__summaryEvents.completes.length, 2, 'only one retry is attempted');
    assert.equal(globalThis.__summaryEvents.upserts.length, 0, 'a clipped summary is never stored as finished');
    assert.equal(globalThis.__summaryEvents.results[0][1], 'failed');
    assert.match(globalThis.__summaryEvents.results[0][3], /se cortó/);
  } finally {
    console.warn = originalWarn;
  }

  console.log('Summary scan resilience tests passed!');
} finally {
  delete globalThis.__summaryComplete;
  delete globalThis.__summaryEmbed;
  delete globalThis.__summaryDb;
  delete globalThis.__summaryEvents;
  delete globalThis.__summaryProvenanceFails;
  delete globalThis.__SummaryAiError;
  delete globalThis.__summaryCurrent;
  delete globalThis.__summaryStored;
  await rm(scratch, { recursive: true, force: true });
}
