import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createResearchApp, waitFor } from './lib/research-app-harness.mjs';
import { researchTestEnvironment } from './research-isolation.mjs';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv.includes('--install-fixture')) {
  const root = fs.realpathSync(argument('root')), marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  assert.equal(marker.root, root); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
  installRuntimeHooks(path.join(root, 'profile'));
  const require = createRequire(import.meta.url), { DocumentaryStore } = require(path.join(repoRoot, 'electron/db/documentaryStore.ts'));
  const store = new DocumentaryStore(path.join(root, 'profile/documentary/store.sqlite'));
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/desktop-capacity-fixture.json'), 'utf8'));
  assert([256, 512].includes(fixture.dimensions));
  const buffer = fs.readFileSync(path.join(root, `artifacts/capacity-${fixture.count}.f32`));
  const array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  assert.equal(array.length, fixture.count * fixture.dimensions);
  const vectors = Array.from({ length: fixture.count }, (_, index) => Array.from(array.subarray(index * fixture.dimensions, (index + 1) * fixture.dimensions)));
  assert(vectors.every(vector => Math.abs(Math.hypot(...vector) - 1) < 1e-5));
  const previous = JSON.parse(store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE embedding_ready=1 LIMIT 1').get().identity_json);
  assert.equal(previous.embedding?.model, fixture.profile, 'capacity vectors must match the seeded profile');
  assert.equal(previous.embedding.dimensions, fixture.dimensions);
  store.removeDocument(fixture.document.id); store.setPreference('paused', false);
  const text = fixture.texts.join('\n\n'), identity = { ...previous, documentId: fixture.document.id, revision: fixture.document.revision,
    textFingerprint: createHash('sha256').update(text).digest('hex'), processingVersion: 'qa-fixed-capacity-chunks/1' };
  const key = store.enqueue(identity, {}), job = store.claim(Date.now(), 600000, key); assert(job);
  store.saveExtraction(job, text);
  store.saveChunks(job, fixture.texts.map((text, index) => ({ text, pageLabel: `QA record ${index}`, pageNumber: null, sourceRef: `qa-capacity:${index}` })));
  store.publishLexical(job); store.publishEmbeddings(job, vectors); store.publishDocument(fixture.document, [key]);
  store.setPreference('paused', true); store.close();
  const { env, AutoTokenizer } = await import('@nodus/embeddinggemma-transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false;
  const directory = path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1'); env.cacheDir = directory;
  const tokenizer = await AutoTokenizer.from_pretrained(directory, { local_files_only: true });
  const { prepareEmbeddingGemma2Input } = require(path.join(repoRoot, 'shared/embeddingGemma2.ts'));
  const queryTokenCounts = fixture.questions.map(question => tokenizer(prepareEmbeddingGemma2Input(question, 'query'), { truncation: false, padding: false }).input_ids.dims.at(-1));
  assert(queryTokenCounts.every(count => count <= 128), 'capacity queries include their prefix and special tokens within 128');
  fs.writeFileSync(path.join(root, 'artifacts/capacity-query-tokens.json'), JSON.stringify(queryTokenCounts));
  process.exit(0);
}

const source = fs.realpathSync(argument('capacity-root') ?? '');
const marker = JSON.parse(fs.readFileSync(path.join(source, 'isolation.json'), 'utf8'));
assert.equal(marker.root, source); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
const model = JSON.parse(fs.readFileSync(path.join(source, 'artifacts/model-manifest.json'), 'utf8'));
const modelDirectory = fs.realpathSync(model.directory);
assert(modelDirectory.startsWith(source + path.sep), 'weights must belong to the isolated capacity root');
assert(['embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1'].includes(model.testedProfile));
assert.equal(model.dimensions, Number(model.testedProfile.match(/-(256|512)-/)[1]));
const texts = fs.readFileSync(path.join(source, 'artifacts/capacity-texts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const counts = [1000, 10000].filter(count => fs.existsSync(path.join(source, `artifacts/capacity-${count}.f32`)));
assert(counts.length, 'First run native capacity with --persist-capacity');
const harness = await createResearchApp({ extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1' } });
const report = { format: 'nodus.embedding-desktop-capacity/1', profile: model.testedProfile, root: harness.root, source, isolation: harness.proof, counts: [],
  contention: argument('contention') ?? 'not-specified',
  note: 'Capacity only: real ONNX vectors are loaded into the production store with explicit QA chunks; extraction and quality are evaluated in the product corpus lane. RSS can fall under memory compression; per-process peaks are also recorded and must not be treated as concurrent resident totals.' };
try {
  const target = path.join(harness.root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
  fs.cpSync(modelDirectory, target, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  let { app, page } = await harness.launch();
  await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: model.testedProfile });
  const item = await page.evaluate(() => window.nodus.createGlobalLibraryItem({ title: 'none', itemType: 'report', creators: [], abstract: 'QA seed record for the capacity store.' }, []));
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'QA capacity', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), item.id);
  assert(await waitFor(async () => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === item.id)?.preparation.embeddings === 'ready', { timeoutMs: 120000 }));
  for (const count of counts) {
    const questions = Array.from({ length: 21 }, (_, round) => `Which device detects water cloudiness using visible green light? Explain its calibration requirement. QA request ${round}.`);
    await page.evaluate(() => window.nodus.setResearchPreparationPaused(true));
    await page.evaluate(({ id, text }) => window.nodus.updateGlobalLibraryItemMetadata(id, { abstract: text }), { id: item.id, text: texts.slice(0, count).join('\n\n') });
    const document = (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === item.id);
    await harness.closeApp();
    fs.copyFileSync(path.join(source, `artifacts/capacity-${count}.f32`), path.join(harness.root, `artifacts/capacity-${count}.f32`));
    fs.writeFileSync(path.join(harness.root, 'artifacts/desktop-capacity-fixture.json'), JSON.stringify({ document, count, dimensions: model.dimensions, profile: model.testedProfile, texts: texts.slice(0, count), questions }));
    const installed = spawnSync(path.join(harness.root, 'electron-isolated'), [fileURLToPath(import.meta.url), '--install-fixture', `--root=${harness.root}`],
      { env: { ...researchTestEnvironment(harness.root), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    ({ app, page } = await harness.launch());
    const baseline = await app.evaluate(({ app }) => app.getAppMetrics());
    const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    assert.equal(inventory.documents.find(document => document.id === item.id).preparation.passages, count);
    const queryTokenCounts = JSON.parse(fs.readFileSync(path.join(harness.root, 'artifacts/capacity-query-tokens.json'), 'utf8'));
    const timings = [], frames = [], memorySamples = []; let coldMs;
    for (let round = 0; round < 21; round++) {
      const question = questions[round];
      const started = performance.now();
      const result = await page.evaluate(async ({ id, question }) => {
        const intervals = []; let running = true, previous = performance.now();
        const frame = now => { intervals.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
        try { return { hit: await window.nodus.searchResearchNotebook(id, question), intervals }; } finally { running = false; }
      }, { id: notebook.id, question });
      assert(result.hit.evidence.length); const elapsed = performance.now() - started;
      if (!round) coldMs = elapsed; else timings.push(elapsed); frames.push(...result.intervals);
      memorySamples.push(await app.evaluate(async ({ app }) => ({ processes: app.getAppMetrics(), main: await process.getProcessMemoryInfo(), maximumMainRssKiB: process.resourceUsage().maxRSS })));
    }
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics()), totalRss = rows => rows.reduce((sum, row) => sum + row.memory.workingSetSize, 0);
    const sorted = [...timings].sort((a, b) => a - b), trace = fs.readFileSync(path.join(harness.root, 'profile/embedding-trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(trace => trace.type === 'documentary-retrieval').at(-1);
    assert(trace.retrieval.semantic.length, 'the measured native query uses semantic candidates');
    report.counts.push({ count, coldMs, timings, questions, queryTokenCounts, p50Ms: sorted[9], p95Ms: sorted[18], maximumFrameGapMs: Math.max(...frames), baseline, metrics,
      fullAppRssKiB: totalRss(metrics), runtimeRssGrowthKiB: totalRss(metrics) - totalRss(baseline), trace,
      memorySamples, maximumSampledFullAppRssKiB: Math.max(...memorySamples.map(sample => totalRss(sample.processes))),
      upperBoundSumProcessPeaksKiB: metrics.reduce((sum, row) => sum + row.memory.peakWorkingSetSize, 0),
      sqliteBytes: fs.statSync(path.join(harness.root, 'profile/documentary/store.sqlite')).size });
    fs.writeFileSync(path.join(harness.root, 'artifacts/desktop-capacity.json'), JSON.stringify(report, null, 2));
  }
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { await harness.close(); fs.writeFileSync(path.join(harness.root, 'artifacts/desktop-capacity.json'), JSON.stringify(report, null, 2)); console.log(`Desktop capacity: ${harness.root}/artifacts/desktop-capacity.json`); }
