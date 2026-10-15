import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright-core';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const root = createResearchTestRoot();
// This zero-provider-call UI smoke never needs credentials. Disable OS Safe
// Storage through the existing harness gate before application startup.
const emptyKeysFile = path.join(root, 'fixtures/empty-provider-keys.json');
fs.writeFileSync(emptyKeysFile, '{}\n', { mode: 0o600, flag: 'wx' });
const sandbox = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, sandbox);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const policyPath = path.join(root, 'isolation.sb');
const wrapper = path.join(root, 'electron-isolated');
fs.writeFileSync(policyPath, sandbox);
fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policyPath)} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
let app;
const sha256 = file => createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex');
const builtFiles = fs.readdirSync(path.join(repoRoot, 'dist-electron')).filter(name => name.endsWith('.js')).sort().map(name => `dist-electron/${name}`);
const report = { root, proof, completed: false, modelCalls: 0, productionFixtures: false,
  safeStorage: 'disabled by an empty isolated harness key file',
  startedAt: new Date().toISOString(), sourceVersion: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()),
    builtFiles: Object.fromEntries(builtFiles.map(file => [file, sha256(file)])),
  } };
try {
  // Seatbelt cannot be nested. This test uses the inherited OS profile above
  // for the entire process tree instead of Chromium's additional child profile.
  app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', '--disable-gpu', repoRoot], cwd: root,
    env: { ...researchTestEnvironment(root), NODUS_HARNESS_KEYS_FILE: emptyKeysFile }, timeout: 60_000 });
  const page = await app.firstWindow();
  report.runtime = await app.evaluate(() => ({ versions: process.versions, platform: process.platform, arch: process.arch }));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), null, { timeout: 60_000 });
  const paths = await app.evaluate(({ app }) => ({
    userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), temp: app.getPath('temp'),
    appData: app.getPath('appData'), downloads: app.getPath('downloads'),
  }));
  for (const value of Object.values(paths)) assert.ok(value.startsWith(`${root}/`));
  const windowTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  assert.equal(windowTitle, 'Nodus Research · Desarrollo');
  const audit = fs.readFileSync(path.join(root, 'profile/database-access.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(audit.length > 0);
  for (const row of audit) assert.ok(row.path.startsWith(`${root}/profile/`));
  await page.screenshot({ path: path.join(root, 'artifacts/startup.png') });
  if (process.argv.includes('--notebooks')) {
    const corpus = await page.evaluate(async ({ root, verification }) => {
      await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' });
      await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false, autoBackupFolder: `${root}/library`, onboardingComplete: true,
        basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true,
        uiLanguage: 'es', mascotStyle: 'orb', mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true,
        chatModel: verification ? { provider: 'openrouter', model: 'mistralai/mistral-small-3.2-24b-instruct' } : { provider: 'deepseek', model: 'deepseek-flash' } });
      const collections = [];
      for (const name of ['Synthetic North', 'Synthetic South', 'Synthetic Comparison']) collections.push(await window.nodus.createGlobalLibraryCollection(name, null));
      const items = [];
      for (const [i, text] of ['North field measured 23 units. Evidence marker NORTH23.', 'South field measured 41 units. Evidence marker SOUTH41.', 'The comparison found conflicting measurements. Evidence marker COMPARE64.'].entries()) {
        items.push(await window.nodus.createGlobalLibraryItem({ title: `Synthetic research ${i + 1}`, itemType: 'report', creators: [], abstract: text }, [collections[i].id]));
      }
      const notebook = await window.nodus.saveResearchNotebook({ name: 'Synthetic fixed notebook', mode: 'fixed',
        sources: [{ kind: 'library-collection', id: collections[0].id }, { kind: 'library-item', id: items[1].id }], exclusions: [items[1].id] });
      const scope = await window.nodus.resolveResearchNotebook(notebook.id);
      await window.nodus.prepareResearchDocuments(scope.documents.map(document => document.id));
      return { collections, items, notebook, scope };
    }, { root, verification: process.argv.includes('--verification') });
    assert.equal(corpus.scope.documents.length, 1);
    assert.equal(corpus.scope.documents[0].id, corpus.items[0].id);
    let preparation;
    const deadline = Date.now() + 60000;
    do {
      preparation = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
      if (preparation.documents.find(document => document.id === corpus.items[0].id)?.preparation.lexical === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    fs.writeFileSync(path.join(root, 'artifacts/corpus.json'), JSON.stringify(corpus, null, 2));
    fs.writeFileSync(path.join(root, 'artifacts/preparation.json'), JSON.stringify(preparation, null, 2));
    const prepared = preparation.documents.find(document => document.id === corpus.items[0].id);
    assert.ok(prepared.preparation.passages > 0);
    assert.equal(preparation.documents.find(document => document.id === corpus.items[1].id).preparation.lexical, 'missing');
    const search = await page.evaluate(async notebookId => window.nodus.searchResearchNotebook(notebookId, 'NORTH23'), corpus.notebook.id);
    assert.equal(search.evidence.length, 1);
    assert.match(search.evidence[0].text, /NORTH23/);
    assert.equal(search.evidence[0].provenance, 'abstract');
    assert.equal(search.evidence[0].locator.pageNumber, null, 'abstracts never acquire invented PDF page numbers');
    const citationId = `documentary:${search.scopeId}:${search.evidence[0].id}`;
    const detail = await page.evaluate(id => window.nodus.getPassage(id), citationId);
    assert.match(detail.text, /NORTH23/);
    assert.equal(detail.provenance, 'abstract');
    assert.equal(detail.libraryItemId, corpus.items[0].id);
    assert.equal(await page.evaluate(id => window.nodus.getPassage(id), citationId.replace(search.scopeId, '0'.repeat(64))), null);
    const narrowed = await page.evaluate(async notebook => window.nodus.saveResearchNotebook({ ...notebook, exclusions: [...notebook.exclusions, notebook.resolvedDocumentIds[0]] }), corpus.notebook);
    assert.equal(await page.evaluate(id => window.nodus.getPassage(id), citationId), null, 'manual exclusion revokes direct citation access');
    corpus.notebook = await page.evaluate(async notebook => window.nodus.saveResearchNotebook(notebook), { ...corpus.notebook, revision: narrowed.revision });

    fs.writeFileSync(path.join(root, 'artifacts/corpus.json'), JSON.stringify(corpus, null, 2));
    fs.writeFileSync(path.join(root, 'artifacts/preparation.json'), JSON.stringify(preparation, null, 2));
    Object.assign(report, { notebooks: { passed: true, collections: corpus.collections.length, sources: corpus.items.length, preparedPassages: prepared.preparation.passages } });
    await page.evaluate(version => {
      localStorage.setItem('nodus.lastSeenVersion', version);
      for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07',
        'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
    }, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version);
    if (process.argv.includes('--preparation')) {
      await page.evaluate(async ids => {
        const vault = await window.nodus.getActiveVault();
        await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
        await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 0, decision: 'pending' });
      }, corpus.items.map(item => item.id));
    }
    await page.reload();
    if (process.argv.includes('--preparation')) report.preparation = await (await import('./verify-research-preparation-ui.mjs')).verifyResearchPreparationUi(page, root);
    await page.getByRole('button', { name: 'Research chat', exact: true }).first().click({ timeout: 20000 });
    // Notebooks live at the top of the chat history.
    await page.locator('.research-assistant-header').waitFor({ timeout: 30000 });
    if (await page.getByTestId('research-history-toggle').count() && !(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
    await page.getByTestId('research-chat-search').fill(corpus.notebook.name);
    await page.getByTestId(`research-search-notebook-${corpus.notebook.id}`).click();
    await page.getByTestId('research-notebook-home').waitFor();
    await page.getByTestId('research-notebook-title').getByRole('button', { name: /Editar colecciones|Edit collections/ }).click();
    await page.getByRole('dialog').filter({ has: page.locator('#research-notebook-title') }).waitFor();
    await page.screenshot({ path: path.join(root, 'artifacts/notebook-editor.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#research-notebook-title').count(), 0, 'Escape closes the notebook editor');
    const layouts = [];
    for (const theme of ['dark', 'light']) for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 640 }]) {
      await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
      await page.setViewportSize(viewport);
      await page.getByTestId('research-notebook-title').getByRole('button', { name: /Editar colecciones|Edit collections/ }).click();
      const editor = page.getByRole('dialog').filter({ has: page.locator('#research-notebook-title') });
      await editor.waitFor();
      await editor.getByRole('textbox', { name: 'Nombre', exact: true }).focus();
      for (let step = 0; step < 16; step++) {
        await page.keyboard.press('Tab');
        assert.equal(await editor.evaluate(element => element.contains(document.activeElement)), true, 'keyboard focus remains in the modal');
      }
      const box = await editor.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'editor fits the window width');
      await page.screenshot({ path: path.join(root, 'artifacts', `notebook-${theme}-${viewport.width}.png`) });
      layouts.push({ theme, viewport, box, keyboardFocusContained: true });
      await page.keyboard.press('Escape');
    }
    report.notebooks.layouts = layouts;
    if (process.argv.includes('--verification')) {
      const toggle = page.getByTestId('research-verification-toggle');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(async () => (await window.nodus.getSettings()).researchAnswerVerification), 'off');
      await toggle.click();
      await page.waitForFunction(async () => (await window.nodus.getSettings()).researchAnswerVerification === 'structured');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: path.join(root, 'artifacts/verification-enabled.png') });
      await toggle.click();
      await page.waitForFunction(async () => (await window.nodus.getSettings()).researchAnswerVerification === 'off');
      report.verification = { passed: true, default: 'off', enabled: 'structured', disabled: 'off', modelCalls: 0 };
    }
    // Back to a general chat, which reads the whole vault, for the checks that follow.
    await page.getByTestId('research-new-conversation').click();
  }
  if (process.argv.includes('--activity')) report.activity = await (await import('./verify-research-activity-ui.mjs')).verifyResearchActivityUi(page, app, root);
  if (process.argv.includes('--skills')) report.skills = await (await import('./verify-research-skill-mention.mjs')).verifyResearchSkillMention(page, app, root);
  if (process.argv.includes('--pdf')) report.pdf = await (await import('./verify-research-pdf.mjs')).verifyResearchPdf(page, app, root);
  const completedAudit = fs.readFileSync(path.join(root, 'profile/database-access.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const row of completedAudit) assert.ok(row.path.startsWith(`${root}/profile/`), 'every database open remains in the QA profile');
  Object.assign(report, { completed: true, paths, databaseOpens: completedAudit.length, initialDatabaseOpens: audit.length });
} catch (error) {
  report.failure = { message: String(error?.message ?? error), stack: error?.stack };
  if (app) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      await fs.promises.writeFile(path.join(root, 'artifacts/failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable'));
      await page.screenshot({ path: path.join(root, 'artifacts/failure.png'), timeout: 10000 }).catch(() => undefined);
    }
  }
  throw error;
} finally {
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  report.buildUnchanged = builtFiles.every(file => sha256(file) === report.sourceVersion.builtFiles[file]);
  if (!report.buildUnchanged) report.completed = false;
  fs.writeFileSync(path.join(root, 'artifacts/startup.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(report.buildUnchanged, true, 'the measured Electron bundles did not change during the run');
}
