import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createResearchApp, waitFor } from './lib/research-app-harness.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const executablePath = argument('executable'), source = argument('model-root');
if (!executablePath || !source) throw new Error('Provide --executable and a marked --model-root QA profile');
const sourceRoot = await fs.realpath(source), marker = JSON.parse(await fs.readFile(path.join(sourceRoot, 'isolation.json'), 'utf8'));
assert.equal(marker.root, sourceRoot); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
const model = JSON.parse(await fs.readFile(path.join(sourceRoot, 'artifacts/model-manifest.json'), 'utf8'));
const sourceDirectory = path.join(sourceRoot, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
assert.equal(model.directory, sourceDirectory, 'assets must belong to the marked QA profile');
assert.equal(await fs.realpath(sourceDirectory), sourceDirectory, 'model directory must not redirect outside QA');
const qaRoot = createResearchTestRoot();
const keysFile = path.join(qaRoot, 'fixtures/empty-provider-keys.json');
await fs.writeFile(keysFile, '{}\n', { mode: 0o600, flag: 'wx' });
const harness = await createResearchApp({ root: qaRoot, executablePath, appArgs: [],
  extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1', NODUS_HARNESS_KEYS_FILE: keysFile } });
const report = { format: 'nodus.embedding-package-smoke/1', root: harness.root, executablePath, platform: process.platform, architecture: process.arch,
  isolation: harness.proof, safeStorageGate: { keysFile, literalEmptyKeys: true }, assetProof: [], completed: false };
try {
  const target = path.join(harness.root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
  // APFS/reflink copies keep independent paths and copy-on-write file contents;
  // the sandbox still forbids access to the source profile. No shared symlinks.
  for (const asset of model.assets) {
    assert.equal(typeof asset.file, 'string');
    assert(!path.isAbsolute(asset.file) && !asset.file.split(/[\\/]/u).includes('..'));
    const origin = path.join(sourceDirectory, asset.file);
    const stat = await fs.lstat(origin);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await fs.realpath(origin), origin);
    const hash = await fileHash(origin);
    assert.equal(stat.size, asset.bytes); assert.equal(hash, asset.sha256);
    const file = path.join(target, asset.file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.copyFile(origin, file, constants.COPYFILE_FICLONE);
    assert.equal(await fileHash(file), hash);
    report.assetProof.push({ file: asset.file, bytes: stat.size, sha256: hash });
  }
  const { app, page } = await harness.launch();
  report.package = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), pid: process.pid, metrics: app.getAppMetrics() }));
  assert(report.package.packaged); assert(report.package.appPath.endsWith('.asar'));
  const legalNotice = path.join(path.dirname(report.package.appPath), 'legal/EMBEDDINGGEMMA_2_NOTICE.md');
  const noticeText = await fs.readFile(legalNotice, 'utf8');
  assert(noticeText.includes('Apache License 2.0') && noticeText.includes('Gemma Prohibited Use Policy'));
  report.legalNotice = { path: legalNotice, declaredLicense: 'Apache-2.0', unresolvedPolicyStatementRetained: true };
  await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: 'embeddinggemma-2-text-q8-512-v1' });
  const item = await page.evaluate(() => window.nodus.createGlobalLibraryItem({ title: 'Packaged sensor source', itemType: 'report', creators: [], abstract: 'El sensor Alba mide turbidez con luz verde de 530 nm. No mide oxígeno.' }, []));
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Packaged local inference', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), item.id);
  assert(await waitFor(async () => (await page.evaluate(id => window.nodus.getResearchNotebookPreparation(id), notebook.id)).ready === 1, { timeoutMs: 120000 }));
  report.profiles = [];
  for (const dimensions of [512, 256]) {
    const profile = `embeddinggemma-2-text-q8-${dimensions}-v1`;
    await page.evaluate(profile => window.nodus.updateSettings({ embeddingModel: profile }), profile);
    const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    assert.equal(inventory.embeddingsExpected, true);
    if (dimensions === 256) {
      assert.notEqual(inventory.documents.find(document => document.id === item.id).preparation.embeddings, 'ready');
      assert.equal((await page.evaluate(id => window.nodus.getResearchNotebookPreparation(id), notebook.id)).ready, 0);
      report.profileSwitchRequiresRebuild = true;
    }
    await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id);
    assert(await waitFor(async () => (await page.evaluate(id => window.nodus.getResearchNotebookPreparation(id), notebook.id)).ready === 1, { timeoutMs: 120000 }));
    const hit = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Which apparatus determines how cloudy a liquid is using a visible beam?'), notebook.id);
    assert(hit.evidence.some(evidence => /turbidez/.test(evidence.text)));
    const traces = (await fs.readFile(path.join(harness.root, 'profile/embedding-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const trace = traces.filter(trace => trace.type === 'documentary-retrieval').at(-1);
    assert(trace.retrieval.semantic.length); assert.equal((typeof trace.contract === 'string' ? JSON.parse(trace.contract) : trace.contract).dim, dimensions);
    report.profiles.push({ profile, evidence: hit.evidence, trace });
  }
  report.screenshot = path.join(harness.root, 'artifacts/package.png'); await page.screenshot({ path: report.screenshot });
  await page.evaluate(async version => {
    await window.nodus.updateSettings({ uiLanguage: 'en', modelSettingsMode: 'advanced' });
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
  }, await app.evaluate(({ app }) => app.getVersion()));
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'AI models', exact: true }).click();
  const models = page.getByTestId('nodus-local-embedding-list');
  const card = models.getByTestId('local-model-embeddinggemma-2-text-q8-512-v1');
  await card.getByText('Experimental', { exact: true }).waitFor();
  assert.equal(await models.locator('[data-testid^="local-model-embeddinggemma-"]').count(), 1);
  assert.match(await card.innerText(), /Product validation pending/);
  assert.match(await card.innerText(), /share one download/);
  assert.match(await card.innerText(), /review resource terms/);
  report.settingsScreenshot = path.join(harness.root, 'artifacts/package-settings.png');
  await card.screenshot({ path: report.settingsScreenshot });
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('The shared weights for the 256- and 512-dimensional profiles will be deleted.', { exact: false }).waitFor();
  const confirmation = page.getByRole('dialog', { name: 'Delete local model', exact: true });
  assert(await waitFor(() => confirmation.evaluate(element => Number(getComputedStyle(element).opacity) >= .99), { timeoutMs: 10000 }), 'capture the fully visible confirmation');
  report.deletionScreenshot = path.join(harness.root, 'artifacts/package-deletion.png');
  await page.screenshot({ path: report.deletionScreenshot, animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert((await page.evaluate(() => window.nodus.getNodusLocalAiStatus())).models.filter(model => model.id.startsWith('embeddinggemma')).every(model => model.downloaded));
  report.settings = { language: 'en', sharedCardCount: 1, experimentalBadge: true, licenseTermsLocalized: true, sharedDeletionWarning: true, cancelledDeletionPreservesBothProfiles: true };
  const traces = (await fs.readFile(path.join(harness.root, 'profile/embedding-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const inferenceProcesses = traces.filter(trace => trace.type === 'embedding-gemma-process' && trace.phase === 'spawn');
  assert(inferenceProcesses.length > 0, 'packaged embeddings must run through the isolated utility process');
  assert(inferenceProcesses.every(trace => Number.isSafeInteger(trace.pid) && trace.pid !== report.package.pid));
  report.inferenceProcesses = inferenceProcesses;
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { await harness.close(); await fs.writeFile(path.join(harness.root, 'artifacts/package-smoke.json'), JSON.stringify(report, null, 2)); console.log(`Package report: ${harness.root}/artifacts/package-smoke.json`); }
