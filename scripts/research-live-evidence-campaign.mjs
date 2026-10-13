import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createResearchTestRoot } from './research-isolation.mjs';
import { prepareEmbeddingCorpus } from './embeddinggemma-corpus.mjs';
import { canonicalResearchJson } from './lib/researchLiveIndexAuthorization.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error(`Research campaign requires Node 24+ before any run state is created; received ${process.versions.node}.`);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const runtimeSourceFiles = ['shared/localAiModels.ts', 'shared/researchCorpus.ts', 'shared/libraryTypes.ts',
  'shared/retrievalChunks.ts', 'shared/embeddingGemma2.ts', 'shared/embeddingContract.ts', 'electron/ai/researchAssistant.ts',
  'electron/ai/documentaryPreparation.ts', 'electron/ai/nodusLocalAi.ts',
  'electron/ai/researchCorpusScope.ts', 'electron/db/documentaryStore.ts', 'electron/db/documentaryRetrieval.ts',
  'electron/workers/documentaryRetrievalWorker.ts', 'electron/workers/embeddingGemma2Worker.ts',
  'electron/library/libraryExtractionWorkerHost.ts', 'electron/library/libraryOperations.ts',
  'electron/library/libraryExtractionEngine.ts', 'electron/ai/documentaryExtraction.ts', 'electron/bootstrap.ts',
  'electron/extraction/textExtractor.ts', 'electron/extraction/pdfjsLoader.ts', 'electron/extraction/ocr.ts', 'electron/ipc/platform.ts',
  'electron/ipc/researchAttachments.ts'];
function sourceFilesUnder(root) {
  const absolute = path.join(repoRoot, root);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(relative);
    return /\.(?:ts|tsx|js|cjs|mjs)$/u.test(entry.name) ? [relative] : [];
  });
}
const sourceVersionSnapshot = () => Object.fromEntries([...new Set([...runtimeSourceFiles,
  ...['electron', 'shared'].flatMap(root => sourceFilesUnder(root))])].sort()
  .map(file => [file, sha256(fs.readFileSync(path.join(repoRoot, file)))]));
function generatedArtifacts(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name), absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return generatedArtifacts(absolute, relative);
    return /\.(?:js|cjs|mjs)$/u.test(entry.name) ? [relative] : [];
  });
}
const buildArtifactSnapshot = () => {
  const files = [...generatedArtifacts(path.join(repoRoot, 'dist-electron'), 'dist-electron'),
    ...generatedArtifacts(path.join(repoRoot, 'dist/assets'), 'dist/assets'), 'dist/index.html'];
  return Object.fromEntries(files.map(file => [file, fs.existsSync(path.join(repoRoot, file))
    ? sha256(fs.readFileSync(path.join(repoRoot, file))) : null]));
};
const format = 'nodus.research-live-evidence-campaign/1';
const launchGate = 'I_CONFIRM_ISOLATED_ELECTRON_LAUNCH';
const profileId = 'embeddinggemma-2-text-q8-512-v1';
const launchRequested = process.argv.includes('--launch');
const tessdataCommit = '65727574dfcd264acbb0c3e07860e4e9e9b22185';
const tessdataLanguages = {
  eng: { sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2', bytes: 4113088 },
  spa: { sha256: '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464', bytes: 2294433 },
  fra: { sha256: 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca', bytes: 1130365 },
  deu: { sha256: '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d', bytes: 1525436 },
  por: { sha256: 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb', bytes: 1982756 },
  ita: { sha256: 'b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827', bytes: 2701314 },
};

function markedRoot(root) {
  const canonical = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
  if (marker.root !== canonical || marker.format !== 'nodus.isolated-research-profile/1') throw new Error(`Unmarked disposable root: ${root}`);
  return canonical;
}

async function prepareOcrResources(root) {
  const rootPath = markedRoot(root);
  const targetRoot = path.join(rootPath, 'cache/tessdata');
  await fsp.mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const resources = [];
  const copySource = arg('ocr-source');
  for (const [language, pin] of Object.entries(tessdataLanguages)) {
    const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${tessdataCommit}/${language}.traineddata`;
    if (copySource) {
      const { copyResearchQaPinnedResource } = await import('./lib/researchQaPinnedResource.mjs');
      const copyProof = copyResearchQaPinnedResource({ sourceRoot: copySource, targetRoot: rootPath,
        relativePath: `cache/tessdata/${language}.traineddata`, ...pin });
      resources.push({ language, file: `${language}.traineddata`, sourceUrl: url, sourceCommit: tessdataCommit,
        license: 'Apache-2.0 (tesseract-ocr/tessdata_fast)', sha256: pin.sha256, bytes: pin.bytes,
        path: copyProof.targetPath, copyProof });
      continue;
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Pinned OCR resource ${language} failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256(bytes);
    if (digest !== pin.sha256 || bytes.length !== pin.bytes) {
      throw new Error(`Pinned OCR resource mismatch for ${language}: sha256=${digest}, bytes=${bytes.length}`);
    }
    const target = path.join(targetRoot, `${language}.traineddata`);
    await fsp.writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
    resources.push({ language, file: `${language}.traineddata`, sourceUrl: url, sourceCommit: tessdataCommit,
      license: 'Apache-2.0 (tesseract-ocr/tessdata_fast)', sha256: digest, bytes: bytes.length, path: target });
  }
  const manifest = { format: 'nodus.research-live-ocr-resources/1', createdAt: now(), root: rootPath,
    cachePath: targetRoot, resources };
  const artifacts = path.join(rootPath, 'artifacts');
  await fsp.mkdir(artifacts, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(artifacts, 'ocr-resources.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  const { build } = await import('esbuild');
  const contractModule = path.join(rootPath, 'profile/tmp/ocr-contract.mjs');
  await fsp.mkdir(path.dirname(contractModule), { recursive: true, mode: 0o700 });
  await build({ entryPoints: [path.join(repoRoot, 'electron/extraction/ocr.ts')], outfile: contractModule,
    bundle: true, format: 'esm', platform: 'node', external: ['@napi-rs/canvas', 'tesseract.js'], logLevel: 'silent' });
  const { installedOcrOptions } = await import(`${pathToFileURL(contractModule).href}?root=${Date.now()}`);
  process.env.NODUS_TESSDATA_CACHE = targetRoot;
  const apiChecks = ['spa+eng', 'eng+fra', 'deu+eng', 'por+eng', 'ita+eng'].map(languages => {
    const installed = installedOcrOptions(languages);
    if (installed.cachePath !== fs.realpathSync(targetRoot) || installed.langPath !== fs.realpathSync(targetRoot)
        || installed.gzip !== false || installed.cacheMethod !== 'readOnly') throw new Error(`OCR API contract mismatch for ${languages}`);
    return { languages, cachePath: installed.cachePath, langPath: installed.langPath, gzip: installed.gzip, cacheMethod: installed.cacheMethod };
  });
  manifest.apiContractChecks = apiChecks;
  const bootstrap = await fsp.readFile(path.join(repoRoot, 'electron/bootstrap.ts'), 'utf8');
  const libraryTypes = await fsp.readFile(path.join(repoRoot, 'shared/libraryTypes.ts'), 'utf8');
  if (!bootstrap.includes("isolatedPath(root, 'cache/tessdata')")
      || !libraryTypes.includes("ocrMode: 'off' | 'local' | 'remote'")
      || !libraryTypes.includes('localOcrOnly?: boolean')) throw new Error('OCR bootstrap or LibraryExtractionOptions API contract changed.');
  manifest.apiContracts = { bootstrapUsesIsolatedTessdataCache: true,
    libraryExtractionOptionsSupportLocalOnly: true, extractionResourceChecks: apiChecks };
  await fsp.writeFile(path.join(artifacts, 'ocr-resources.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function assertFreshCampaignRoot(root) {
  for (const relative of ['profile/config', 'profile/cache', 'profile/local-ai', 'profile/documentary', 'library', 'fixtures', 'artifacts']) {
    const target = path.join(root, relative);
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`Campaign root is not fresh; refusing reuse of ${target}`);
  }
}

function fixedQueries(queries, historicalManifest) {
  if (historicalManifest.format !== 'nodus.research-live-directed-queries/1') throw new Error('Unsupported fixed directed-question fixture');
  const coreCandidates = queries.filter(query => query.split === 'evaluation' && ['monolingual', 'cross-language'].includes(query.kind));
  const languageOrder = ['de', 'en', 'es', 'fr', 'it', 'pt'];
  const quotas = { de: 5, en: 8, es: 8, fr: 6, it: 5, pt: 8 };
  const answers = [];
  for (const language of languageOrder) {
    const choices = coreCandidates.filter(query => query.language === language).sort((a, b) => a.id.localeCompare(b.id));
    if (choices.length < quotas[language]) throw new Error(`Insufficient core evaluation questions for ${language}`);
    answers.push(...choices.slice(0, quotas[language]));
  }
  const hard = queries.filter(query => query.split === 'evaluation' && query.kind === 'hard-negative');
  const absences = queries.filter(query => query.kind === 'no-evidence');
  const historical = historicalManifest.cases.filter(item => item.positive);
  if (answers.length !== 40 || hard.length !== 10 || historical.length !== 8 || absences.length !== 20) {
    throw new Error(`Unexpected preregistration inventory: core=${answers.length}, hard=${hard.length}, historical=${historical.length}, absence=${absences.length}`);
  }
  const twoNew = [
    { id: 'new-multisource-restore-measure', kind: 'complex-multisource', language: 'en',
      question: 'Compare Alba and Linde in separate rows: what does Alba measure and explicitly exclude, and what can Linde restore and explicitly exclude? Keep Linde’s event-retention period as a separate field.',
      annotations: { alba: { measures: 'turbidity with green light at 530 nm', excludes: 'oxygen concentration' },
        linde: { restores: 'deleted items', excludes: 'closed accounts', eventRetention: '14 days in version 2; changed from 7 days' } } },
    { id: 'new-table-vega-calculation', kind: 'complex-table-calculation', language: 'en',
      question: 'Make a two-row table for Vega’s spaced-retrieval and rereading groups, report each recall percentage, calculate the difference in percentage points, and name the measured outcome.',
      annotations: { rows: [{ group: 'spaced retrieval', recall: '72%' }, { group: 'rereading', recall: '51%' }],
        difference: '21 percentage points', measuredOutcome: 'recall, not intelligence' } },
  ];
  const selected = [
    ...historical.map(item => ({ query: { id: item.name, question: item.question, language: item.promptLanguage }, kind: 'historical-complex',
      name: item.name, annotations: { positive: true, acceptanceNote: historicalAcceptance[item.name], historicalCaseId: item.id,
        historicalSourceHash: item.sourceHash, historicalSourceCount: item.sourceCount } })),
    ...twoNew.map(item => ({ query: { id: item.id, question: item.question, language: item.language }, kind: item.kind, name: item.id,
      annotations: item.annotations })),
    ...hard.map(query => ({ query, kind: query.kind, name: query.id, annotations: { expected: query.expected, sourceIds: query.relevant } })),
    ...answers.map(query => ({ query, kind: query.kind, name: query.id, annotations: { expected: query.expected, sourceIds: query.relevant } })),
    ...absences.map(query => ({ query, kind: query.kind, name: query.id,
      annotations: { insufficientEvidence: true, sourceIds: query.relevant, originalSplit: query.split } })),
  ].map(({ query, kind, name, annotations }, index) => ({
    query: { id: `R${String(index + 1).padStart(3, '0')}`, manifestQueryId: query.id ?? null,
      kind, name, question: query.question, language: query.language,
      sourceLanguage: query.sourceLanguage ?? null, isAnswerable: kind !== 'no-evidence',
      originalSplit: query.split ?? null },
    annotations,
  }));
  return { queries: selected.map(item => item.query),
    annotationGold: Object.fromEntries(selected.map(item => [item.query.id, item.annotations])) };
}

const historicalAcceptance = {
  policy: 'Distinguish restoration of deleted items from closed-account exclusion without conflating either with event retention.',
  negation: 'Report Vega recall outcomes and the fact intelligence was not measured; report Bruma median 18 and mean 24 as different summaries; avoid unsupported interpretation.',
  correction: 'Use the final Bruma total of 240 and say it supersedes the preliminary 239.',
  dates: 'Library opened in 1912; laboratory opened in 1913.',
  statistics: 'Median 18; mean 24; these summaries alone do not determine the response distribution.',
  paper: 'Explain NF4 parameter storage and double quantization of quantization constants; distinguish 4-bit storage from BF16 computation; explain how NVIDIA unified-memory paged optimizers evict optimizer states to CPU RAM when GPU memory is insufficient and page them back for updates; cite QLoRA paper evidence.',
  calculation: 'Vega spaced retrieval 72%, rereading 51%, a 21 percentage-point gap; outcome is recall.',
  sensor: 'Alba measures turbidity using green light at 530 nm; it does not measure oxygen concentration.',
};

async function copyCampaignInputs(corpusRoot, campaignRoot, manifest) {
  const destination = path.join(campaignRoot, 'fixtures', 'corpus');
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  const documents = [];
  const canonicalFixtures = fs.realpathSync(path.join(corpusRoot, 'fixtures'));
  for (const document of manifest.documents) {
    const source = path.resolve(document.file);
    const sourceStat = fs.lstatSync(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Corpus fixture must be a regular, non-symlink file: ${document.id}`);
    const canonicalSource = fs.realpathSync(source);
    if (!canonicalSource.startsWith(canonicalFixtures + path.sep)) throw new Error(`Corpus fixture escapes canonical fixtures root: ${document.id}`);
    const bytes = await fsp.readFile(canonicalSource);
    const digest = sha256(bytes);
    if (digest !== document.sha256) throw new Error(`Corpus source hash mismatch: ${document.id}`);
    const target = path.join(destination, path.basename(source));
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    documents.push({ id: document.id, title: document.title, format: document.format,
      language: document.language, file: target, sha256: digest, provenance: document.provenance,
      bytes: bytes.length });
  }
  return documents;
}

async function verifyAssetSource(source, profileRoot) {
  if (!source) return { available: false, reason: 'Pass --asset-source to an owned, previously verified QA asset cache.' };
  const sourceRoot = fs.realpathSync(source);
  const approvedQaRoot = fs.realpathSync('/private/tmp/nodus-research-XnhRol');
  if (sourceRoot !== approvedQaRoot) throw new Error(`Model assets must come from the canonical marked QA cache ${approvedQaRoot}`);
  const qaMarker = JSON.parse(await fsp.readFile(path.join(sourceRoot, 'isolation.json'), 'utf8'));
  if (qaMarker.format !== 'nodus.isolated-research-profile/1' || qaMarker.root !== sourceRoot) throw new Error('QA asset cache is not a canonical marked isolated root.');
  const cacheManifest = JSON.parse(await fsp.readFile(path.join(sourceRoot, 'artifacts/model-manifest.json'), 'utf8'));
  if (cacheManifest.testedProfile !== profileId || cacheManifest.dimensions !== 512) throw new Error('QA asset cache does not certify the exact Q8-512 profile.');
  const canonicalModelDirectory = fs.realpathSync(cacheManifest.directory);
  if (!canonicalModelDirectory.startsWith(sourceRoot + path.sep)) throw new Error('QA model directory escapes its marked root.');
  const modelsBuild = path.join(profileRoot, 'tmp/local-model-catalog.mjs');
  const { build } = await import('esbuild');
  await build({ entryPoints: [path.join(repoRoot, 'shared/localAiModels.ts')], outfile: modelsBuild, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { NODUS_LOCAL_MODELS } = await import(pathToFileURL(modelsBuild));
  const model = NODUS_LOCAL_MODELS.find(item => item.id === profileId);
  if (!model) throw new Error(`Missing catalog profile ${profileId}`);
  const sourceProfile = path.join(sourceRoot, 'profile');
  const requested = model.assets.map(asset => ({ file: asset.file, sha256: asset.sha256,
    relative: `local-ai/models/${model.assetFamily}/${asset.file}`, kind: 'model' }));
  const verified = [];
  for (const asset of requested) {
    const candidate = path.join(sourceProfile, asset.relative);
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const actual = sha256(await fsp.readFile(candidate));
    if (actual !== asset.sha256) throw new Error(`QA asset hash mismatch at ${candidate}`);
    const target = path.join(profileRoot, asset.relative);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.copyFile(candidate, target, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    verified.push({ kind: asset.kind, file: asset.file, sha256: actual, bytes: stat.size, source: candidate, target });
  }
  const missing = requested.filter(asset => !verified.some(row => row.file === asset.file && row.kind === asset.kind));
  return { available: missing.length === 0, sourceRoot, modelId: profileId, verified, missing };
}

if (process.argv.includes('--validate-cohort')) {
  const scriptText = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const sourceQueries = JSON.parse(fs.readFileSync(path.join(repoRoot, 'audit/embeddinggemma-2/queries-gold.json'), 'utf8'));
  const historical = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/fixtures/research-live-directed-queries.json'), 'utf8'));
  const { queries, annotationGold } = fixedQueries(sourceQueries, historical);
  const counts = { total: queries.length, answerable: queries.filter(query => query.isAnswerable).length,
    insufficient: queries.filter(query => !query.isAnswerable).length,
    core: queries.filter(query => ['monolingual', 'cross-language'].includes(query.kind)).length,
    hard: queries.filter(query => query.kind === 'hard-negative').length,
    historicalComplex: queries.filter(query => query.kind === 'historical-complex').length,
    newComplex: queries.filter(query => query.kind.startsWith('complex-')).length,
    languages: Object.fromEntries([...new Set(queries.filter(query => ['monolingual', 'cross-language'].includes(query.kind)).map(query => query.language))].sort()
      .map(language => [language, queries.filter(query => ['monolingual', 'cross-language'].includes(query.kind) && query.language === language).length])) };
  assert.deepEqual(counts, { total: 80, answerable: 60, insufficient: 20, core: 40, hard: 10,
    historicalComplex: 8, newComplex: 2, languages: { de: 5, en: 8, es: 8, fr: 6, it: 5, pt: 8 } });
  assert.equal(Object.keys(annotationGold).length, 80);
  assert.ok(queries.every(query => !Object.hasOwn(query, 'annotationGold') && !Object.hasOwn(query, 'sourceIds')
    && !Object.hasOwn(query, 'goldExpected')));
  assert.equal(new Set(queries.map(query => query.id)).size, 80);
  const notebookStart = scriptText.lastIndexOf('const notebook = await page.evaluate');
  const notebookBuilder = scriptText.slice(notebookStart, scriptText.indexOf('const resolvedScope =', notebookStart));
  const retrievalStart = scriptText.lastIndexOf('for (const query of queries)');
  const retrievalBuilder = scriptText.slice(retrievalStart, scriptText.indexOf('report.modelCalls = 0;', retrievalStart));
  assert.match(notebookBuilder, /sources:\s*ids\.map\(id => \(\{ kind: 'library-item', id \}\)\)/u);
  assert.doesNotMatch(notebookBuilder, /annotationGold|sourceIds|goldExpected|expected/u);
  assert.match(retrievalBuilder, /searchResearchNotebook\(input\.notebookId, input\.question\)/u);
  assert.doesNotMatch(retrievalBuilder, /annotationGold|sourceIds|goldExpected|expected/u);
  assert.match(scriptText, /NODUS_RESEARCH_CAMPAIGN_LAUNCH_READY/u);
  assert.match(scriptText, /NODUS_EMBEDDING_QA_TRACE/u);
  console.log(JSON.stringify({ valid: true, counts, caseIds: queries.map(query => query.id),
    queryGoldSeparated: true, notebookAndRetrievalInputsContainNoGoldOrExpectedIds: true }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--prepare-ocr-resources')) {
  const root = markedRoot(arg('campaign-root') ?? createResearchTestRoot());
  assertFreshCampaignRoot(root);
  const manifest = await prepareOcrResources(root);
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

const campaignRoot = markedRoot(arg('campaign-root') ?? createResearchTestRoot());
assertFreshCampaignRoot(campaignRoot);
const corpusRoot = markedRoot(arg('corpus-root') ?? createResearchTestRoot());
const artifacts = path.join(campaignRoot, 'artifacts');
const save = async (name, value) => fsp.writeFile(path.join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const report = { format, campaignRoot, corpusRoot, profileId, status: 'preparing', launchRequested,
  launchAuthorized: false, modelCalls: 0, startedAt: now(), coordinatorPid: process.pid,
  sourceVersionBefore: sourceVersionSnapshot(), buildArtifactsBefore: buildArtifactSnapshot(), restrictions: {
    providers: 'none; retrieval and passage resolution only',
    externalNetwork: 'denied to Electron by the isolated harness',
    zotero: 'disposable unreachable endpoint',
    safeStorage: 'disabled by literal empty harness keys file',
    sourceGoldSeparation: 'gold annotations remain in campaign artifacts and are never imported or passed to retrieval',
  } };
let activePage = null;
let observerStage = 'prelaunch';
let observerTimer = null;
let launchedApp = null;
const processEventsFile = path.join(artifacts, 'electron-process-events.jsonl');
const processStdoutFile = path.join(artifacts, 'electron-stdout.log');
const processStderrFile = path.join(artifacts, 'electron-stderr.log');
const appendProcessEvent = row => {
  try { fs.appendFileSync(processEventsFile, `${JSON.stringify({ at: now(), ...row })}\n`, { mode: 0o600 }); } catch {}
};
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
async function startElectronObservability(app, root) {
  const child = app.process?.();
  const pid = child?.pid ?? null;
  const appendBytes = (filename, chunk) => {
    try { fs.appendFileSync(filename, chunk, { mode: 0o600 }); } catch {}
  };
  child?.stdout?.on('data', chunk => appendBytes(processStdoutFile, chunk));
  child?.stderr?.on('data', chunk => appendBytes(processStderrFile, chunk));
  child?.on('exit', (code, signal) => appendProcessEvent({ event: 'child-exit', pid, code, signal }));
  child?.on('close', (code, signal) => appendProcessEvent({ event: 'child-close', pid, code, signal }));
  appendProcessEvent({ event: 'child-attached', pid, stdoutAvailable: Boolean(child?.stdout), stderrAvailable: Boolean(child?.stderr) });
  const mainEvents = path.join(root, 'artifacts/electron-process-events.jsonl');
  const mainObserver = await app.evaluate(({ app: electronApp, BrowserWindow }, target) => {
    const key = '__nodusQaProcessObserverV1';
    if (globalThis[key]) return { attached: true, reused: true };
    const fs = process.getBuiltinModule('node:fs');
    const append = row => { try { fs.appendFileSync(target, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, { mode: 0o600 }); } catch {} };
    const attach = win => {
      const contents = win.webContents;
      append({ event: 'window-attached', webContentsId: contents.id });
      contents.on('render-process-gone', (_event, details) => append({ event: 'render-process-gone', webContentsId: contents.id,
        reason: details?.reason ?? null, exitCode: details?.exitCode ?? null }));
      contents.on('destroyed', () => append({ event: 'webContents-destroyed', webContentsId: contents.id }));
      win.on('closed', () => append({ event: 'browser-window-closed', webContentsId: contents.id }));
    };
    for (const win of BrowserWindow.getAllWindows()) attach(win);
    electronApp.on('browser-window-created', (_event, win) => attach(win));
    globalThis[key] = true;
    append({ event: 'main-process-observer-attached', pid: process.pid });
    return { attached: true, reused: false };
  }, mainEvents).catch(error => ({ attached: false, message: String(error) }));
  appendProcessEvent({ event: mainObserver.attached ? 'main-observer-result' : 'main-observer-failed', ...mainObserver });
  observerTimer = setInterval(() => {
    const prep = Array.isArray(report.preparation) ? report.preparation : [];
    appendProcessEvent({ event: 'runtime-sample', pid, stage: observerStage,
      counters: { imported: report.importedDocuments?.length ?? 0,
        extractionDone: report.extraction?.filter(row => row.status === 'done').length ?? 0,
        preparationReady: prep.filter(row => row.preparation?.status === 'ready').length,
        retrievalCompleted: report.retrievalCompleted ?? 0, modelCalls: report.modelCalls ?? 0 }, ...processTreeSample(pid) });
  }, 15_000);
  observerTimer.unref?.();
  return stage => { observerStage = stage; appendProcessEvent({ event: 'stage', pid, stage }); };
}

await fsp.mkdir(artifacts, { recursive: true, mode: 0o700 });
try {
  report.ocrResourceManifest = await prepareOcrResources(campaignRoot);
  if (!fs.existsSync(path.join(corpusRoot, 'artifacts/corpus-manifest.json'))) await prepareEmbeddingCorpus(corpusRoot);
  const manifest = JSON.parse(await fsp.readFile(path.join(corpusRoot, 'artifacts/corpus-manifest.json'), 'utf8'));
  const allQueries = JSON.parse(await fsp.readFile(path.join(corpusRoot, 'artifacts/queries-gold.json'), 'utf8'));
  const historicalManifest = JSON.parse(await fsp.readFile(path.join(repoRoot, 'scripts/fixtures/research-live-directed-queries.json'), 'utf8'));
  const { queries, annotationGold: annotations } = fixedQueries(allQueries, historicalManifest);
  const documents = await copyCampaignInputs(corpusRoot, campaignRoot, manifest);
  const preregistration = { format: 'nodus.research-live-evidence-preregistration/1', createdAt: now(),
    classification: 'directed regression set; current code and known defects may have influenced query selection; not an untouched holdout',
    selection: 'Ordered as 10 complex cases (8 exact historical positive questions from scripts/fixtures/research-live-directed-queries.json plus 2 annotated multi-source/table cases), all 10 original evaluation hard questions, 40 deterministic original evaluation core questions balanced across six languages, and all 20 original no-evidence questions (including development cases)',
    languageQuotas: { de: 5, en: 8, es: 8, fr: 6, it: 5, pt: 8 },
    counts: { total: 80, answerable: 60, insufficient: 20, core: 40, hard: 10, historicalComplex: 8, newComplex: 2 },
    queries,
    pendingStressCoverage: ['eu', 'la', 'eu/en mixed-language', 'de/es mixed-language'].map(language => ({ language, status: 'not included in the fixed 80-case denominator; no answerable stress case was selected from these strata' })),
    annotationGold: annotations,
    sourceDocuments: documents.map(({ id, title, format, language, sha256, provenance, bytes }) => ({ id, title, format, language, sha256, provenance, bytes })),
  };
  await save('preregistration.json', preregistration);
  await save('source-manifest.json', { format: manifest.format, totals: manifest.totals,
    documents, corpusRoot, generatedAt: now() });
  report.preregistration = { path: path.join(artifacts, 'preregistration.json'), sha256: sha256(JSON.stringify(preregistration)), counts: preregistration.counts };
  report.documents = documents.length;

  if (!launchRequested) {
    report.status = 'prepared-dry-run';
    report.nextRequirement = `To launch only after reviewer readiness confirmation, pass --launch and NODUS_RESEARCH_CAMPAIGN_LAUNCH_READY=${launchGate}.`;
    report.assetProof = await verifyAssetSource(arg('asset-source'), path.join(campaignRoot, 'profile'));
    if (!report.assetProof.available) report.blocker = { kind: 'verified-assets-unavailable-or-incomplete', proof: report.assetProof };
  } else {
    if (process.env.NODUS_RESEARCH_CAMPAIGN_LAUNCH_READY !== launchGate) {
      throw new Error(`Launch gate absent: root must explicitly confirm readiness and set NODUS_RESEARCH_CAMPAIGN_LAUNCH_READY=${launchGate}`);
    }
    if (!arg('asset-source')) throw new Error('Live run requires --asset-source pointing to the owned QA assets cache.');
    report.launchAuthorized = true;
    report.assetProof = await verifyAssetSource(arg('asset-source'), path.join(campaignRoot, 'profile'));
    if (!report.assetProof.available) {
      report.status = 'blocked-assets';
      report.blocker = { kind: 'verified-assets-unavailable-or-incomplete', proof: report.assetProof };
      throw new Error('Required verified Q8-512 model/runtime assets are missing; no download fallback is permitted.');
    }

    const emptyKeysFile = path.join(campaignRoot, 'fixtures/empty-provider-keys.json');
    await fsp.writeFile(emptyKeysFile, '{}\n', { mode: 0o600, flag: 'wx' });
    const { createResearchApp } = await import('./lib/research-app-harness.mjs');
    const harness = await createResearchApp({ root: campaignRoot,
      extraEnv: { NODUS_HARNESS_KEYS_FILE: emptyKeysFile, NODUS_E2E_UPDATE_STATUS: 'not-available',
        NODUS_E2E_NO_EXTERNAL_SERVICES: '1', NODUS_EMBEDDING_QA_TRACE: '1' } });
    let app;
    try {
      const launched = await harness.launch(); app = launched.app;
      launchedApp = app;
      const setObserverStage = await startElectronObservability(app, campaignRoot);
      const page = launched.page; activePage = page; page.setDefaultTimeout(60_000);
      page.on('crash', error => appendProcessEvent({ event: 'playwright-page-crash', message: String(error) }));
      page.on('close', () => appendProcessEvent({ event: 'playwright-page-close' }));
      page.on('pageerror', error => appendProcessEvent({ event: 'renderer-pageerror', message: String(error).slice(0, 1000) }));
      setObserverStage('startup-ui');
      const rendererHttpRequests = [];
      page.on('request', request => {
        const rawUrl = request.url();
        if (!/^https?:/iu.test(rawUrl)) return;
        let parsed;
        try { parsed = new URL(rawUrl); } catch { return; }
        const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
        rendererHttpRequests.push({ at: now(), method: request.method(), url: rawUrl,
          route: loopback ? 'loopback' : 'external', state: 'requested' });
      });
      page.on('requestfailed', request => {
        const row = rendererHttpRequests.findLast(item => item.url === request.url() && item.state === 'requested');
        if (row) { row.state = 'failed'; row.error = request.failure()?.errorText ?? null; }
      });
      await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: 'multilingual-e5-small-int8',
        chatModel: { provider: 'custom', model: 'nodus-campaign-no-generation' },
        synthesisModel: { provider: 'custom', model: 'nodus-campaign-no-generation' },
        ocrLanguages: 'eng+spa+fra+deu+por+ita',
        researchWebSearch: 'off', autoLightScan: false, autoDeepScanOnReadTag: false,
        autoSummaryAfterDeep: false, autoBridgeAfterQueue: false });
      report.electronPid = app.process()?.pid ?? null;
      report.profileSettings = await page.evaluate(async () => ({ settings: await window.nodus.getSettings(), localAi: await window.nodus.getNodusLocalAiStatus() }));
      if (report.profileSettings.settings.embeddingModel === profileId) throw new Error('Fresh profile unexpectedly starts on Q8-512; UI model selection would not commit a change.');
      const appVersion = JSON.parse(await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
      await page.evaluate(version => {
        localStorage.setItem('nodus.lastSeenVersion', version);
        for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07',
          'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA',
          'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
      }, appVersion);
      await page.reload();
      await page.getByTestId('app-shell').waitFor();
      report.initialUi = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 2000) }));

      // Exercise the integrated settings/profile UI before indexing.
      setObserverStage('settings-profile-selection');
      await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
      await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
      await page.getByTestId('embedding-model-input').fill(profileId);
      await page.getByTestId('embedding-model-input').press('Tab');
      await page.getByRole('button', { name: 'Cambiar modelo', exact: true }).click();
      await page.waitForFunction(async id => (await window.nodus.getSettings()).embeddingModel === id, profileId);
      report.selectedProfile = await page.evaluate(async () => ({ settings: await window.nodus.getSettings(), localAi: await window.nodus.getNodusLocalAiStatus() }));
      const selectedModelStatus = report.selectedProfile.localAi.models.find(model => model.id === profileId);
      if (!selectedModelStatus?.downloaded || selectedModelStatus.downloadedBytes !== selectedModelStatus.totalBytes) {
        throw new Error('Q8-512 did not verify as downloaded in the fresh isolated profile.');
      }

      // Use Library's actual file importer. The imported title comes from file metadata;
      // no expected fact or curated excerpt is supplied to the application.
      setObserverStage('library-import');
      await page.evaluate(async () => window.nodus.setGlobalLibrarySettings({
        ...await window.nodus.getGlobalLibrarySettings(), autoPrepareAttachments: false,
      }));
      const imported = await page.evaluate(files => window.nodus.importDroppedGlobalLibraryFiles(files), documents.map(document => document.file));
      report.importResult = imported;
      const itemIds = imported.itemIds ?? imported.items?.map(item => item.id) ?? [];
      if (itemIds.length !== documents.length) throw new Error(`Library import did not return all original files: ${itemIds.length}/${documents.length}`);
      const importedItems = await page.evaluate(ids => Promise.all(ids.map(id => window.nodus.getGlobalLibraryItem(id))), itemIds);
      const itemByHash = new Map(importedItems.flatMap(item => (item?.attachments ?? []).map(attachment => [attachment.sha256, item])));
      const aligned = documents.map(document => ({ ...document, libraryItemId: itemByHash.get(document.sha256)?.id ?? null }));
      if (aligned.some(document => !document.libraryItemId)) throw new Error('One or more imported original files lack matching attachment hashes.');
      report.importedDocuments = aligned.map(({ id, title, format, language, sha256: digest, libraryItemId }) => ({ id, title, format, language, sha256: digest, libraryItemId }));
      const ocrLanguageByCorpusLanguage = { es: 'spa', en: 'eng', fr: 'fra', de: 'deu', pt: 'por', it: 'ita' };
      const extractionGroups = new Map();
      for (const document of aligned) {
        const ocrLanguages = document.format === 'pdf-scanned'
          ? [...new Set([ocrLanguageByCorpusLanguage[document.language] ?? 'eng', 'eng'])].join('+') : 'spa+eng';
        if (!extractionGroups.has(ocrLanguages)) extractionGroups.set(ocrLanguages, []);
        extractionGroups.get(ocrLanguages).push(document.libraryItemId);
      }
      report.extractionBatches = [...extractionGroups].map(([ocrLanguages, ids]) => ({ ocrLanguages, itemIds: ids }));
      for (const [ocrLanguages, ids] of extractionGroups) {
        setObserverStage(`library-extraction-${ocrLanguages}`);
        await page.evaluate(({ ids, ocrLanguages }) => window.nodus.enqueueLibraryExtraction(ids, { ocrMode: 'local', ocrLanguages,
          localOcrOnly: true, extractImages: false, detectTables: true, force: false }), { ids, ocrLanguages });
      }
      const extractionDeadline = Date.now() + 900_000;
      let extractionJobs = [];
      do {
        extractionJobs = await page.evaluate(() => window.nodus.listLibraryExtractionJobs());
        const latest = aligned.map(document => extractionJobs.filter(job => job.itemId === document.libraryItemId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]).filter(Boolean);
        report.extraction = latest.map(job => ({ itemId: job.itemId, status: job.status, error: job.error ?? null }));
        await save('progress.json', report);
        if (latest.length === aligned.length && latest.every(job => ['done', 'failed', 'canceled'].includes(job.status))) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } while (Date.now() < extractionDeadline);
      const completedExtraction = new Map(report.extraction.map(job => [job.itemId, job]));
      report.extractionMissing = aligned.filter(document => !completedExtraction.has(document.libraryItemId)).map(document => document.libraryItemId);
      const notebook = await page.evaluate(async ids => {
        // Notebook creation is performed only from current, hash-verified imported item ids.
        const vault = await window.nodus.getActiveVault();
        await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
        return window.nodus.saveResearchNotebook({ name: 'Live documentary evidence campaign', mode: 'fixed',
          sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] });
      }, aligned.map(document => document.libraryItemId));
      report.notebook = notebook;
      setObserverStage('documentary-preparation-dispatch');
      await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), aligned.map(document => document.libraryItemId));
      const deadline = Date.now() + 2_700_000;
      let inventory;
      do {
        setObserverStage('documentary-preparation-wait');
        inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
        const relevant = inventory.documents.filter(document => aligned.some(source => source.libraryItemId === document.id));
        report.preparation = relevant.map(document => ({ id: document.id, title: document.title, preparation: document.preparation }));
        await save('progress.json', report);
        if (relevant.length === aligned.length && relevant.every(document => document.preparation.status === 'ready'
            && document.preparation.lexical === 'ready' && document.preparation.embeddings === 'ready')) break;
        if (relevant.some(document => ['failed', 'blocked', 'cancelled'].includes(document.preparation.status)
            || document.preparation.embeddings === 'failed')) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      const readyIds = new Set(inventory.documents.filter(document => document.preparation.status === 'ready'
        && document.preparation.lexical === 'ready' && document.preparation.embeddings === 'ready').map(document => document.id));
      if (aligned.some(document => !readyIds.has(document.libraryItemId))) {
        report.status = 'partial-preparation';
        report.preparationFailures = aligned.filter(document => !readyIds.has(document.libraryItemId)).map(document => ({
          id: document.id, libraryItemId: document.libraryItemId,
          inventory: inventory.documents.find(row => row.id === document.libraryItemId)?.preparation ?? null,
        }));
      }

      // Preparation publishes the lexical/source index identity asynchronously.
      // Freeze the notebook's scope after the required vectors are ready.
      const resolvedScope = await page.evaluate(id => window.nodus.resolveResearchNotebook(id), notebook.id);
      report.scopeContract = { notebookId: notebook.id, notebookRevision: notebook.revision, scopeId: resolvedScope.id,
        permissionFingerprint: resolvedScope.permissionFingerprint, resolvedDocumentIds: resolvedScope.documents.map(document => document.id).sort(),
        documents: resolvedScope.documents.map(document => ({ id: document.id, title: document.title, revision: document.revision,
          attachmentId: document.attachmentId, attachments: document.attachments ?? [], coverage: document.coverage,
          indexedSource: document.indexedSource ?? null, origin: document.origin })) };

      // Notebook is opened in the real Research UI. Each question is then sent only
      // to the documentary retriever; no answer generation or external provider call occurs.
      await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
      await page.locator('.research-assistant-header').waitFor();
      if (await page.getByTestId('research-history-toggle').count()
          && !(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
      await page.getByTestId('research-chat-search').fill(notebook.name);
      await page.getByTestId(`research-search-notebook-${notebook.id}`)
        .getByRole('button', { name: `Abrir ${notebook.name}`, exact: true }).click();
      await page.getByTestId('research-notebook-home').waitFor();
      report.embeddingContract = { profileId, provider: 'nodus', dimensions: (inventory.embeddingSpaces ?? [])
        .find(space => space.model === profileId)?.dimensions ?? null,
        ocrResourceManifestSha256: sha256(JSON.stringify(report.ocrResourceManifest)),
        ocrLanguages: report.profileSettings.settings.ocrLanguages,
        extractionBatches: report.extractionBatches,
        localEmbeddingStatus: { downloaded: selectedModelStatus.downloaded, downloadedBytes: selectedModelStatus.downloadedBytes,
          totalBytes: selectedModelStatus.totalBytes, runtime: 'ONNX embedding worker; unrelated llama.cpp runtime status is not used as a readiness signal' },
        modelReady: report.selectedProfile.localAi.models.find(model => model.id === profileId)?.downloaded ?? false,
        sourceCount: aligned.length, retrievalSettings: notebook.settings ?? null,
        profileSettings: { embeddingProvider: report.selectedProfile.settings.embeddingProvider,
          embeddingModel: report.selectedProfile.settings.embeddingModel },
        embeddingSpaces: inventory.embeddingSpaces ?? [], modelAssets: report.assetProof.verified,
        indexContracts: inventory.documents.filter(document => aligned.some(source => source.libraryItemId === document.id)).map(document => ({
          documentId: document.id, preparation: document.preparation, indexedSource: document.indexedSource ?? null,
        })) };
      report.profileContractSha256 = sha256(JSON.stringify(report.embeddingContract));
      const embeddingContractBuild = path.join(campaignRoot, 'profile/tmp/embedding-gemma-contract.mjs');
      const { build: buildContract } = await import('esbuild');
      await buildContract({ entryPoints: [path.join(repoRoot, 'shared/embeddingGemma2.ts')], outfile: embeddingContractBuild,
        bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
      const { embeddingGemma2Contract } = await import(`${pathToFileURL(embeddingContractBuild).href}?campaign=${Date.now()}`);
      report.embeddingContract.embeddingModelContract = embeddingGemma2Contract(profileId);
      report.profileContractSha256 = sha256(JSON.stringify(report.embeddingContract));
      report.scopeContractSha256 = sha256(JSON.stringify(report.scopeContract));
      const retrieved = [];
      const authorizedItemIds = new Set(aligned.map(document => document.libraryItemId));
      const scopeDocuments = new Map(resolvedScope.documents.map(document => [document.id, document]));
      const tracePath = path.join(campaignRoot, 'profile/embedding-trace.jsonl');
      for (const query of queries) {
        setObserverStage(`documentary-retrieval-${query.id}`);
        const startedAt = performance.now();
        const traceOffset = fs.existsSync(tracePath) ? fs.statSync(tracePath).size : 0;
        let search;
        try { search = await page.evaluate(input => window.nodus.searchResearchNotebook(input.notebookId, input.question), { notebookId: notebook.id, question: query.question }); }
        catch (error) { search = { error: String(error), evidence: [], scopeId: null }; }
        const traceRows = fs.existsSync(tracePath) ? fs.readFileSync(tracePath).subarray(traceOffset).toString('utf8')
          .split('\n').filter(Boolean).map(JSON.parse) : [];
        const retrievalTraces = traceRows.filter(row => row.type === 'documentary-retrieval');
        const canonicalModelContract = report.embeddingContract.embeddingModelContract;
        const retrievalContractAudit = retrievalTraces.map(row => {
          const actualContract = row.contract ?? null;
          const contractMatchesCatalog = actualContract ? canonicalResearchJson(actualContract) === canonicalResearchJson(canonicalModelContract) : null;
          const traceVectorKeys = Array.isArray(row.vectorKeys) ? row.vectorKeys : null;
          // Semantic and lexical keys fingerprint different embedding identities.
          // The separate read-only full-identity audit must bind each semantic
          // variant to this scope before any generation campaign is admitted.
          const vectorKeysAuthorized = null;
          return { contractPresent: Boolean(actualContract), contractMatchesCatalog,
            traceVectorKeys, vectorKeysAuthorized, lexicalOnly: row.limitations?.lexicalOnly === true,
            status: !actualContract || !traceVectorKeys ? 'incomplete-trace'
              : !contractMatchesCatalog ? 'mismatch' : 'pending-index-identity-audit' };
        });
        const semanticParticipated = retrievalTraces.some(row => (row.retrieval?.semantic?.length ?? 0) > 0);
        const lexicalFallback = retrievalTraces.some(row => row.limitations?.lexicalOnly === true);
        const evidence = search.evidence ?? [];
        const scopeLeaks = evidence.filter(item => !authorizedItemIds.has(item.documentId)).map(item => ({
          evidenceId: item.id, documentId: item.documentId ?? null, title: item.title ?? null,
        }));
        const citationIds = evidence.map(item => `documentary:${search.scopeId}:${item.id}`);
        const resolved = citationIds.length ? await page.evaluate(ids => Promise.all(ids.map(id => window.nodus.getPassage(id))), citationIds) : [];
        const sourcesContext = { notebookId: notebook.id, scopeId: search.scopeId ?? null,
          permissionFingerprint: resolvedScope.permissionFingerprint, authorizedDocumentIds: [...authorizedItemIds].sort(),
          receipts: evidence.map((item, index) => ({ evidenceId: item.id, documentId: item.documentId,
            citationId: citationIds[index], canonicalNodusLink: `nodus://passage/${encodeURIComponent(citationIds[index])}`,
            evidenceSha256: sha256(item.text), resolved: Boolean(resolved[index]),
            resolvedLibraryItemId: resolved[index]?.libraryItemId ?? null,
            resolvedTextSha256: resolved[index] ? sha256(resolved[index].text) : null })) };
        const permittedPassages = evidence.flatMap((item, index) => {
          const detail = resolved[index];
          if (!detail || !authorizedItemIds.has(detail.libraryItemId) || detail.libraryItemId !== item.documentId
              || detail.text !== item.text) return [];
          const document = scopeDocuments.get(item.documentId);
          const citationId = citationIds[index];
          const title = document?.title ?? 'Untitled source';
          return [{ id: citationId, label: title, title, citation: `nodus://passage/${encodeURIComponent(citationId)}`,
            text: detail.text, ...(item.locator?.pageLabel ? { pageLabel: item.locator.pageLabel } : {}),
            reason: item.provenance, authors: document?.authors ?? [], ...(Number.isInteger(document?.year) ? { year: document.year } : {}) }];
        });
        const selectedContext = { research_scope: { answer_mode: 'documentary', documentary_evidence_required: true,
          notebook_id: notebook.id, scope_id: search.scopeId ?? null, partial: search.partial ?? false },
          pasajes_relevantes: permittedPassages };
        const sourceContext = JSON.stringify({ contexto_modular_seleccionado: selectedContext,
          conversacion: [{ role: 'user', content: query.question }] }, null, 2);
        const runKind = query.kind === 'no-evidence' ? 'absence'
          : query.kind === 'hard-negative' ? 'hard'
            : ['monolingual', 'cross-language'].includes(query.kind) ? 'core' : 'complex';
        const caseRecord = { id: query.id, name: query.name, kind: runKind, cohortKind: query.kind, question: query.question, language: query.language,
          isAnswerable: query.isAnswerable, sourceContext, sourceContextSha256: sha256(sourceContext),
          sourcesContext, sourcesContextSha256: sha256(JSON.stringify(sourcesContext)),
          retrievalTraces, retrievalContractAudit, semanticParticipated, lexicalFallback,
          sourceEvidence: evidence.map((item, index) => ({ evidenceId: item.id, citationId: citationIds[index],
            canonicalNodusLink: `nodus://passage/${encodeURIComponent(citationIds[index])}`, text: item.text,
            title: scopeDocuments.get(item.documentId)?.title ?? null, provenance: item.provenance,
            locator: item.locator, documentId: item.documentId })),
          resolvedEvidence: resolved.map((item, index) => ({ citationId: citationIds[index], resolved: Boolean(item),
            passageId: item?.passage_id ?? null, text: item?.text ?? null, provenance: item?.provenance ?? null,
            pageLabel: item?.page_label ?? null, pageNumber: item?.page_number ?? null,
            revision: item?.revision ?? null, attachmentId: item?.attachmentId ?? null,
            attachmentRevision: item?.attachmentRevision ?? null, libraryItemId: item?.libraryItemId ?? null,
            work: item?.work ?? null, evidenceSha256: item ? sha256(item.text) : null })),
          citationResolution: { attempted: citationIds.length, attemptedIds: [...citationIds],
            resolved: resolved.filter(Boolean).length, resolvedIds: citationIds.filter((_, index) => Boolean(resolved[index])),
            unresolved: resolved.filter(item => !item).length, unresolvedIds: citationIds.filter((_, index) => !resolved[index]),
            resolvedTextsMatchSearch: evidence.every((item, index) => !resolved[index] || resolved[index].text === item.text),
            resolvedDocumentsAuthorized: resolved.every(item => !item || authorizedItemIds.has(item.libraryItemId)) },
          scopeLeaks, searchError: search.error ?? null, latencyMs: performance.now() - startedAt };
        caseRecord.caseSourceSnapshotSha256 = sha256(JSON.stringify({ caseId: caseRecord.id, question: caseRecord.question,
          language: caseRecord.language, isAnswerable: caseRecord.isAnswerable,
          sourceContextSha256: caseRecord.sourceContextSha256, sourcesContextSha256: caseRecord.sourcesContextSha256,
          profileContractSha256: report.profileContractSha256, scopeContractSha256: report.scopeContractSha256 }));
        retrieved.push(caseRecord);
        report.modelCalls = 0;
        report.retrievalCompleted = retrieved.length;
        await save('case-sources.partial.json', { format: 'nodus.research-case-sources/1', createdAt: now(),
          notebookId: notebook.id, profileId, cases: retrieved });
        await save('progress.json', report);
      }
      report.cases = retrieved.length;
      report.observedLexicalFallbackCases = retrieved.filter(item => item.lexicalFallback).map(item => item.id);
      report.observedSemanticCandidateCases = retrieved.filter(item => item.semanticParticipated).map(item => item.id);
      report.citationResolution = { attempted: retrieved.reduce((sum, item) => sum + item.citationResolution.attempted, 0),
        resolved: retrieved.reduce((sum, item) => sum + item.citationResolution.resolved, 0),
        unresolved: retrieved.reduce((sum, item) => sum + item.citationResolution.unresolved, 0),
        everyCapturedIdAttempted: retrieved.every(item => item.citationResolution.attemptedIds.length === item.sourceEvidence.length),
        allCapturedIdsResolved: retrieved.every(item => item.citationResolution.attemptedIds.length === item.citationResolution.resolvedIds.length),
        allResolvedTextsMatchSearch: retrieved.every(item => item.citationResolution.resolvedTextsMatchSearch),
        allResolvedDocumentsAuthorized: retrieved.every(item => item.citationResolution.resolvedDocumentsAuthorized) };
      report.scopeLeakCount = retrieved.reduce((sum, item) => sum + item.scopeLeaks.length, 0);
      report.evidenceBindingViolations = retrieved.reduce((sum, item) => sum + item.scopeLeaks.length
        + Number(!item.citationResolution.resolvedTextsMatchSearch)
        + Number(!item.citationResolution.resolvedDocumentsAuthorized), 0);
      const allTraceAudits = retrieved.flatMap(item => item.retrievalContractAudit);
      report.retrievalContractAudit = { expectedContractSha256: sha256(JSON.stringify(report.embeddingContract.embeddingModelContract)),
        traces: allTraceAudits.length, verified: allTraceAudits.filter(item => item.status === 'verified').length,
        mismatches: allTraceAudits.filter(item => item.status === 'mismatch').length,
        incomplete: allTraceAudits.filter(item => item.status === 'incomplete-trace').length,
        pendingFullIdentityAudit: allTraceAudits.filter(item => item.status === 'pending-index-identity-audit').length,
        checks: allTraceAudits };
      report.networkAudit = { rendererHttpRequests, loopback: rendererHttpRequests.filter(row => row.route === 'loopback'),
        external: rendererHttpRequests.filter(row => row.route === 'external'), providerModelCalls: 0,
        loopbackAllowedPorts: harness.proof.allowedLoopbackPorts, isolationProof: harness.proof,
        coverage: 'Playwright renderer HTTP(S) requests; external outbound connections are denied by inherited OS sandbox. Model generation/provider calls are disabled.' };
      report.status = report.status === 'partial-preparation' ? report.status : 'retrieval-complete-awaiting-index-identity-audit';
      const casesDigest = sha256(JSON.stringify(retrieved.map(item => ({ id: item.id, caseSourceSnapshotSha256: item.caseSourceSnapshotSha256 }))));
      report.caseSourceSnapshotSha256 = casesDigest;
      const output = { format: 'nodus.research-case-sources/1', createdAt: now(), notebookId: notebook.id,
        profileRoot: campaignRoot, profileId, profileContract: report.embeddingContract, profileContractSha256: report.profileContractSha256,
        scopeContract: report.scopeContract, scopeContractSha256: report.scopeContractSha256,
        corpusSourceHashes: documents.map(document => ({ id: document.id, sha256: document.sha256 })),
        caseSourceSnapshotSha256: casesDigest, cases: retrieved };
      await save('case-sources.json', output);
      report.sourceVersionAfter = sourceVersionSnapshot();
      report.buildArtifactsAfter = buildArtifactSnapshot();
      report.runtimeAndBuildUnchanged = JSON.stringify(report.sourceVersionBefore) === JSON.stringify(report.sourceVersionAfter)
        && JSON.stringify(report.buildArtifactsBefore) === JSON.stringify(report.buildArtifactsAfter);
      if (!report.runtimeAndBuildUnchanged) throw new Error('Runtime source or build artifacts changed during the live campaign.');
      const accessLog = path.join(campaignRoot, 'profile/database-access.jsonl');
      const opens = fs.existsSync(accessLog) ? fs.readFileSync(accessLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      report.databaseOpens = opens.length;
      report.databaseOpensContained = opens.every(row => path.resolve(row.path).startsWith(path.join(campaignRoot, 'profile') + path.sep));
      if (!report.databaseOpensContained) throw new Error('A database was opened outside the disposable profile.');
      await save('case-sources.json', output);
    } finally { await harness.close(); }
  }
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.failureStage = observerStage;
  if (activePage && !activePage.isClosed()) {
    report.failureUi = await activePage.evaluate(() => ({ title: document.title, url: location.href })).catch(() => null);
    const screenshot = path.join(artifacts, 'failed-ui.png');
    await activePage.screenshot({ path: screenshot, fullPage: false }).then(() => { report.failureScreenshot = screenshot; }).catch(() => {});
  } else report.failureUi = { pageClosed: true };
  if (report.status === 'preparing') report.status = 'blocked';
} finally {
  if (observerTimer) clearInterval(observerTimer);
  report.sourceVersionAfter = sourceVersionSnapshot();
  report.buildArtifactsAfter = buildArtifactSnapshot();
  report.harnessSha256 = sha256(fs.readFileSync(new URL(import.meta.url)));
  report.runtimeAndBuildUnchanged = JSON.stringify(report.sourceVersionBefore) === JSON.stringify(report.sourceVersionAfter)
    && JSON.stringify(report.buildArtifactsBefore) === JSON.stringify(report.buildArtifactsAfter);
  report.processObservability = { eventsFile: processEventsFile, stdoutFile: processStdoutFile,
    stderrFile: processStderrFile, eventFileBytes: fs.existsSync(processEventsFile) ? fs.statSync(processEventsFile).size : 0,
    stdoutBytes: fs.existsSync(processStdoutFile) ? fs.statSync(processStdoutFile).size : 0,
    stderrBytes: fs.existsSync(processStderrFile) ? fs.statSync(processStderrFile).size : 0,
    // Playwright disposes its process dispatcher during harness.close(). The
    // PID captured while the application was live remains valid evidence.
    electronPid: report.electronPid ?? null };
  report.finishedAt = now();
  await save('campaign.json', report);
  console.log(JSON.stringify(report, null, 2));
}

if (report.failure) process.exitCode = 1;
