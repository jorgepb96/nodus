import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { createResearchApp, waitFor, reserveLoopbackPort } from './lib/research-app-harness.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';
import { prepareEmbeddingCorpus } from './embeddinggemma-corpus.mjs';
import { checkEmbeddingProductLifecycle } from './lib/embedding-product-lifecycle.mjs';
import { checkEmbeddingAcademicAnalysis } from './lib/embedding-academic-analysis.mjs';
import { auditProductRetrieval } from './lib/embedding-product-retrieval.mjs';
import { checkEmbeddingProductChat } from './lib/embedding-product-chat.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const modelId = argument('profile') ?? 'embeddinggemma-2-text-q8-512-v1';
const resumeRoot = argument('resume-root');
const live = !process.argv.includes('--no-chat');
const previousReport = resumeRoot ? JSON.parse(fs.readFileSync(path.join(resumeRoot, 'artifacts/product-report.json'), 'utf8')) : null;
const campaignRoot = argument('campaign-root') ?? previousReport?.campaignRoot ?? createResearchTestRoot();
if (previousReport) assert.equal(campaignRoot, previousReport.campaignRoot, 'resuming cannot reset the shared campaign budget');
const corpusRoot = argument('corpus-root') ?? createResearchTestRoot();
const modelsFile = path.join(campaignRoot, 'tmp/models.mjs');
await build({ entryPoints: ['shared/localAiModels.ts'], outfile: modelsFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { NODUS_LOCAL_MODELS } = await import(pathToFileURL(modelsFile));
assert(NODUS_LOCAL_MODELS.some(model => model.id === modelId && model.kind === 'embedding'));
if (!fs.existsSync(path.join(corpusRoot, 'artifacts/corpus-manifest.json'))) await prepareEmbeddingCorpus(corpusRoot);
const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'artifacts/corpus-manifest.json'), 'utf8'));

// An ephemeral byte-forwarding proxy permits downloads from their pinned origin
// while Electron remains denied every external endpoint. No weights are hosted.
const runtimeFile = path.join(campaignRoot, 'tmp/runtime.mjs');
await build({ entryPoints: ['shared/localAiRuntime.ts'], outfile: runtimeFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { runtimeAssetCatalog } = await import(pathToFileURL(runtimeFile));
const allowedAssets = new Set([...NODUS_LOCAL_MODELS.flatMap(model => model.assets.map(asset => asset.url)), ...Object.values(runtimeAssetCatalog()).flat().map(asset => asset.url)]);
const nonce = randomUUID(), transfers = [];
const assetProxy = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1'); const source = url.searchParams.get('url');
    if (request.method !== 'GET' || url.pathname !== `/${nonce}/asset` || !allowedAssets.has(source)) { response.writeHead(403).end(); return; }
    const controller = new AbortController(); response.once('close', () => { if (!response.writableFinished) controller.abort(); });
    const upstream = await fetch(source, { headers: request.headers.range ? { Range: request.headers.range } : {}, signal: controller.signal });
    transfers.push({ url: source, range: request.headers.range ?? null, status: upstream.status });
    response.writeHead(upstream.status, Object.fromEntries(['content-length', 'content-range', 'content-type', 'accept-ranges'].flatMap(key => upstream.headers.has(key) ? [[key, upstream.headers.get(key)]] : [])));
    for await (const chunk of upstream.body ?? []) {
      if (!response.write(chunk)) await new Promise(resolve => {
        const done = () => { response.removeListener('drain', done); response.removeListener('close', done); resolve(); };
        response.once('drain', done); response.once('close', done);
      });
      if (response.destroyed) break;
    }
    response.end();
  } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
});
await new Promise(resolve => assetProxy.listen(0, '127.0.0.1', resolve));
const assetPort = assetProxy.address().port, localPort = await reserveLoopbackPort();
const harness = await createResearchApp({ ...(live ? { realProvider: { campaignRoot, proxyOptions: { limitUsd: 5, allowedProviders: ['deepseek'] } } } : {}),
  root: resumeRoot,
  extraPorts: [assetPort, localPort], extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1', NODUS_LOCAL_AI_QA_ASSET_PROXY: `http://127.0.0.1:${assetPort}/${nonce}`, NODUS_LOCAL_AI_QA_PORT: String(localPort) } });
const report = resumeRoot ? JSON.parse(fs.readFileSync(path.join(harness.root, 'artifacts/product-report.json'), 'utf8'))
  : { format: 'nodus.embedding-product-e2e/1', root: harness.root, campaignRoot, profile: modelId, isolation: harness.proof,
    chatModel: 'deepseek-flash', completed: false, checks: {}, answers: [], pending: [], startedAt: new Date().toISOString() };
assert.equal(report.profile, modelId, 'a resumed profile cannot change its configuration');
if (resumeRoot) { report.attempts ??= []; report.attempts.push({ failure: report.failure, finishedAt: report.finishedAt, processExit: report.processExit });
  for (const key of ['failure', 'failureUi', 'failureScreenshot', 'processExit', 'runtimeErrors']) delete report[key]; report.completed = false; }
const artifacts = path.join(harness.root, 'artifacts');
const save = () => fs.writeFileSync(path.join(artifacts, 'product-report.json'), JSON.stringify(report, null, 2));
const shot = async name => { const file = path.join(artifacts, name + '.png'); await harness.page.screenshot({ path: file }); return file; };
let fatal;
const log = [];
try {
  if (live && !resumeRoot) report.credentials = await harness.importCredentials(undefined, ['deepseek']);
  await fsp.cp(path.join(corpusRoot, 'fixtures/corpus'), path.join(harness.root, 'fixtures/corpus'), { recursive: true });
  const tessdata = path.join(harness.root, 'cache/tessdata'); await fsp.mkdir(tessdata, { recursive: true });
  for (const language of ['eng', 'spa']) {
    const response = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${language}.traineddata`);
    if (!response.ok) throw new Error(`OCR resource unavailable: ${language}`);
    const data = Buffer.from(await response.arrayBuffer()); await fsp.writeFile(path.join(tessdata, `${language}.traineddata`), data);
    report.ocrResources ??= []; report.ocrResources.push({ language, source: `tesseract-ocr/tessdata_fast/4.1.0/${language}.traineddata`, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
  }
  const documents = manifest.documents.map(document => ({ ...document, file: path.join(harness.root, 'fixtures/corpus', path.basename(document.file)) }));
  fs.writeFileSync(path.join(artifacts, 'corpus-manifest.json'), JSON.stringify({ ...manifest, documents }, null, 2));
  await fsp.copyFile(path.join(corpusRoot, 'artifacts/queries-gold.json'), path.join(artifacts, 'queries-gold.json'));
  for (const document of documents) assert.equal(createHash('sha256').update(await fsp.readFile(document.file)).digest('hex'), document.sha256);
  const { app, page } = await harness.launch();
  app.process().once('exit', (code, signal) => { report.processExit = { code, signal, at: new Date().toISOString() }; save(); });
  page.setDefaultTimeout(60_000);
  app.process().stderr?.on('data', data => { log.push(String(data).slice(0, 4000)); if (log.length > 40) log.shift(); });
  app.process().stdout?.on('data', data => { const lines = String(data).split('\n').filter(line => line.includes('[qa-extraction]'));
    if (lines.length) { log.push(lines.join('\n')); report.extractionLifecycle = log.join('\n').split('\n').filter(line => line.includes('[qa-extraction]')).slice(-30); save(); } });
  page.on('pageerror', error => log.push(String(error)));
  const deepseek = { provider: 'deepseek', model: 'deepseek-flash' };
  await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: modelId, chatModel: deepseek,
    deepResearchModel: deepseek, summaryModel: deepseek, extractionModel: deepseek, synthesisModel: deepseek,
    fusionModel: deepseek, relationModel: deepseek, documentProfileModel: deepseek, documentAuditModel: deepseek,
    modelSettingsMode: 'advanced', chatReasoning: 'off', researchWebSearch: 'off', promptLanguage: 'es' });
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
  await page.reload();
  console.log(`Product profile: ${harness.root}`);

  // Download from the visible Settings card; cancel through the same app operation.
  if (!resumeRoot) {
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  const downloadModelId = modelId.startsWith('embeddinggemma') ? 'embeddinggemma-2-text-q8-512-v1' : modelId;
  const card = page.getByTestId(`local-model-${downloadModelId}`);
  await card.getByRole('button', { name: 'Descargar', exact: true }).click();
  assert(await waitFor(async () => {
    const status = await page.evaluate(() => window.nodus.getNodusLocalAiStatus());
    return status.models.some(model => model.downloading && model.downloadedBytes > 2 * 1024 * 1024 && !model.downloaded);
  }, { timeoutMs: 120000 }), 'cancel after bytes have actually reached the partial resource');
  await page.evaluate(() => window.nodus.cancelNodusLocalDownloads());
  await waitFor(async () => !(await page.evaluate(() => window.nodus.getNodusLocalAiStatus())).models.some(model => model.downloading), { timeoutMs: 30000 });
  await card.getByRole('button', { name: 'Descargar', exact: true }).click();
  const downloaded = await waitFor(async () => {
    const status = await page.evaluate(() => window.nodus.getNodusLocalAiStatus());
    return status.models.find(model => model.id === modelId)?.downloaded && status;
  }, { timeoutMs: 600000, intervalMs: 500 });
  assert(downloaded, 'model download completed');
  if (modelId.startsWith('embeddinggemma')) {
    const family = downloaded.models.filter(model => model.id.startsWith('embeddinggemma'));
    assert(family.every(model => model.downloaded)); assert.equal(family[0].path, family[1].path);
    report.checks.sharedDownload = true;
  }
  report.checks.downloadCancelResume = { transfers: transfers.length, resumed: transfers.some(transfer => transfer.range), paths: downloaded.models.filter(model => model.downloaded).map(model => model.path) };
  assert(report.checks.downloadCancelResume.resumed, 'resume must make an HTTP range request');
  if (modelId.startsWith('embeddinggemma')) {
    const definition = NODUS_LOCAL_MODELS.find(model => model.id === modelId), folder = downloaded.models.find(model => model.id === modelId).path;
    const hashes = [];
    for (const asset of definition.assets) {
      const buffer = await fsp.readFile(path.join(folder, asset.file));
      const actual = createHash('sha256').update(buffer).digest('hex'); assert.equal(actual, asset.sha256); hashes.push({ file: asset.file, sha256: actual, bytes: buffer.length });
    }
    const config = path.join(folder, 'config.json'), original = await fsp.readFile(config);
    const corrupt = Buffer.from(original); corrupt[0] ^= 1; await fsp.writeFile(config, corrupt);
    assert((await page.evaluate(() => window.nodus.getNodusLocalAiStatus())).models.filter(model => model.id.startsWith('embeddinggemma')).every(model => !model.downloaded));
    await fsp.writeFile(config, original);
    const tokenizer = path.join(folder, 'tokenizer.json'); await fsp.rename(tokenizer, tokenizer + '.qa-incomplete');
    assert((await page.evaluate(() => window.nodus.getNodusLocalAiStatus())).models.filter(model => model.id.startsWith('embeddinggemma')).every(model => !model.downloaded));
    await fsp.rename(tokenizer + '.qa-incomplete', tokenizer);
    assert((await page.evaluate(() => window.nodus.getNodusLocalAiStatus())).models.find(model => model.id === modelId).downloaded);
    report.checks.resourceIntegrity = { hashes, corruptRejected: true, incompleteRejected: true };
  }
  report.checks.downloadScreenshot = await shot('01-models'); save();
  }

  if (modelId.startsWith('embeddinggemma') && !report.checks.uiProfileSelection) {
    await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
    await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
    const alternate = modelId.includes('-512-') ? 'embeddinggemma-2-text-q8-256-v1' : 'embeddinggemma-2-text-q8-512-v1';
    for (const selected of [alternate, modelId]) {
      await page.getByTestId('embedding-model-input').fill(selected);
      await page.getByTestId('embedding-model-input').press('Tab');
      await page.getByRole('button', { name: 'Cambiar modelo', exact: true }).click();
      assert(await waitFor(async () => (await page.evaluate(() => window.nodus.getSettings())).embeddingModel === selected, { timeoutMs: 30000 }));
    }
    report.checks.uiProfileSelection = [alternate, modelId]; save();
  }

  // Both vaults are created here from an empty profile. No registry is copied.
  const vaults = report.vaults ?? await page.evaluate(async ({ modelId, deepseek }) => {
    const result = [];
    for (const mode of ['manual', 'auto']) {
      const { vault } = await window.nodus.createVault({ name: `QA ${mode} ${modelId}`, type: 'academic', aiModel: deepseek, embeddingProvider: 'nodus', embeddingModel: modelId });
      await window.nodus.switchVault(vault.id);
      await window.nodus.updateSettings({ academicMode: mode });
      await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined', futureAdditions: false });
      await window.nodus.updateSettings({ onboardingComplete: true, embeddingProvider: 'nodus', embeddingModel: modelId,
        autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false,
        chatModel: deepseek, chatReasoning: 'off', researchWebSearch: 'off', promptLanguage: 'es', basicsTutorialVersion: 99, recoverySetupVersion: 999,
        tourComplete: true, advancedTourComplete: true, mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true });
      result.push({ id: vault.id, mode });
    }
    return result;
  }, { modelId, deepseek });
  report.vaults = vaults;
  await page.reload();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.getByTestId('library-scope-global').click();
  await page.getByTestId('global-library-view').waitFor();
  await page.evaluate(async () => window.nodus.setGlobalLibrarySettings({ ...await window.nodus.getGlobalLibrarySettings(), autoPrepareAttachments: false }));
  const existingItems = (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100 }))).items;
  if (existingItems.length < 40) {
  await app.evaluate(({ dialog }, files) => { globalThis.qaOriginalPicker = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, documents.map(document => document.file));
  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('add-library-files').click();
  }
  const items = await waitFor(async () => {
    const listed = (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100 }))).items;
    if (listed.length < 40) return false;
    const records = await page.evaluate(ids => Promise.all(ids.map(id => window.nodus.getGlobalLibraryItem(id))), listed.map(item => item.id));
    const corpusItems = records.filter(item => item && item.attachments.some(attachment => documents.some(document => document.sha256 === attachment.sha256)));
    return corpusItems.length === 40 && corpusItems;
  }, { timeoutMs: 300000, intervalMs: 1000 });
  if (existingItems.length < 40) await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.qaOriginalPicker; delete globalThis.qaOriginalPicker; });
  assert(items, 'all forty documents imported through Library');
  assert(documents.every(document => items.some(item => item.attachments.some(attachment => attachment.sha256 === document.sha256))), 'imported original bytes match the campaign manifest');
  await page.evaluate(async ids => {
    await window.nodus.setResearchPreparationPaused(true);
    await window.nodus.cancelResearchDocuments(ids);
    for (const job of await window.nodus.listLibraryExtractionJobs()) if (ids.includes(job.itemId) && ['queued', 'processing'].includes(job.status)
      && (!job.options.localOcrOnly || job.options.extractImages)) await window.nodus.cancelLibraryExtraction(job.id);
  }, items.map(item => item.id));
  report.checks.importedFormats = Object.fromEntries([...new Set(documents.map(document => document.format))].map(format => [format, documents.filter(document => document.format === format).length]));
  report.checks.libraryScreenshot = await shot('02-imported'); save();
  const collection = await page.evaluate(async ({ ids, vaults }) => {
    const collection = await window.nodus.createGlobalLibraryCollection('Embedding QA corpus', null);
    await window.nodus.patchGlobalLibraryItemCollections(ids, { add: [collection.id] });
    for (const vault of vaults) await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
    return collection;
  }, { ids: items.map(item => item.id), vaults });
  const createNotebooks = async () => page.evaluate(async collection => {
    const dynamic = await window.nodus.saveResearchNotebook({ name: 'QA dynamic', mode: 'linked', sources: [{ kind: 'library-collection', id: collection.id }], exclusions: [] });
    const fixed = await window.nodus.saveResearchNotebook({ name: 'QA fixed', mode: 'fixed', sources: [{ kind: 'library-collection', id: collection.id }], exclusions: [] });
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'accepted', futureAdditions: true });
    return { dynamic, fixed };
  }, collection);
  // Scanned originals first pass through Library's real local OCR pipeline.
  // Documentary preparation deliberately refuses to invent text for a scan.
  await page.evaluate(ids => window.nodus.enqueueLibraryExtraction(ids, { ocrMode: 'local', ocrLanguages: 'spa+eng', localOcrOnly: true,
    extractImages: false, detectTables: true, force: false }), items.map(item => item.id));
  const extracted = await waitFor(async () => {
    const jobs = await page.evaluate(() => window.nodus.listLibraryExtractionJobs());
    const relevant = items.map(item => jobs.filter(job => job.itemId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]).filter(Boolean);
    report.extractionJobs = relevant; save();
    report.extractionLifecycle = log.join('\n').split('\n').filter(line => line.includes('[qa-extraction]')).slice(-30);
    if (relevant.some(job => job.status === 'failed')) throw new Error(`Extraction failed before embeddings: ${JSON.stringify(relevant.filter(job => job.status === 'failed').map(job => ({ itemId: job.itemId, error: job.error })))}`);
    return relevant.length >= 40 && relevant.every(job => job.status === 'done') && relevant;
  }, { timeoutMs: 900000, intervalMs: 1000 });
  assert(extracted, 'all formats extracted and OCR completed');
  await page.evaluate(() => window.nodus.setResearchPreparationPaused(false));
  const notebooks = await createNotebooks(); report.notebooks = notebooks;
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), items.map(item => item.id));
  const preparation = await waitFor(async () => {
    const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    const relevant = inventory.documents.filter(document => items.some(item => item.id === document.id));
    report.preparation = relevant.map(document => ({ id: document.id, title: document.title, preparation: document.preparation })); save();
    const failures = relevant.filter(document => document.preparation.reason || document.preparation.embeddings === 'failed');
    if (failures.length) report.extractionFailures = failures;
    return relevant.length === 40 && relevant.every(document => document.preparation.lexical === 'ready' && document.preparation.embeddings === 'ready') && inventory;
  }, { timeoutMs: 2700000, intervalMs: 1000 });
  assert(preparation, 'all sources have text, locators and compatible embeddings before quality evaluation');
  report.checks.prepared = true; save();
  const search = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Which device uses green light to detect cloudiness in water?'), notebooks.dynamic.id);
  assert(search.evidence.some(evidence => /Alba|530/.test(evidence.text)), 'cross-language paraphrase recovered after adding');
  const traceFile = path.join(harness.root, 'profile/embedding-trace.jsonl');
  const traces = fs.readFileSync(traceFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert(traces.some(trace => trace.retrieval?.semantic?.length), 'semantic candidates actually participated');
  report.checks.semanticRecovery = { evidence: search.evidence, trace: traces.at(-1) };
  if (!report.checks.productRetrieval) await auditProductRetrieval(harness, report, documents, items, save);
  if (!report.checks.localOffline) await checkEmbeddingProductLifecycle(harness, report, save);
  if (!report.checks.academicAnalysis) await checkEmbeddingAcademicAnalysis(harness, report, save, live);

  if (live) await checkEmbeddingProductChat(harness, report, save, shot);
  else report.pending.push('Live Research Chat and factual grounding');
  // Exclusion revokes direct citation access, then restart keeps the semantic index.
  const excluded = search.evidence[0];
  const receipt = `documentary:${search.scopeId}:${excluded.id}`;
  await page.evaluate(async ({ notebook, documentId }) => window.nodus.saveResearchNotebook({ ...notebook, exclusions: [documentId] }), { notebook: notebooks.dynamic, documentId: excluded.documentId });
  assert.equal(await page.evaluate(id => window.nodus.getPassage(id), receipt), null);
  report.checks.exclusionRevocation = true;
  await harness.closeApp(); await harness.launch();
  assert((await harness.page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.some(document => document.preparation.embeddings === 'ready'));
  report.checks.restartPersistence = true;
  const audit = fs.readFileSync(path.join(harness.root, 'profile/database-access.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(audit.every(row => row.path.startsWith(path.join(harness.root, 'profile') + path.sep)));
  report.checks.databaseIsolation = { opens: audit.length, allContained: true };
  report.pending.push('Manual factual-grounding review', 'Packaged/native Windows, Linux and Intel Mac');
  report.completed = true;
} catch (error) { fatal = error; report.failure = { message: error.message, stack: error.stack };
  report.runtimeErrors = log.join('\n').split('\n').filter(line => !/authorization|api.?key|providerKeys|secret/i.test(line)).map(line => line.replace(/sk-[\w-]+/g, '[redacted]')).slice(-40);
  report.processExit ??= { code: harness.app?.process().exitCode, signal: harness.app?.process().signalCode };
  if (harness.page) { report.failureScreenshot = await shot('failure').catch(() => null); report.failureUi = await harness.page.locator('body').innerText().catch(() => ''); }
}
finally {
  report.finishedAt = new Date().toISOString(); report.transfers = transfers;
  if (harness.proxy) report.cost = harness.proxy.ledger.read(); save();
  await harness.close(); assetProxy.closeAllConnections(); await new Promise(resolve => assetProxy.close(resolve));
  console.log(`Product report: ${artifacts}/product-report.json`);
}
if (fatal) throw fatal;
