// Real Electron + production file workers, inside the proven Research OS sandbox.
// Optional PDF paths are copied into the disposable root before the app starts.
// No production profile, Zotero endpoint, provider key or external network is usable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchApp, waitFor, repoRoot } from './lib/research-app-harness.mjs';

const harness = await createResearchApp();
const { root } = harness;
console.log(`Isolated verification root: ${root}`);
const fixture = async (pages, name) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= pages; p++) {
    const page = pdf.addPage([595, 842]);
    for (let line = 0; line < 35; line++) page.drawText(`Page ${p}. Documentary evidence about travel, history and research. Line ${line}.`, { x: 40, y: 780 - line * 19, size: 10, font });
  }
  const file = path.join(root, 'fixtures', name);
  fs.writeFileSync(file, await pdf.save());
  return file;
};
const supplied = process.argv.slice(2);
assert.ok(supplied.length === 0 || supplied.length === 2, 'Supply either zero or two PDF paths');
const files = supplied.length ? supplied.map((file, index) => {
  const copy = path.join(root, 'fixtures', `selected-${index}.pdf`);
  fs.copyFileSync(path.resolve(file), copy, fs.constants.COPYFILE_EXCL);
  return copy;
}) : [await fixture(7, 'selected-7.pdf'), await fixture(37, 'selected-37.pdf')];
const small = await fixture(1, 'preparation.pdf');
// A test-only module exposes source functions for observation; all extraction
// children are the real Vite-built worker entries used by the desktop app.
const helper = path.join(root, 'helpers.mjs');
fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'));
const exports = [
  ['electron/extraction/textExtractor.ts', ['extractFromPath']],
  ['electron/extraction/fileTextExtraction.ts', ['extractFileText']],
  ['electron/extraction/textExtractionWorkerHost.ts', ['extractFileTextInWorker', 'disposeTextExtractionWorkers']],
  ['electron/library/libraryExtractionWorkerHost.ts', ['extractLibraryItemInWorker']],
  ['electron/library/libraryStorage.ts', ['LibraryDiskStore']],
  ['electron/ai/documentaryChunking.ts', ['documentaryChunks']],
  ['electron/db/database.ts', ['getDb']],
  ['electron/db/worksRepo.ts', ['upsertWork', 'getWork', 'setSummaryPending', 'setSummaryResult']],
  ['electron/db/workSummariesRepo.ts', ['upsertWorkSummary']],
  ['electron/db/settingsRepo.ts', ['getSettings']],
  ['electron/db/libraryAnalysisProvenance.ts', ['recordLocalAnalysisProvenance', 'analysisModelFingerprint']],
  ['electron/ai/summaryScan.ts', ['runSummaryScan', 'summaryContentHash']],
];
await build({ stdin: { contents: exports.map(([file, names]) => `export {${names.join(',')}} from ${JSON.stringify(path.join(repoRoot, file))};`).join('\n'), resolveDir: repoRoot },
  outfile: helper, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', alias: { '@shared': path.join(repoRoot, 'shared') },
  banner: { js: `import{createRequire as __qaRequire}from'node:module';const require=__qaRequire(import.meta.url);const __dirname=${JSON.stringify(path.join(repoRoot, 'dist-electron'))};const __filename=${JSON.stringify(path.join(repoRoot, 'dist-electron/qa.js'))};` } });

try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page, { academicInterfaceProfile: 'advanced', academicMode: 'auto', autoResumeQueue: false, ocrEnabled: false });
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of [`nodus.mobileTeaserSeen.${version}`, 'nodus.libraryTutorialSeen.v1', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'))).version);
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });
  console.log('Isolated app ready; measuring the original inline parsers.');
  await app.evaluate(async (_electron, url) => { const require = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:url').fileURLToPath(url)); globalThis.qa = require(process.getBuiltinModule('node:url').fileURLToPath(url)); globalThis.qa.getDb(); }, pathToFileURL(helper).href);
  const baseline = await app.evaluate(async (_electron, files) => {
    const gaps = []; let last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last - 10); last = now; }, 10);
    await new Promise(resolve => setTimeout(resolve, 30));
    const docs = await Promise.all(files.map(file => globalThis.qa.extractFileText(file, { declutter: true, schemeClassifier: 'layout-4', ocr: { enabled: false, languages: 'spa+eng', maxPages: 300 } })));
    await new Promise(resolve => setTimeout(resolve, 30)); clearInterval(timer);
    const { createHash } = process.getBuiltinModule('node:crypto');
    return { maxMainDelayMs: Math.round(Math.max(...gaps)), documents: docs.map(doc => ({ pages: doc.analysis.pageCount, chars: doc.text.length, hash: createHash('sha256').update(doc.text).digest('hex') })) };
  }, files);

  console.log(`Inline baseline: ${baseline.maxMainDelayMs} ms; running the mixed worker workload.`);
  // Prepare 32 metadata records outside the measurement, then run their actual
  // clean-document workers alongside the two idea-text parsers and chunking.
  await app.evaluate(async (_electron, { root, small, files }) => {
    const qa = globalThis.qa;
    const store = new qa.LibraryDiskStore(`${root}/library/cpu-fixture`, 'isolated-cpu-fixture');
    const { promises: fs } = process.getBuiltinModule('node:fs');
    const jobs = [];
    for (let i = 0; i < 32; i++) {
      const id = `preparation-${i}`; const folder = store.itemFolder(id);
      await fs.mkdir(folder, { recursive: true }); await fs.copyFile(small, `${folder}/source.pdf`);
      const item = store.upsertItem({ id, storageId: id, source: 'nodus', metadata: { title: id, itemType: 'document', creators: [] }, collectionIds: [],
        attachments: [{ id: `${id}-pdf`, title: 'PDF', fileName: 'source.pdf', relativePath: 'source.pdf', mimeType: 'application/pdf', byteSize: (await fs.stat(small)).size, role: 'original' }] });
      jobs.push({ item, store, extractionOptions: { ocrMode: 'off', extractImages: false, maxOcrPages: 0 } });
    }
    globalThis.qaJobs = jobs; globalThis.qaFiles = files;
  }, { root, small, files });
  await page.evaluate(() => { globalThis.qaRenderGaps = []; let last = performance.now(); globalThis.qaRenderTimer = setInterval(() => { const now = performance.now(); globalThis.qaRenderGaps.push(now - last - 10); last = now; }, 10); });
  await app.evaluate(({ utilityProcess }) => {
    const state = globalThis.qaRun = { active: 0, peak: 0, pids: [], done: false, gaps: [], errors: [] };
    const original = utilityProcess.fork.bind(utilityProcess);
    utilityProcess.fork = (...args) => {
      const child = original(...args);
      if (/Nodus (idea text extraction|document extraction|documentary chunking)/.test(args[2]?.serviceName)) {
        state.active++; state.peak = Math.max(state.peak, state.active);
        child.once('spawn', () => state.pids.push(child.pid)); child.once('exit', () => { state.active--; });
      }
      return child;
    };
    let last = performance.now(); const timer = setInterval(() => { const now = performance.now(); state.gaps.push(now - last - 10); last = now; }, 10);
    const qa = globalThis.qa;
    const reads = globalThis.qaFiles.map(file => qa.extractFromPath(file, { declutter: true, schemeClassifier: 'layout-4', ocr: { enabled: false, languages: 'spa+eng', maxPages: 300 } }));
    void Promise.all([...reads, ...globalThis.qaJobs.map(job => qa.extractLibraryItemInWorker(job)), qa.documentaryChunks('Isolated documentary chunking fixture. '.repeat(1000))]).then(async results => {
      const { createHash } = process.getBuiltinModule('node:crypto');
      state.documents = results.slice(0, 2).map(doc => ({ pages: doc.analysis.pageCount, chars: doc.text.length, hash: createHash('sha256').update(doc.text).digest('hex') }));
    }).catch(error => state.errors.push(String(error.stack ?? error))).finally(() => { clearInterval(timer); state.done = true; utilityProcess.fork = original; });
  });
  // Real renderer navigation while the local CPU work is active.
  await page.locator('[data-tour="nav-library"]').click();
  assert.equal(await waitFor(() => app.evaluate(() => globalThis.qaRun.done), { timeoutMs: 120_000, intervalMs: 250 }), true, 'mixed workload completes');
  const corrected = await app.evaluate(() => {
    const state = globalThis.qaRun;
    return { maxMainDelayMs: Math.round(Math.max(...state.gaps)), peakDocumentProcesses: state.peak, documentProcesses: state.pids.length, distinctWorkerPids: state.pids.every(pid => pid !== process.pid), documents: state.documents, errors: state.errors };
  });
  const renderer = await page.evaluate(() => { clearInterval(globalThis.qaRenderTimer); return { maxDelayMs: Math.round(Math.max(...globalThis.qaRenderGaps)) }; });
  assert.deepEqual(corrected.errors, []);
  assert.deepEqual(corrected.documents, baseline.documents, 'text, page counts and exact hashes match the original algorithms');
  assert.ok(corrected.peakDocumentProcesses <= 2, 'all document paths share the CPU budget');
  assert.ok(corrected.distinctWorkerPids && corrected.documentProcesses >= 34);
  assert.ok(corrected.maxMainDelayMs < 500, `main process blocked for ${corrected.maxMainDelayMs} ms`);

  console.log(`Mixed workers complete: ${corrected.maxMainDelayMs} ms main delay; peak ${corrected.peakDocumentProcesses} processes.`);
  const cancellation = await app.evaluate(async (_electron, { root, source }) => {
    const qa = globalThis.qa; const { promises: fs } = process.getBuiltinModule('node:fs');
    const file = `${root}/fixtures/cancel.pdf`; await fs.copyFile(source, file);
    const controller = new AbortController(); let error = null;
    try { await qa.extractFromPath(file, { signal: controller.signal, onProgress: () => controller.abort(), ocr: { enabled: false, languages: 'spa+eng', maxPages: 300 } }); }
    catch (failure) { error = failure.name; }
    const cached = qa.getDb().prepare('SELECT 1 FROM extraction_cache WHERE file_path=?').get(file);
    const saved = process.env.NODUS_TEXT_EXTRACTION_WORKER_FILE;
    process.env.NODUS_TEXT_EXTRACTION_WORKER_FILE = `${root}/absent-worker.js`;
    let missing = null;
    try { await qa.extractFileTextInWorker(file); } catch (failure) { missing = failure.message; }
    if (saved === undefined) delete process.env.NODUS_TEXT_EXTRACTION_WORKER_FILE; else process.env.NODUS_TEXT_EXTRACTION_WORKER_FILE = saved;
    return { error, cached: !!cached, missing };
  }, { root, source: files[1] });
  assert.equal(cancellation.error, 'AbortError'); assert.equal(cancellation.cached, false);
  assert.match(cancellation.missing, /unavailable/);

  const workId = 'isolated-galant-2017';
  await app.evaluate(async (_electron, workId) => {
    const qa = globalThis.qa;
    qa.upsertWork({ nodus_id: workId, zotero_key: 'TEST2017', zotero_version: 1, title: '2017 work — isolated summary recovery', authors: ['Fixture author'], year: 2017, item_type: 'journalArticle', doi: null, read_tag: false, zoteroTags: [] });
    qa.getDb().prepare("UPDATE works SET light_status='done',deep_status='done',deep_hash='fixture-deep',source_type='pdf' WHERE nodus_id=?").run(workId);
    const work = qa.getWork(workId); const hash = qa.summaryContentHash(work);
    qa.upsertWorkSummary({ nodusId: workId, summary: 'Saved fixture summary, preserved without a provider call.', sourceLevel: 'deep', model: null, contentHash: hash });
    qa.setSummaryResult(workId, 'done', hash);
    qa.recordLocalAnalysisProvenance({ workId, components: ['summary'], documentFingerprint: hash,
      modelFingerprints: { summary: qa.analysisModelFingerprint('summary', qa.getSettings()) } });
    const doneSnapshot = qa.getWork(workId);
    qa.setSummaryPending(workId); await qa.runSummaryScan(doneSnapshot);
    if (qa.getWork(workId).summary_status !== 'done') throw Error('Cached return left the summary pending');
    qa.setSummaryPending(workId); // The user's existing orphan, without any queue entry.
  }, workId);
  await page.reload();
  await page.locator('[data-tour="nav-library"]').click();
  const row = page.getByTestId(`vault-library-item-${workId}`); await row.waitFor();
  await row.locator('button').filter({ hasText: /Incompleto|Listo|Pendiente/ }).first().click();
  const retry = page.getByTestId('work-status-retry-summary'); await retry.waitFor();
  assert.equal(await retry.isEnabled(), true, 'the orphan summary offers recovery in the real status modal');
  await retry.click();
  assert.equal(await waitFor(() => app.evaluate((_electron, id) => globalThis.qa.getWork(id).summary_status === 'done', workId), { timeoutMs: 15_000, intervalMs: 100 }), true, 'the actual summary IPC and queue recover the orphan');
  const summary = await page.evaluate(id => window.nodus.getWorkSummary(id), workId);
  assert.equal(summary.summary, 'Saved fixture summary, preserved without a provider call.');
  await page.getByTestId('work-status-step-summary').getByText('Hecho', { exact: true }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(root, 'artifacts/summary-recovery.png') });
  const shutdown = await app.evaluate(async (_electron, file) => {
    globalThis.qa.disposeTextExtractionWorkers();
    try { await globalThis.qa.extractFileTextInWorker(file); return false; }
    catch (error) { return error.name === 'AbortError'; }
  }, files[0]);
  assert.equal(shutdown, true, 'shutdown prevents a waiting extraction from starting another process');
  const report = { isolation: harness.proof, baseline, corrected, renderer, cancellation, summaryRecoveredThroughUi: true, shutdownGuard: shutdown, externalNetworkPermitted: false };
  fs.writeFileSync(path.join(root, 'artifacts/responsiveness.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, ...report }, null, 2));
} catch (error) {
  if (harness.page) {
    await harness.page.screenshot({ path: path.join(root, 'artifacts/failure.png') }).catch(() => {});
    fs.writeFileSync(path.join(root, 'artifacts/failure.txt'), await harness.page.locator('body').innerText().catch(() => 'Page unavailable'));
  }
  throw error;
} finally { await harness.close(); }
