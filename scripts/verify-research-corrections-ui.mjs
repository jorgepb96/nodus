/** Real Electron/UI and IPC; Intel availability is simulated on an ARM host.
 * No model calls, credentials, real vaults or downloads. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createResearchApp } from './lib/research-app-harness.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';
if (process.platform !== 'darwin') throw new Error('This isolated Electron smoke requires the macOS Seatbelt harness');
const root = createResearchTestRoot();
const keysFile = path.join(root, 'fixtures/empty-provider-keys.json');
fs.writeFileSync(keysFile, '{}\n', { flag: 'wx', mode: 0o600 });
const harness = await createResearchApp({ root, extraEnv: { NODUS_HARNESS_KEYS_FILE: keysFile } });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = ['electron/ai/nodusLocalAi.ts', 'electron/ai/embeddingGemma2Host.ts', 'shared/embeddingGemma2Availability.ts',
  'src/components/LocalAiModelsSettings.tsx', 'dist-electron/main.js', 'dist/index.html'];
const report = { format: 'nodus.research-corrections-ui/1', root, startedAt: new Date().toISOString(), isolation: harness.proof,
  sourceHashes: Object.fromEntries(files.map(file => [file, hash(file)])), completed: false, modelCalls: 0, credentials: 'empty harness file; safe storage disabled',
  scope: 'Real Electron/UI/IPC on macOS ARM; simulated process.arch=x64 availability. No native Intel inference claimed.' };
let app, nativeArch;
try {
  const launched = await harness.launch(); app = launched.app; const page = launched.page;
  report.host = await app.evaluate(() => ({ arch: process.arch, platform: process.platform, versions: process.versions }));
  nativeArch = report.host.arch; assert.equal(nativeArch, 'arm64');
  const profile = 'embeddinggemma-2-text-q8-512-v1';
  await harness.prepareProfile(page, { uiLanguage: 'en', modelSettingsMode: 'advanced', embeddingProvider: 'nodus', embeddingModel: profile });
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
  }, await app.evaluate(({ app }) => app.getVersion()));
  await app.evaluate(() => { Object.defineProperty(process, 'arch', { value: 'x64', configurable: true }); });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'AI models', exact: true }).click();
  let card = page.getByTestId(`local-model-${profile}`);
  await card.getByTestId('local-model-unavailable').waitFor();
  assert.match(await card.getByTestId('local-model-unavailable').innerText(), /Intel Macs/);
  assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).isDisabled(), true);
  const status = await page.evaluate(() => window.nodus.getNodusLocalAiStatus());
  assert.equal(status.models.filter(m => m.id.startsWith('embeddinggemma-') && m.unavailableReason).length, 2);
  const models = await page.evaluate(() => window.nodus.listEmbeddingModels('nodus'));
  assert.ok(!models.some(m => m.id.startsWith('embeddinggemma-')));
  assert.ok(models.some(m => m.id === 'multilingual-e5-small-int8'));
  const error = await page.evaluate(async id => { try { await window.nodus.downloadNodusLocalModel(id); return null; } catch (e) { return e.message; } }, profile);
  assert.match(error, /Intel Macs/);
  // The intentionally rejected IPC request opens the existing generic model
  // dialog. Close it before checking and capturing the actual availability UI.
  const required = page.getByTestId('ai-model-required-modal');
  await required.getByRole('button', { name: 'Not now', exact: true }).click();
  await required.waitFor({ state: 'detached' });
  const settings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(settings.embeddingModel, profile, 'availability never silently switches the persisted model');
  report.intelSimulation = { status: status.models.filter(m => m.id.startsWith('embeddinggemma-')), availableModels: models.map(m => m.id), downloadError: error,
    preservedModel: settings.embeddingModel, screenshot: path.join(root, 'artifacts/intel-unavailable.png') };
  await card.screenshot({ path: report.intelSimulation.screenshot });
  await app.evaluate(arch => { Object.defineProperty(process, 'arch', { value: arch, configurable: true }); }, nativeArch);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'AI models', exact: true }).click();
  card = page.getByTestId(`local-model-${profile}`);
  await card.getByRole('button', { name: 'Download', exact: true }).waitFor();
  // Wait for the real asynchronous status refresh, not merely the initial card.
  await page.waitForFunction(async () => (await window.nodus.getNodusLocalAiStatus()).models.filter(m => m.id.startsWith('embeddinggemma-')).every(m => !m.unavailableReason));
  await card.getByRole('button', { name: 'Download', exact: true }).waitFor();
  assert.equal(await card.getByTestId('local-model-unavailable').count(), 0);
  await page.waitForFunction(() => { const card = document.querySelector('[data-testid="local-model-embeddinggemma-2-text-q8-512-v1"]'); return [...card.querySelectorAll('button')].some(b => b.textContent === 'Download' && !b.disabled); });
  report.arm = { screenshot: path.join(root, 'artifacts/arm-available.png') };
  await card.screenshot({ path: report.arm.screenshot });
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (app && nativeArch) await app.evaluate(arch => { Object.defineProperty(process, 'arch', { value: arch, configurable: true }); }, nativeArch).catch(() => {});
  await harness.close();
  const file = path.join(root, 'profile/database-access.jsonl');
  const opens = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  report.databaseIsolation = { opens: opens.length, allContained: opens.length > 0 && opens.every(row => row.path.startsWith(`${root}/profile/`)) };
  if (!report.databaseIsolation.allContained) { report.completed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  const result = path.join(root, 'artifacts/corrections-ui.json'); fs.writeFileSync(result, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed, result, failure: report.failure?.message }));
}
