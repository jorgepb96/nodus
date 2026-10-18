/** Resume the isolated 40-document preparation and 80-case retrieval campaign.
 * Default behavior is read-only preflight. A real run requires --run and two
 * explicit root gates after the native worker build has been reviewed. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createResearchApp } from './lib/research-app-harness.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error(`Research recovery requires Node 24+ before any run state is created; received ${process.versions.node}.`);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const PROFILE_ID = 'embeddinggemma-2-text-q8-512-v1';
const PLACEHOLDER = { provider: 'custom', model: 'nodus-campaign-no-generation' };
const BUILD_GATE = 'I_CONFIRM_NATIVE_ONNX_RECOVERY_BUILD';
const RUN_GATE = 'I_CONFIRM_ISOLATED_RESEARCH_RECOVERY';
const runtimeSourceFiles = ['shared/localAiModels.ts', 'shared/researchCorpus.ts', 'shared/libraryTypes.ts',
  'shared/retrievalChunks.ts', 'shared/embeddingGemma2.ts', 'shared/embeddingContract.ts',
  'electron/ai/researchAssistant.ts', 'electron/ai/documentaryPreparation.ts', 'electron/ai/nodusLocalAi.ts',
  'electron/ai/researchCorpusScope.ts', 'electron/db/documentaryStore.ts', 'electron/db/documentaryRetrieval.ts',
  'electron/workers/documentaryRetrievalWorker.ts', 'electron/workers/embeddingGemma2Worker.ts',
  'electron/library/libraryExtractionWorkerHost.ts', 'electron/library/libraryOperations.ts',
  'electron/library/libraryExtractionEngine.ts', 'electron/ai/documentaryExtraction.ts', 'electron/bootstrap.ts',
  'electron/extraction/textExtractor.ts', 'electron/extraction/pdfjsLoader.ts', 'electron/extraction/ocr.ts',
  'electron/ipc/platform.ts', 'electron/ipc/researchAttachments.ts',
  'scripts/research-live-evidence-campaign.mjs', 'scripts/research-live-evidence-recover.mjs',
  'scripts/lib/research-app-harness.mjs', 'scripts/research-isolation.mjs'];

function safeRead(file, maxBytes = 1024 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Unsafe QA input: ${file}`);
  return fs.readFileSync(file);
}
function markedRoot(root) {
  const resolved = fs.realpathSync(root);
  const stat = fs.lstatSync(path.join(resolved, 'isolation.json'));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing canonical isolation marker: ${root}`);
  const marker = JSON.parse(fs.readFileSync(path.join(resolved, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== resolved
      || resolved === path.parse(resolved).root) throw new Error(`Invalid marked QA root: ${root}`);
  return resolved;
}
function hashFile(file) { return digest(safeRead(file)); }
function sourceSnapshot() {
  const walk = root => {
    const absolute = path.join(repoRoot, root);
    if (!fs.existsSync(absolute)) return [];
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
      const relative = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(relative);
      return /\.(?:ts|tsx|js|cjs|mjs)$/u.test(entry.name) ? [relative] : [];
    });
  };
  const files = [...new Set([...runtimeSourceFiles, ...walk('electron'), ...walk('shared'), ...walk('scripts')])].sort();
  return Object.fromEntries(files.map(file => [file, hashFile(path.join(repoRoot, file))]));
}
function generatedFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name), absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return generatedFiles(absolute, relative);
    return /\.(?:js|cjs|mjs)$/u.test(entry.name) ? [relative] : [];
  });
}
function buildSnapshot() {
  const files = [...generatedFiles(path.join(repoRoot, 'dist-electron'), 'dist-electron'),
    ...generatedFiles(path.join(repoRoot, 'dist/assets'), 'dist/assets'), 'dist/index.html'];
  return Object.fromEntries(files.map(file => [file, fs.existsSync(path.join(repoRoot, file))
    ? hashFile(path.join(repoRoot, file)) : null]));
}
function assertInside(root, file) {
  const resolved = fs.realpathSync(file);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`QA path escaped isolated root: ${file}`);
  return resolved;
}
function exactCounts(values, expected, label) {
  if (JSON.stringify(values) !== JSON.stringify(expected)) throw new Error(`${label} mismatch: ${JSON.stringify(values)}`);
}

function preflight(rootInput) {
  if (!rootInput) throw new Error('Usage: node scripts/research-live-evidence-recover.mjs --root=/private/tmp/nodus-research-qlKmuM [--run]');
  const root = markedRoot(rootInput);
  const campaignFile = path.join(root, 'artifacts/campaign.json');
  const preregFile = path.join(root, 'artifacts/preregistration.json');
  const sourceFile = path.join(root, 'artifacts/source-manifest.json');
  const ocrFile = path.join(root, 'artifacts/ocr-resources.json');
  const campaign = JSON.parse(safeRead(campaignFile).toString('utf8'));
  const prereg = JSON.parse(safeRead(preregFile).toString('utf8'));
  const sourceManifest = JSON.parse(safeRead(sourceFile).toString('utf8'));
  const ocr = JSON.parse(safeRead(ocrFile).toString('utf8'));
  if (campaign.campaignRoot !== root || campaign.profileId !== PROFILE_ID || campaign.status !== 'blocked') {
    throw new Error('Expected the original blocked qlKmuM Q8-512 campaign report; refusing a different profile.');
  }
  if (campaign.modelCalls !== 0 || campaign.retrievalCompleted || campaign.cases) throw new Error('The previous attempt has unexpected retrieval or generation activity.');
  if (campaign.failure?.message !== 'page.evaluate: Target page, context or browser has been closed') {
    throw new Error('Previous attempt failure does not match the reviewed isolated Electron crash.');
  }
  if (campaign.importedDocuments?.length !== 40 || campaign.extraction?.length !== 40
      || campaign.extraction.some(row => row.status !== 'done')) throw new Error('Expected all 40 original imported files to have completed extraction.');
  const prepCounts = campaign.preparation?.reduce((counts, row) => {
    const status = row.preparation?.status ?? 'unknown'; counts[status] = (counts[status] ?? 0) + 1; return counts;
  }, {}) ?? {};
  exactCounts(prepCounts, { ready: 21, queued: 19 }, 'Preserved first-attempt preparation counts');
  if (!campaign.notebook?.id || campaign.notebook.mode !== 'fixed' || campaign.notebook.sources?.length !== 40) {
    throw new Error('The original fixed notebook does not contain the 40 imported library sources.');
  }
  const current = campaign.selectedProfile?.settings;
  if (current?.embeddingProvider !== 'nodus' || current?.embeddingModel !== PROFILE_ID
      || current?.chatModel?.provider !== PLACEHOLDER.provider || current?.chatModel?.model !== PLACEHOLDER.model
      || current?.synthesisModel?.provider !== PLACEHOLDER.provider || current?.synthesisModel?.model !== PLACEHOLDER.model) {
    throw new Error('The isolated profile no longer has the reviewed Q8-512/no-generation model selection.');
  }
  const localModel = campaign.selectedProfile?.localAi?.models?.find(row => row.id === PROFILE_ID);
  if (!localModel?.downloaded || localModel.downloadedBytes !== localModel.totalBytes) throw new Error('The copied Q8-512 asset catalog proof is incomplete.');

  const keyFile = path.join(root, 'fixtures/empty-provider-keys.json');
  if (safeRead(keyFile, 1024).toString('utf8') !== '{}\n') throw new Error('Harness key file is not the literal empty object.');
  if (prereg.format !== 'nodus.research-live-evidence-preregistration/1' || prereg.counts?.total !== 80
      || prereg.queries?.length !== 80 || Object.keys(prereg.annotationGold ?? {}).length !== 80) {
    throw new Error('The saved 80-query preregistration or separate gold annotations are incomplete.');
  }
  if (prereg.queries.some(query => Object.hasOwn(query, 'annotationGold') || Object.hasOwn(query, 'expected')
      || Object.hasOwn(query, 'sourceIds') || Object.hasOwn(query, 'goldExpected'))) {
    throw new Error('Gold or expected evidence leaked into the fixed query records.');
  }
  const caseIds = prereg.queries.map(query => query.id);
  if (new Set(caseIds).size !== 80 || caseIds.some((id, index) => id !== `R${String(index + 1).padStart(3, '0')}`)) {
    throw new Error('Preregistered case order is not the frozen R001–R080 cohort.');
  }
  const kinds = prereg.queries.map(query => query.kind);
  exactCounts({ complex: kinds.slice(0, 10).filter(kind => kind.startsWith('complex-') || kind === 'historical-complex').length,
    hard: kinds.slice(10, 20).filter(kind => kind === 'hard-negative').length,
    core: kinds.slice(20, 60).filter(kind => ['monolingual', 'cross-language'].includes(kind)).length,
    absence: kinds.slice(60).filter(kind => kind === 'no-evidence').length },
  { complex: 10, hard: 10, core: 40, absence: 20 }, 'Preregistered cohort blocks');
  exactCounts(prereg.languageQuotas, { de: 5, en: 8, es: 8, fr: 6, it: 5, pt: 8 }, 'Language quotas');

  const sourceRoot = markedRoot(sourceManifest.corpusRoot);
  const canonicalCorpusFixtures = fs.realpathSync(path.join(sourceRoot, 'fixtures'));
  if (campaign.corpusRoot !== sourceRoot || sourceManifest.documents?.length !== 40) throw new Error('Corpus source root or document inventory does not match the original campaign.');
  const originalCorpusManifest = JSON.parse(safeRead(path.join(sourceRoot, 'artifacts/corpus-manifest.json')).toString('utf8'));
  if (originalCorpusManifest.documents?.length !== 40) throw new Error('Original marked corpus manifest is not the verified 40-document corpus.');
  const corpusById = new Map(originalCorpusManifest.documents.map(row => [row.id, row]));
  const existingById = new Map(sourceManifest.documents.map(row => [row.id, row]));
  const importedBySource = new Map(campaign.importedDocuments.map(row => [row.id, row]));
  if (corpusById.size !== 40 || existingById.size !== 40 || importedBySource.size !== 40) throw new Error('Duplicate or missing source document IDs.');
  const campaignFixtureDir = path.join(root, 'fixtures/corpus');
  const campaignFixtureStat = fs.lstatSync(campaignFixtureDir);
  if (!campaignFixtureStat.isDirectory() || campaignFixtureStat.isSymbolicLink()) throw new Error('Campaign fixture directory is not a regular isolated directory.');
  const canonicalCampaignFixtures = assertInside(root, campaignFixtureDir);
  for (const [id, corpusDoc] of corpusById) {
    const savedDoc = existingById.get(id), importedDoc = importedBySource.get(id);
    const originalPath = path.resolve(corpusDoc.file);
    const originalStat = fs.lstatSync(originalPath);
    if (!originalStat.isFile() || originalStat.isSymbolicLink()) throw new Error(`Original source is not a regular fixture: ${id}`);
    const canonicalOriginal = fs.realpathSync(originalPath);
    if (!canonicalOriginal.startsWith(`${canonicalCorpusFixtures}${path.sep}`)) throw new Error(`Original source fixture escapes marked corpus root: ${id}`);
    if (hashFile(canonicalOriginal) !== corpusDoc.sha256 || savedDoc?.sha256 !== corpusDoc.sha256
        || importedDoc?.sha256 !== corpusDoc.sha256 || importedDoc?.title !== savedDoc.title) {
      throw new Error(`Original source SHA/title binding mismatch: ${id}`);
    }
    const copiedPath = path.join(root, 'fixtures/corpus', path.basename(originalPath));
    const copiedStat = fs.lstatSync(copiedPath);
    if (!copiedStat.isFile() || copiedStat.isSymbolicLink()
        || !fs.realpathSync(copiedPath).startsWith(`${canonicalCampaignFixtures}${path.sep}`)
        || hashFile(copiedPath) !== corpusDoc.sha256) throw new Error(`Campaign source copy SHA mismatch: ${id}`);
  }
  const itemIds = campaign.importedDocuments.map(row => row.libraryItemId);
  if (new Set(itemIds).size !== 40 || campaign.notebook.sources.map(row => row.id).sort().join('\n') !== [...itemIds].sort().join('\n')) {
    throw new Error('Original notebook source ids do not equal the 40 imported Library item IDs.');
  }

  if (ocr.root !== root || ocr.resources?.length !== 6 || ocr.cachePath !== path.join(root, 'cache/tessdata')) throw new Error('Pinned OCR resource manifest is missing or from another root.');
  for (const item of ocr.resources) {
    if (fs.lstatSync(item.path).isSymbolicLink()) throw new Error(`OCR cache entry must not be a symlink: ${item.language}`);
    const file = assertInside(root, item.path);
    if (hashFile(file) !== item.sha256 || fs.statSync(file).size !== item.bytes) throw new Error(`Pinned OCR file mismatch: ${item.language}`);
  }
  if (!campaign.assetProof?.available || campaign.assetProof.modelId !== PROFILE_ID || campaign.assetProof.verified?.length !== 5) {
    throw new Error('The original five-file Q8-512 cache copy proof is missing.');
  }
  const assetSourceRoot = markedRoot(campaign.assetProof.sourceRoot);
  const assetManifest = JSON.parse(safeRead(path.join(assetSourceRoot, 'artifacts/model-manifest.json')).toString('utf8'));
  if (assetManifest.testedProfile !== PROFILE_ID || assetManifest.dimensions !== 512
      || assertInside(assetSourceRoot, assetManifest.directory) !== fs.realpathSync(assetManifest.directory)
      || assetManifest.assets?.length !== 5) throw new Error('Original owned QA source no longer certifies the exact Q8-512 profile.');
  const manifestAssetByName = new Map(assetManifest.assets.map(row => [row.file, row]));
  for (const item of campaign.assetProof.verified) {
    if (fs.lstatSync(item.target).isSymbolicLink() || fs.lstatSync(item.source).isSymbolicLink()) throw new Error(`Q8-512 asset must not be a symlink: ${item.file}`);
    assertInside(assetSourceRoot, item.source);
    const manifestAsset = manifestAssetByName.get(item.file);
    if (!manifestAsset || manifestAsset.sha256 !== item.sha256 || hashFile(item.source) !== item.sha256
        || fs.statSync(item.source).size !== manifestAsset.bytes) throw new Error(`Owned QA source asset changed: ${item.file}`);
    const file = assertInside(root, item.target);
    if (hashFile(file) !== item.sha256 || item.sha256.length !== 64) throw new Error(`Q8-512 asset mismatch: ${item.file}`);
  }
  const lock = path.join(root, 'profile/isolated-instance.lock');
  const lockInfo = fs.existsSync(lock) ? { present: true, pid: Number(fs.readFileSync(lock, 'utf8').trim()) } : { present: false, pid: null };
  const inputs = { campaign: hashFile(campaignFile), preregistration: hashFile(preregFile), sourceManifest: hashFile(sourceFile),
    ocrManifest: hashFile(ocrFile), emptyKeys: hashFile(keyFile), originalCorpusManifest: hashFile(path.join(sourceRoot, 'artifacts/corpus-manifest.json')) };
  return { root, sourceRoot, campaign, prereg, sourceManifest, ocr, prepCounts, itemIds, inputs, lockInfo };
}

function nextAttempt(root) {
  const names = fs.readdirSync(path.join(root, 'artifacts'));
  const ids = names.map(name => /^recovery-(\d{3})-/u.exec(name)?.[1]).filter(Boolean).map(Number);
  return `recovery-${String(Math.max(0, ...ids) + 1).padStart(3, '0')}`;
}

const appendJsonl = (file, row) => { try { fs.appendFileSync(file, `${JSON.stringify({ at: now(), ...row })}\n`, { mode: 0o600 }); } catch {} };
function processTreeSample(rootPid) {
  if (!rootPid) return { processes: [], rssKb: null, cpuPercent: null };
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,%cpu='], { encoding: 'utf8' });
  if (result.status !== 0) return { processes: [], rssKb: null, cpuPercent: null };
  const rows = result.stdout.trim().split(/\r?\n/u).map(line => line.trim().split(/\s+/u).map(Number))
    .filter(row => row.length >= 4 && row.slice(0, 4).every(Number.isFinite))
    .map(([pid, ppid, rssKb, cpuPercent]) => ({ pid, ppid, rssKb, cpuPercent }));
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (included.has(row.ppid) && !included.has(row.pid)) { included.add(row.pid); changed = true; } }
  const processes = rows.filter(row => included.has(row.pid));
  return { processes, rssKb: processes.reduce((sum, row) => sum + row.rssKb, 0),
    cpuPercent: processes.reduce((sum, row) => sum + row.cpuPercent, 0) };
}
async function runRecovery(preflightData) {
  const { root, sourceRoot, campaign, prereg, itemIds } = preflightData;
  const attempt = nextAttempt(root);
  const artifacts = path.join(root, 'artifacts');
  const reservationFile = path.join(artifacts, `${attempt}-reservation.json`);
  fs.writeFileSync(reservationFile, `${JSON.stringify({ attempt, startedAt: now(), coordinatorPid: process.pid })}\n`, { mode: 0o600, flag: 'wx' });
  const progressFile = path.join(artifacts, `${attempt}-progress.json`);
  const reportFile = path.join(artifacts, `${attempt}-report.json`);
  const partialCasesFile = path.join(artifacts, `${attempt}-case-sources.partial.json`);
  const caseSourcesFile = path.join(artifacts, `${attempt}-case-sources.json`);
  const eventsFile = path.join(artifacts, `${attempt}-electron-events.jsonl`);
  const stdoutFile = path.join(artifacts, `${attempt}-electron-stdout.log`);
  const stderrFile = path.join(artifacts, `${attempt}-electron-stderr.log`);
  const report = { format: 'nodus.research-live-evidence-recovery/1', attempt, campaignRoot: root, profileRoot: root,
    corpusRoot: sourceRoot, profileId: PROFILE_ID, startedAt: now(), status: 'preparing', modelCalls: 0,
    oldCampaignReportSha256: preflightData.inputs.campaign, preregistrationSha256: preflightData.inputs.preregistration,
    originalCorpusManifestSha256: preflightData.inputs.originalCorpusManifest,
    runtimeSourceBefore: sourceSnapshot(), buildArtifactsBefore: buildSnapshot(),
    restrictions: { providers: 'none; documentary retrieval and passage resolution only',
      externalNetwork: 'denied by inherited macOS sandbox', zotero: 'disposable unreachable endpoint',
      safeStorage: 'literal empty harness keys file', sourceGoldSeparation: 'gold annotation object is excluded from all runtime calls' } };
  report.harnessSha256 = hashFile(path.join(repoRoot, 'scripts/research-live-evidence-recover.mjs'));
  let app = null, activePage = null, stage = 'launch', stageCounters = {}, timer = null;
  let isolationProof = null;
  const childPipes = { stdout: false, stderr: false };
  const stageSet = (value, counters = stageCounters) => { stage = value; stageCounters = counters;
    appendJsonl(eventsFile, { event: 'stage', stage, counters: stageCounters }); };
  const updateNetworkAudit = () => {
    report.networkAudit = { rendererHttpRequests, loopback: rendererHttpRequests.filter(row => row.route === 'loopback'),
      external: rendererHttpRequests.filter(row => row.route === 'external'), providerModelCalls: 0,
      loopbackAllowedPorts: isolationProof?.allowedLoopbackPorts ?? [], isolationProof,
      coverage: 'Renderer HTTP(S) requests; external outbound connections denied by inherited macOS sandbox.' };
  };
  const writeReport = async () => {
    updateNetworkAudit();
    await fsp.writeFile(progressFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  };
  const runtimeProvenance = () => ({ sourceVersionBeforeSha256: digest(JSON.stringify(report.runtimeSourceBefore)),
    buildArtifactsBeforeSha256: digest(JSON.stringify(report.buildArtifactsBefore)), harnessSha256: report.harnessSha256 ?? null,
    electronPid: report.electronPid ?? null, electronEventsFile: eventsFile, electronStdoutFile: stdoutFile,
    electronStderrFile: stderrFile, processPipes: childPipes, isolationProof,
    embeddingModelId: PROFILE_ID, embeddingContractSha256: report.embeddingContract ? digest(JSON.stringify(report.embeddingContract.embeddingModelContract)) : null,
    generationProvider: 'custom placeholder; no generation invocation', modelCalls: 0,
    vectorParity: { verified: false, requiresRootVerification: true,
      note: 'Root must compare numeric vectors against the prior compatible Q8-512 baseline before treating the runtime architecture as parity-validated.' } });
  const saveAtomic = async (file, value) => {
    const temp = `${file}.tmp-${process.pid}`;
    await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fsp.rename(temp, file);
  };
  let rendererHttpRequests = [];
  try {
    await writeReport();
    const emptyKeysFile = path.join(root, 'fixtures/empty-provider-keys.json');
    const { build } = await import('esbuild');
    const contractModule = path.join(root, 'profile/tmp/recovery-embedding-contract.mjs');
    await fsp.mkdir(path.dirname(contractModule), { recursive: true, mode: 0o700 });
    await build({ entryPoints: [path.join(repoRoot, 'shared/embeddingGemma2.ts')], outfile: contractModule,
      bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    const { embeddingGemma2Contract } = await import(`${pathToFileURL(contractModule).href}?attempt=${Date.now()}`);
    const canonicalModelContract = embeddingGemma2Contract(PROFILE_ID);
    const harness = await createResearchApp({ root, extraEnv: { NODUS_HARNESS_KEYS_FILE: emptyKeysFile,
      NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_NO_EXTERNAL_SERVICES: '1', NODUS_EMBEDDING_QA_TRACE: '1' } });
    isolationProof = harness.proof;
    try {
      stageSet('launch');
      const launched = await harness.launch(); app = launched.app; activePage = launched.page;
      const child = app.process?.();
      report.electronPid = child?.pid ?? null;
      if (!child) throw new Error('Playwright did not expose the Electron process handle; durable exit observability is unavailable.');
      childPipes.stdout = Boolean(child.stdout); childPipes.stderr = Boolean(child.stderr);
      child.stdout?.on('data', chunk => { try { fs.appendFileSync(stdoutFile, chunk, { mode: 0o600 }); } catch {} });
      child.stderr?.on('data', chunk => { try { fs.appendFileSync(stderrFile, chunk, { mode: 0o600 }); } catch {} });
      child.on('exit', (code, signal) => appendJsonl(eventsFile, { event: 'electron-exit', pid: child.pid, code, signal, stage }));
      child.on('close', (code, signal) => appendJsonl(eventsFile, { event: 'electron-close', pid: child.pid, code, signal, stage }));
      appendJsonl(eventsFile, { event: 'electron-attached', pid: child.pid, stdoutAvailable: childPipes.stdout, stderrAvailable: childPipes.stderr });
      activePage.on('crash', error => appendJsonl(eventsFile, { event: 'page-crash', message: String(error) }));
      activePage.on('close', () => appendJsonl(eventsFile, { event: 'page-close', stage }));
      activePage.on('pageerror', error => appendJsonl(eventsFile, { event: 'page-error', message: String(error).slice(0, 1000), stage }));
      await app.evaluate(({ app: electronApp, BrowserWindow }, target) => {
        const fs = process.getBuiltinModule('node:fs');
        const append = row => { try { fs.appendFileSync(target, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, { mode: 0o600 }); } catch {} };
        const attach = win => {
          const contents = win.webContents;
          append({ event: 'window-attached', webContentsId: contents.id });
          contents.on('render-process-gone', (_event, details) => append({ event: 'render-process-gone', webContentsId: contents.id,
            reason: details?.reason ?? null, exitCode: details?.exitCode ?? null }));
          contents.on('destroyed', () => append({ event: 'webcontents-destroyed', webContentsId: contents.id }));
          win.on('closed', () => append({ event: 'window-closed', webContentsId: contents.id }));
        };
        for (const win of BrowserWindow.getAllWindows()) attach(win);
        electronApp.on('browser-window-created', (_event, win) => attach(win));
        append({ event: 'main-observer-attached', pid: process.pid });
      }, eventsFile);
      timer = setInterval(() => {
        appendJsonl(eventsFile, { event: 'runtime-sample', pid: child.pid, stage, counters: stageCounters, ...processTreeSample(child.pid) });
      }, 10_000);
      timer.unref?.();
      activePage.setDefaultTimeout(60_000);
      await activePage.getByTestId('app-shell').waitFor();
      const externalNetwork = [];
      activePage.on('request', request => {
        const rawUrl = request.url(); if (!/^https?:/iu.test(rawUrl)) return;
        let parsed; try { parsed = new URL(rawUrl); } catch { return; }
        const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
        externalNetwork.push({ at: now(), method: request.method(), url: rawUrl, route: loopback ? 'loopback' : 'external', state: 'requested' });
      });
      activePage.on('requestfailed', request => {
        const row = externalNetwork.findLast(item => item.url === request.url() && item.state === 'requested');
        if (row) { row.state = 'failed'; row.failure = request.failure()?.errorText ?? null; }
      });
      activePage.on('requestfinished', request => {
        const row = externalNetwork.findLast(item => item.url === request.url() && item.state === 'requested');
        if (row) row.state = 'finished';
      });
      rendererHttpRequests = externalNetwork;

      stageSet('settings-verification');
      const actualSettings = await activePage.evaluate(() => window.nodus.getSettings());
      if (actualSettings.embeddingProvider !== 'nodus' || actualSettings.embeddingModel !== PROFILE_ID
          || actualSettings.chatModel?.model !== PLACEHOLDER.model || actualSettings.synthesisModel?.model !== PLACEHOLDER.model) {
        throw new Error('Isolated recovery profile settings changed since the reviewed campaign.');
      }
      report.profileSettings = { embeddingProvider: actualSettings.embeddingProvider, embeddingModel: actualSettings.embeddingModel,
        chatModel: actualSettings.chatModel, synthesisModel: actualSettings.synthesisModel };
      const liveModel = await activePage.evaluate(id => window.nodus.getNodusLocalAiStatus().then(status => status.models.find(model => model.id === id)), PROFILE_ID);
      if (!liveModel?.downloaded || liveModel.downloadedBytes !== liveModel.totalBytes) throw new Error('Live Q8-512 assets did not verify in the preserved isolated profile.');
      report.localEmbeddingAssets = { id: liveModel.id, downloaded: liveModel.downloaded,
        downloadedBytes: liveModel.downloadedBytes, totalBytes: liveModel.totalBytes };

      stageSet('original-library-item-sha-verification');
      const importedRows = campaign.importedDocuments;
      const liveItems = await activePage.evaluate(ids => Promise.all(ids.map(id => window.nodus.getGlobalLibraryItem(id))), itemIds);
      const byId = new Map(liveItems.map(row => [row?.id, row]));
      for (const row of importedRows) {
        const item = byId.get(row.libraryItemId);
        const attachment = item?.attachments?.find(candidate => candidate.sha256 === row.sha256);
        if (!attachment) throw new Error(`Existing Library item is not bound to its original source SHA: ${row.id}`);
      }
      report.libraryShaVerification = { items: liveItems.length, all40OriginalAttachmentHashesMatched: true };

      // Read-only API preflight must finish before preparation is enqueued. ResearchNotebookApi
      // declares listResearchNotebooks(): Promise<ResearchNotebook[]>; page.evaluate does not
      // unwrap a Promise before a synchronous .find(), so await it inside the renderer callback.
      stageSet('read-only-notebook-preflight');
      const notebook = await activePage.evaluate(async id => {
        const notebooks = await window.nodus.listResearchNotebooks();
        if (!Array.isArray(notebooks)) throw new Error('listResearchNotebooks did not resolve to an array.');
        return notebooks.find(row => row.id === id) ?? null;
      }, campaign.notebook.id);
      if (!notebook || notebook.id !== campaign.notebook.id || notebook.mode !== 'fixed'
          || notebook.sources?.length !== 40 || notebook.sources.some(source => !itemIds.includes(source.id))) {
        throw new Error('Original fixed notebook does not resolve to the same 40 sources.');
      }
      report.notebookId = notebook.id;
      const preflightScope = await activePage.evaluate(async id => await window.nodus.resolveResearchNotebook(id), notebook.id);
      const preflightScopeIds = new Set(preflightScope.documents.map(row => row.id));
      if (preflightScopeIds.size !== 40 || itemIds.some(id => !preflightScopeIds.has(id))
          || [...preflightScopeIds].some(id => !itemIds.includes(id))) {
        throw new Error('Read-only notebook scope preflight does not equal the authorized 40 source IDs.');
      }
      let inventory = await activePage.evaluate(async () => await window.nodus.getResearchPreparationInventory());
      if (!inventory || !Array.isArray(inventory.documents)) throw new Error('Research preparation inventory did not resolve to a documents array.');
      const beforeRows = inventory.documents.filter(row => itemIds.includes(row.id));
      if (beforeRows.length !== 40) throw new Error(`Read-only preparation inventory contains ${beforeRows.length}/40 campaign documents.`);
      report.readOnlyApiPreflight = { completedBeforeEnqueue: true, notebookId: notebook.id,
        resolvedScopeId: preflightScope.id, permissionFingerprint: preflightScope.permissionFingerprint,
        documentIds: [...preflightScopeIds].sort(), inventoryDocumentCount: beforeRows.length,
        preparationCounts: beforeRows.reduce((counts, row) => {
          const status = row.preparation?.status ?? 'unknown'; counts[status] = (counts[status] ?? 0) + 1; return counts;
        }, {}) };
      await writeReport();

      stageSet('read-only-open-existing-notebook-ui');
      await activePage.getByRole('button', { name: 'Research chat', exact: true }).first().click();
      await activePage.locator('.research-assistant-header').waitFor();
      if (await activePage.getByTestId('research-history-toggle').count()
          && !(await activePage.getByTestId('research-history-sidebar').isVisible())) await activePage.getByTestId('research-history-toggle').click();
      await activePage.getByTestId('research-chat-search').fill(notebook.name);
      await activePage.getByTestId(`research-search-notebook-${notebook.id}`)
        .getByRole('button', { name: `Abrir ${notebook.name}`, exact: true }).click();
      await activePage.getByTestId('research-notebook-home').waitFor();
      report.readOnlyApiPreflight.openedNotebookInUi = true;
      await writeReport();

      stageSet('resume-all-40-preparations');
      await activePage.evaluate(async ids => { await window.nodus.prepareResearchDocuments(ids); }, itemIds);
      let resolvedScope;
      const deadline = Date.now() + 2_700_000;
      do {
        stageSet('resume-documentary-preparation-wait');
        inventory = await activePage.evaluate(() => window.nodus.getResearchPreparationInventory());
        const rows = inventory.documents.filter(row => itemIds.includes(row.id));
        const counts = rows.reduce((acc, row) => { const status = row.preparation?.status ?? 'unknown'; acc[status] = (acc[status] ?? 0) + 1; return acc; }, {});
        report.preparation = { documentCount: rows.length, counts, ready: rows.filter(row => row.preparation?.status === 'ready'
          && row.preparation?.lexical === 'ready' && row.preparation?.embeddings === 'ready').length,
          failed: rows.filter(row => ['failed', 'blocked', 'canceled', 'cancelled'].includes(row.preparation?.status)
            || row.preparation?.embeddings === 'failed').map(row => ({ id: row.id, status: row.preparation?.status,
              reason: row.preparation?.reason ?? null, error: row.preparation?.error ?? null })) };
        stageSet('resume-documentary-preparation-wait', { documentCount: rows.length, ready: report.preparation.ready,
          failed: report.preparation.failed.length, modelCalls: 0 });
        await writeReport();
        if (rows.length === 40 && rows.every(row => row.preparation?.status === 'ready'
            && row.preparation?.lexical === 'ready' && row.preparation?.embeddings === 'ready')) break;
        if (report.preparation.failed.length) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      } while (Date.now() < deadline);
      if (report.preparation.documentCount !== 40 || report.preparation.ready !== 40 || report.preparation.failed.length) {
        report.status = 'partial-preparation';
        report.caseRetrievalStarted = false;
        report.notReadyDocumentIds = itemIds.filter(id => !inventory.documents.some(row => row.id === id
          && row.preparation?.status === 'ready' && row.preparation?.lexical === 'ready' && row.preparation?.embeddings === 'ready'));
        return report;
      }

      stageSet('post-preparation-notebook-scope-resolution');
      resolvedScope = await activePage.evaluate(id => window.nodus.resolveResearchNotebook(id), notebook.id);
      const scoped = new Set(resolvedScope.documents.map(row => row.id));
      if (scoped.size !== 40 || itemIds.some(id => !scoped.has(id)) || [...scoped].some(id => !itemIds.includes(id))) {
        throw new Error('Fresh post-preparation notebook scope does not equal the authorized 40 source IDs.');
      }
      const currentDocs = inventory.documents.filter(row => itemIds.includes(row.id));
      const authorizedIndexKeys = new Set(currentDocs.flatMap(row => row.indexedSource?.indexKeys ?? []));
      if (authorizedIndexKeys.size === 0) throw new Error('Current 40-document inventory exposes no index keys for semantic contract validation.');
      const modelSpace = inventory.embeddingSpaces?.find(row => row.model === PROFILE_ID);
      if (!modelSpace || modelSpace.dimensions !== 512) throw new Error('Current 512-dimensional embedding space is not present after preparation.');
      report.embeddingContract = { profileId: PROFILE_ID, provider: actualSettings.embeddingProvider, dimensions: modelSpace.dimensions,
        localEmbeddingStatus: report.localEmbeddingAssets, modelReady: true, sourceCount: 40,
        profileSettings: { embeddingProvider: actualSettings.embeddingProvider, embeddingModel: actualSettings.embeddingModel },
        embeddingSpaces: inventory.embeddingSpaces, embeddingModelContract: canonicalModelContract,
        indexContracts: currentDocs.map(row => ({ documentId: row.id, preparation: row.preparation,
          indexedSource: row.indexedSource ?? null })) };
      report.profileContractSha256 = digest(JSON.stringify(report.embeddingContract));
      report.scopeContract = { notebookId: notebook.id, notebookRevision: notebook.revision, scopeId: resolvedScope.id,
        permissionFingerprint: resolvedScope.permissionFingerprint, resolvedDocumentIds: [...scoped].sort(),
        documents: resolvedScope.documents.map(row => ({ id: row.id, title: row.title, revision: row.revision,
          attachmentId: row.attachmentId, attachments: row.attachments ?? [], coverage: row.coverage,
          indexedSource: row.indexedSource ?? null, origin: row.origin })) };
      report.scopeContractSha256 = digest(JSON.stringify(report.scopeContract));

      stageSet('verify-existing-notebook-after-preparation');
      await activePage.getByTestId('research-notebook-home').waitFor();

      stageSet('actual-80-case-retrieval-and-citation-resolution');
      const traceFile = path.join(root, 'profile/embedding-trace.jsonl');
      const scopeDocsById = new Map(resolvedScope.documents.map(row => [row.id, row]));
      const retrieved = [];
      for (const query of prereg.queries) {
        stageSet('actual-80-case-retrieval-and-citation-resolution', { caseId: query.id,
          retrievalCompleted: retrieved.length, retrievalTotal: 80, modelCalls: 0 });
        const traceOffset = fs.existsSync(traceFile) ? fs.statSync(traceFile).size : 0;
        const startedAt = performance.now();
        let search;
        try { search = await activePage.evaluate(input => window.nodus.searchResearchNotebook(input.notebookId, input.question),
          { notebookId: notebook.id, question: query.question }); }
        catch (error) { search = { error: String(error), evidence: [], scopeId: null }; }
        const traceRows = fs.existsSync(traceFile) ? fs.readFileSync(traceFile).subarray(traceOffset).toString('utf8')
          .split(/\r?\n/u).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean) : [];
        const retrievalTraces = traceRows.filter(row => row.type === 'documentary-retrieval');
        const traceAudits = retrievalTraces.map(row => {
          const contract = row.contract ?? null;
          const keys = Array.isArray(row.vectorKeys) ? row.vectorKeys : null;
          const contractMatches = contract ? JSON.stringify(contract) === JSON.stringify(canonicalModelContract) : null;
          const keysAuthorized = keys ? keys.every(key => authorizedIndexKeys.has(key)) : null;
          return { contractPresent: Boolean(contract), contractMatchesCatalog: contractMatches,
            traceVectorKeys: keys, vectorKeysAuthorized: keysAuthorized, lexicalOnly: row.limitations?.lexicalOnly === true,
            status: !contract || !keys ? 'incomplete-trace' : contractMatches && keysAuthorized ? 'verified' : 'mismatch' };
        });
        const evidence = Array.isArray(search?.evidence) ? search.evidence : [];
        const citationIds = evidence.map(item => `documentary:${search?.scopeId}:${item.id}`);
        const resolved = citationIds.length ? await activePage.evaluate(ids => Promise.all(ids.map(id => window.nodus.getPassage(id))), citationIds) : [];
        const receipts = evidence.map((item, index) => ({ evidenceId: item.id, documentId: item.documentId,
          citationId: citationIds[index], canonicalNodusLink: `nodus://passage/${encodeURIComponent(citationIds[index])}`,
          evidenceSha256: digest(item.text), resolved: Boolean(resolved[index]),
          resolvedLibraryItemId: resolved[index]?.libraryItemId ?? null,
          resolvedTextSha256: resolved[index] ? digest(resolved[index].text) : null }));
        const sourcesContext = { notebookId: notebook.id, scopeId: search?.scopeId ?? null,
          permissionFingerprint: resolvedScope.permissionFingerprint, authorizedDocumentIds: [...itemIds].sort(), receipts };
        const scopeLeaks = evidence.filter(item => !itemIds.includes(item.documentId)).map(item => ({
          evidenceId: item.id, documentId: item.documentId ?? null, title: item.title ?? null }));
        const permitted = evidence.flatMap((item, index) => {
          const detail = resolved[index], doc = scopeDocsById.get(item.documentId);
          if (!detail || !itemIds.includes(detail.libraryItemId) || detail.libraryItemId !== item.documentId || detail.text !== item.text) return [];
          const citationId = citationIds[index], title = doc?.title ?? 'Untitled source';
          return [{ id: citationId, label: title, title, citation: `nodus://passage/${encodeURIComponent(citationId)}`,
            text: detail.text, ...(item.locator?.pageLabel ? { pageLabel: item.locator.pageLabel } : {}),
            reason: item.provenance, authors: doc?.authors ?? [], ...(Number.isInteger(doc?.year) ? { year: doc.year } : {}) }];
        });
        const sourceContext = JSON.stringify({ contexto_modular_seleccionado: { research_scope: {
          answer_mode: 'documentary', documentary_evidence_required: true, notebook_id: notebook.id,
          scope_id: search?.scopeId ?? null, partial: search?.partial ?? false }, pasajes_relevantes: permitted },
          conversacion: [{ role: 'user', content: query.question }] }, null, 2);
        const runKind = query.kind === 'no-evidence' ? 'absence' : query.kind === 'hard-negative' ? 'hard'
          : ['monolingual', 'cross-language'].includes(query.kind) ? 'core' : 'complex';
        const sourceContextSha256 = digest(sourceContext), sourcesContextSha256 = digest(JSON.stringify(sourcesContext));
        const caseRecord = { id: query.id, name: query.name, kind: runKind, cohortKind: query.kind,
          question: query.question, language: query.language, isAnswerable: query.isAnswerable,
          sourceContext, sourceContextSha256, sourcesContext, sourcesContextSha256,
          retrievalTraces, retrievalContractAudit: traceAudits,
          semanticParticipated: retrievalTraces.some(row => (row.retrieval?.semantic?.length ?? 0) > 0),
          lexicalFallback: retrievalTraces.some(row => row.limitations?.lexicalOnly === true),
          sourceEvidence: evidence.map((item, index) => ({ evidenceId: item.id, citationId: citationIds[index],
            canonicalNodusLink: `nodus://passage/${encodeURIComponent(citationIds[index])}`, text: item.text,
            title: scopeDocsById.get(item.documentId)?.title ?? null, provenance: item.provenance,
            locator: item.locator, documentId: item.documentId })),
          resolvedEvidence: resolved.map((item, index) => ({ citationId: citationIds[index], resolved: Boolean(item),
            passageId: item?.passage_id ?? null, text: item?.text ?? null, provenance: item?.provenance ?? null,
            pageLabel: item?.page_label ?? null, pageNumber: item?.page_number ?? null, revision: item?.revision ?? null,
            attachmentId: item?.attachmentId ?? null, attachmentRevision: item?.attachmentRevision ?? null,
            libraryItemId: item?.libraryItemId ?? null, work: item?.work ?? null, evidenceSha256: item ? digest(item.text) : null })),
          citationResolution: { attempted: citationIds.length, attemptedIds: citationIds,
            resolved: resolved.filter(Boolean).length, resolvedIds: citationIds.filter((_, index) => Boolean(resolved[index])),
            unresolved: resolved.filter(item => !item).length, unresolvedIds: citationIds.filter((_, index) => !resolved[index]),
            resolvedTextsMatchSearch: evidence.every((item, index) => !resolved[index] || resolved[index].text === item.text),
            resolvedDocumentsAuthorized: resolved.every(item => !item || itemIds.includes(item.libraryItemId)) },
          scopeLeaks, searchError: search?.error ?? null, latencyMs: performance.now() - startedAt };
        caseRecord.caseSourceSnapshotSha256 = digest(JSON.stringify({ caseId: caseRecord.id, question: caseRecord.question,
          language: caseRecord.language, isAnswerable: caseRecord.isAnswerable, sourceContextSha256,
          sourcesContextSha256, profileContractSha256: report.profileContractSha256, scopeContractSha256: report.scopeContractSha256 }));
        retrieved.push(caseRecord);
        report.retrievalCompleted = retrieved.length;
        report.modelCalls = 0;
        report.networkAudit = { rendererHttpRequests, loopback: rendererHttpRequests.filter(row => row.route === 'loopback'),
          external: rendererHttpRequests.filter(row => row.route === 'external'), providerModelCalls: 0,
          isolationProof: harness.proof, coverage: 'Renderer HTTP(S) requests; outbound external network denied by inherited macOS sandbox.' };
        await saveAtomic(partialCasesFile, { format: 'nodus.research-case-sources/1', createdAt: now(), notebookId: notebook.id,
          profileRoot: root, profileId: PROFILE_ID, profileContract: report.embeddingContract,
          profileContractSha256: report.profileContractSha256, scopeContract: report.scopeContract,
          scopeContractSha256: report.scopeContractSha256, corpusSourceHashes: prereg.sourceDocuments.map(row => ({ id: row.id, sha256: row.sha256 })),
          runtimeProvenance: runtimeProvenance(),
          caseSourceSnapshotSha256: digest(JSON.stringify(retrieved.map(row => ({ id: row.id, caseSourceSnapshotSha256: row.caseSourceSnapshotSha256 })))), cases: retrieved });
        await writeReport();
      }
      report.cases = retrieved.length;
      report.citationResolution = { attempted: retrieved.reduce((n, row) => n + row.citationResolution.attempted, 0),
        resolved: retrieved.reduce((n, row) => n + row.citationResolution.resolved, 0),
        unresolved: retrieved.reduce((n, row) => n + row.citationResolution.unresolved, 0),
        allCapturedIdsResolved: retrieved.every(row => row.citationResolution.attempted === row.citationResolution.resolved),
        allResolvedTextsMatchSearch: retrieved.every(row => row.citationResolution.resolvedTextsMatchSearch),
        allResolvedDocumentsAuthorized: retrieved.every(row => row.citationResolution.resolvedDocumentsAuthorized) };
      report.scopeLeakCount = retrieved.reduce((n, row) => n + row.scopeLeaks.length, 0);
      report.evidenceBindingViolations = retrieved.reduce((n, row) => n + row.scopeLeaks.length
        + Number(!row.citationResolution.resolvedTextsMatchSearch) + Number(!row.citationResolution.resolvedDocumentsAuthorized), 0);
      const audits = retrieved.flatMap(row => row.retrievalContractAudit);
      report.retrievalContractAudit = { expectedContractSha256: digest(JSON.stringify(canonicalModelContract)),
        traces: audits.length, verified: audits.filter(row => row.status === 'verified').length,
        mismatches: audits.filter(row => row.status === 'mismatch').length,
        incomplete: audits.filter(row => row.status === 'incomplete-trace').length, checks: audits };
      report.retrievalContractAudit.allCasesHaveVerifiedTrace = retrieved.length === 80
        && retrieved.every(row => row.retrievalContractAudit.length > 0 && row.retrievalContractAudit.every(audit => audit.status === 'verified'));
      const retrievalAcceptance = retrieved.length === 80 && report.retrievalContractAudit.allCasesHaveVerifiedTrace
        && report.citationResolution.allCapturedIdsResolved && report.citationResolution.allResolvedTextsMatchSearch
        && report.citationResolution.allResolvedDocumentsAuthorized && report.scopeLeakCount === 0
        && report.evidenceBindingViolations === 0;
      report.status = retrievalAcceptance ? 'retrieval-complete' : 'partial-retrieval';
      report.retrievalAcceptance = { passed: retrievalAcceptance, cases: retrieved.length,
        allCasesHaveVerifiedTrace: report.retrievalContractAudit.allCasesHaveVerifiedTrace,
        allCapturedCitationIdsResolved: report.citationResolution.allCapturedIdsResolved,
        allResolvedTextsMatchSearch: report.citationResolution.allResolvedTextsMatchSearch,
        allResolvedDocumentsAuthorized: report.citationResolution.allResolvedDocumentsAuthorized,
        scopeLeaks: report.scopeLeakCount, evidenceBindingViolations: report.evidenceBindingViolations };
      const caseSourceSnapshotSha256 = digest(JSON.stringify(retrieved.map(row => ({ id: row.id, caseSourceSnapshotSha256: row.caseSourceSnapshotSha256 }))));
      report.caseSourceSnapshotSha256 = caseSourceSnapshotSha256;
      await saveAtomic(caseSourcesFile, { format: 'nodus.research-case-sources/1', createdAt: now(), notebookId: notebook.id,
        profileRoot: root, profileId: PROFILE_ID, profileContract: report.embeddingContract,
        profileContractSha256: report.profileContractSha256, scopeContract: report.scopeContract,
        scopeContractSha256: report.scopeContractSha256, corpusSourceHashes: prereg.sourceDocuments.map(row => ({ id: row.id, sha256: row.sha256 })),
        runtimeProvenance: runtimeProvenance(), caseSourceSnapshotSha256, cases: retrieved });
      report.caseSourcesFile = caseSourcesFile;
    } finally { await harness.close().catch(() => {}); }
  } catch (error) {
    report.failure = { message: error?.message ?? String(error), stack: error?.stack ?? null };
    report.failureStage = stage;
    if (activePage && !activePage.isClosed()) {
      report.failurePage = await activePage.evaluate(() => ({ title: document.title, url: location.href })).catch(() => null);
      const screenshot = path.join(artifacts, `${attempt}-failed-ui.png`);
      await activePage.screenshot({ path: screenshot, fullPage: false }).then(() => { report.failureScreenshot = screenshot; }).catch(() => {});
    } else report.failurePage = { pageClosed: true };
    if (report.status === 'preparing') report.status = 'blocked';
  } finally {
    if (timer) clearInterval(timer);
    report.runtimeSourceAfter = sourceSnapshot();
    report.buildArtifactsAfter = buildSnapshot();
    report.harnessSha256 = hashFile(path.join(repoRoot, 'scripts/research-live-evidence-recover.mjs'));
    report.runtimeAndBuildUnchanged = JSON.stringify(report.runtimeSourceBefore) === JSON.stringify(report.runtimeSourceAfter)
      && JSON.stringify(report.buildArtifactsBefore) === JSON.stringify(report.buildArtifactsAfter);
    report.electronStdoutBytes = fs.existsSync(stdoutFile) ? fs.statSync(stdoutFile).size : 0;
    report.electronStderrBytes = fs.existsSync(stderrFile) ? fs.statSync(stderrFile).size : 0;
    report.processEventsFile = eventsFile;
    report.processPipes = childPipes;
    updateNetworkAudit();
    report.finishedAt = now();
    await saveAtomic(reportFile, report);
    await writeReport();
    console.log(JSON.stringify({ status: report.status, attempt, campaignRoot: root,
      reportFile, progressFile, caseSourcesFile: report.caseSourcesFile ?? null,
      caseSourcesPartialFile: fs.existsSync(partialCasesFile) ? partialCasesFile : null,
      preparation: report.preparation ?? null, retrievalCompleted: report.retrievalCompleted ?? 0,
      citationResolution: report.citationResolution ?? null, retrievalContractAudit: report.retrievalContractAudit ? {
        traces: report.retrievalContractAudit.traces, verified: report.retrievalContractAudit.verified,
        mismatches: report.retrievalContractAudit.mismatches, incomplete: report.retrievalContractAudit.incomplete,
        allCasesHaveVerifiedTrace: report.retrievalContractAudit.allCasesHaveVerifiedTrace,
      } : null, modelCalls: report.modelCalls, failure: report.failure ?? null,
      runtimeAndBuildUnchanged: report.runtimeAndBuildUnchanged }, null, 2));
  }
  if (report.failure) process.exitCode = 1;
}

try {
  const root = arg('root');
  const checked = preflight(root);
  const currentSourceHashes = sourceSnapshot();
  const currentBuildHashes = buildSnapshot();
  const dryResult = { status: 'dry-check-passed', appLaunched: false, modelCalls: 0, campaignRoot: checked.root,
    corpusRoot: checked.sourceRoot, profileId: PROFILE_ID, previousAttempt: { status: checked.campaign.status,
      imported: checked.campaign.importedDocuments.length, extractionDone: checked.campaign.extraction.length,
      preparedBeforeCrash: checked.prepCounts, previousRetrievalCases: checked.campaign.retrievalCompleted ?? 0,
      modelCalls: checked.campaign.modelCalls },
    sourceHashes: { corpusDocuments: 40, shaBindingsVerified: true, preregistration: checked.inputs.preregistration,
      sourceManifest: checked.inputs.sourceManifest, corpusManifest: checked.inputs.originalCorpusManifest,
      emptyProviderKeysFile: checked.inputs.emptyKeys, ocrManifest: checked.inputs.ocrManifest },
    q8AssetsVerified: checked.campaign.assetProof.verified.length,
    lockInfo: checked.lockInfo, gates: { runFlagRequired: true, buildEnvironment: `NODUS_RESEARCH_RECOVERY_BUILD_READY=${BUILD_GATE}`,
      launchEnvironment: `NODUS_RESEARCH_RECOVERY_RUN_READY=${RUN_GATE}` },
    sourceVersion: { files: Object.keys(currentSourceHashes).length,
      sha256: digest(JSON.stringify(currentSourceHashes)), embeddingWorkerSha256: currentSourceHashes['electron/workers/embeddingGemma2Worker.ts'] },
    buildArtifacts: Object.keys(currentBuildHashes).length, buildArtifactMapSha256: digest(JSON.stringify(currentBuildHashes)) };
  if (!process.argv.includes('--run')) {
    console.log(JSON.stringify(dryResult, null, 2));
  } else {
    if (process.env.NODUS_RESEARCH_RECOVERY_BUILD_READY !== BUILD_GATE
        || process.env.NODUS_RESEARCH_RECOVERY_RUN_READY !== RUN_GATE) {
      throw new Error(`Run requires both parent gates: NODUS_RESEARCH_RECOVERY_BUILD_READY=${BUILD_GATE} and NODUS_RESEARCH_RECOVERY_RUN_READY=${RUN_GATE}`);
    }
    if (checked.lockInfo.present) throw new Error(`Isolated Electron lock remains present; inspect stale PID before recovery: ${checked.lockInfo.pid}`);
    await runRecovery(checked);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'preflight-failed', appLaunched: false, message: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
}
