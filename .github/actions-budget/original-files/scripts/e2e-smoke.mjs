// End-to-end smoke test: launches the REAL Electron app (dist-electron build)
// against a throwaway user-data profile and verifies the vital signs no unit
// test can see — the window opens, the renderer mounts, the preload bridge is
// live, graph:get answers over real IPC (compute worker included), the DB
// migrates to the current schema, and the renderer logs no uncaught errors.
//
// Requires a build (dist/ + dist-electron/); run via `npm run test:e2e`.
import assert from 'node:assert/strict';
import { waitForCondition } from './lib/waitForCondition.mjs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { WebSocket } from 'ws';
import { buildTextPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

// Re-exec under Electron-as-Node so the final better-sqlite3 check matches the
// app ABI (same pattern as every other script in this suite). Playwright then
// spawns the real Electron GUI as a child of this process.
if (!process.argv.includes('--electron-e2e-smoke')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-smoke.mjs'), '--electron-e2e-smoke'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const zoteroApiServer = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Last-Modified-Version', '7');
  if (pathname.endsWith('/groups')) {
    response.end('[]');
    return;
  }
  if (pathname.endsWith('/items/top')) {
    response.setHeader('Total-Results', '1');
    response.end(JSON.stringify([{ key: 'ITEM1', version: 7, data: {
      key: 'ITEM1', version: 7, itemType: 'journalArticle', title: 'Smoke Research Paper',
      date: '2025', creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
      tags: [], collections: [],
    } }]));
    return;
  }
  if (pathname.endsWith('/items/ITEM1/children')) {
    response.end(JSON.stringify([{ key: 'ATT1', version: 7, data: {
      key: 'ATT1', version: 7, itemType: 'attachment', parentItem: 'ITEM1', title: 'Full text PDF',
      contentType: 'application/pdf', linkMode: 'imported_file', filename: 'smoke-paper.pdf',
    } }]));
    return;
  }
  if (pathname.endsWith('/items')) {
    response.setHeader('Total-Results', '1');
    response.end(JSON.stringify([{ key: 'ITEM1', version: 7, data: { key: 'ITEM1', itemType: 'journalArticle', title: 'Smoke Research Paper' } }]));
    return;
  }
  response.statusCode = 404;
  response.end('{"error":"not found"}');
});
zoteroApiServer.listen(0, '127.0.0.1');
await once(zoteroApiServer, 'listening');
const zoteroAddress = zoteroApiServer.address();
assert.ok(zoteroAddress && typeof zoteroAddress !== 'string');
const zoteroApiBase = `http://127.0.0.1:${zoteroAddress.port}/api`;

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-'));
const fakeWhisperPath = path.join(userData, 'fake-whisper-cli.mjs');
if (process.platform !== 'win32') {
  await writeFile(fakeWhisperPath, `#!/usr/bin/env node
process.stderr.write('whisper_print_progress_callback: progress = 25%\\n');
process.stdout.write('[00:00:00.000 --> 00:00:01.000] Hola\\n');
setTimeout(() => {
  process.stderr.write('whisper_print_progress_callback: progress = 100%\\n');
  process.stdout.write('[00:00:01.000 --> 00:00:02.000] mundo\\n');
}, 30);
`, 'utf8');
  await chmod(fakeWhisperPath, 0o755);
  const modelDir = path.join(userData, 'whisper.cpp', 'models');
  await mkdir(modelDir, { recursive: true });
  await writeFile(path.join(modelDir, 'ggml-base.bin'), 'e2e-placeholder');
}
async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const closedCleanly = await Promise.race([
    closed,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timeout);
  if (!closedCleanly && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

let app = null;
try {
  // The child must run as a real GUI app: strip the runner's as-Node flag.
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
    NODUS_E2E_FORCE_STUDY_AI_FAILURE: '1',
    NODUS_E2E_TRANSLATE_FAKE: '1',
    NODUS_ZOTERO_API_BASE: zoteroApiBase,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const packagedExecutable = process.env.NODUS_E2E_EXECUTABLE;
  app = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(packagedExecutable ? [] : [repoRoot]),
    ],
    env: childEnv,
  });
  if (packagedExecutable) console.log(`[e2e] packaged executable: ${packagedExecutable}`);

  // ── Window + renderer mount ─────────────────────────────────────────────────
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err);
    process.stderr.write(`[e2e][pageerror] ${err?.stack ?? err}\n`);
  });
  // Kept so the tutorial walk can prove the CSP actually admits the video embed: a
  // blocked frame never attaches, it only logs "Refused to frame …".
  const consoleMessages = [];
  page.on('console', (message) => { consoleMessages.push(message.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  console.log('[e2e] renderer mounted');

  // Suppress the "what's new" modal: a fresh profile has no last-seen version, so it
  // would otherwise overlay the app and intercept later clicks. localStorage persists
  // across the reloads below (same origin).
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    // The mobile teaser sits between release notes and everything behind it.
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
  }, appVersion);

  // ── Preload bridge ──────────────────────────────────────────────────────────
  const bridge = await page.evaluate(() => ({
    hasNodus: typeof window.nodus === 'object' && window.nodus !== null,
    hasGetGraph: typeof window.nodus?.getGraph === 'function',
    hasEdgeFeedback: typeof window.nodus?.setEdgeFeedback === 'function',
    hasImageModels: typeof window.nodus?.listImageModels === 'function',
    hasImageQueue: typeof window.nodus?.queueDecorativeImage === 'function',
    hasSearchDetail: typeof window.nodus?.getSearchResultDetail === 'function',
    hasStudyStt: typeof window.nodus?.transcribeStudyAudio === 'function',
    hasStudyImprove: typeof window.nodus?.improveStudyText === 'function' && typeof window.nodus?.listStudyStyles === 'function',
    hasStudySynonyms: typeof window.nodus?.suggestStudySynonyms === 'function',
    hasStudyRecordings: typeof window.nodus?.createStudyRecording === 'function' && typeof window.nodus?.saveStudyTranscript === 'function',
    hasStudySearch: typeof window.nodus?.searchStudyCorpus === 'function' && typeof window.nodus?.rebuildStudySearchIndex === 'function',
    hasStudyKnowledge: typeof window.nodus?.listStudyIdeas === 'function' && typeof window.nodus?.getStudyKnowledgeGraph === 'function' && typeof window.nodus?.reanalyzeStudyKnowledgeSource === 'function',
    blocksAiStudyGrading: typeof window.nodus?.gradeStudyAnswer !== 'function' && typeof window.nodus?.listStudyRubrics === 'function',
    hasStudyLearning: typeof window.nodus?.createStudyFlashcard === 'function' && typeof window.nodus?.getStudyPlanner === 'function' && typeof window.nodus?.getStudyProgressDashboard === 'function',
    hasStudyAiPolicy: typeof window.nodus?.getStudyAiUsageSummary === 'function' && typeof window.nodus?.clearStudyAiUsage === 'function',
    hasStudyDemo: typeof window.nodus?.seedStudyDemoData === 'function',
    hasNodusLocalAi: typeof window.nodus?.getNodusLocalAiStatus === 'function' && typeof window.nodus?.downloadNodusLocalModel === 'function' && typeof window.nodus?.deleteNodusLocalModel === 'function',
    hasAiConcurrency: typeof window.nodus?.getAiConcurrencySnapshot === 'function' && typeof window.nodus?.onAiConcurrencySnapshot === 'function',
    hasChatGptSubscription: typeof window.nodus?.getChatGptSubscriptionStatus === 'function' && typeof window.nodus?.startChatGptSubscriptionLogin === 'function' && typeof window.nodus?.logoutChatGptSubscription === 'function',
    hasGitHubCopilotSubscription: typeof window.nodus?.getGitHubCopilotSubscriptionStatus === 'function' && typeof window.nodus?.startGitHubCopilotSubscriptionLogin === 'function' && typeof window.nodus?.logoutGitHubCopilotSubscription === 'function',
    hasOpenCodeGoUsage: typeof window.nodus?.getOpenCodeGoUsageStatus === 'function' && typeof window.nodus?.onOpenCodeGoUsageStatusChanged === 'function',
    hasProtect: typeof window.nodus?.pickProtectFiles === 'function' && typeof window.nodus?.readProtectSource === 'function' && typeof window.nodus?.saveProtectArtifactToVault === 'function' && typeof window.nodus?.downloadProtectCopy === 'function',
    hasDatabaseDeepResearch: [
      'previewDatabaseDeepResearch', 'enqueueDatabaseDeepResearch', 'listDatabaseDeepResearchJobs',
      'getDatabaseDeepResearchJob', 'cancelDatabaseDeepResearchJob', 'clearFinishedDatabaseDeepResearchJobs',
      'listDatabaseDeepResearchReports', 'getDatabaseDeepResearchReport', 'deleteDatabaseDeepResearchReport',
      'exportDatabaseDeepResearchReport', 'onDatabaseDeepResearchProgress',
    ].every((name) => typeof window.nodus?.[name] === 'function'),
  }));
  assert.equal(bridge.hasNodus, true, 'window.nodus bridge exposed');
  assert.equal(bridge.hasGetGraph, true, 'getGraph available');
  assert.equal(bridge.hasEdgeFeedback, true, 'setEdgeFeedback available');
  assert.equal(bridge.hasImageModels, true, 'image model catalog available');
  assert.equal(bridge.hasImageQueue, true, 'decorative image queue available');
  assert.equal(bridge.hasSearchDetail, true, 'search detail modal bridge available');
  assert.equal(bridge.hasStudyStt, true, 'study speech-to-text bridge available');
  assert.equal(bridge.hasStudyImprove, true, 'study improvement and style bridge available');
  assert.equal(bridge.hasStudySynonyms, true, 'contextual study synonyms bridge available');
  assert.equal(bridge.hasStudyRecordings, true, 'study recording and transcript bridge available');
  assert.equal(bridge.hasStudySearch, true, 'study hybrid-search bridge available');
  assert.equal(bridge.hasStudyKnowledge, true, 'study ideas and knowledge-graph bridge available');
  assert.equal(bridge.blocksAiStudyGrading, true, 'AI grading bridge is absent while local rubric management remains available');
  assert.equal(bridge.hasStudyLearning, true, 'study review, progress and planner bridge available');
  assert.equal(bridge.hasStudyAiPolicy, true, 'study AI policy and usage bridge available');
  assert.equal(bridge.hasStudyDemo, true, 'study sample-data bridge available');
  assert.equal(bridge.hasNodusLocalAi, true, 'integrated local AI model manager bridge available');
  assert.equal(bridge.hasAiConcurrency, true, 'adaptive AI concurrency snapshot bridge available');
  assert.deepEqual(await page.evaluate(() => window.nodus.getAiConcurrencySnapshot()), [], 'fresh profile has no leaked provider/model state');
  assert.equal(bridge.hasChatGptSubscription, true, 'managed ChatGPT subscription bridge available');
  assert.equal(bridge.hasGitHubCopilotSubscription, true, 'managed GitHub Copilot subscription bridge available');
  assert.equal(bridge.hasOpenCodeGoUsage, true, 'OpenCode Go usage bridge available');
  assert.equal(bridge.hasProtect, true, 'Nodus Protect secure bridge available');
  assert.equal(bridge.hasDatabaseDeepResearch, true, 'database Deep Research bridge is complete');
  const signedOutChatGpt = await page.evaluate(() => window.nodus.getChatGptSubscriptionStatus());
  assert.equal(signedOutChatGpt.available, true, `official Codex runtime is available: ${signedOutChatGpt.error ?? 'ok'}`);
  assert.equal(signedOutChatGpt.connected, false, 'throwaway profile starts without a ChatGPT account');
  assert.equal(signedOutChatGpt.loginPending, false, 'throwaway profile has no pending OAuth flow');
  console.log('[e2e] preload bridge ok');

  // ── Essential tutorial: first screen, language preferences, seen-once gate ──
  await page.getByTestId('basics-tutorial-language').waitFor({ timeout: 30_000 });
  const languageButtonSizes = await page.locator('.tutorial-language-option').evaluateAll((buttons) =>
    buttons.map((button) => { const box = button.getBoundingClientRect(); return `${Math.round(box.width)}x${Math.round(box.height)}`; }));
  assert.equal(new Set(languageButtonSizes).size, 1, `every cinematic tutorial language button has the same dimensions: ${languageButtonSizes.join(', ')}`);
  await page.getByTestId('tutorial-language-fr').click();
  // Second screen: which Nodi guides the rest. It speaks the language just chosen, and
  // records the choice so the one-time modal never asks again after the tutorial.
  await page.getByTestId('basics-tutorial-nodi-style').waitFor({ timeout: 30_000 });
  await page.getByText('Quel Nodi préférez-vous ?', { exact: true }).waitFor();
  await page.getByTestId('nodi-style-classic').click();
  await waitForCondition('elección de Nodi registrada', () => page.evaluate(async () => {
    const settings = await window.nodus.getSettings();
    return settings.mascotStyle === 'classic' && settings.mascotStyleChosen === true;
  }));
  // Third screen: watch the tutorials or read the deck. Walk the video path first —
  // including the player, whose embed the CSP has to admit — then come back to the
  // written guide, which is the offline path the rest of this walk relies on.
  await page.getByTestId('basics-tutorial-mode').waitFor({ timeout: 30_000 });
  await page.getByText('Comment préférez-vous apprendre ?', { exact: true }).waitFor();
  await page.getByTestId('tutorial-mode-video').click();
  await page.getByTestId('basics-tutorial-videos').waitFor({ timeout: 30_000 });
  // ONE tutorial, not the catalogue. A brand-new install has no vault yet, so the vault
  // videos would be cards about places the reader cannot go; they are deferred and said
  // out loud instead (below).
  await page.getByTestId('tutorial-video-feature').waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.tutorial-video-card').count(), 0, 'the first-run screen is not the grid');
  assert.equal(await page.locator('.tutorial-video-feature-card').count(), 1, 'exactly one tutorial is offered');
  // …and the screen SAYS where the others are: each vault's on creation, all of them in
  // Settings. That promise is the whole point of showing only one here.
  const whereText = await page.getByTestId('tutorial-video-where').innerText();
  assert.match(whereText, /coffre/i, 'it names the vaults, in the language chosen');
  assert.match(whereText, /Réglages/, 'and points at Settings for the full catalogue');
  for (const shelf of ['Introduction', 'Coffres', 'Fonctions', 'Intégrations']) {
    assert.ok(whereText.includes(shelf), `the four shelves are named: missing ${shelf}`);
  }

  await page.getByTestId('tutorial-video-play-essentials').click();
  const videoPlayer = page.getByTestId('tutorial-video-player');
  await videoPlayer.waitFor({ timeout: 30_000 });
  const embedSrc = (await videoPlayer.locator('iframe').getAttribute('src')) ?? '';
  assert.match(embedSrc, /^https:\/\/www\.youtube-nocookie\.com\/embed\/QqSY1_DeDRM\?/, 'the player embeds the no-cookie host');
  assert.match(embedSrc, /hl=fr/, 'the embed follows the language chosen for the tutorial');
  assert.equal(await videoPlayer.locator('iframe[allowfullscreen]').count(), 1, 'the embedded player can go fullscreen');
  // The badge is the shelf, not "Tutorial 1": the published titles stopped being numbered.
  // innerText comes back upper-cased: the bar is styled `text-transform: uppercase`.
  assert.equal(
    (await videoPlayer.locator('.tutorial-video-player-bar span').innerText()).toLowerCase(),
    'introduction',
  );
  await waitForCondition('vídeo marcado como visto', () => page.evaluate(async () => {
    const settings = await window.nodus.getSettings();
    return Array.isArray(settings.tutorialVideosWatched) && settings.tutorialVideosWatched.includes('essentials');
  }));
  await page.getByTestId('tutorial-video-close').click();
  await videoPlayer.waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('.tutorial-video-feature-card .tutorial-video-watched').count(),
    1,
    'the featured card reflects the watched flag once the player closes'
  );
  const framingRefusals = consoleMessages.filter((text) => /Refused to frame/i.test(text));
  assert.deepEqual(framingRefusals, [], `the CSP admits the tutorial embed: ${framingRefusals.join(' | ')}`);
  await page.getByTestId('tutorial-mode-switch-text').click();

  await page.getByTestId('basics-tutorial').waitFor({ timeout: 30_000 });
  // French now has a full UI translation, so choosing it keeps the French interface
  // instead of borrowing the English one.
  await waitForCondition('preferencias de idioma del tutorial', () => page.evaluate(async () => {
    const settings = await window.nodus.getSettings();
    return settings.uiLanguage === 'fr' && settings.promptLanguage === 'fr';
  }));
  assert.equal(await page.locator('.tutorial-progress button').count(), 19, 'essential guide exposes thirteen core chapters plus three model-guidance and three connected-workflow chapters');
  await page.locator('.tutorial-topbar button').click();
  // The skip dialog follows the (now French) UI language, proving the French table
  // is actually wired into a real render.
  await page.getByText('Passer le guide essentiel ?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Passer quand même', exact: true }).click();
  await page.getByTestId('basics-tutorial').waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).basicsTutorialVersion, 5, 'confirmed skip records the current tutorial version globally');

  // Finish setup, then walk every translated language on the real shell. These labels
  // reach the DOM from navigation.ts through t(), so they prove each table is wired
  // all the way through a render rather than merely present on disk. Words are
  // distinctive per language (and per Portuguese variant) so a table cannot pass by
  // falling back to English or to its sibling variant.
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true }));
  const SIDEBAR_BY_LANGUAGE = {
    fr: ['accueil', 'bibliothèque', 'idées', 'paramètres'],
    de: ['start', 'bibliothek', 'ideen', 'einstellungen'],
    pt: ['início', 'biblioteca', 'ideias', 'definições'],
    'pt-BR': ['início', 'biblioteca', 'ideias', 'configurações'],
    it: ['casa', 'biblioteca', 'idee', 'impostazioni'],
  };
  for (const [language, labels] of Object.entries(SIDEBAR_BY_LANGUAGE)) {
    await page.evaluate((lang) => window.nodus.updateSettings({ uiLanguage: lang }), language);
    await page.reload();
    await page.getByTestId('app-shell').waitFor();
    await waitForCondition(`barra lateral traducida (${language})`, async () => {
      // Compare visible section labels case-insensitively. Group headers are optional
      // because users can hide them while preserving the translated destinations.
      const sidebar = (await page.getByTestId('sidebar-scroll-region').innerText().catch(() => '')).toLowerCase();
      return labels.every((label) => sidebar.includes(label));
    });
    assert.equal(await page.evaluate(() => document.documentElement.lang), language, `the document language follows the UI language (${language})`);
  }
  console.log(`[e2e] ${Object.keys(SIDEBAR_BY_LANGUAGE).length} translated UIs render on the real shell (sidebar + document lang)`);

  // Existing users (tutorial v4) receive the new three-part connected-workflows
  // summary immediately after release notes. This profile is throwaway, so the
  // seen key exercised here never touches the developer's real Nodus profile.
  await page.evaluate(async (version) => {
    localStorage.removeItem('nodus.lastSeenVersion');
    localStorage.removeItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA');
    localStorage.removeItem('nodus.platformHighlightsSeen.2026-07');
    // Walking the tutorial above marked the videos announcement seen, exactly as it
    // does for a real first run. Clear it here so the announcement this existing user
    // never got is exercised too — it must be cleared BEFORE the render, since
    // eligibility is read once, when the modal mounts.
    localStorage.removeItem('nodus.tutorialVideosAnnouncementSeen.2026-07');
    localStorage.removeItem(`nodus.mobileTeaserSeen.${version}`);
    await window.nodus.updateSettings({ uiLanguage: 'es', promptLanguage: 'es', basicsTutorialVersion: 4 });
  }, appVersion);
  await page.reload();
  const whatsNewForExistingUser = page.getByTestId('whats-new-cinematic-modal');
  await whatsNewForExistingUser.waitFor();
  const releaseOriginalWindow = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? { bounds: win.getBounds(), minimumSize: win.getMinimumSize() } : null;
  });
  const releaseOriginalClasses = await page.evaluate(() => document.documentElement.className);
  for (const variant of [
    { theme: 'dark', name: 'dark-wide', width: 1540, height: 940 },
    { theme: 'light', name: 'light-narrow', width: 760, height: 900 },
  ]) {
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.classList.toggle('light', theme === 'light');
    }, variant.theme);
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.setMinimumSize(640, 480);
      win.setBounds({ width: size.width, height: size.height });
    }, variant);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(os.tmpdir(), `nodus-v4-release-notes-${variant.name}.png`), fullPage: true });
    const action = await whatsNewForExistingUser.getByRole('button', { name: 'Explorar las novedades', exact: true }).boundingBox();
    assert.ok(action && action.height >= 32 && action.y + action.height <= (await page.evaluate(() => window.innerHeight)) + 1, `v4 release action remains visible in ${variant.name}`);
  }
  await app.evaluate(({ BrowserWindow }, original) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || !original) return;
    win.setMinimumSize(original.minimumSize[0], original.minimumSize[1]);
    win.setBounds(original.bounds);
  }, releaseOriginalWindow);
  await page.evaluate((className) => { document.documentElement.className = className; }, releaseOriginalClasses);
  await whatsNewForExistingUser.getByRole('button', { name: 'Explorar las novedades', exact: true }).click();

  const pdfPresenterAnnouncement = page.getByTestId('pdf-presenter-tutorial-announcement');
  await pdfPresenterAnnouncement.waitFor();
  assert.match(await pdfPresenterAnnouncement.locator('iframe').getAttribute('src'), /e2js_u-05OA/);
  await pdfPresenterAnnouncement.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await pdfPresenterAnnouncement.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA')), '1');

  // First behind release notes sat the look at the mobile app, and it was a 3.2.4
  // one-off: it presents only on the version it names, and its seen-key carries that
  // version, so pointing the constant at a later release would show the gallery again to
  // everyone who already met it. Past 3.2.4 the step must retire WITHOUT stalling the
  // chain it holds — it sits between release notes and the connected-workflows summary,
  // so a retired modal that forgets to settle strands everything behind it. Reaching the
  // summary at all is the proof; the carousel itself is covered by
  // scripts/test-mobile-teaser-guide.mjs, which still pins all nine shipped screenshots.
  const platformTour = page.getByTestId('platform-highlights-update-tour');
  await platformTour.waitFor();
  assert.equal(
    await page.getByTestId('mobile-teaser-guide').count(),
    0,
    'the 3.2.4 teaser must not come back on a later release',
  );
  console.log('[e2e] the retired mobile teaser hands the chain straight to the summary');

  assert.equal(await platformTour.locator('.toolkit-guide-progress button').count(), 3, 'existing-user summary has three ordered chapters');
  await platformTour.getByRole('heading', { name: 'MCP local y Nodus Server', exact: true }).waitFor();
  await platformTour.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await platformTour.getByRole('heading', { name: 'Nodus para Zotero', exact: true }).waitFor();
  assert.equal(await platformTour.locator('img[alt="Zotero"]').count(), 1, 'the Zotero chapter renders the official Zotero mark');
  await platformTour.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await platformTour.getByRole('heading', { name: 'El Toolkit completo', exact: true }).waitFor();
  await platformTour.getByTestId('platform-highlights-tour-complete').click();
  await platformTour.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.platformHighlightsSeen.2026-07')), '1', 'the summary is marked seen only after its final action');
  console.log('[e2e] release notes hand off to the translated three-part connected-workflows summary');

  // …and behind that, the videos announcement: the one modal that embeds the catalogue
  // instead of describing it, for users who completed the guide when it was text-only.
  const videosTour = page.getByTestId('tutorial-videos-update-tour');
  await videosTour.waitFor();
  await videosTour.getByRole('heading', { name: 'Tutoriales en vídeo', exact: true }).waitFor();
  // The WHOLE catalogue, arranged on its shelves — the announcement's claim is that it
  // shows the tutorials rather than describing them. Asserted by shape, not by a count
  // that has to be edited every time a tutorial is published.
  assert.ok(await videosTour.locator('.tutorial-video-card').count() >= 4, 'the announcement embeds the published catalogue');
  assert.equal(await videosTour.locator('.tutorial-videos-shelf-title').count(), 4, 'introduction, vaults, features, integrations');
  assert.equal(await videosTour.locator('iframe').count(), 0, 'nothing is framed until a card is opened');
  await videosTour.getByTestId('tutorial-videos-tour-complete').click();
  await videosTour.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.tutorialVideosAnnouncementSeen.2026-07')), '1', 'the announcement is marked seen only when dismissed');
  console.log('[e2e] the video tutorials announcement shows the catalogue in-modal, once');

  // Back to Spanish for the rest of the suite, which asserts on Spanish copy. The
  // reload above already consumed the once-per-session startup update check, so reset
  // its gate to leave the next reload looking like a fresh session again.
  await page.evaluate(() => {
    sessionStorage.removeItem('nodus.startupUpdateChecked');
    return window.nodus.updateSettings({ uiLanguage: 'es', promptLanguage: 'es' });
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  assert.equal(await page.getByTestId('basics-tutorial-language').count(), 0, 'a seen cinematic tutorial does not return after restart/update');
  assert.equal(await page.getByTestId('whats-new-cinematic-modal').count(), 0, 'the release modal stays dismissed for the exact running version');
  await waitForCondition('startup update check to finish', () => page.evaluate(async () =>
    (await window.nodus.getUpdateStatus())?.status === 'not-available'
  ));
  await page.getByTestId('update-ready-notice').waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('startup-update-modal').count(), 0);
  console.log('[e2e] essential tutorial language preferences + persistent seen-once gate ok');

  // No startup dialog offers document understanding any more: it is opted into from
  // Library -> Document index or Settings -> Library. Nothing may queue between the
  // update check and Nodi.
  assert.equal(
    await page.getByTestId('document-understanding-consent').count(),
    0,
    'no document-understanding consent modal is shown at startup',
  );
  console.log('[e2e] startup shows no document-understanding consent modal');

  // File imports open the OS picker directly — there is no in-app privacy modal.
  // Stub the native dialog so automation never opens a real picker, then assert
  // that invoking an importer resolves without any consent dialog appearing.
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  const toolkitPick = await page.evaluate(() => window.nodus.pickToolkitFiles(['pdf']));
  assert.deepEqual(toolkitPick, [], 'a cancelled toolkit import returns no files without prompting');
  assert.equal(await page.getByRole('dialog', { name: 'Antes de incorporar un archivo' }).count(), 0, 'no file-import privacy modal is shown');
  console.log('[e2e] file imports open the native picker directly, with no privacy modal');

  // ── Nodi: absolute drag + right-click goodbye + persisted visibility ───────
  const originalMascotSettings = await page.evaluate(() => window.nodus.getSettings());
  await page.evaluate(() => window.nodus.updateSettings({ mascotEnabled: true, mascotAlwaysOnTop: false, reduceMotion: true }));
  const nodiFigure = page.locator('.nodi-figure');
  await nodiFigure.waitFor({ timeout: 30_000 });

  // Right-click on a Nodi that has NOT been dragged yet: the context menu must
  // survive its own pointer-up, which is otherwise read as a click and swaps the
  // menu for the radial one. Order matters — a preceding drag leaves the "moved"
  // flag set (a right press never resets it) and hides the bug.
  const nodiCloseItem = page.getByRole('menuitem', { name: /Cerrar mascota/ });
  await nodiFigure.click({ button: 'right' });
  await nodiCloseItem.waitFor({ timeout: 5_000 });
  await page.waitForTimeout(150);
  assert.ok(await nodiCloseItem.isVisible(), 'right-click keeps the Nodi context menu open');
  // Dismiss via a synthetic outside mousedown rather than a real click at some
  // corner, which would land on the sidebar and collapse it.
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await nodiCloseItem.waitFor({ state: 'hidden', timeout: 5_000 });

  const nodiStart = await nodiFigure.boundingBox();
  assert.ok(nodiStart, 'Nodi is visible before the drag');
  await page.mouse.move(nodiStart.x + nodiStart.width / 2, nodiStart.y + nodiStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(20, 20, { steps: 8 });
  await page.mouse.up();
  const nodiAtTop = await nodiFigure.boundingBox();
  assert.ok(nodiAtTop && nodiAtTop.x <= 12 && nodiAtTop.y <= 12, `Nodi reaches the whole viewport (${nodiAtTop?.x}, ${nodiAtTop?.y})`);
  await nodiFigure.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Cerrar mascota/ }).click();
  await waitForCondition('Nodi desactivado tras el cierre animado', () => page.evaluate(async () => !(await window.nodus.getSettings()).mascotEnabled));
  await nodiFigure.waitFor({ state: 'detached' });
  await page.evaluate((previous) => window.nodus.updateSettings({
    mascotEnabled: true,
    mascotAlwaysOnTop: false,
    reduceMotion: previous.reduceMotion,
  }), originalMascotSettings);
  await nodiFigure.waitFor({ timeout: 30_000 });
  console.log('[e2e] Nodi reaches every screen edge and its right-click goodbye persists visibility');
  if (process.env.NODUS_E2E_NODI_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused Nodi drag + close smoke passed');
    process.exit(0);
  }

  // ── Vault wizard: independent, required text + embedding models ───────────
  const originalVaultId = (await page.evaluate(() => window.nodus.getActiveVault())).id;
  // The right-rail Bóvedas button is gone; the centred badge is the way into the panel.
  await page.locator('[data-testid="header-vault-badge"]').click();
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  const vaultDialog = page.getByRole('dialog', { name: 'Añadir bóveda' });
  await vaultDialog.waitFor();
  for (const type of ['academic', 'genealogy', 'estudio', 'databases']) {
    assert.equal(await vaultDialog.getByTestId(`new-vault-type-icon-${type}`).count(), 1, `${type} uses the shared model-enabled creation wizard`);
  }
  await vaultDialog.getByPlaceholder('Nombre de la bóveda').fill('Vault model setup smoke');
  // The dialog creates the vault bare and hands off to the setup wizard, which
  // discovers the models instead of asking here — so the gate lives there now.
  await vaultDialog.getByTestId('vault-models-next-step').waitFor();
  await vaultDialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await waitForCondition('creación del vault y apertura del asistente', async () => {
    const active = await page.evaluate(() => window.nodus.getActiveVault());
    return active.id !== originalVaultId && active.name === 'Vault model setup smoke';
  });
  const configuredVault = await page.evaluate(() => window.nodus.getActiveVault());

  // A fresh vault opens on its wizard. Walk to the provider step rather than hard-
  // coding its index, which differs by vault type (3 for academic, 1 for the simple
  // types). Discovery reaches the built-in local models with no key and no network, so
  // the pickers always have choices — but nothing is preselected for either role, and
  // that is the point: a model that runs on this machine is a deliberate choice, so the
  // wizard hands the decision to the person instead of opening on the bundled Gemma
  // (which used to arrive as `choices[0]`).
  const modeChoice = page.getByTestId('onboarding-mode-auto');
  if (await modeChoice.isVisible()) await modeChoice.click();
  const modelStep = page.getByTestId('onboarding-models');
  for (let i = 0; i < 4 && await modelStep.count() === 0; i++) {
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  }
  await modelStep.waitFor({ timeout: 30_000 });

  // Finishing is gated on having BOTH models, and the gate stays shut until they are
  // chosen here: an unanswered picker shows its placeholder, and no local model has been
  // put in the user's name.
  const startButton = page.getByTestId('onboarding-start');
  const aiTrigger = page.getByTestId('onboarding-ai-model-trigger');
  await waitForCondition('el asistente deja ambos modelos sin elegir', () => aiTrigger.isVisible());
  for (const role of ['onboarding-ai-model', 'onboarding-embedding-model']) {
    const triggerText = await page.getByTestId(`${role}-trigger`).innerText();
    assert.ok(!/nodus|ollama|lm studio/i.test(triggerText), `${role} does not open on a local model (shows "${triggerText.trim()}")`);
  }
  assert.equal(await startButton.isEnabled(), false, 'nothing is preselected, so starting stays disabled');

  // Choosing one per role is what enables it.
  for (const role of ['onboarding-ai-model', 'onboarding-embedding-model']) {
    await page.getByTestId(`${role}-trigger`).click();
    const options = page.getByTestId(role).getByRole('option');
    await options.first().waitFor({ timeout: 30_000 });
    assert.ok(await options.count() > 0, `${role} offers discovered models to choose between`);
    await options.first().click();
  }
  await waitForCondition('el asistente habilita Empezar tras elegir ambos modelos', () => startButton.isEnabled());

  await page.evaluate(async ({ original, temporary }) => {
    const switched = await window.nodus.switchVault(original);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.deleteVault(temporary, true);
  }, { original: originalVaultId, temporary: configuredVault.id });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  console.log('[e2e] a new vault hands off to the wizard, which discovers both models itself');

  // ── Main header: model selection belongs to Settings/features, never global ─
  const smokeModel = { provider: 'openai', model: 'smoke-model' };
  const chatModel = { provider: 'openrouter', model: 'smoke-chat-model' };
  const searchableModel = { provider: 'google', model: 'gemini-flash-lite' };
  const migrated = await page.evaluate((model) =>
    window.nodus.updateSettings({
      defaultModel: model,
      extractionModel: null,
      synthesisModel: null,
      summaryModel: null,
      fusionModel: null,
    }), smokeModel);
  assert.equal(migrated.defaultModel, null, 'legacy global choice retired after migration');
  for (const key of ['extractionModel', 'synthesisModel', 'summaryModel', 'fusionModel']) {
    assert.deepEqual(migrated[key], smokeModel, `legacy model migrated into ${key}`);
  }
  const independent = await page.evaluate(({ model, chat, searchable }) =>
    window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      modelSettingsMode: 'advanced',
      favorites: [model, chat, searchable],
      nodiModel: model,
      extractionModel: model,
      synthesisModel: model,
      summaryModel: chat,
      fusionModel: chat,
      chatModel: chat,
      deepResearchModel: model,
      immersionModel: chat,
      imageProvider: 'google',
      imageModel: 'gemini-3.1-flash-lite-image',
      imageQuality: 'balanced',
      imageStyle: 'antique_book',
    }), { model: smokeModel, chat: chatModel, searchable: searchableModel });
  assert.deepEqual(independent.chatModel, chatModel, 'chat model persists independently');
  assert.deepEqual(independent.deepResearchModel, smokeModel, 'Deep Research model persists independently');
  assert.deepEqual(independent.immersionModel, chatModel, 'immersion model persists independently');
  assert.equal(independent.imageModel, 'gemini-3.1-flash-lite-image', 'image model persists independently');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('header'));
  assert.equal(await page.locator('header select[data-tour="model"]').count(), 0, 'global header model selector removed');
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Proveedores', exact: true }).click();
  const chatGptProvider = page.getByTestId('chatgpt-subscription-provider');
  await chatGptProvider.waitFor();
  await chatGptProvider.locator('button').first().click();
  await chatGptProvider.getByRole('button', { name: 'Conectar suscripción de ChatGPT', exact: true }).waitFor();
  await chatGptProvider.getByText('El uso consume la cuota o los créditos de Codex incluidos en tu plan de ChatGPT; no consume saldo de la API de OpenAI.', { exact: true }).waitFor();
  const githubCopilotProvider = page.getByTestId('github-copilot-subscription-provider');
  await githubCopilotProvider.waitFor();
  await githubCopilotProvider.locator('button').first().click();
  await githubCopilotProvider.getByText('Nodus usa el SDK y el runtime oficiales de GitHub Copilot. Cada petición se factura a la suscripción de GitHub del usuario; no requiere claves de los modelos.', { exact: true }).waitFor();
  await githubCopilotProvider.getByText('Cada petición se ejecuta en una sesión efímera sin herramientas, MCP, memoria, acceso a archivos, GitHub ni instrucciones del proyecto.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /OpenCode Go/ }).first().click();
  const openCodeUsage = page.getByTestId('opencode-go-usage');
  await openCodeUsage.waitFor();
  await openCodeUsage.getByText('Límites generales publicados: 12 USD cada 5 horas, 30 USD por semana y 60 USD por mes. Algunos modelos tienen un límite mensual efectivo inferior (15 USD); el número de peticiones depende del modelo y puede cambiar.', { exact: true }).waitFor();
  await openCodeUsage.getByText('Saldo restante oficial: OpenCode solo lo publica en Console; no ofrece una API de cuota compatible con la clave de usuario. Nodus no usa cookies ni endpoints privados.', { exact: true }).waitFor();
  const providerThemeStyles = await page.evaluate(() => {
    const root = document.documentElement;
    const github = document.querySelector('[data-testid="github-copilot-subscription-provider"]');
    const openCode = document.querySelector('[data-testid="provider-opencode-go"]');
    const openCodeUsage = document.querySelector('[data-testid="opencode-go-usage"]');
    if (!github || !openCode || !openCodeUsage) throw new Error('provider theme surfaces are missing');
    const original = { light: root.classList.contains('light'), dark: root.classList.contains('dark') };
    const read = () => ({
      githubBackground: getComputedStyle(github).backgroundColor,
      githubBorder: getComputedStyle(github).borderTopColor,
      openCodeBorder: getComputedStyle(openCode).borderTopColor,
      openCodeUsageBackground: getComputedStyle(openCodeUsage).backgroundColor,
      openCodeUsageText: getComputedStyle(openCodeUsage).color,
    });
    root.classList.add('light');
    root.classList.remove('dark');
    const light = read();
    root.classList.remove('light');
    root.classList.add('dark');
    const dark = read();
    root.classList.toggle('light', original.light);
    root.classList.toggle('dark', original.dark);
    return { light, dark };
  });
  const colorBrightness = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).reduce((sum, channel) => sum + Number(channel), 0);
  assert.ok(colorBrightness(providerThemeStyles.light.githubBackground) > colorBrightness(providerThemeStyles.dark.githubBackground) + 300, 'Copilot uses a genuinely light surface in light mode');
  assert.ok(colorBrightness(providerThemeStyles.light.openCodeUsageBackground) > colorBrightness(providerThemeStyles.dark.openCodeUsageBackground) + 300, 'OpenCode Go uses a genuinely light surface in light mode');
  assert.notEqual(providerThemeStyles.light.githubBorder, providerThemeStyles.dark.githubBorder, 'Copilot border follows the active theme');
  assert.notEqual(providerThemeStyles.light.openCodeBorder, providerThemeStyles.dark.openCodeBorder, 'OpenCode Go provider border follows the active theme');
  assert.notEqual(providerThemeStyles.light.openCodeUsageText, providerThemeStyles.dark.openCodeUsageText, 'OpenCode Go body text follows the active theme');
  await page.getByRole('button', { name: /Anthropic/ }).click();
  await page.getByText(/Anthropic no permite que aplicaciones de terceros ofrezcan inicio de sesión de Claude\.ai/).waitFor();
  console.log('[e2e] provider UI exposes subscriptions, usage limits and real light/dark surfaces');

  // The custom OpenAI-compatible provider: its whole reason to exist is that the
  // user can name models a gateway never publishes, so the row must offer both the
  // URL field and the manual-model list, and must store what it captured. Placed
  // after the OpenCode assertions on purpose: this accordion shows one provider at
  // a time, so expanding a row here collapses whatever the previous block opened.
  const customProvider = page.getByTestId('provider-row-custom');
  await customProvider.waitFor();
  await customProvider.locator('button').first().click();
  await customProvider.getByTestId('custom-provider-url').fill('http://127.0.0.1:8317/v1/');
  await customProvider.getByTestId('custom-provider-model-input').fill('gateway-model-a');
  await customProvider.getByRole('button', { name: 'Añadir', exact: true }).click();
  await customProvider.getByTestId('custom-provider-manual-models').getByText('gateway-model-a', { exact: true }).waitFor();
  const storedCustomProvider = await page.evaluate(async () => (await window.nodus.getSettings()).customProvider);
  assert.deepEqual(storedCustomProvider, { baseUrl: 'http://127.0.0.1:8317/v1', models: ['gateway-model-a'] },
    'the custom endpoint is stored normalised, with the hand-typed model');
  console.log('[e2e] custom OpenAI-compatible provider accepts a URL and hand-typed models');

  // ── ChatGPT MCP connector: every semantic surface must work in both themes ──
  await page.getByRole('button', { name: 'Integraciones', exact: true }).click();
  const mcpSettingsCard = page.getByTestId('mcp-settings-card');
  await mcpSettingsCard.waitFor();
  await mcpSettingsCard.getByRole('button', { name: /Conectar con ChatGPT|Administrar conexión/ }).click();
  await page.getByTestId('mcp-privacy-notice').waitFor();
  const mcpThemeStyles = await page.evaluate(() => {
    const root = document.documentElement;
    const settingsCard = document.querySelector('[data-testid="mcp-settings-card"]');
    const notice = document.querySelector('[data-testid="mcp-privacy-notice"]');
    const status = document.querySelector('[data-testid="mcp-tunnel-status"]');
    const tabs = document.querySelector('[data-testid="mcp-client-tabs"]');
    const step = document.querySelector('[data-testid="mcp-setup-step"]');
    const settingsHeading = settingsCard?.querySelector('h3');
    const statusHeading = status?.querySelector('h3');
    if (!settingsCard || !notice || !status || !tabs || !step || !settingsHeading || !statusHeading) {
      throw new Error('MCP theme surfaces are missing');
    }
    const original = { light: root.classList.contains('light'), dark: root.classList.contains('dark') };
    const read = () => ({
      settingsBackground: getComputedStyle(settingsCard).backgroundColor,
      settingsText: getComputedStyle(settingsHeading).color,
      noticeBackground: getComputedStyle(notice).backgroundColor,
      noticeText: getComputedStyle(notice).color,
      noticeBorder: getComputedStyle(notice).borderTopColor,
      statusBackground: getComputedStyle(status).backgroundColor,
      statusText: getComputedStyle(statusHeading).color,
      tabsBackground: getComputedStyle(tabs).backgroundColor,
      stepBorder: getComputedStyle(step).borderTopColor,
    });
    root.classList.add('light');
    root.classList.remove('dark');
    const light = read();
    root.classList.remove('light');
    root.classList.add('dark');
    const dark = read();
    root.classList.toggle('light', original.light);
    root.classList.toggle('dark', original.dark);
    return { light, dark };
  });
  const rgbChannels = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const relativeLuminance = (color) => {
    const channels = rgbChannels(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrastRatio = (foreground, background) => {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  assert.ok(contrastRatio(mcpThemeStyles.light.noticeText, mcpThemeStyles.light.noticeBackground) >= 4.5, 'MCP privacy notice meets WCAG AA contrast in light mode');
  assert.ok(contrastRatio(mcpThemeStyles.dark.noticeText, mcpThemeStyles.dark.noticeBackground) >= 4.5, 'MCP privacy notice meets WCAG AA contrast in dark mode');
  assert.ok(contrastRatio(mcpThemeStyles.light.statusText, mcpThemeStyles.light.statusBackground) >= 4.5, 'MCP status heading is readable in light mode');
  assert.ok(contrastRatio(mcpThemeStyles.dark.statusText, mcpThemeStyles.dark.statusBackground) >= 4.5, 'MCP status heading is readable in dark mode');
  assert.ok(contrastRatio(mcpThemeStyles.light.settingsText, mcpThemeStyles.light.settingsBackground) >= 4.5, 'MCP Settings heading is readable in light mode');
  assert.notEqual(mcpThemeStyles.light.noticeBackground, mcpThemeStyles.dark.noticeBackground, 'MCP privacy notice follows the active theme');
  assert.notEqual(mcpThemeStyles.light.noticeBorder, mcpThemeStyles.dark.noticeBorder, 'MCP privacy border follows the active theme');
  assert.notEqual(mcpThemeStyles.light.statusBackground, mcpThemeStyles.dark.statusBackground, 'MCP status panel follows the active theme');
  assert.notEqual(mcpThemeStyles.light.tabsBackground, mcpThemeStyles.dark.tabsBackground, 'MCP client tabs follow the active theme');
  assert.notEqual(mcpThemeStyles.light.stepBorder, mcpThemeStyles.dark.stepBorder, 'MCP setup steps follow the active theme');
  await page.getByRole('dialog', { name: 'Conectar Nodus' }).getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  console.log('[e2e] ChatGPT MCP connector has readable light/dark surfaces');

  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  await page.getByText('Generación de imágenes', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('gemini-3.1-flash-lite-image', { exact: false }).count() > 0, true, 'image settings render selected verified model');
  const advancedPickers = page.getByTestId('common-model-overrides').locator('button[aria-haspopup="listbox"]');
  const advancedPickerBoxes = await advancedPickers.evaluateAll((triggers) => triggers.map((trigger) => {
    const box = trigger.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  assert.ok(advancedPickerBoxes.length >= 5, 'advanced model settings render a common selector for every task, including Nodi');
  const advancedPickerHeights = advancedPickerBoxes.map((box) => box.height);
  const advancedPickerWidths = advancedPickerBoxes.map((box) => box.width);
  assert.ok(Math.max(...advancedPickerHeights) - Math.min(...advancedPickerHeights) <= 1, 'the Nodi model selector has the same height as adjacent advanced selectors');
  assert.ok(Math.max(...advancedPickerWidths) - Math.min(...advancedPickerWidths) <= 1, 'all common advanced model selectors have the same width');
  for (let i = 0; i < advancedPickerBoxes.length; i++) {
    const trigger = advancedPickers.nth(i);
    await trigger.click();
    const search = page.getByTestId('model-picker-search');
    await search.fill('gemini flash');
    const options = page.locator('.model-picker-list').getByRole('option');
    await options.filter({ hasText: 'gemini-flash-lite' }).waitFor();
    assert.equal(await options.count(), 1, 'every common picker matches spaced terms and excludes unrelated models');
    await search.press('Escape');
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, 'Escape restores focus to the model trigger');
  }
  const nodiPicker = page.getByTestId('common-model-overrides').locator('div.grid').filter({ has: page.locator('label').filter({ hasText: 'Asistente Nodi' }) }).locator('button[aria-haspopup="listbox"]');
  await nodiPicker.click();
  await page.getByTestId('model-picker-search').fill('flash gemini');
  await page.locator('.model-picker-list').getByRole('option', { name: /gemini-flash-lite/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="common-model-overrides"]')?.textContent.includes('gemini-flash-lite'));
  assert.deepEqual((await page.evaluate(() => window.nodus.getSettings())).nodiModel, searchableModel, 'selecting a search result persists the Nodi model through real IPC');
  await nodiPicker.click();
  await page.getByTestId('model-picker-search').fill('openai smoke');
  await page.locator('.model-picker-list').getByRole('option', { name: /smoke-model/ }).click();
  console.log('[e2e] all advanced model pickers search without strict separators, preserve layout and save selections');
  console.log('[e2e] image provider settings rendered');
  await page.getByRole('button', { name: 'Acerca de Nodus Research', exact: true }).click();
  await page.getByTestId('about-privacy').waitFor();
  const sourceCodeButton = page.getByTestId('source-code');
  await sourceCodeButton.waitFor();
  assert.match(await page.getByTestId('about-third-party-licenses').innerText(), /GNU AGPL v3/);
  assert.match(await sourceCodeButton.innerText(), /Código fuente de esta versión/);
  const originalAboutWindow = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? { bounds: win.getBounds(), minimumSize: win.getMinimumSize() } : null;
  });
  const originalRootClasses = await page.evaluate(() => document.documentElement.className);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    for (const viewport of [{ name: 'wide', width: 1540, height: 940 }, { name: 'narrow', width: 760, height: 900 }]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.setMinimumSize(640, 480);
        win.setBounds({ width: size.width, height: size.height });
      }, viewport);
      await page.waitForTimeout(250);
      await sourceCodeButton.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(os.tmpdir(), `nodus-about-license-${theme}-${viewport.name}.png`), fullPage: true });
      const box = await sourceCodeButton.boundingBox();
      assert.ok(box && box.width >= 180 && box.height >= 32, `source offer remains usable in ${theme} ${viewport.name}`);
    }
  }
  await app.evaluate(({ BrowserWindow }, original) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || !original) return;
    win.setMinimumSize(original.minimumSize[0], original.minimumSize[1]);
    win.setBounds(original.bounds);
  }, originalAboutWindow);
  await page.evaluate((className) => { document.documentElement.className = className; }, originalRootClasses);
  await page.waitForTimeout(250);
  assert.equal(await page.getByTestId('about-updates').count(), 0, 'Updates moved out of About Nodus into its own section');
  // The privacy card opens a localized in-app modal instead of launching an external markdown file.
  await page.getByTestId('open-privacy-policy').click();
  await page.getByTestId('legal-doc-modal-privacy').waitFor();
  await page.getByTestId('legal-doc-modal-privacy').getByText('Privacidad y control de datos', { exact: true }).waitFor();
  await page.getByTestId('legal-doc-canonical-privacy').waitFor();
  await page.getByTestId('legal-doc-close-privacy').click();
  await page.getByTestId('legal-doc-modal-privacy').waitFor({ state: 'detached' });
  console.log('[e2e] About legal cards open a localized in-app modal');

  await page.getByRole('button', { name: 'Actualizaciones y novedades', exact: true }).click();
  await page.getByTestId('about-updates').waitFor();
  await page.getByTestId('about-latest-changes').waitFor();
  const [latestChangesButtonBox, checkUpdatesButtonBox] = await Promise.all([
    page.getByTestId('open-latest-changes').boundingBox(),
    page.getByTestId('about-updates').getByRole('button', { name: 'Buscar actualización', exact: true }).boundingBox(),
  ]);
  assert.ok(latestChangesButtonBox && checkUpdatesButtonBox, 'The Updates section renders both release-related actions');
  assert.equal(latestChangesButtonBox.width, checkUpdatesButtonBox.width, 'Latest changes and Check for updates have the same width');
  assert.equal(latestChangesButtonBox.height, checkUpdatesButtonBox.height, 'Latest changes and Check for updates have the same height');
  await page.getByTestId('open-latest-changes').click();
  const whatsNewModal = page.getByTestId('whats-new-cinematic-modal');
  const selectedRelease = page.getByTestId('whats-new-selected-release');
  await whatsNewModal.waitFor();
  assert.equal(await whatsNewModal.count(), 1, 'Latest changes reopens the release modal even after the current version was seen');
  assert.equal(await selectedRelease.count(), 1, 'the release modal renders exactly one version at a time');
  // 4.2.1 is a presentation-only hotfix: it intentionally reuses the complete
  // 4.2.0 What's New card instead of adding a duplicate release-note entry.
  const expectedLatestChangesVersion = appVersion === '4.2.1' ? '4.2.0' : appVersion;
  assert.equal(await selectedRelease.getByText(`v${expectedLatestChangesVersion}`, { exact: true }).count(), 1, 'the latest available release note is selected by default');
  assert.equal(await selectedRelease.getByText('v2.5.3', { exact: true }).count(), 0, 'an older release is not rendered before it is selected');

  await page.getByTestId('whats-new-version-trigger').click();
  const versionMenu = page.getByTestId('whats-new-version-menu');
  await versionMenu.waitFor();
  assert.equal(await versionMenu.getByText('Nodus 2.x', { exact: true }).count(), 1, 'the version dropdown groups releases by major version');
  assert.equal(await versionMenu.getByText('v2.5.x', { exact: true }).count(), 1, 'the version dropdown groups releases by minor branch');
  await page.getByTestId('whats-new-version-2.5.3').click();
  await versionMenu.waitFor({ state: 'detached' });
  assert.equal(await selectedRelease.getByText('v2.5.3', { exact: true }).count(), 1, 'selecting a historical version replaces the rendered release');

  const generalReleaseScope = page.getByTestId('whats-new-scope-general').first();
  await page.waitForTimeout(550);
  await generalReleaseScope.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="whats-new-scope-general"] .whats-new-scope-tooltip')).opacity === '1');
  const generalScopeTooltip = await generalReleaseScope.locator('.whats-new-scope-tooltip').evaluate((tooltip) => ({
    label: tooltip.textContent?.trim(),
    opacity: getComputedStyle(tooltip).opacity,
  }));
  assert.deepEqual(generalScopeTooltip, { label: 'General', opacity: '1' }, 'hovering a release icon visibly identifies its group');
  await page.getByTestId('whats-new-cinematic-modal').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('whats-new-cinematic-modal').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  await page.getByTestId('nodus-local-ai-models').waitFor({ timeout: 30_000 });
  const localAiStatus = await page.evaluate(() => window.nodus.getNodusLocalAiStatus());
  assert.equal(localAiStatus.models.length, 7, 'integrated local AI catalog is available over the real preload bridge');
  assert.equal(await page.getByText('BGE-M3 Q8_0', { exact: true }).count(), 1, 'local embedding catalog renders');
  assert.equal(await page.getByText('Qwen3.5-0.8B Q4', { exact: true }).count(), 1, 'local multimodal chat catalog renders');
  for (const assignmentAction of ['Seleccionado', 'Usar para embeddings', 'Modelo general', 'Usar como general', 'Modelo de visión', 'Usar para visión']) {
    assert.equal(await page.getByRole('button', { name: assignmentAction, exact: true }).count(), 0, `${assignmentAction} is not offered from the download catalog`);
  }
  assert.equal(await page.getByText('Importante sobre los embeddings:', { exact: false }).count(), 1, 'embedding compatibility warning remains visible');
  if (process.env.NODUS_E2E_LOCAL_RUNTIME === '1') {
    const installedRuntime = await page.evaluate(async () => {
      const progress = [];
      const status = await window.nodus.installNodusLocalRuntime((fraction) => progress.push(fraction));
      return { status, progress };
    });
    assert.equal(installedRuntime.status.runtime.ready, true, 'Nodus downloads and extracts a working llama.cpp runtime');
    assert.ok(installedRuntime.progress.some((fraction) => fraction >= 1), 'local runtime installation reports completion progress');
  }
  await page.getByTestId('nodus-local-image-models').waitFor({ timeout: 30_000 });
  const localImageStatus = await page.evaluate(() => window.nodus.getNodusLocalImageStatus());
  assert.equal(localImageStatus.model.id, 'flux-2-klein-4b-q4', 'native FLUX.2 image model is available over the real preload bridge');
  await page.getByTestId('image-generation-model-list').getByText('FLUX.2 Klein 4B Q4', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('FLUX.2 Klein 4B Q4', { exact: true }).count(), 2, 'native model appears in its download section and the shared image selector');
  assert.deepEqual(await page.getByTestId('nodus-image-quality').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['draft', 'balanced', 'high'], 'native image quality exposes all three resolution presets');
  assert.equal(await page.getByText('Licencia: esta integración usa FLUX.2 Klein 4B bajo Apache 2.0. La variante 9B tiene términos no comerciales diferentes y no se descarga.', { exact: true }).count(), 1, 'the 4B license distinction is visible before download');
  await page.getByTestId('stt-settings').waitFor({ timeout: 30_000 });
  assert.deepEqual(await page.getByTestId('stt-provider').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['transformers', 'whisper_cpp', 'openai'], 'Settings owns all STT engines');
  const whisperCppStatus = await page.evaluate(() => window.nodus.getWhisperCppStatus());
  assert.ok(whisperCppStatus.models.length >= 5, 'whisper.cpp model manager is available over the real preload bridge');
  await page.getByTestId('stt-provider').selectOption('whisper_cpp');
  await page.getByTestId('stt-settings').getByRole('button', { name: /Instalar|Desinstalar/, exact: true }).waitFor();
  if (process.platform !== 'win32') {
    await page.evaluate(({ executable }) => window.nodus.updateSettings({ sttWhisperCppExecutable: executable, sttWhisperCppModel: 'base' }), { executable: fakeWhisperPath });
    const streamedCpp = await page.evaluate(async () => {
      const partials = []; const progress = [];
      const result = await window.nodus.transcribeStudyAudio({
        audioBytes: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav', provider: 'whisper_cpp', model: 'base', language: 'auto',
      }, { onPartial: (text) => partials.push(text), onProgress: (fraction) => progress.push(fraction) });
      return { result, partials, progress };
    });
    assert.equal(streamedCpp.result.text, 'Hola mundo', 'whisper.cpp IPC returns accumulated text');
    assert.deepEqual(streamedCpp.partials, ['Hola', 'Hola mundo'], 'whisper.cpp IPC streams segments before completion');
    assert.ok(streamedCpp.progress.some((value) => value >= 1), 'whisper.cpp IPC streams progress');
  }
  await page.getByTestId('stt-provider').selectOption('transformers');
  console.log('[e2e] STT engine/model management rendered in Settings');
  if (process.env.NODUS_E2E_STT_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused STT Settings + whisper.cpp streaming smoke passed');
    process.exit(0);
  }
  await page.locator('header').getByRole('button', { name: 'Research chat', exact: true }).click();
  await page.getByTestId('research-chat-view').waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('select[title="Modelo del chat"]').inputValue(), 'openrouter::smoke-chat-model');
  await page.locator('[data-tour="nav-settings"]').click();
  console.log('[e2e] header has no global model selector');

  // The brand and the collapse chevron used to share one centred flex row. On
  // macOS an asymmetric 76px padding then shifted the whole row as the sidebar
  // grew. Exercise the real drag handle and compare centres at the full resize
  // range; the independently pinned chevron must never affect this geometry.
  const readSidebarBrandGeometry = () => page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="resizable-sidebar"]');
    const toggle = document.querySelector('[data-testid="sidebar-header-toggle"]');
    const brand = document.querySelector('[data-testid="sidebar-header-brand"]');
    if (!sidebar || !toggle || !brand) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    };
    return { sidebar: box(sidebar), toggle: box(toggle), brand: box(brand) };
  });
  const assertSidebarBrandCentred = async (expectedWidth) => {
    await waitForCondition(`sidebar redimensionado a ${expectedWidth}px`, async () => {
      const geometry = await readSidebarBrandGeometry();
      return geometry !== null && Math.abs(geometry.sidebar.width - expectedWidth) <= 1;
    });
    const geometry = await readSidebarBrandGeometry();
    assert.ok(geometry, `sidebar geometry is readable at ${expectedWidth}px`);
    assert.ok(
      Math.abs(geometry.toggle.width - geometry.sidebar.width) <= 1,
      `the header follows the ${expectedWidth}px sidebar width`,
    );
    const sidebarCentre = geometry.sidebar.left + geometry.sidebar.width / 2;
    const brandCentre = geometry.brand.left + geometry.brand.width / 2;
    assert.ok(
      Math.abs(brandCentre - sidebarCentre) <= 1,
      `the Nodus brand stays centred at ${expectedWidth}px (offset ${(brandCentre - sidebarCentre).toFixed(2)}px)`,
    );
  };
  const resizeHandle = page.getByTestId('sidebar-resize-handle');
  await resizeHandle.dblclick({ position: { x: 3, y: 80 } });
  await assertSidebarBrandCentred(176);
  for (const targetWidth of [268, 360]) {
    const handleBox = await resizeHandle.boundingBox();
    const sidebarGeometry = await readSidebarBrandGeometry();
    assert.ok(handleBox && sidebarGeometry, `resize controls are visible before dragging to ${targetWidth}px`);
    const startX = handleBox.x + handleBox.width / 2;
    const pointerY = handleBox.y + Math.min(80, handleBox.height / 2);
    await page.mouse.move(startX, pointerY);
    await page.mouse.down();
    await page.mouse.move(startX + targetWidth - sidebarGeometry.sidebar.width, pointerY, { steps: 8 });
    await page.mouse.up();
    await assertSidebarBrandCentred(targetWidth);
  }
  await resizeHandle.dblclick({ position: { x: 3, y: 80 } });
  await assertSidebarBrandCentred(176);
  console.log('[e2e] sidebar Nodus brand stays centred throughout real resizing');

  // ── Header: the centre badge yields to the rails instead of overlapping ────
  // A hard left:50% badge sat under the header controls when the available space
  // tightened (the model alert or a dragged-wide sidebar). Measure the real boxes
  // and assert the geometry survives each constrained layout state.
  const HEADER_GAP = 12;
  // The badge only renders from the xl breakpoint up (xl:inline-flex); below it the
  // element is display:none by design and there is nothing to measure. The app asks
  // for a 1440px window, but a headless CI runner can be pinned to a smaller screen
  // (macOS CI comes up at the 1024px minWidth). Try to widen the real window to xl,
  // then measure: if the display cannot host it these steps are skipped with a log
  // rather than failing — the geometry itself is still fully covered by the unit
  // sweep in scripts/test-header-layout.mjs.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setBounds({ width: 1440, height: Math.max(win.getBounds().height, 900) });
  }).catch(() => {});
  await page.waitForTimeout(300);
  const headerViewportWidth = await page.evaluate(() => window.innerWidth);
  const readHeaderGeometry = () => page.evaluate(() => {
    const badge = document.querySelector('[data-testid="header-vault-badge"]');
    const logo = document.querySelector('[data-testid="sidebar-header-toggle"]');
    const actions = document.querySelector('[data-testid="header-actions"]');
    const header = actions?.closest('header');
    if (!badge || !logo || !actions || !header) return null;
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    return {
      badge: box(badge),
      logo: box(logo),
      actions: box(actions),
      header: box(header),
      fits: badge.getAttribute('data-badge-fits'),
      visible: getComputedStyle(badge).visibility === 'visible',
    };
  });
  // A rail that grows is a layout change; the badge answers it through a
  // ResizeObserver, so it lands a frame later. Poll for the settled position rather
  // than sampling once — a real overlap never settles and still fails, loudly, with
  // the measurements that prove it.
  const headerBadgeSafety = (g) => {
    if (!g) return { safe: false, why: 'header geometry unreadable' };
    if (!g.visible) {
      return g.fits === 'false'
        ? { safe: true, why: 'badge hidden because it reported it cannot fit' }
        : { safe: false, why: `badge is invisible but reported fits=${g.fits}` };
    }
    if (g.badge.left < g.logo.right + HEADER_GAP - 0.5) {
      return { safe: false, why: `badge.left ${g.badge.left.toFixed(1)} crosses logo.right ${g.logo.right.toFixed(1)} + ${HEADER_GAP}` };
    }
    if (g.badge.right > g.actions.left - HEADER_GAP + 0.5) {
      return { safe: false, why: `badge.right ${g.badge.right.toFixed(1)} crosses actions.left ${g.actions.left.toFixed(1)} - ${HEADER_GAP}` };
    }
    return { safe: true, why: 'clear of both rails' };
  };
  const assertHeaderBadgeSafe = async (label) => {
    let geometry = null;
    let safety = { safe: false, why: 'never measured' };
    const deadline = Date.now() + 5_000;
    do {
      geometry = await readHeaderGeometry();
      safety = headerBadgeSafety(geometry);
      if (safety.safe) return geometry;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.fail(`the header badge never settled clear of the rails (${label}): ${safety.why}`);
  };

  const setWindowWidth = async (width) => {
    await app.evaluate(({ BrowserWindow }, w) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setBounds({ width: w, height: Math.max(win.getBounds().height, 900) });
    }, width).catch(() => {});
    await page.waitForTimeout(300);
  };
  const badgeCentreOffset = async () => {
    const g = await readHeaderGeometry();
    if (!g?.visible) return null;
    return Math.abs((g.badge.left + g.badge.width / 2) - (g.header.left + g.header.width / 2));
  };

  if (headerViewportWidth < 1280) {
    console.log(`[e2e] header centre badge steps skipped: the window is ${headerViewportWidth}px and the resize did not take; geometry covered by scripts/test-header-layout.mjs`);
  } else {
    // Missing-model guidance belongs in Notifications and never occupies the header.
    const originalSynthesis = (await page.evaluate(() => window.nodus.getSettings())).synthesisModel;
    await page.evaluate(() => window.nodus.updateSettings({ synthesisModel: null }));
    await page.locator('[data-notifications-trigger]').click();
    await page.getByTestId('notifications-model-alert').waitFor();
    assert.equal(await page.getByTestId('header-model-alert').count(), 0, 'no model alert in the header');
    await page.keyboard.press('Escape');
    // Narrowing the window exercises the responsive rail. Native tooltips do not add
    // layout width, so a centred or clamped badge is valid as long as it stays clear
    // of both rails.
    // The deterministic geometry suite separately fixes the clamp branch itself.
    await setWindowWidth(980);
    const tight = await assertHeaderBadgeSafe('sin modelo de IA y con la ventana estrecha');
    assert.ok(tight.visible, 'the badge stays visible on a tight header');

    await setWindowWidth(1440);
    await page.evaluate((model) => window.nodus.updateSettings({ synthesisModel: model }), originalSynthesis);
    await page.locator('[data-notifications-trigger]').click();
    if (originalSynthesis) {
      await waitForCondition('aviso de modelo de IA retirado', async () =>
        (await page.getByTestId('notifications-model-alert').count()) === 0);
    }
    await page.keyboard.press('Escape');
    // With room available, the badge returns to the true window centre.
    await waitForCondition('el badge vuelve al centro exacto', async () => {
      const offset = await badgeCentreOffset();
      return offset !== null && offset <= 1;
    });
    const roomy = await assertHeaderBadgeSafe('sin el aviso');
    assert.ok(roomy.visible, 'the badge shows on a roomy header');

    // Hovering a rail button keeps the label out of the layout; the native title
    // tooltip is owned by the browser and does not widen the rail.
    await page.locator('[data-tour="toolkit"]').hover();
    await page.waitForTimeout(400);
    await assertHeaderBadgeSafe('con un tooltip nativo sin expandir la barra');
    await page.mouse.move(0, 300);
    await page.waitForTimeout(400);

    // A sidebar dragged to its maximum walks the logo towards the badge.
    await page.evaluate(() => localStorage.setItem('nodus.sidebarWidth', '360'));
    await page.reload();
    await page.getByTestId('app-shell').waitFor();
    await page.waitForTimeout(600);
    await assertHeaderBadgeSafe('con la barra lateral al máximo');
    await page.evaluate(() => localStorage.setItem('nodus.sidebarWidth', '176'));
    await page.reload();
    await page.getByTestId('app-shell').waitFor();
    await page.waitForTimeout(400);
    console.log('[e2e] header centre badge stays centred, yields to both rails and never overlaps');
  }

  // ── Nodus Toolkit: hub geometry, tool navigation and the way back ──────────
  // The preceding Nodi test deliberately restores the companion. Hide it for the
  // remaining workflow so its floating hit target cannot cover a control on a
  // smaller CI viewport; Toolkit clicks below must still pass normal actionability
  // checks and are never forced through an overlay.
  await page.evaluate(() => window.nodus.updateSettings({ mascotEnabled: false }));
  await nodiFigure.waitFor({ state: 'detached', timeout: 5_000 });
  // The hub's promise is a single catalogue whose cards read as one set, so the sizes are
  // measured on the real rendered shell rather than trusted from the classes.
  await page.locator('[data-tour="toolkit"]').click();
  await page.getByTestId('toolkit-home').waitFor({ timeout: 30_000 });
  const toolCards = ['toolkit-card-apps', 'toolkit-card-browser', 'toolkit-card-compass', 'toolkit-card-convert', 'toolkit-card-drift', 'toolkit-card-focus', 'toolkit-card-protect', 'toolkit-card-radar', 'toolkit-card-scriptor', 'toolkit-card-translate', 'toolkit-card-aiocr', 'toolkit-card-presenter'];
  assert.deepEqual(await page.locator('.toolkit-card').evaluateAll((cards) => cards.map((card) => card.dataset.testid)), toolCards, 'the shared catalogue shows all twelve tools in alphabetical order');
  const cardBoxes = [];
  for (const testId of toolCards) {
    const box = await page.getByTestId(testId).boundingBox();
    assert.ok(box, `${testId} is visible in the hub`);
    cardBoxes.push({ testId, ...box });
  }
  assert.equal(
    new Set(cardBoxes.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`)).size,
    1,
    `every toolkit card has the same dimensions: ${cardBoxes.map((b) => `${b.testId} ${Math.round(b.width)}x${Math.round(b.height)}`).join(', ')}`
  );
  const firstRowCount = cardBoxes.filter((box) => Math.round(box.y) === Math.round(cardBoxes[0].y)).length;
  assert.equal(new Set(cardBoxes.map((b) => Math.round(b.y))).size, Math.ceil(toolCards.length / firstRowCount), 'the cards form aligned rows at the current responsive column count');
  // Each card's icon tile is square and its glyph sits dead centre in it.
  for (const testId of toolCards) {
    const centring = await page.getByTestId(testId).evaluate((card) => {
      const tile = card.querySelector('span');
      const glyph = tile?.querySelector('svg');
      if (!tile || !glyph) return null;
      const t = tile.getBoundingClientRect();
      const g = glyph.getBoundingClientRect();
      return {
        square: Math.round(t.width) === Math.round(t.height),
        dx: Math.abs((t.left + t.width / 2) - (g.left + g.width / 2)),
        dy: Math.abs((t.top + t.height / 2) - (g.top + g.height / 2)),
      };
    });
    assert.ok(centring, `${testId} renders an icon tile`);
    assert.equal(centring.square, true, `${testId} icon tile is square`);
    assert.ok(centring.dx <= 0.5 && centring.dy <= 0.5, `${testId} icon is centred (dx ${centring.dx}, dy ${centring.dy})`);
  }
  // A card pin creates a real direct shortcut, using the exact same catalogue
  // icon, and that shortcut opens the nested page without turning it into a View.
  const ocrPin = page.getByTestId('toolkit-card-aiocr-pin');
  assert.equal(await ocrPin.getAttribute('aria-pressed'), 'false', 'OCR starts unpinned');
  await ocrPin.click();
  await page.waitForFunction(() => document.querySelector('[data-tour="nav-toolkit:ocr"]'));
  assert.equal(await ocrPin.getAttribute('aria-pressed'), 'true', 'the card reflects its saved pin');
  const ocrShortcut = page.locator('[data-tour="nav-toolkit:ocr"]');
  assert.equal(
    await ocrShortcut.locator('svg').innerHTML(),
    await page.getByTestId('toolkit-card-aiocr').locator('span svg').first().innerHTML(),
    'the shortcut reuses the OCR catalogue icon',
  );
  await ocrShortcut.click();
  await page.getByTestId('aiocr-home').waitFor({ timeout: 10_000 });
  await page.getByTestId('toolkit-aiocr-back').click();
  await page.getByTestId('toolkit-home').waitFor();
  await page.getByTestId('toolkit-card-aiocr-pin').click();
  await ocrShortcut.waitFor({ state: 'detached' });
  // Nodus Apps opens its beginner-facing catalogue and executes both curated
  // multilingual apps in the real sandbox before exercising app management.
  assert.equal(await page.getByTestId('toolkit-card-apps').isDisabled(), false, 'Nodus Apps opens');
  await page.getByTestId('toolkit-card-apps').click();
  await page.getByTestId('toolkit-apps-catalog').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-testid^="toolkit-app-card-"]').count(), 3, 'the three curated bundled apps are included');
  const appsSearch = page.getByTestId('toolkit-app-search');
  await appsSearch.fill('ruleta');
  assert.equal(await page.locator('[data-testid^="toolkit-app-card-"]').count(), 1, 'catalogue search covers the roulette title and tags');
  await appsSearch.fill('evidencias');
  assert.equal(await page.locator('[data-testid^="toolkit-app-card-"]').count(), 0, 'discarded example apps are no longer included');
  await appsSearch.fill('');

  await page.getByTestId('toolkit-app-card-included-miniapp-topic-distributor').click();
  await page.getByTestId('toolkit-app-runtime').waitFor();
  const distributorFrame = page.frameLocator('[data-testid="toolkit-app-iframe"]');
  await distributorFrame.getByRole('heading', { name: 'Repartidor de temas' }).waitFor();
  await page.getByTestId('toolkit-app-fullscreen-open').click();
  await page.getByTestId('toolkit-app-fullscreen').waitFor();
  await page.getByTestId('toolkit-app-fullscreen').locator('[data-testid="toolkit-app-iframe"]').waitFor();
  await page.getByTestId('toolkit-app-fullscreen-close').click();
  assert.equal(await page.getByTestId('toolkit-app-fullscreen').count(), 0, 'bundled apps can enter and leave the full-screen view');
  assert.equal(await distributorFrame.getByRole('button', { name: 'Generar asignaciones' }).isDisabled(), true, 'assignments require enough active topics');
  await distributorFrame.locator('#group-count').fill('4');
  await distributorFrame.locator('#group-count').press('Tab');
  for (const topic of ['Tema uno', 'Tema dos', 'Tema tres']) {
    await distributorFrame.getByPlaceholder('Ej. Energías renovables').fill(topic);
    await distributorFrame.getByRole('button', { name: 'Añadir', exact: true }).click();
  }
  await distributorFrame.getByPlaceholder('Ej. Tema de recuperación').fill('Tema excepcional');
  await distributorFrame.getByRole('button', { name: 'Añadir excepcional', exact: true }).click();
  await distributorFrame.getByText('Hay 3 temas activos para 4 grupos. Añade o activa 1 más.', { exact: true }).waitFor();
  await distributorFrame.getByRole('checkbox', { name: 'Activar Tema excepcional' }).check();
  await distributorFrame.getByText('Se repartirán 4 temas únicos entre 4 grupos.', { exact: true }).waitFor();
  await distributorFrame.getByRole('button', { name: 'Generar asignaciones' }).click();
  assert.equal(await distributorFrame.locator('.assignment').count(), 4, 'one assignment is generated for every group');
  assert.equal(new Set(await distributorFrame.locator('.assignment strong').allTextContents()).size, 4, 'all assigned topics are unique');

  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();
  await page.getByTestId('toolkit-app-card-included-miniapp-topic-distributor').click();
  await distributorFrame.getByRole('heading', { name: 'Asignaciones' }).waitFor();
  assert.equal(await distributorFrame.locator('.assignment').count(), 4, 'the topic setup and assignments persist after reopening');
  await distributorFrame.getByRole('button', { name: 'Rebarajar' }).click();
  assert.equal(new Set(await distributorFrame.locator('.assignment strong').allTextContents()).size, 4, 'reshuffling keeps assignments unique');
  await distributorFrame.getByRole('button', { name: 'Nueva configuración' }).click();
  const resetDialog = distributorFrame.getByRole('dialog', { name: '¿Empezar una configuración nueva?' });
  await resetDialog.waitFor();
  await resetDialog.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await distributorFrame.getByText('Hay 0 temas activos para 4 grupos. Añade o activa 4 más.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();

  await page.getByTestId('toolkit-app-card-included-miniapp-brainstorm').click();
  await page.getByTestId('toolkit-app-runtime').waitFor();
  const brainstormFrame = page.frameLocator('[data-testid="toolkit-app-iframe"]');
  await brainstormFrame.getByRole('heading', { name: 'Lluvia de ideas' }).waitFor();
  await brainstormFrame.getByRole('button', { name: 'Crear la primera sesión' }).first().click();
  await brainstormFrame.getByLabel('Título de la sesión').fill('Ideas para el campus');
  await brainstormFrame.getByLabel('Pregunta para el grupo').fill('¿Qué cambio haría el campus más sostenible?');
  await brainstormFrame.getByRole('button', { name: 'Crear sesión', exact: true }).click();
  await brainstormFrame.getByRole('heading', { name: 'Ideas para el campus' }).waitFor();
  await brainstormFrame.getByRole('button', { name: 'Editar sesión' }).click();
  await brainstormFrame.getByLabel('Título de la sesión').fill('Campus sostenible');
  await brainstormFrame.getByRole('button', { name: 'Guardar cambios' }).click();
  await brainstormFrame.getByRole('heading', { name: 'Campus sostenible' }).waitFor();
  await brainstormFrame.getByRole('button', { name: 'Eliminar sesión' }).click();
  const brainstormDelete = brainstormFrame.getByRole('dialog', { name: '¿Eliminar esta sesión?' });
  await brainstormDelete.waitFor();
  await brainstormDelete.getByRole('button', { name: 'Cancelar' }).click();
  assert.equal(await brainstormDelete.count(), 0, 'brainstorm session deletion always requires a confirmation modal');

  await page.getByRole('button', { name: 'Compartir por QR', exact: true }).click();
  await page.getByTestId('toolkit-app-session-start').click();
  await page.getByTestId('toolkit-app-session-live').waitFor({ timeout: 10_000 });
  await brainstormFrame.getByText('La sesión está conectada. Las nuevas ideas aparecerán sin recargar.', { exact: true }).waitFor();
  const brainstormSessionInfo = await page.evaluate(() => window.nodus.getToolkitAppSessionInfo());
  assert.ok(brainstormSessionInfo?.url, 'the brainstorm exposes a real participant link and QR session');
  assert.equal(new URL(brainstormSessionInfo.url).search, '', 'the participant link never embeds the access code');
  const brainstormJoinHtml = await fetch(brainstormSessionInfo.url).then((response) => response.text());
  assert.match(brainstormJoinHtml, /Introduce el código/, 'opening the link requires the visible six-digit access code');
  const invalidBrainstormPin = brainstormSessionInfo.pin === '000000' ? '999999' : '000000';
  const brainstormMetaUrl = new URL('/api/meta', brainstormSessionInfo.url);
  brainstormMetaUrl.searchParams.set('pin', invalidBrainstormPin);
  assert.equal((await fetch(brainstormMetaUrl)).status, 403, 'a participant cannot bypass the access code gate');
  brainstormMetaUrl.searchParams.set('pin', brainstormSessionInfo.pin);
  assert.equal((await fetch(brainstormMetaUrl)).status, 200, 'the displayed access code unlocks the participant experience');
  const participantSocket = await new Promise((resolve, reject) => {
    const shareUrl = new URL(brainstormSessionInfo.url);
    const socket = new WebSocket(`ws://${shareUrl.host}/socket?pin=${encodeURIComponent(brainstormSessionInfo.pin)}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('brainstorm participant did not receive the live question')); }, 10_000);
    const finish = (messages) => {
      const config = messages.find((message) => message?.channel === 'brainstorm:config' && message.payload?.accepting);
      if (!config) return false;
      clearTimeout(timeout);
      resolve({ socket, sessionId: config.payload.sessionId });
      return true;
    };
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', name: '' })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind === 'ready' && finish(message.history ?? [])) return;
      if (message.kind === 'app-message') finish([message.message]);
    });
    socket.on('error', reject);
  });
  await page.getByRole('button', { name: 'Usar app', exact: true }).click();
  await brainstormFrame.getByRole('heading', { name: 'Campus sostenible' }).waitFor();
  participantSocket.socket.send(JSON.stringify({
    type: 'app-message',
    channel: 'brainstorm:idea',
    payload: { sessionId: participantSocket.sessionId, text: 'Instalar fuentes de agua y más aparcabicis', clientId: 'e2e-student-idea' },
  }));
  await brainstormFrame.getByText('Instalar fuentes de agua y más aparcabicis', { exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(await brainstormFrame.locator('.idea-card').count(), 1, 'student ideas appear automatically while the host keeps the main app tab visible');
  participantSocket.socket.close();
  await page.getByRole('button', { name: 'Compartir por QR', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Usar app', exact: true }).click();
  await brainstormFrame.getByRole('heading', { name: 'Campus sostenible' }).waitFor();
  await brainstormFrame.getByText('Instalar fuentes de agua y más aparcabicis', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();

  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en' }));
  await page.getByText('Topic distributor', { exact: true }).waitFor();
  await page.getByTestId('toolkit-app-card-included-miniapp-topic-distributor').click();
  await distributorFrame.getByRole('heading', { name: 'Topic distributor' }).waitFor();
  await distributorFrame.getByText('There are 0 active topics for 4 groups. Add or enable 4 more.', { exact: true }).waitFor();
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es' }));
  await distributorFrame.getByRole('heading', { name: 'Repartidor de temas' }).waitFor();
  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();

  await page.getByTestId('toolkit-app-card-included-miniapp-wheel').click();
  await page.getByTestId('toolkit-app-runtime').waitFor();
  const wheelFrame = page.frameLocator('[data-testid="toolkit-app-iframe"]');
  assert.equal(await wheelFrame.getByRole('button', { name: 'Girar la ruleta' }).isDisabled(), true, 'the wheel requires at least two options');
  await wheelFrame.getByLabel('Nueva opción').fill('Opción alfa');
  await wheelFrame.getByRole('button', { name: 'Añadir', exact: true }).click();
  await wheelFrame.getByLabel('Nueva opción').fill('Opción beta');
  await wheelFrame.getByRole('button', { name: 'Añadir', exact: true }).click();
  await wheelFrame.locator('#options-list').getByText('Opción alfa', { exact: true }).waitFor();
  await wheelFrame.locator('#options-list').getByText('Opción beta', { exact: true }).waitFor();
  assert.equal(await wheelFrame.getByRole('button', { name: 'Girar la ruleta' }).isDisabled(), false, 'two custom options activate the wheel');
  await wheelFrame.getByRole('button', { name: 'Girar la ruleta' }).click();
  await page.waitForTimeout(4_000);
  const wheelResult = await wheelFrame.locator('#result').textContent();
  assert.ok(wheelResult === 'Opción alfa' || wheelResult === 'Opción beta', `the wheel chooses one real option, got ${wheelResult}`);
  assert.equal(await wheelFrame.locator('.history-item').count(), 1, 'the completed spin is recorded in history');

  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();
  await page.getByTestId('toolkit-apps-catalog').waitFor();
  await page.getByTestId('toolkit-app-card-included-miniapp-wheel').click();
  await page.getByTestId('toolkit-app-runtime').waitFor();
  await wheelFrame.locator('#options-list').getByText('Opción alfa', { exact: true }).waitFor();
  await wheelFrame.locator('#options-list').getByText('Opción beta', { exact: true }).waitFor();
  assert.equal(await wheelFrame.locator('.history-item').count(), 1, 'options and history persist after reopening the roulette');

  await page.getByRole('button', { name: 'Crear una copia', exact: true }).click();
  await page.getByTestId('toolkit-app-fullscreen-open').click();
  await page.getByTestId('toolkit-app-fullscreen').waitFor();
  assert.equal(await page.getByTestId('toolkit-app-fullscreen').getAttribute('role'), 'dialog', 'personal apps open in an accessible full-window view');
  await page.getByTestId('toolkit-app-fullscreen').locator('[data-testid="toolkit-app-iframe"]').waitFor();
  await page.getByTestId('toolkit-app-fullscreen-close').click();
  assert.equal(await page.getByTestId('toolkit-app-fullscreen').count(), 0, 'full-screen view closes without leaving the app');
  assert.equal(await page.getByTestId('toolkit-app-download').isVisible(), true, 'the complete app package can be downloaded');
  await page.getByTestId('toolkit-app-delete').click();
  const deleteAppDialog = page.getByRole('dialog', { name: 'Eliminar app' });
  await deleteAppDialog.waitFor();
  await deleteAppDialog.getByRole('button', { name: 'Eliminar app', exact: true }).click();
  await page.getByTestId('toolkit-apps-catalog').waitFor();
  assert.equal(await page.locator('[data-testid^="toolkit-app-card-"]').count(), 3, 'deleting a personal copy restores the three curated apps');

  await page.getByTestId('toolkit-app-card-included-miniapp-wheel').click();
  await page.getByTestId('toolkit-app-improve').click();
  await page.getByTestId('toolkit-app-studio').waitFor();
  await page.getByTestId('toolkit-app-instruction').fill('Añade pesos opcionales manteniendo la ruleta fácil de entender.');
  assert.equal(await page.getByTestId('toolkit-app-generate').isDisabled(), false, 'the included roulette can be revised with the configured AI model');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByRole('button', { name: 'Todas las apps', exact: true }).click();
  await page.getByTestId('toolkit-apps-catalog').waitFor();
  await page.getByTestId('toolkit-app-create').click();
  await page.getByTestId('toolkit-app-studio').waitFor();
  await page.getByText('La app se ejecuta aislada', { exact: false }).waitFor();
  await page.getByTestId('toolkit-app-instruction').fill('Una herramienta para comparar dos argumentos académicos, sus evidencias y sus supuestos.');
  assert.equal(await page.getByTestId('toolkit-app-generate').isDisabled(), false, 'generation is ready when the profile has a configured model');
  assert.match(await page.getByTestId('toolkit-app-studio').textContent(), /No necesitas saber programar/, 'the studio keeps the creation flow beginner-facing');
  console.log('[e2e] Nodus Apps: multilingual bundled tools, live brainstorm, staged AI flow, package download, fullscreen and delete modals');
  if (process.env.NODUS_E2E_APPS_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused Nodus Apps smoke passed');
    process.exit(0);
  }
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByTestId('toolkit-apps-catalog').waitFor();
  await page.getByTestId('toolkit-apps-page').getByRole('button', { name: 'Nodus Toolkit', exact: true }).click();
  await page.getByTestId('toolkit-home').waitFor();
  // AI OCR is a working tool: it opens on its (empty) library and returns.
  assert.equal(await page.getByTestId('toolkit-card-aiocr').isDisabled(), false, 'OCR Workspace opens');
  await page.getByTestId('toolkit-card-aiocr').click();
  await page.getByTestId('aiocr-home').waitFor({ timeout: 10_000 });
  await page.getByTestId('toolkit-aiocr-back').click();
  await page.getByTestId('toolkit-home').waitFor();
  // Nodus Translate: run a pasted-text translation through the real renderer →
  // preload → IPC → segment protocol path. The E2E-only model is deterministic and
  // offline, so this never needs a personal provider key.
  const e2eTranslateModel = { provider: 'lmstudio', model: 'nodus-e2e-translate' };
  await page.evaluate((model) => window.nodus.updateSettings({ synthesisModel: model, favorites: [model] }), e2eTranslateModel);
  await page.getByTestId('toolkit-card-translate').click();
  await page.getByTestId('translate-home').waitFor({ timeout: 10_000 });
  const translatePaneLayout = await page.evaluate(() => {
    const source = document.querySelector('[data-testid="translate-source-text"]')?.getBoundingClientRect();
    const result = document.querySelector('[data-testid="translate-result-text"]')?.getBoundingClientRect();
    return source && result ? { sourceWidth: source.width, resultWidth: result.width, gap: result.left - source.right } : null;
  });
  assert.ok(translatePaneLayout, 'both translation panes are rendered');
  assert.ok(Math.abs(translatePaneLayout.sourceWidth - translatePaneLayout.resultWidth) <= 2, `source and result panes have equal widths (${translatePaneLayout.sourceWidth}/${translatePaneLayout.resultWidth})`);
  assert.ok(translatePaneLayout.gap >= 20, `translation panes keep a visible gutter (${translatePaneLayout.gap}px)`);

  // The Zotero tab talks to a deterministic local-API fixture through real IPC.
  // It verifies reconnection, the library select, search-result freshness and icon spacing.
  await page.getByTestId('translate-tab-zotero').click();
  await page.getByTestId('translate-zotero-library').waitFor({ state: 'visible' });
  await waitForCondition('Zotero library connected in Translate', () => page.getByTestId('translate-zotero-library').isEnabled());
  assert.equal(await page.getByTestId('translate-zotero-library').inputValue(), 'user:0');
  const zoteroSearchSpacing = await page.getByTestId('translate-zotero-search').evaluate((input) => {
    const icon = input.parentElement?.querySelector('svg')?.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    return { paddingLeft: parseFloat(getComputedStyle(input).paddingLeft), iconRight: icon ? icon.right - field.left : 0 };
  });
  assert.ok(zoteroSearchSpacing.paddingLeft > zoteroSearchSpacing.iconRight, `Zotero placeholder starts after its icon (${zoteroSearchSpacing.paddingLeft}px > ${zoteroSearchSpacing.iconRight}px)`);
  await page.getByTestId('translate-zotero-search').fill('Smoke Research');
  await page.getByTestId('translate-zotero-results').getByText('Smoke Research Paper', { exact: true }).waitFor();
  await page.getByTestId('translate-zotero-results').getByText('Smoke Research Paper', { exact: true }).click();
  await page.getByText('smoke-paper.pdf', { exact: true }).waitFor();
  await page.getByTestId('translate-tab-text').click();
  await page.getByTestId('translate-source-text').fill('# Titulo Principal\n\nEste es un documento de prueba.');
  await page.getByTestId('translate-run').click();
  await page.getByTestId('translate-result-text').getByText('Main Title', { exact: false }).waitFor({ timeout: 20_000 });
  assert.match(await page.getByTestId('translate-result-text').innerText(), /This is a test document\./, 'pasted text crosses the complete translation stack');
  await page.getByTestId('translate-tab-history').click();
  await page.getByTestId('translate-history').getByText('Texto pegado', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.nodus.listTranslateHistory())).some((entry) => entry.inputKind === 'text' && entry.translatedText?.includes('Main Title')), 'pasted translation is persisted in history');

  // Facsimile mode gets its own real PDF round-trip: three source pages enter IPC,
  // translated page rasters come out with the same geometry and no source text layer.
  const translateDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-translate-'));
  const translateSourcePdf = await buildTextPdf(translateDir, 'translate-facsimile.pdf');
  const facsimileResult = await page.evaluate(async ({ input, outDir, model }) => window.nodus.runTranslateJob({
    inputKind: 'files', inputPaths: [input], targetLanguage: 'en', model,
    outputFormat: 'pdf', pdfMode: 'facsimile', translateImageText: false,
    outputDir: outDir, openFolderOnDone: false,
  }, { onProgress: () => {} }), { input: translateSourcePdf, outDir: translateDir, model: e2eTranslateModel });
  assert.equal(facsimileResult.cancelled, false);
  assert.equal(facsimileResult.outputs.length, 1, 'facsimile job emits one translated PDF');
  assert.equal(facsimileResult.outputs[0].pageCount, 3, 'facsimile reports the original page count');
  const translatedFacsimilePath = facsimileResult.outputs[0].outputPath;
  assert.ok(existsSync(translatedFacsimilePath), 'facsimile output exists');
  const facsimilePdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const facsimileDoc = await facsimilePdfjs.getDocument({ data: new Uint8Array(await readFile(translatedFacsimilePath)), isEvalSupported: false }).promise;
  assert.equal(facsimileDoc.numPages, 3);
  const facsimileViewport = (await facsimileDoc.getPage(1)).getViewport({ scale: 1 });
  assert.ok(Math.abs(facsimileViewport.width - 595) < 1 && Math.abs(facsimileViewport.height - 842) < 1, 'facsimile retains A4 page geometry');
  assert.equal((await (await facsimileDoc.getPage(1)).getTextContent()).items.length, 0, 'source-language text is not leaked behind the facsimile');
  const persistedFacsimile = (await page.evaluate(() => window.nodus.listTranslateHistory())).find((entry) => entry.outputPath === translatedFacsimilePath);
  assert.ok(persistedFacsimile?.outputExists, 'facsimile output is visible in persistent history');
  assert.equal(persistedFacsimile.pdfMode, 'facsimile');
  await rm(translateDir, { recursive: true, force: true });
  await page.getByTestId('toolkit-translate-back').click();
  await page.getByTestId('toolkit-home').waitFor();
  // PDF Presenter is a working tool: it opens on its (empty) library and returns.
  assert.equal(await page.getByTestId('toolkit-card-presenter').isDisabled(), false, 'PDF Presenter opens');
  await page.getByTestId('toolkit-card-presenter').click();
  await page.getByTestId('presenter-import').waitFor({ timeout: 10_000 });
  await page.getByTestId('presenter-back').click();
  await page.getByTestId('toolkit-home').waitFor();
  // A legacy tagged shelf migrates to folder navigation over the real IPC.
  await page.evaluate(() => window.nodus.savePresenterLibrary({
    tags: [{ id: 'folder_smoke', name: 'Seminario', createdAt: '2026-01-01T00:00:00Z' }],
    presentations: [
      { id: 'pres_filed', name: 'Clase organizada', fileName: 'a.pdf', createdAt: '2026-01-02T00:00:00Z', tag: 'folder_smoke', totalPages: 2, notes: {}, videos: {} },
      { id: 'pres_loose', name: 'Clase suelta', fileName: 'b.pdf', createdAt: '2026-01-03T00:00:00Z', tag: '', totalPages: 2, notes: {}, videos: {} },
    ],
  }));
  await page.getByTestId('toolkit-card-presenter').click();
  await page.getByTestId('presenter-import').waitFor({ timeout: 10_000 });
  await waitForCondition('la biblioteca principal muestra solo sus presentaciones', async () => (await page.getByTestId('presenter-row').count()) === 1, { timeout: 5_000 });
  assert.match(await page.getByTestId('presenter-row').first().innerText(), /Clase suelta/);
  const presenterSearch = page.locator('.presenter-library-rail input[type="search"]');
  await presenterSearch.fill('Clase');
  await waitForCondition('la búsqueda principal incluye las carpetas', async () => (await page.getByTestId('presenter-row').count()) === 2, { timeout: 5_000 });
  assert.match(await page.getByTestId('presenter-row').filter({ hasText: 'Clase organizada' }).locator('.presenter-row-location').innerText(), /Seminario/);
  await presenterSearch.fill('');
  const smokeFolder = page.getByTestId('presenter-folder-nav').filter({ hasText: 'Seminario' });
  await page.getByTestId('presenter-row').first().locator('.presenter-row-select').dragTo(smokeFolder);
  await waitForCondition('arrastrar mueve la presentación a la carpeta', async () => (await page.evaluate(() => window.nodus.getPresenterLibrary())).presentations.find(p => p.id === 'pres_loose')?.folderId === 'folder_smoke', { timeout: 5_000 });
  const looseRow = page.locator('[data-presentation-id="pres_loose"]');
  await looseRow.getByTestId('presenter-row-menu').click();
  assert.equal(await page.getByRole('menuitem').count(), 3, 'each presentation has rename, move and delete in one menu');
  await page.getByTestId('presenter-row-move').click();
  await page.getByTestId('presenter-move-folder-select').selectOption('');
  await page.getByTestId('presenter-move-confirm').click();
  await waitForCondition('el menú permite volver a la biblioteca principal', async () => (await page.evaluate(() => window.nodus.getPresenterLibrary())).presentations.find(p => p.id === 'pres_loose')?.folderId === null, { timeout: 5_000 });
  await smokeFolder.click();
  await waitForCondition('la carpeta muestra su presentación', async () => /Clase organizada/.test(await page.getByTestId('presenter-row').first().innerText()), { timeout: 5_000 });
  await page.getByTestId('presenter-folder-root').click();
  await page.getByTestId('presenter-folder-menu').first().click();
  await page.getByTestId('presenter-delete-folder').click();
  await page.getByTestId('presenter-delete-folder-modal').waitFor();
  await page.getByTestId('presenter-delete-folder-modal').getByRole('button', { name: /cancel|cancelar/i }).click();
  await page.getByTestId('presenter-delete-folder-modal').waitFor({ state: 'detached' });
  assert.equal(await smokeFolder.count(), 1, 'cancel keeps the folder');
  await page.getByTestId('presenter-folder-menu').first().click();
  await page.getByTestId('presenter-delete-folder').click();
  await page.getByTestId('presenter-delete-folder-confirm').click();
  await smokeFolder.waitFor({ state: 'detached' });
  await waitForCondition('las presentaciones conservadas vuelven a la biblioteca principal', async () => (await page.getByTestId('presenter-row').count()) === 2, { timeout: 5_000 });
  await page.getByTestId('presenter-row').first().click();
  await page.getByTestId('presenter-download-pdf').waitFor({ timeout: 5_000 });
  assert.equal(await page.getByTestId('presenter-download-pdf').isDisabled(), false);
  await page.evaluate(() => window.nodus.savePresenterLibrary({ folders: [], presentations: [] }));
  await page.getByTestId('presenter-back').click();
  await page.getByTestId('toolkit-home').waitFor();
  console.log('[e2e] PDF Presenter folders migrate tags, search recursively, move by dragging or menu and confirm deletion while keeping decks.');
  // Nodus Convert opens on its empty state: the dropzone plus the catalogue of
  // formats it accepts, so the drop is never a blind guess.
  await page.getByTestId('toolkit-card-convert').click();
  await page.getByTestId('toolkit-convert-page').waitFor({ timeout: 10_000 });
  await page.getByTestId('toolkit-dropzone').waitFor();
  const formatsPanel = page.getByTestId('toolkit-formats');
  await formatsPanel.waitFor();
  const formatsText = await formatsPanel.innerText();
  for (const ext of ['pdf', 'docx', 'epub', 'heic', 'srt']) {
    assert.match(formatsText, new RegExp(`\\b${ext}\\b`, 'i'), `the supported-formats panel advertises .${ext}`);
  }
  // Nothing is convertible until files are added, so the run button stays inert.
  assert.equal(await page.getByTestId('toolkit-run').isDisabled(), true, 'Convertir is disabled with no files');
  assert.equal(await page.getByTestId('toolkit-op-picker').count(), 0, 'the conversion menu appears only once files are in');

  // Real conversion through the whole stack: Markdown → PDF uses printToPDF in the
  // main process (A5), which no unit test can reach. Drive it via the IPC API with a
  // fixture on disk, then read the produced PDF back with pdfjs and match its text.
  const toolkitDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-toolkit-'));
  const mdPath = path.join(toolkitDir, 'sample.md');
  await writeFile(mdPath, '# Titulo Principal\n\nUn parrafo con **negrita** para la prueba.\n', 'utf8');
  const convertResult = await page.evaluate(
    async ({ input, outDir }) => {
      const result = await window.nodus.runToolkitJob(
        { opId: 'text-to-pdf', inputPaths: [input], outputFormat: 'pdf', options: {}, outputDir: outDir, mergedName: null, openFolderOnDone: false },
        { onProgress: () => {} },
      );
      return { status: result.files[0]?.status, error: result.files[0]?.error, outputs: result.files[0]?.outputPaths ?? [] };
    },
    { input: mdPath, outDir: toolkitDir },
  );
  assert.equal(convertResult.status, 'done', `MD→PDF conversion succeeded (${convertResult.error ?? ''})`);
  assert.equal(convertResult.outputs.length, 1, 'one PDF was produced');
  const producedPdf = convertResult.outputs[0];
  assert.ok(existsSync(producedPdf), 'the produced PDF exists on disk');
  const toolkitPdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const producedPdfBytes = await readFile(producedPdf);
  const producedPdfDoc = await toolkitPdfjs.getDocument({ data: new Uint8Array(producedPdfBytes), isEvalSupported: false }).promise;
  assert.ok(producedPdfDoc.numPages > 0, 'the produced PDF has pages');
  const producedPdfText = (await (await producedPdfDoc.getPage(1)).getTextContent()).items.map((it) => it.str ?? '').join(' ');
  assert.match(producedPdfText, /Titulo Principal/, 'the PDF carries the document text');
  await rm(toolkitDir, { recursive: true, force: true });

  // …and hands back a way home.
  await page.getByTestId('toolkit-back').click();
  await page.getByTestId('toolkit-home').waitFor({ timeout: 10_000 });
  assert.equal(await page.getByTestId('toolkit-convert-page').count(), 0, 'back returns to the hub');
  await page.getByTestId('toolkit-card-protect').click();
  await page.getByTestId('protect-home').waitFor({ timeout: 10_000 });
  await page.getByTestId('protect-start-protect').getByRole('heading', { name: 'Proteger documentos', exact: true }).waitFor();
  await page.getByText('Verificar una copia trazable', { exact: true }).waitFor();
  await page.getByText('El procesamiento de Nodus Protect es local. No envía tus documentos a IA, proveedores ni servicios externos.', { exact: true }).waitFor();

  // Full Protect round-trip without a native dialog: seed one valid image in the
  // active vault, redact it through the real canvas UI, emit a traceable PNG to
  // Protected Copies, then load that exact BLOB again and authenticate IDPS v1.
  const { createCanvas: createNativeCanvas } = await import('@napi-rs/canvas');
  const protectFixtureCanvas = createNativeCanvas(480, 300);
  const protectFixtureContext = protectFixtureCanvas.getContext('2d');
  protectFixtureContext.fillStyle = '#f7f1e5';
  protectFixtureContext.fillRect(0, 0, 480, 300);
  protectFixtureContext.fillStyle = '#1d6fd6';
  protectFixtureContext.fillRect(28, 28, 424, 70);
  protectFixtureContext.fillStyle = '#171512';
  protectFixtureContext.font = '28px sans-serif';
  protectFixtureContext.fillText('Documento E2E · 12345678Z', 54, 190);
  const protectFixtureBase64 = protectFixtureCanvas.toBuffer('image/png').toString('base64');
  const seededProtectCopy = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return window.nodus.saveProtectArtifactToVault({
      fileName: 'e2e-source.png', mimeType: 'image/png', format: 'png', pageCount: 1, bytes,
      sourceKind: 'disk', sourceLabel: 'E2E fixture',
    });
  }, protectFixtureBase64);
  assert.match(seededProtectCopy.id, /^[0-9a-f-]{36}$/i, 'Protect vault copies use stable UUIDs');

  await page.getByTestId('protect-start-protect').click();
  await page.getByTestId('protect-source').waitFor();
  await page.getByTestId('protect-source-tab-vault').click();
  await page.getByText('e2e-source.png', { exact: true }).waitFor();
  await page.getByText('e2e-source.png', { exact: true }).click();
  await page.getByTestId('protect-source-continue').getByRole('button').click();
  await page.getByTestId('protect-redact').waitFor({ timeout: 30_000 });
  const protectEditorCanvas = page.getByTestId('protect-editor-host').locator('canvas');
  await protectEditorCanvas.waitFor();
  const protectCanvasBox = await protectEditorCanvas.boundingBox();
  assert.ok(protectCanvasBox, 'Protect renders its real redaction canvas');
  await page.mouse.move(protectCanvasBox.x + protectCanvasBox.width * 0.28, protectCanvasBox.y + protectCanvasBox.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(protectCanvasBox.x + protectCanvasBox.width * 0.72, protectCanvasBox.y + protectCanvasBox.height * 0.56, { steps: 8 });
  await page.mouse.up();
  await page.getByText(/1 ocultaciones o desenfoques añadidos/).waitFor();
  await page.getByTestId('protect-redact-continue').getByRole('button').click({ force: true });
  await page.getByTestId('protect-watermark').waitFor();
  await page.getByTestId('protect-watermark-continue').getByRole('button').evaluate((button) => button.click());
  await page.getByTestId('protect-result').waitFor();
  await page.getByTestId('protect-trace-toggle').check();
  await page.getByTestId('protect-trace-label').fill('Recorrido E2E');
  await page.getByTestId('protect-save-vault').getByRole('button').click({ force: true });
  await page.getByText('Copia guardada en esta bóveda.', { exact: true }).waitFor({ timeout: 30_000 });
  const protectedCopiesAfterSave = await page.evaluate(() => window.nodus.listProtectCopies());
  const emittedProtectCopy = protectedCopiesAfterSave.find((copy) => copy.fileName === 'e2e-source-protegido.png');
  assert.ok(emittedProtectCopy, 'the completed Protect action stores the emitted artifact in the active vault');
  assert.notEqual(emittedProtectCopy.id, seededProtectCopy.id, 'the output is a distinct vault artifact');
  await page.getByText('Recorrido E2E', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Volver a Nodus Protect', exact: true }).click({ force: true });
  await page.getByTestId('protect-home').waitFor();
  await page.getByTestId('protect-start-verify').click();
  await page.getByTestId('protect-source-tab-vault').click();
  await page.getByText('e2e-source-protegido.png', { exact: true }).waitFor();
  await page.getByText('e2e-source-protegido.png', { exact: true }).click();
  await page.getByTestId('protect-source-continue').getByRole('button').click({ force: true });
  await page.getByTestId('protect-verify').waitFor();
  await page.getByTestId('protect-verify-action').getByRole('button').click({ force: true });
  await page.getByText('Marca verificada', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('Abierto', { exact: true }).waitFor();
  await page.getByText(/Coincide: Recorrido E2E/).waitFor();
  await page.getByRole('button', { name: 'Volver a Nodus Protect', exact: true }).click({ force: true });
  await page.getByTestId('protect-home').waitFor();
  await page.getByTestId('toolkit-protect-back').click();
  await page.getByTestId('toolkit-home').waitFor({ timeout: 10_000 });
  console.log('[e2e] toolkit: hub geometry, Convert regression, Translate text + PDF facsimile, and full Protect redact → trace → vault → verify round-trip');
  if (process.env.NODUS_E2E_TOOLKIT_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused Toolkit + Nodus Translate + Nodus Protect smoke passed');
    process.exit(0);
  }

  // ── Search result: an idea reuses the Ideas section's detail modal ─────────
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true, 'demo corpus seeded for search smoke');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-tour="nav-search"]'));
  await page.locator('[data-tour="nav-search"]').click();
  const searchInput = page.getByPlaceholder('Escribe para buscar…', { exact: true });
  await searchInput.fill('recuperación');
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText('Práctica de recuperación y retención a largo plazo', { exact: true }).click();
  const detailDialog = page.locator('[role="dialog"]');
  await detailDialog.waitFor();
  // The idea opens the shared IdeaDetailModal, whose graph jump is the secondary
  // "Ver en el grafo" action — not an immediate navigation away from Search.
  const graphAction = detailDialog.getByRole('button', { name: 'Ver en el grafo', exact: true });
  await graphAction.waitFor({ timeout: 10_000 });
  assert.equal(await graphAction.count(), 1, 'idea detail modal opened with its secondary graph action');
  assert.equal(await searchInput.isVisible(), true, 'search remains the active primary surface');
  await detailDialog.locator('button[title="Cerrar"]').first().click();
  console.log('[e2e] search idea result opens the shared idea detail modal');

  // ── Espacio de trabajo: la unificación de Notas, Escritura y Proyectos ──────
  //
  // Se prueba en este orden porque es el orden en que le pasa a alguien que actualiza:
  // primero hay contenido antiguo, y solo después se abre la sección nueva. El proyecto
  // se siembra por IPC con la forma EXACTA que tenía antes de la v130 — una carpeta raíz,
  // una sección y un capítulo — y lo que se comprueba es que la vista nueva lo encuentra
  // como colección con su nota dentro, sin haberlo tocado a mano.
  const legacy = await page.evaluate(async () => {
    const detail = await window.nodus.createProject({ title: 'Tesis heredada', kind: 'thesis', brief: 'Un proyecto anterior al Espacio de trabajo.' });
    const tree = await window.nodus.getNotesTree();
    const document = tree.notes.find((note) => note.title === 'Brief - Tesis heredada');
    return { rootFolderId: detail.project.rootFolderId, noteId: document?.id ?? null };
  });
  assert.ok(legacy.rootFolderId, 'the legacy project brought its own folder, exactly as it always did');
  assert.ok(legacy.noteId, 'and a document inside it');

  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-view').waitFor({ timeout: 15_000 });
  await page.getByTestId(`workspace-collection-${legacy.rootFolderId}`).waitFor({ timeout: 10_000 });
  await page.getByTestId(`workspace-item-${legacy.noteId}`).waitFor({ timeout: 10_000 });
  console.log('[e2e] workspace: a legacy project reads as a collection with its document inside');

  // Una nota y una idea, cada una con su icono, abiertas a la vez en pestañas.
  if (await page.locator('.editorial-workspace .editorial-options').getAttribute('open') === null) await page.locator('.editorial-workspace .editorial-options > summary').click();
  await page.getByTestId('workspace-create-note').click();
  await page.getByTestId('editor-title').waitFor({ timeout: 20_000 });
  await page.getByTestId('workspace-tab-home').click();
  if (await page.locator('.editorial-workspace .editorial-options').getAttribute('open') === null) await page.locator('.editorial-workspace .editorial-options > summary').click();
  await page.getByTestId('workspace-create-idea').click();
  await page.getByTestId('editor-title').waitFor({ timeout: 20_000 });
  assert.equal(
    await page.locator('[data-testid^="workspace-tab-"]:not([data-testid="workspace-tab-home"]):not([data-testid^="workspace-tab-close-"])').count(),
    2,
    'a note and an idea stay open side by side in tabs'
  );
  // Notes and ideas use the same native canvas and save-status contract as Study.
  await page.locator('.nodus-blocknote .bn-editor').first().waitFor({ timeout: 10_000 });
  await page.getByTestId('study-editor-save-state').waitFor({ timeout: 10_000 });
  console.log('[e2e] workspace: notes and ideas open in tabs with the full Study editor');

  // Y el enlace con la biblioteca sobrevive a una recarga del listado.
  const linked = await page.evaluate(async (noteId) => {
    await window.nodus.addWorkspaceLibraryLink({ ownerKind: 'note', ownerId: noteId, libraryItemId: 'e2e-item', scope: 'vault', label: 'Obra enlazada' });
    const after = await window.nodus.listWorkspaceLibraryLinks('note', noteId);
    await window.nodus.removeWorkspaceLibraryLink('note', noteId, 'e2e-item', 'vault');
    return { after: after.length, gone: (await window.nodus.listWorkspaceLibraryLinks('note', noteId)).length };
  }, legacy.noteId);
  assert.deepEqual(linked, { after: 1, gone: 0 }, 'a library link persists and can be removed again');
  console.log('[e2e] workspace: library links persist per note');

  // ── Optional-image controls exist and can be toggled without generation ───
  // The immersion image option now lives in the "New immersion" composer modal.
  await page.locator('[data-tour="nav-immersion"]').click();
  await page.getByRole('button', { name: 'Nueva inmersión', exact: true }).first().click();
  const immersionImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await immersionImageToggle.waitFor();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion style hidden while disabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'immersion style shown when enabled');
  await immersionImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'immersion image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.locator('[data-tour="nav-deepResearch"]').click();
  // The Deep Research image option now lives in the "New report" composer modal.
  await page.getByRole('button', { name: 'Nuevo informe', exact: true }).first().click();
  const reportImageToggle = page.getByRole('button', { name: 'Imagen decorativa', exact: true });
  await reportImageToggle.waitFor();
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 1, 'Deep Research style shown when enabled');
  await reportImageToggle.click();
  assert.equal(await page.getByRole('option', { name: 'Acuarela', exact: true }).count(), 0, 'Deep Research image option disables cleanly');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  console.log('[e2e] optional image controls toggle in both owner flows');

  // ── Real IPC round-trip: the async graph build (compute worker path) ────────
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  assert.ok(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges), 'graph:get returns {nodes, edges}');
  console.log(`[e2e] graph:get ok (${graph.nodes.length} nodes, ${graph.edges.length} edges on a fresh profile)`);

  const authorsGraph = await page.evaluate(() => window.nodus.getGraph('authors'));
  assert.ok(Array.isArray(authorsGraph.nodes), 'authors lens answers too');

  const stellar = await page.evaluate(() => window.nodus.stellarPage({kind:'search',limit:20}));
  assert.ok(Array.isArray(stellar.nodes) && stellar.nodes.length <= 20, 'stellar seed search is paginated');

  // ── Records ontology + evidence archive over real IPC ───────────────────────
  const records = await page.evaluate(async () => {
    const juan = await window.nodus.createPerson({ displayName: 'Juan Pérez', sex: 'male', birthDate: 'c. 1850' });
    const hijo = await window.nodus.createPerson({ displayName: 'Pedro Pérez', sex: 'male' });
    await window.nodus.addRelationship(juan.personId, hijo.personId, 'parent', 'user_asserted', 'adoptive');
    await window.nodus.setPersonFrame(juan.personId, 'walnut');
    const kin = await window.nodus.kinOf(juan.personId);
    const juanReloaded = await window.nodus.getPerson(juan.personId);
    const place = await window.nodus.findOrCreatePlace('Sevilla', 'municipality');
    const event = await window.nodus.createEvent({
      type: 'marriage',
      date: '1875',
      placeId: place.placeId,
      participants: [{ personId: juan.personId, role: 'principal' }],
    });
    await window.nodus.addRecordEvidence({
      targetKind: 'person',
      targetId: juan.personId,
      quote: 'Juan Pérez, jornalero',
      location: 'p. 1',
    });
    const folder = await window.nodus.createArchiveFolder('Censos', null);
    const item = await window.nodus.createArchiveItem({
      folderId: folder.folderId,
      title: 'Hoja censal',
      kind: 'image',
      extractedText: 'Juan Pérez jornalero',
      tags: ['censo'],
    });
    const entry = await window.nodus.createArchiveTextEntry({
      title: 'Partida',
      content: 'texto',
      docType: 'birth_record',
      metadata: { persona: 'Juan Pérez', inventado: 'x' },
    });
    await window.nodus.linkArchivePerson(entry.itemId, juan.personId);
    const linkedDocs = await window.nodus.listArchiveItemsForPerson(juan.personId);

    // Map: offline gazetteer search → resolve to a place → per-person place record →
    // located map point (the whole map pipeline over IPC, fully offline).
    const gaz = await window.nodus.searchGazetteer('Carmona', 6);
    const carmonaEs = gaz.find((g) => g.countryCode === 'ES');
    let mapPointCount = 0;
    if (carmonaEs) {
      const gplace = await window.nodus.resolveGazetteerPlace(carmonaEs);
      await window.nodus.addPersonPlace({ personId: juan.personId, placeId: gplace.placeId, label: 'birth', date: 'c. 1850' });
      mapPointCount = (await window.nodus.mapPoints([juan.personId])).length;
    }

    // Kinship suggestion IPC is wired and answers cleanly with no proposals yet
    // (proposals are seeded by an AI scan, which needs a provider key we don't set here;
    // the accumulate/confirm/dismiss logic is covered by the unit repo test).
    const kinSuggestionCount = await window.nodus.kinSuggestionCount();
    const kinSuggestions = await window.nodus.listKinSuggestions();

    // Archive discovery is AI-free (lexical): the censal sheet names Juan, so he is
    // proposed for the document and the document is proposed for him — both directions.
    const personSuggestions = await window.nodus.suggestPersonsForItem(item.itemId);
    const docSuggestions = await window.nodus.suggestDocumentsForPerson(juan.personId);

    return {
      linkedDocs: linkedDocs.length,
      linkedName: (await window.nodus.getArchiveItem(entry.itemId)).linkedPersons[0]?.displayName,
      entryDocType: entry.docType,
      entryMeta: entry.metadata,
      frameStyle: juanReloaded.frameStyle,
      biographyField: juanReloaded.biography, // null until generated; confirms the v41 column
      persons: (await window.nodus.listPersons()).length,
      children: kin.children.length,
      events: (await window.nodus.listEvents({ personId: juan.personId })).length,
      evidence: (await window.nodus.listRecordEvidence('person', juan.personId)).length,
      placeName: (await window.nodus.getEvent(event.eventId)).placeName,
      archiveItems: (await window.nodus.listArchiveItems({ tags: ['censo'] })).length,
      archiveFilteredOut: (await window.nodus.listArchiveItems({ tags: ['inexistente'] })).length,
      hasBlobFlag: item.hasBlob,
      kinSuggestionCount,
      kinSuggestionsIsArray: Array.isArray(kinSuggestions),
      personSuggested: personSuggestions.some((p) => p.displayName === 'Juan Pérez'),
      docSuggested: docSuggestions.some((d) => d.itemId === item.itemId && d.reason === 'name'),
      gazetteerHits: gaz.length,
      gazetteerCarmona: !!carmonaEs,
      mapPointCount,
    };
  });
  assert.equal(records.persons, 2, 'persons created over IPC');
  assert.equal(records.children, 1, 'kinship edge resolved over IPC');
  assert.equal(records.frameStyle, 'walnut', 'per-person tree frame stored over IPC');
  assert.equal(records.linkedDocs, 1, 'document linked to the person over IPC');
  assert.equal(records.linkedName, 'Juan Pérez', 'linked person surfaces on the item over IPC');
  assert.equal(records.biographyField, null, 'biography column present (null until generated)');
  assert.equal(records.events, 1, 'event linked to the person');
  assert.equal(records.evidence, 1, 'record evidence attached');
  assert.equal(records.placeName, 'Sevilla', 'event resolves its place');
  assert.equal(records.archiveItems, 1, 'archive item created + tag-filtered');
  assert.equal(records.archiveFilteredOut, 0, 'tag filter excludes non-matching items over IPC');
  assert.equal(records.entryDocType, 'birth_record', 'text entry keeps its document type');
  assert.deepEqual(records.entryMeta, { persona: 'Juan Pérez' }, 'metadata sanitised to the type (unknown key dropped)');
  assert.equal(records.kinSuggestionCount, 0, 'kinship suggestions IPC answers (none seeded without AI)');
  assert.ok(records.kinSuggestionsIsArray, 'listKinSuggestions returns an array over IPC');
  assert.ok(records.personSuggested, 'archive → person discovery proposes the named person over IPC');
  assert.ok(records.docSuggested, 'person → document discovery proposes the naming document over IPC');
  console.log('[e2e] records ontology + archive ok over IPC');

  assert.ok(records.gazetteerHits > 0, 'offline gazetteer search returns candidates over IPC');
  assert.ok(records.gazetteerCarmona, 'the Spanish Carmona is found in the offline gazetteer');
  assert.equal(records.mapPointCount, 1, 'a resolved gazetteer place becomes a located map point over IPC');
  console.log('[e2e] map: gazetteer + per-person places ok over IPC');

  // ── Databases mode over real IPC ────────────────────────────────────────────
  // The db_* tables exist in every vault DB (the vault-type gate is UI-only), so the
  // engine round-trips here even though the e2e profile is an academic vault.
  const dbmode = await page.evaluate(async () => {
    const database = await window.nodus.createDatabase('Fotos', null);
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    const sel = await window.nodus.createDatabaseColumn(database.id, 'Estado', 'select');
    const opt = await window.nodus.addDatabaseOption(sel.id, 'Nuevo', '#ef4444');
    const row = await window.nodus.createDatabaseRow(database.id);
    await window.nodus.setDatabaseCell(row.id, title.id, 'Gato');
    await window.nodus.setDatabaseCell(row.id, sel.id, opt.id);
    const rows = await window.nodus.listDatabaseRows(database.id, { sort: 'position' });
    const stats = await window.nodus.databaseStats(database.id);
    const detail = await window.nodus.getDatabaseDetail(database.id);

    // CSV import over IPC (no dialog: createDatabaseFromCsv takes the rows directly).
    const imported = await window.nodus.createDatabaseFromCsv(
      'CSV',
      ['Nombre', 'Peso', 'Estado'],
      [['Gato', '3.5', 'vivo'], ['Perro', '8', 'muerto']],
      ['title', 'number', 'select']
    );
    const importedDetail = await window.nodus.getDatabaseDetail(imported.id);
    const importedRows = await window.nodus.listDatabaseRows(imported.id, { sort: 'position' });

    // Relation column → link the first table's row to an imported row.
    const relCol = await window.nodus.createDatabaseColumn(database.id, 'Vínculo', 'relation', {
      relationTargetKind: 'db_row',
      relationTargetDatabaseId: imported.id,
    });
    const relation = await window.nodus.addDatabaseRelation(row.id, relCol.id, 'db_row', importedRows[0].id);
    const relations = await window.nodus.listDatabaseRelations(row.id, relCol.id);

    // Saved view over IPC.
    const view = await window.nodus.createDatabaseView(imported.id, {
      name: 'Vivos',
      layout: 'gallery',
      filter: { conjunction: 'and', conditions: [{ id: 'c', columnId: importedDetail.columns[2].id, op: 'isNoneOf', value: [] }] },
      sorts: [],
    });
    const viewList = await window.nodus.listDatabaseViews(imported.id);

    // Analysis profile (deterministic stats) over IPC.
    const prof = await window.nodus.getDatabaseProfile(imported.id);
    const numProfile = prof.profile.columns.find((c) => c.type === 'number');

    return {
      list: (await window.nodus.listDatabases()).length,
      shortId: database.shortId,
      columns: detail.columns.length,
      titleCell: rows[0]?.cells[title.id],
      selCell: rows[0]?.cells[sel.id],
      optId: opt.id,
      rowCount: stats.rowCount,
      percent: stats.percent,
      importedCols: importedDetail.columns.length,
      importedSelectOptions: importedDetail.columns[2].options.length,
      importedRows: importedRows.length,
      relationLabel: relation.label,
      relationCount: relations.length,
      viewLayout: view.layout,
      viewCount: viewList.length,
      profileRows: prof.profile.rowCount,
      profileNumberMean: numProfile ? numProfile.number.mean : null,
    };
  });
  assert.ok(dbmode.list >= 1, 'database created over IPC');
  assert.match(dbmode.shortId, /^DB-[A-Z0-9]{4}$/, 'database gets a unique short id over IPC');
  assert.equal(dbmode.columns, 2, 'typed columns created over IPC');
  assert.equal(dbmode.titleCell, 'Gato', 'title cell round-trips over IPC');
  assert.equal(dbmode.selCell, dbmode.optId, 'select cell stores the option id over IPC');
  assert.equal(dbmode.rowCount, 1, 'row counted in database stats over IPC');
  assert.equal(dbmode.importedCols, 3, 'CSV import created typed columns over IPC');
  assert.equal(dbmode.importedSelectOptions, 2, 'CSV import built select options from distinct values');
  assert.equal(dbmode.importedRows, 2, 'CSV import created rows over IPC');
  assert.equal(dbmode.relationLabel, 'Gato', 'relation resolves the target row title over IPC');
  assert.equal(dbmode.relationCount, 1, 'relation stored over IPC');
  assert.equal(dbmode.viewLayout, 'gallery', 'saved view stored its layout over IPC');
  assert.equal(dbmode.viewCount, 1, 'saved view listed over IPC');
  assert.equal(dbmode.profileRows, 2, 'analysis profile counts rows over IPC');
  assert.equal(dbmode.profileNumberMean, 5.75, 'analysis profile computes numeric mean over IPC');
  console.log('[e2e] databases mode (CSV import + relations + views + analysis) ok over IPC');

  // ── Database Deep Research: production renderer → preload → IPC preview ─────
  const databaseResearchSetup = await page.evaluate(async () => {
    const originalVaultId = (await window.nodus.getActiveVault()).id;
    const created = await window.nodus.createVault({ name: 'Database research smoke', type: 'databases' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, databasesTourComplete: true, theme: 'light',
    });
    const database = await window.nodus.createDatabase('Research evidence', null);
    const title = await window.nodus.createDatabaseColumn(database.id, 'Cohorte', 'title');
    const value = await window.nodus.createDatabaseColumn(database.id, 'Resultado', 'number');
    for (const [label, numeric] of [['A', '10'], ['B', '18'], ['C', '31']]) {
      const row = await window.nodus.createDatabaseRow(database.id);
      await window.nodus.setDatabaseCell(row.id, title.id, label);
      await window.nodus.setDatabaseCell(row.id, value.id, numeric);
    }
    const preview = await window.nodus.previewDatabaseDeepResearch({
      objective: 'Verificar diferencias y anomalías sin inventar cifras.',
      databaseIds: [database.id], viewIds: [], filters: { query: '', columnIds: [] }, roles: { outcome: value.id },
      model: { provider: 'codex', model: 'gpt-5.6-luna' }, depth: 'deep',
      budget: { depth: 'deep', rounds: 4, maxTasks: 60, resamples: 5000, maxRows: 500000 },
      includeAttachmentContent: false,
    });
    return { originalVaultId, temporaryVaultId: created.vault.id, preview };
  });
  assert.equal(databaseResearchSetup.preview.rowCount, 3, 'database Deep Research preview reads the selected rows over IPC');
  assert.equal(databaseResearchSetup.preview.sourceCount, 1, 'database Deep Research preview preserves source scope');
  assert.ok(databaseResearchSetup.preview.sections.length >= 3, 'database Deep Research preview returns an editable research outline');
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.locator('[data-tour="nav-dbDeepResearch"]').click();
  await page.getByTestId('database-deep-research').waitFor({ timeout: 30_000 });
  // The library is what the view opens on; the composer is now a dialog behind
  // "Nuevo informe", and the editable outline lives inside its advanced options.
  assert.equal(await page.getByTestId('database-deep-research-library').count(), 1, 'database Deep Research report library renders in the real app');
  assert.equal(await page.getByTestId('database-deep-research-composer').count(), 0, 'the composer stays closed until it is asked for');
  await page.getByTestId('database-deep-research-new').click();
  await page.getByTestId('database-deep-research-composer').waitFor({ timeout: 30_000 });
  await page.getByTestId('database-deep-research-objective').fill('Verificar diferencias y anomalías sin inventar cifras.');
  const composer = page.getByTestId('database-deep-research-composer');
  await composer.getByRole('checkbox', { name: 'Research evidence' }).check();
  await composer.getByRole('button', { name: 'Opciones avanzadas' }).click();
  await composer.getByTestId('database-deep-research-advanced').waitFor({ timeout: 30_000 });
  await composer.getByRole('button', { name: 'Preparar automáticamente' }).click();
  await composer.getByTestId('database-deep-research-preview').waitFor({ timeout: 30_000 });
  assert.ok(await composer.getByTestId('database-deep-research-preview').locator('input').count() >= 6, 'the editable outline renders a title and focus field per section');
  await composer.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByTestId('database-deep-research-composer').waitFor({ state: 'detached', timeout: 30_000 });
  await page.evaluate(async ({ originalVaultId, temporaryVaultId }) => {
    const switched = await window.nodus.switchVault(originalVaultId);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.deleteVault(temporaryVaultId, true);
  }, databaseResearchSetup);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  console.log('[e2e] database Deep Research library + composer dialog + editable outline ok over real IPC');

  // ── Study vault: real UI creation flow + visual/structural regressions ─────
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Study smoke', type: 'estudio' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 5, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true, studyTourComplete: true, theme: 'light' });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).first().click();
  await page.getByTestId('study-create-course').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByText('Crea tu primer curso para empezar.', { exact: true }).count(), 0, 'empty-state guidance stays out of the sidebar');
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'estudio', 'study vault uses the teal Nodus logo');

  const organizationBox = await page.getByTestId('study-sidebar-organization').boundingBox();
  const analyzeBox = await page.getByRole('button', { name: 'Analizar', exact: true }).boundingBox();
  assert.ok(organizationBox && analyzeBox && analyzeBox.y - (organizationBox.y + organizationBox.height) < 40, 'Analyze follows Organization without a flex spacer');
  assert.equal(await page.getByRole('button', { name: 'Banco de preguntas', exact: true }).isDisabled(), false, 'question bank is enabled');
  for (const removed of ['Tests', 'Exámenes', 'Repaso', 'Planificador', 'Progreso']) {
    assert.equal(await page.getByRole('button', { name: removed, exact: true }).count(), 0, `${removed} is not rendered`);
  }
  await page.getByTestId('study-sidebar-organization-toggle').click();
  assert.equal(await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).count(), 0, 'Organization can be collapsed');
  assert.equal(await page.getByTestId('study-sidebar-organization-toggle').getAttribute('aria-expanded'), 'false');
  await page.getByTestId('study-sidebar-organization-toggle').click();
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).waitFor();

  const createStudyItem = async (buttonTestId, name) => {
    await page.getByTestId(buttonTestId).click();
    await page.getByTestId('study-create-dialog').waitFor();
    await page.getByTestId('study-create-name').fill(name);
    await page.getByTestId('study-create-submit').click();
    await page.getByTestId('study-create-dialog').waitFor({ state: 'detached' });
  };
  await createStudyItem('study-create-course', 'Curso smoke');
  await createStudyItem('study-create-subject', 'Asignatura smoke');
  await createStudyItem('study-create-folder', 'Carpeta smoke');
  await createStudyItem('study-create-topic', 'Tema smoke');
  const searchPadding = await page.getByTestId('study-organization-search').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(searchPadding >= 30, `study search reserves space for its leading icon (${searchPadding}px)`);
  await createStudyItem('study-create-document', 'Apunte smoke');

  const study = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    return {
      counts: [workspace.courses.length, workspace.subjects.length, workspace.topics.length, workspace.folders.length, workspace.documents.length],
      placement: workspace.placements.find((item) => item.documentId === document?.id),
    };
  });
  assert.deepEqual(study.counts, [1, 1, 1, 1, 1], 'all organization buttons create through the real renderer and IPC bridge');
  assert.ok(study.placement?.courseId && study.placement?.subjectId && study.placement?.folderId && study.placement?.topicId, 'UI-created material keeps the selected hierarchy placement');
  assert.match(await page.locator('body').innerText(), /Cursos y asignaturas/, 'study-specific sidebar is rendered');
  console.log('[e2e] study logo, search padding, sidebar flow and creation dialogs ok');

  const openEditorOptions = async () => {
    const options = page.locator('.editorial-editor-header .editorial-options');
    if (await options.getAttribute('open') === null) await options.locator('summary').click();
  };
  const clickEditorAction = async button => {
    if (!await button.isVisible()) await openEditorOptions();
    await button.click();
  };
  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY !== '1') {
  await page.locator('.nodus-blocknote .bn-editor').first().waitFor({ timeout: 30_000 });
  await clickEditorAction(page.getByTestId('study-dictation-toggle'));
  await page.getByTestId('study-dictation').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-dictation').innerText(), /ONNX|Local|offline/i, 'dictation panel defaults to the offline ONNX backend');
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Dictado', exact: true }).click();
  const dictationLanguage = page.getByTestId('study-dictation-language');
  await dictationLanguage.waitFor();
  assert.equal(await dictationLanguage.locator('option').first().getAttribute('value'), 'auto', 'dictation supports automatic language detection');
  assert.ok(await dictationLanguage.locator('option').count() >= 100, 'dictation exposes every language supported by multilingual Whisper');
  await dictationLanguage.selectOption('es');
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Dictado', exact: true }).click();
  await page.getByTestId('study-dictation-start').click();
  const microphonePrivacyDialog = page.getByRole('dialog', { name: 'Antes de activar el micrófono' });
  await microphonePrivacyDialog.waitFor({ timeout: 30_000 });
  assert.match(
    await microphonePrivacyDialog.innerText(),
    /localmente|base jurídica|no sustituye el consentimiento/i,
    'the recording privacy notice blocks microphone access and explains the local/controller boundary',
  );
  await microphonePrivacyDialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.getByTestId('study-dictation-discard').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-dictation-discard').click();
  await page.getByTestId('study-dictation-start').waitFor({ timeout: 30_000 });
  await clickEditorAction(page.getByTestId('study-dictation-toggle'));
  console.log('[e2e] study dictation panel + fake microphone capture ok');
  if (process.env.NODUS_E2E_STT_UI_ONLY === '1') {
    const recordingId = await page.evaluate(async () => (await window.nodus.createStudyRecording({
      fileName: 'idioma-smoke.wav', mimeType: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]), language: 'auto',
    })).recording.id);
    await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
    await page.getByTestId('study-recordings-view').waitFor();
    await page.locator(`[data-testid="study-recording-${recordingId}"]`).click();
    const recordingLanguage = page.getByTestId('study-recording-language');
    await recordingLanguage.waitFor();
    assert.equal(await recordingLanguage.inputValue(), 'auto', 'recordings preserve per-audio automatic detection');
    assert.ok(await recordingLanguage.locator('option').count() >= 100, 'recordings expose every language supported by multilingual Whisper');
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused dictation + recording language UI smoke passed');
    process.exit(0);
  }
  await clickEditorAction(page.getByTestId('study-doc-favorite'));
  await clickEditorAction(page.getByTestId('study-doc-style'));
  await page.getByTestId('study-doc-kind').selectOption('manual');
  await page.getByTestId('study-doc-color').fill('#22c55e');
  await waitForCondition('metadatos del editor de estudio', () => page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    return document?.favorite === true && document.kind === 'manual' && document.color === '#22c55e';
  }));
  console.log('[e2e] study editor metadata controls ok');
  await clickEditorAction(page.getByRole('button', { name: 'Markdown crudo', exact: true }));
  const editorMarkdown = '# Tema smoke\n\nTexto **importante** con $x^2$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  await page.getByTestId('study-markdown-editor').fill(editorMarkdown);
  // Exercise the editor's real autosave and poll the persisted state directly;
  // dispatching a second manual save would make this smoke assertion depend on
  // runner timing instead of the durability contract it is meant to verify.
  await page.evaluate(async (expected) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const workspace = await window.nodus.getStudyWorkspace();
      const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
      if (document?.contentMarkdown === expected) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('El autoguardado del editor no persistió el Markdown a tiempo.');
  }, editorMarkdown);
  const editorRoundTrip = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    if (!document) return null;
    const data = await window.nodus.getStudyDocEditorData(document.id);
    return { content: document.contentMarkdown, versions: data.versions.length };
  });
  assert.equal(editorRoundTrip?.content, editorMarkdown, 'raw Markdown round-trips exactly through the editor');
  assert.ok((editorRoundTrip?.versions ?? 0) >= 1, 'editor save creates a recoverable version');
  console.log('[e2e] study editor raw Markdown autosave + version ok');

  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY !== '1') {
  // Compact prompt manager + contextual streaming actions. The smoke profile
  // intentionally has no usable provider, so the direct action must restore
  // the original selection after the streamed request fails.
  await page.getByTestId('study-improve-toggle').click();
  await page.getByTestId('study-improve-dialog').waitFor();
  const improveDialogBox = await page.getByTestId('study-improve-dialog').locator('section').first().boundingBox();
  assert.ok(improveDialogBox && improveDialogBox.width <= 960, `prompt manager fits its responsive two-column surface (${improveDialogBox?.width}px)`);
  assert.equal(await page.locator('[data-testid^="study-style-builtin-"]').count(), 13, 'all predefined improvement styles are visible');
  assert.ok(await page.getByTestId('study-prompt-search').isVisible(), 'the prompt library exposes search');
  await page.getByTestId('study-style-builtin-academic').click();
  await page.getByText('Registro académico preciso y argumentación ordenada.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Conservar significado', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Transformación libre', { exact: true }).count(), 0);
  await page.getByTestId('study-style-toolbar-builtin-proofread').click();
  await page.getByText('Puedes mostrar un máximo de cuatro prompts en la barra.', { exact: true }).waitFor();
  await page.getByTestId('study-style-new').click();
  await page.getByTestId('study-prompt-title').fill('Pulir smoke');
  await page.getByTestId('study-prompt-text').fill('Reescribe el texto seleccionado con mayor fluidez sin añadir información nueva.');
  await page.getByTestId('study-create-icon-emoji').click();
  await page.getByRole('button', { name: 'flask', exact: true }).click();
  await page.getByTestId('study-prompt-save').click();
  await page.getByText('Prompt guardado.', { exact: true }).waitFor();
  await page.getByTestId('study-improve-dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();

  await clickEditorAction(page.getByRole('button', { name: 'Markdown crudo', exact: true }));
    await page.locator('.nodus-blocknote .bn-editor').first().waitFor({ timeout: 30_000 });
  await page.locator('.nodus-blocknote .bn-editor').evaluate((root) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('Texto') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 5);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 420, clientY: 420 })); return;
    }
    throw new Error('Improvement selection fixture not found');
  });
  await page.getByTestId('study-selection-text-color').waitFor();
  assert.equal(await page.locator('[data-testid^="study-quick-improve-"]').count(), 4, 'the selection exposes exactly the four configured prompt shortcuts');
  assert.equal(await page.getByTestId('study-synonyms-toggle').count(), 1, 'the selection exposes the contextual synonyms action');
  await page.getByTestId('study-synonyms-toggle').click();
  await page.getByTestId('study-synonyms-panel').waitFor();
  assert.equal(await page.getByTestId('study-synonyms-regenerate').count(), 1, 'the contextual synonyms dropdown opens with regeneration controls');
  await page.keyboard.press('Escape');
  await page.getByTestId('study-synonyms-panel').waitFor({ state: 'detached' });
  const failedImprovement = await page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    const style = (await window.nodus.listStudyStyles()).find((item) => item.id === 'builtin:academic');
    if (!document || !style) throw new Error('Improvement failure fixture not found');
    try {
      await window.nodus.improveStudyText({
        documentId: document.id,
        subjectId: workspace.placements.find((item) => item.documentId === document.id)?.subjectId,
        text: 'Texto',
        styleId: style.id,
        scope: 'selection',
        level: style.level,
        length: style.length,
        mode: 'preserve',
        variables: { language: style.language, documentType: document.kind, selectedText: 'Texto' },
        protectedTerms: [document.title],
        model: null,
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(failedImprovement, true, 'the deterministic provider failure reaches the renderer bridge');
  const unchangedAfterImprovement = await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.find((item) => item.title === 'Apunte smoke')?.contentMarkdown);
  // The native canvas can normalize equivalent table separators when leaving raw
  // mode; the selected source phrase itself must remain byte-for-byte intact.
  assert.match(unchangedAfterImprovement ?? '', /Texto \*\*importante\*\* con \$x\^2\$\./, 'failed improvement leaves the selected Markdown untouched');
  console.log('[e2e] compact prompt manager + four contextual streaming shortcuts + failure preservation ok');

  await page.locator('.nodus-blocknote .bn-editor').first().waitFor({ timeout: 30_000 });
  await page.locator('.nodus-blocknote .katex').first().waitFor({ timeout: 30_000 });
  await page.locator('.nodus-blocknote table').first().waitFor({ timeout: 30_000 });
  await page.locator('.nodus-blocknote .bn-editor').evaluate((root) => {
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await openEditorOptions();
  await page.getByTestId('study-heading-level').selectOption('2');
  await page.keyboard.press('Escape');
  await page.locator('.nodus-blocknote .bn-editor h2').first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.nodus-blocknote .bn-editor').getByText('## Título', { exact: true }).count(), 0, 'visual heading insertion creates a heading node rather than literal Markdown');
  await page.locator('.nodus-blocknote .bn-editor').evaluate((root) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('Texto') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 5);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.dispatchEvent(new Event('selectionchange')); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return;
    }
    throw new Error('Text selection fixture not found');
  });
  await page.waitForTimeout(120);
  await clickEditorAction(page.getByTestId('study-inline-code'));
  assert.ok(await page.locator('.nodus-blocknote .bn-editor code').count() > 0, 'inline-code button formats the visual selection');
  await page.locator('.nodus-blocknote .bn-editor').evaluate((root) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf('importante') ?? -1;
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 10);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.dispatchEvent(new Event('selectionchange')); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return;
    }
    throw new Error('Formula selection fixture not found');
  });
  await page.waitForTimeout(120);
  await clickEditorAction(page.getByTestId('study-inline-formula'));
  assert.ok(await page.locator('.nodus-blocknote .bn-editor [data-inline-content-type="nodusFormula"]').count() > 0, 'formula button converts selected visual text into inline math');
  // The floating selection ribbon: out of sight while the pointer is still down,
  // and placed over the point where the selection was released rather than over
  // the box of the whole selection, which starts wherever the drag began.
  const floatingRibbon = page.locator('.bn-formatting-toolbar');
  const measureEditorLine = () => page.locator('.nodus-blocknote .bn-editor').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const candidates = [];
    let node;
    while ((node = walker.nextNode())) {
      const length = (node.textContent ?? '').length;
      if (length < 5) continue;
      const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, Math.min(length, 12));
      const rect = range.getBoundingClientRect();
      // The drag is driven with the real mouse, so the line has to be on screen,
      // and nothing may be sitting on top of the point the drag starts from.
      if (rect.width <= 20 || rect.top <= 0 || rect.bottom >= window.innerHeight) continue;
      const y = rect.top + rect.height / 2;
      if (!root.contains(document.elementFromPoint(rect.left + 1, y))) continue;
      candidates.push({ width: rect.width, from: { x: rect.left + 1, y }, to: { x: rect.right - 1, y } });
    }
    return candidates.sort((a, b) => b.width - a.width)[0] ?? null;
  });
  let editorDrag = null;
  for (let attempt = 0; attempt < 3 && !editorDrag; attempt += 1) {
    const drag = await measureEditorLine();
    if (!drag) { await page.waitForTimeout(400); continue; }
    await page.mouse.move(drag.from.x, drag.from.y);
    await page.mouse.down();
    await page.mouse.move(drag.to.x, drag.to.y, { steps: 8 });
    // A layout that shifted between measuring and dragging selects nothing; the
    // release then has no ribbon to place and the attempt is simply repeated.
    if (await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length > 0)) editorDrag = drag;
    else await page.mouse.up();
  }
  // A CI runner pinned to a small screen may leave no editor line to drag over.
  // The arithmetic itself is covered by scripts/test-selection-ribbon-position.mjs.
  if (!editorDrag) console.log('[e2e] editor selection ribbon geometry skipped: no editor line to drag over');
  else {
    await page.mouse.up();
    await floatingRibbon.waitFor({ state: 'visible', timeout: 10_000 });
    const ribbonBox = await floatingRibbon.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(ribbonBox.x >= 0 && ribbonBox.x + ribbonBox.width <= viewport.width, 'the native selection toolbar fits horizontally');
    assert.ok(ribbonBox.y >= 0 && ribbonBox.y + ribbonBox.height <= viewport.height, 'the native selection toolbar fits vertically');
    assert.ok((await page.evaluate(() => getSelection()?.toString() ?? '')).trim(), 'opening the native toolbar preserves the selected text');
    await page.keyboard.press('ArrowRight');
    await floatingRibbon.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  const splitButton = page.getByRole('button', { name: 'Dividir vista', exact: true });
  await clickEditorAction(splitButton);
  await openEditorOptions();
  assert.equal(await splitButton.getAttribute('aria-pressed'), 'true', 'the split-view control exposes its active state');
  await page.keyboard.press('Escape');
  await page.locator('.study-editor-shell .md .katex').first().waitFor({ timeout: 30_000 });
  assert.match(await page.locator('body').innerText(), /Tema smoke/, 'document outline and WYSIWYG content render');
  console.log('[e2e] study BlockNote editor + metadata + raw Markdown + versioning ok');
  }
  }

  // ── Study materials: native import dialog + embedded PDF + source note ─────
  const pdfPath = path.join(userData, 'fuente-smoke.pdf');
  const pdfBytes = await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><style>body{font:22px sans-serif;padding:60px}</style><h1>Fuente smoke</h1><p>Fragmento verificable para anotación 2026.</p>')}`);
    const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    win.destroy();
    return [...data];
  });
  await writeFile(pdfPath, Buffer.from(pdfBytes));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async (_window, options) => {
      const actual = options ?? _window;
      if (actual?.title === 'Seleccionar materiales de estudio') return { canceled: false, filePaths: [filePath] };
      return { canceled: true, filePaths: [] };
    };
  }, pdfPath);
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  const userNoteId = await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.find((document) => document.title === 'Apunte smoke')?.id);
  assert.equal(typeof userNoteId, 'string');
  await page.getByTestId(`study-material-note-${userNoteId}`).waitFor();
  await page.getByTestId(`study-material-note-${userNoteId}`).click();
  await page.locator('.study-editor-shell').first().waitFor({ timeout: 30_000 });
  assert.match(await page.getByRole('tab', { selected: true }).innerText(), /Apunte smoke/, 'a user-created note opens from Materials');
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  const materialSearchPadding = await page.getByTestId('study-material-search').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(materialSearchPadding >= 30, 'material search keeps its icon and text separated');
  await page.getByTestId('study-material-import').click();
  await page.getByTestId('study-material-import-dialog').waitFor();
  await page.getByRole('button', { name: 'Seleccionar archivos o ZIP', exact: true }).click();
  await page.getByTestId('study-material-import-dialog').getByText('fuente-smoke.pdf', { exact: true }).waitFor();
  await page.getByTestId('study-material-import-confirm').click();
  await page.getByTestId('study-material-import-dialog').waitFor({ state: 'detached' });
  await page.getByText('fuente-smoke', { exact: true }).waitFor({ timeout: 30_000 });
  const importedMaterial = await page.evaluate(async () => (await window.nodus.listStudyMaterials()).find((item) => item.title === 'fuente-smoke'));
  assert.equal(importedMaterial?.previewKind, 'pdf', 'PDF import stores an embedded material');
  assert.ok((importedMaterial?.extractedChars ?? 0) > 20, 'PDF text is extracted for search and citations');
  const materialPlacement = await page.evaluate(async (materialId) => {
    const workspace = await window.nodus.getStudyWorkspace();
    const course = workspace.courses.find((item) => item.name === 'Curso smoke');
    const subject = workspace.subjects.find((item) => item.name === 'Asignatura smoke');
    if (!course || !subject) throw new Error('Study organization fixture not found');
    await window.nodus.setPrimaryStudyMaterialPlacement(materialId, { courseId: course.id, subjectId: subject.id });
    const stored = (await window.nodus.listStudyMaterials()).find((item) => item.id === materialId);
    return { courseId: course.id, subjectId: subject.id, placements: stored?.placements ?? [] };
  }, importedMaterial.id);
  assert.ok(materialPlacement.placements.some((placement) => placement.courseId === materialPlacement.courseId && placement.subjectId === materialPlacement.subjectId), 'material placement persists before navigating to its category');
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).click();
  await page.getByTestId(`study-browser-course-${materialPlacement.courseId}`).locator('button').first().click();
  await page.getByTestId(`study-organization-material-${importedMaterial.id}`).waitFor();
  await page.getByTestId(`study-browser-subject-${materialPlacement.subjectId}`).locator('button').first().click();
  await page.getByTestId(`study-organization-material-${importedMaterial.id}`).waitFor();
  console.log('[e2e] imported material is visible in its assigned course and subject');
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await page.getByTestId('study-materials-view').waitFor({ timeout: 30_000 });
  await page.getByText('fuente-smoke', { exact: true }).click();
  await page.getByTestId('study-pdf-viewer').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-pdf-page] .select-text span')?.textContent?.length, { timeout: 30_000 });
  assert.ok(await page.locator('[data-testid="study-pdf-viewer"] canvas').evaluateAll((canvases) => canvases.some((canvas) => canvas.width > 0 && canvas.height > 0)), 'embedded PDF page rendered to canvas');
  // The viewer opens in the 'none' (select/scroll) tool, so pick the highlighter before selecting text.
  await page.getByTestId('study-pdf-tool-highlight').click();
  await page.locator('[data-pdf-page] .select-text').first().evaluate((layer) => {
    const span = [...layer.querySelectorAll('span')].find((item) => item.textContent?.includes('Fragmento')) ?? layer.querySelector('span');
    if (!span) throw new Error('PDF text layer has no selectable text');
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await waitForCondition('anotación PDF resaltada', () => page.evaluate(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'highlight' && annotation.selectedText.length > 0), importedMaterial.id));
  await page.getByTestId('study-material-annotations-sidebar').waitFor();
  for (const tool of ['highlight', 'underline', 'brush', 'sticky', 'comment']) await page.getByTestId(`study-pdf-tool-${tool}`).waitFor();
  await page.getByTestId('study-pdf-tool-brush').click();
  await page.getByTestId('study-pdf-brush-thickness').fill('7');
  const annotationCanvas = page.locator('[data-pdf-page] > svg[class*="z-20"]').first();
  const annotationCanvasBox = await annotationCanvas.boundingBox();
  assert.ok(annotationCanvasBox);
  await page.mouse.move(annotationCanvasBox.x + 80, annotationCanvasBox.y + 100);
  await page.mouse.down(); await page.mouse.move(annotationCanvasBox.x + 150, annotationCanvasBox.y + 130, { steps: 4 }); await page.mouse.up();
  await waitForCondition('trazo PDF persistido', () => page.evaluate(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'brush' && annotation.thickness === 7), importedMaterial.id));
  await page.getByTestId('study-pdf-tool-sticky').click();
  await annotationCanvas.click({ position: { x: 180, y: 160 } });
  await page.getByTestId('study-pdf-sticky-dialog').locator('textarea').fill('Sticker smoke');
  await page.getByRole('button', { name: 'Guardar sticker', exact: true }).click();
  await page.getByTestId('study-material-annotations-sidebar').getByText('Sticker smoke', { exact: true }).waitFor();
  await page.getByTestId('study-pdf-tool-comment').click();
  await annotationCanvas.click({ position: { x: 220, y: 210 } });
  await page.getByTestId('study-pdf-inline-comment').locator('textarea').fill('Comentario smoke');
  await page.getByTestId('study-pdf-inline-comment').getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByTestId('study-material-annotations-sidebar').getByText('Comentario smoke', { exact: true }).last().waitFor();
  await page.getByText('Crear apunte', { exact: true }).last().click();
  await waitForCondition('apunte creado desde material', () => page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.title.includes('fuente-smoke'))));
  assert.ok(await page.evaluate(async () => (await window.nodus.getStudyWorkspace()).documents.some((document) => document.contentMarkdown.includes('nodus://study/material/'))), 'highlight creates a note with a durable source link');
  console.log('[e2e] study material import + embedded PDF + highlight-to-note provenance ok');
  if (process.env.NODUS_E2E_MATERIAL_ANNOTATIONS_ONLY === '1') {
    const AdmZip = require('adm-zip');
    const epubPath = path.join(userData, 'libro-smoke.epub');
    const epub = new AdmZip();
    epub.addFile('mimetype', Buffer.from('application/epub+zip'));
    epub.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'));
    epub.addFile('OEBPS/content.opf', Buffer.from('<?xml version="1.0"?><package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'));
    epub.addFile('OEBPS/chapter.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Libro smoke</h1><p>Fragmento EPUB seleccionable y verificable.</p></body></html>'));
    await writeFile(epubPath, epub.toBuffer());
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, epubPath);
    await page.getByRole('button', { name: 'Materiales', exact: true }).click();
    await page.getByTestId('study-material-import').click();
    await page.getByRole('button', { name: 'Seleccionar archivos o ZIP', exact: true }).click();
    await page.getByTestId('study-material-import-confirm').click();
    await page.getByText('libro-smoke', { exact: true }).waitFor({ timeout: 30_000 });
    const importedEpub = await page.evaluate(async () => (await window.nodus.listStudyMaterials()).find((item) => item.title === 'libro-smoke'));
    assert.equal(importedEpub?.extension, 'epub');
    await page.getByText('libro-smoke', { exact: true }).click();
    await page.getByTestId('study-epub-viewer').waitFor();
    for (const tool of ['highlight', 'underline', 'brush', 'sticky', 'comment']) await page.getByTestId(`study-epub-tool-${tool}`).waitFor();
    await page.locator('[data-testid="study-epub-viewer"] .font-serif').evaluate((root) => {
      const node = [...root.childNodes].flatMap((child) => child.nodeType === Node.TEXT_NODE ? [child] : [...child.childNodes]).find((child) => child.textContent?.includes('Fragmento'));
      if (!node) throw new Error('EPUB text fixture not found');
      const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await waitForCondition('anotación EPUB resaltada', () => page.evaluate(async (materialId) => (await window.nodus.getStudyMaterial(materialId)).annotations.some((annotation) => annotation.kind === 'highlight'), importedEpub.id));
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused PDF + EPUB annotation toolbar smoke passed');
    process.exit(0);
  }

  // ── Study recordings: direct microphone capture + timed transcript UI ─────
  await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
  await page.getByTestId('study-recordings-view').waitFor({ timeout: 30_000 });
  const recordingSearchPadding = await page.getByPlaceholder('Buscar grabaciones o transcripciones…').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  assert.ok(recordingSearchPadding >= 30, 'recording search keeps its icon and text separated');
  await page.getByRole('button', { name: 'Grabar clase', exact: true }).click();
  const recordingPrivacyDialog = page.getByRole('dialog', { name: 'Antes de activar el micrófono' });
  await recordingPrivacyDialog.waitFor({ timeout: 10_000 });
  await recordingPrivacyDialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const classRecorder = page.getByTestId('study-class-recorder');
  await classRecorder.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_300);
  await classRecorder.getByRole('button', { name: 'Guardar', exact: true }).click();
  const capturedRecordingId = await page.evaluate(async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const recordingId = (await window.nodus.listStudyRecordings())[0]?.id;
      if (typeof recordingId === 'string' && recordingId.length > 0) return recordingId;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the captured study recording');
  });
  assert.equal(typeof capturedRecordingId, 'string');
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
  const recordingFixture = await page.evaluate(async (recordingId) => {
    const literal = await window.nodus.saveStudyTranscript(recordingId, {
      kind: 'literal', contentMarkdown: 'Definición literal de memoria de trabajo.', status: 'ready', progress: 1,
      modelProvider: 'local', modelName: 'Whisper smoke',
      segments: [{ tStart: 0.2, tEnd: 1, text: 'Definición literal de memoria de trabajo.', speaker: 'Docente' }],
    });
    await window.nodus.saveStudyTranscript(recordingId, {
      kind: 'corrected', contentMarkdown: 'Definición literal de memoria de trabajo.', sourceTranscriptId: literal.id,
      segments: [{ tStart: 0.2, tEnd: 1, text: 'Definición literal de memoria de trabajo.', speaker: 'Docente' }],
    });
    await window.nodus.createStudyAudioMarker(recordingId, { tSeconds: 0, label: 'Concepto clave' });
    return { id: recordingId, literalId: literal.id };
  }, capturedRecordingId);
  await page.locator(`[data-testid="study-recording-${recordingFixture.id}"]`).click();
  await page.getByTestId('study-recording-player').waitFor({ timeout: 30_000 });
  await page.getByText('Concepto clave', { exact: false }).waitFor();
  await page.getByTestId('study-transcript-segments').waitFor();
  assert.equal(await page.getByTestId('study-transcript-segments').locator('input').first().inputValue(), 'Docente', 'speaker label persists');
  assert.match(await page.getByTestId('study-transcript-segments').locator('textarea').first().inputValue(), /Definición literal/, 'timestamped transcript block renders and remains linked to audio');
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
  console.log('[e2e] direct class capture + recording modal + timestamped transcript ok');

  // ── Study hybrid search: local index, saved search and direct seek ─────────
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByTestId('study-search-view').waitFor({ timeout: 30_000 });
  const hybridInput = page.getByTestId('study-search-input');
  assert.ok(await hybridInput.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)) >= 30, 'hybrid search keeps its icon and text separated');
  const contentFilters = page.getByTestId('study-search-view').getByRole('group', { name: 'Tipo de contenido', exact: true });
  await contentFilters.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('study-search-filters').count(), 0, 'content chips are available with advanced filters collapsed');
  for (const kind of ['Apunte', 'Material', 'Pregunta', 'Examen']) {
    await contentFilters.getByRole('button', { name: kind, exact: true, pressed: true }).click();
  }
  assert.equal(await contentFilters.getByRole('button', { pressed: true }).count(), 1, 'only transcripts are selected');
  assert.equal(await contentFilters.getByRole('button', { name: 'Transcripción', exact: true }).getAttribute('aria-pressed'), 'true');
  await hybridInput.fill('memoria de trabajo');
  await page.getByTestId('study-search-result').first().waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('study-search-result').first().innerText(), /Definición literal de memoria de trabajo/, 'literal transcript is found through the unified local index');
  await page.getByTestId('study-search-view').getByRole('button', { name: 'Guardar', exact: true }).click();
  const savedSearchDialog = page.getByRole('dialog', { name: 'Guardar búsqueda' });
  await savedSearchDialog.locator('input').fill('Memoria smoke');
  await savedSearchDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await waitForCondition('búsqueda de estudio guardada', () => page.evaluate(async () => (await window.nodus.listStudySavedSearches()).some((item) => item.name === 'Memoria smoke')));
  await page.getByTestId('study-search-result').first().locator('button').first().click();
  await page.getByTestId('study-recording-detail').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-recording-player').locator('audio').waitFor();
  await page.waitForFunction(() => (document.querySelector('[data-testid="study-recording-player"] audio')?.currentTime ?? 0) >= 0.19, { timeout: 30_000 });
  console.log('[e2e] hybrid study search + saved query + timestamp navigation ok');

  // Analysis destinations are intentionally inaccessible in v2.3. Return from
  // the search evidence modal to the note through the supported Organization UI.
  await page.getByTestId('study-recording-detail').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Grabaciones', exact: true }).click();
  const capturedRecordingRow = page.getByTestId(`study-recording-${recordingFixture.id}`);
  await capturedRecordingRow.waitFor();
  await page.getByTestId(`study-recording-trash-${recordingFixture.id}`).click();
  const recordingDeleteDialog = page.getByRole('dialog').filter({ hasText: 'Mover grabación a la papelera' });
  await recordingDeleteDialog.waitFor();
  await recordingDeleteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await capturedRecordingRow.waitFor();
  await page.getByTestId(`study-recording-trash-${recordingFixture.id}`).click();
  await recordingDeleteDialog.getByRole('button', { name: 'Mover a la papelera', exact: true }).click();
  await capturedRecordingRow.waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(async () => window.nodus.listStudyRecordings())).some((recording) => recording.id === recordingFixture.id), false, 'recording is deleted only after confirmation');
  console.log('[e2e] study recording deletion requires explicit confirmation');
  await page.getByRole('button', { name: 'Cursos y asignaturas', exact: true }).click();
  for (const label of ['Curso smoke', 'Asignatura smoke', 'Carpeta smoke', 'Tema smoke']) {
    await page.getByText(label, { exact: true }).last().click();
  }
  await page.getByText('Apunte smoke', { exact: true }).last().click();
  await page.locator('.nodus-blocknote .bn-editor').first().waitFor({ timeout: 30_000 });

  // ── Study narration: selection/cursor modes, formula speech and dictionary ─
  await clickEditorAction(page.getByRole('button', { name: 'Markdown crudo', exact: true }));
  const narrationTextarea = page.getByTestId('study-markdown-editor').first();
  await narrationTextarea.evaluate((element) => {
    const text = element.value;
    const from = Math.max(0, text.indexOf('Texto'));
    element.focus(); element.setSelectionRange(from, Math.min(text.length, from + 18));
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await clickEditorAction(page.getByTestId('study-audio-toggle'));
  await page.getByTestId('study-audio-panel').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-audio-mode').selectOption('selection');
  const narrationSegments = await page.evaluate(async () => window.nodus.getAudioSegments('study_document', (await window.nodus.getStudyWorkspace()).documents.find((document) => document.title === 'Apunte smoke').id, {
    markdown: '# Fórmula\n\nEl valor $x^2$ se conserva.\n\n```js\nconst noLeer = true\n```\n\n## Referencias\n\nNo narrar.',
    title: 'Fórmula',
  }));
  assert.ok(narrationSegments.some((segment) => segment.text.includes('al cuadrado')), 'study narration verbalizes common formulas');
  assert.ok(!narrationSegments.some((segment) => segment.text.includes('noLeer') || segment.text.includes('No narrar')), 'study narration excludes code and references');
  await page.getByTestId('study-audio-tools').click();
  const audioTools = page.getByTestId('study-audio-study-tools');
  await audioTools.getByPlaceholder('Texto escrito').fill('TCC');
  await audioTools.getByPlaceholder('Cómo debe sonar').fill('te ce ce');
  await audioTools.getByRole('button', { name: '+' }).click();
  await waitForCondition('pronunciación de estudio guardada', () => page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    const document = workspace.documents.find((item) => item.title === 'Apunte smoke');
    const subjectId = workspace.placements.find((placement) => placement.documentId === document?.id)?.subjectId;
    return subjectId ? (await window.nodus.getStudyPronunciations(subjectId)).some((entry) => entry.written === 'TCC' && entry.spoken === 'te ce ce') : false;
  }));
  await page.getByRole('button', { name: 'Generar audio', exact: true }).click();
  await page.getByText('La lectura de estudio requiere una voz local de Piper o Kokoro.', { exact: true }).waitFor({ timeout: 30_000 });
  console.log('[e2e] local study narration modes + formula speech + pronunciation dictionary ok');

  // These flows remain ready for reactivation, but the corresponding renderer
  // routes are intentionally locked for users in v2.3.
  const studyAnalysisUiEnabled = false;
  if (studyAnalysisUiEnabled) {
  // ── Study question bank: manual authoring, validation and source metadata ─
  await page.getByRole('button', { name: 'Banco de preguntas', exact: true }).click();
  await page.getByTestId('study-question-bank').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-question-new').click();
  const questionEditor = page.getByTestId('study-question-editor');
  const questionTextareas = questionEditor.locator('textarea');
  await questionTextareas.nth(0).fill('¿Qué demuestra el fragmento verificable de la fuente smoke?');
  await questionTextareas.nth(1).fill('Demuestra que el fragmento está conectado con su evidencia local.');
  await questionTextareas.nth(2).fill('La respuesta procede del fragmento verificable guardado en el vault.');
  await page.getByTestId('study-question-save').click();
  await page.getByRole('heading', { name: '¿Qué demuestra el fragmento verificable de la fuente smoke?', exact: true }).waitFor({ timeout: 30_000 });
  const bankFixture = await page.evaluate(async () => {
    const question = (await window.nodus.listStudyQuestions({ search: 'fragmento verificable' }))[0];
    if (!question) throw new Error('Question bank fixture was not persisted');
    await window.nodus.updateStudyQuestion(question.id, { status: 'approved', locked: true });
    return (await window.nodus.getStudyQuestion(question.id));
  });
  assert.equal(bankFixture.status, 'approved');
  assert.equal(bankFixture.locked, true);
  assert.match(bankFixture.source.excerpt, /respuesta procede del fragmento verificable/i);
  console.log('[e2e] study question bank manual authoring + approval provenance ok');

  // ── Study tests: approved-bank build, durable answer and correction ───────
  await page.getByRole('button', { name: 'Tests', exact: true }).click();
  await page.getByTestId('study-tests-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-new').click();
  await page.getByTestId('study-test-title').fill('Test smoke verificable');
  await page.getByTestId('study-test-create').click();
  await page.getByText('Test smoke verificable', { exact: true }).last().waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-start').click();
  await page.getByTestId('study-test-runner').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-test-response').fill('Demuestra que el fragmento está conectado con su evidencia local.');
  await page.getByTestId('study-test-submit').click();
  await page.getByTestId('study-test-results').waitFor({ timeout: 30_000 });
  const testFixture = await page.evaluate(async () => {
    const assessment = (await window.nodus.listStudyAssessments('test')).find((item) => item.title === 'Test smoke verificable');
    if (!assessment) throw new Error('Study test fixture was not persisted');
    const attempt = (await window.nodus.listStudyAttempts(assessment.id))[0];
    return { assessment, attempt };
  });
  assert.equal(testFixture.assessment.items.length, 1, 'adaptive test uses the approved bank question');
  assert.equal(testFixture.attempt.status, 'submitted', 'test attempt is durably submitted');
  assert.equal(testFixture.attempt.correctCount, 1, 'objective short answer is corrected deterministically');
  console.log('[e2e] study test construction + durable attempt + objective correction ok');

  // ── Study exams: long-form autosave and delivery for human review ─────────
  await page.evaluate(async () => {
    await window.nodus.createStudyQuestion({
      prompt: 'Explica con argumentos cómo se conserva la procedencia en el vault de estudio.', type: 'essay', difficulty: 'medium', cognitiveLevel: 'analyze',
      status: 'approved', answer: { text: 'Debe explicar enlaces, fragmentos exactos y evidencia local.' }, explanation: 'Criterios smoke de respuesta desarrollada.',
      source: { title: 'Fuente smoke', excerpt: 'Los fragmentos exactos mantienen enlaces locales verificables.' }, locked: true,
    });
  });
  await page.getByRole('button', { name: 'Exámenes', exact: true }).click();
  await page.getByTestId('study-exams-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-new').click();
  await page.getByTestId('study-exam-title').fill('Simulacro smoke');
  const examQuestion = page.getByTestId('study-exam-builder').locator('label').filter({ hasText: 'Explica con argumentos cómo se conserva la procedencia' });
  await examQuestion.locator('input[type="checkbox"]').check();
  await page.getByTestId('study-exam-create').click();
  await page.getByText('Simulacro smoke', { exact: true }).last().waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-start').click();
  await page.getByTestId('study-exam-runner').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-exam-response').fill('La procedencia se conserva mediante fragmentos exactos, enlaces locales y evidencia verificable.');
  await waitForCondition('respuesta larga de examen guardada', () => page.evaluate(async () => {
    const exam = (await window.nodus.listStudyAssessments('exam')).find((item) => item.title === 'Simulacro smoke');
    return exam ? (await window.nodus.listStudyAttempts(exam.id))[0]?.answers.some((answer) => String(answer.response.text ?? '').includes('fragmentos exactos')) : false;
  }));
  await page.getByRole('button', { name: 'Entregar examen', exact: true }).click();
  await page.getByTestId('study-exam-results').waitFor({ timeout: 30_000 });
  const examFixture = await page.evaluate(async () => {
    const exam = (await window.nodus.listStudyAssessments('exam')).find((item) => item.title === 'Simulacro smoke');
    if (!exam) throw new Error('Study exam fixture was not persisted');
    return { exam, attempt: (await window.nodus.listStudyAttempts(exam.id))[0] };
  });
  assert.equal(examFixture.attempt.status, 'submitted');
  assert.equal(examFixture.attempt.answers[0].isCorrect, null, 'long-form answer remains pending human review');
  assert.match(examFixture.attempt.answers[0].response.text, /evidencia verificable/);
  assert.equal(await page.getByTestId('study-grade-open').count(), 0, 'no AI grading action is exposed');
  console.log('[e2e] written exam + autosave + human-review delivery ok');

  // ── Study learning: flashcard review, SM-2 evidence, planner and progress ──
  await page.getByRole('button', { name: 'Repaso', exact: true }).click();
  await page.getByTestId('study-review-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-flashcard-new').click();
  const flashcardEditor = page.getByTestId('study-flashcard-editor');
  await page.getByTestId('study-flashcard-front').fill('¿Qué conserva la procedencia local?');
  await flashcardEditor.locator('textarea').nth(1).fill('Fragmentos exactos y enlaces verificables.');
  await page.getByTestId('study-flashcard-save').click();
  await page.getByText('¿Qué conserva la procedencia local?', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('study-review-start').click();
  await page.getByTestId('study-review-session').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-review-session').locator('button').first().click();
  await page.getByTestId('study-review-rate-4').click();
  await waitForCondition('repaso SM-2 persistido', () => page.evaluate(async () => (await window.nodus.listStudyFlashcards()).some((card) => card.front.includes('procedencia local') && card.srs.repetitions === 1)));
  console.log('[e2e] flashcard authoring + real SM-2 review persistence ok');

  await page.getByRole('button', { name: 'Planificador', exact: true }).click();
  await page.getByTestId('study-planner-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-planner-title').fill('Repaso smoke de procedencia');
  await page.getByTestId('study-planner-save').click();
  await page.getByText('Repaso smoke de procedencia', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await page.getByTestId('study-pomodoro-active').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Finalizar y registrar', exact: true }).click();
  await waitForCondition('sesión Pomodoro finalizada', () => page.evaluate(async () => (await window.nodus.getStudyPlanner()).sessions.some((session) => session.endedAt)));
  await page.getByRole('button', { name: 'Progreso', exact: true }).click();
  await page.getByTestId('study-progress-view').waitFor({ timeout: 30_000 });
  const learningFixture = await page.evaluate(async () => ({ planner: await window.nodus.getStudyPlanner(), progress: await window.nodus.getStudyProgressDashboard() }));
  assert.ok(learningFixture.planner.blocks.some((block) => block.title === 'Repaso smoke de procedencia'));
  assert.ok(learningFixture.progress.overall.reviews >= 1, 'progress dashboard is backed by review evidence');
  console.log('[e2e] planner, Pomodoro registration and evidence-backed progress ok');
  }

  await page.locator('[data-tour="nav-studyIdeas"]').click();
  await page.getByTestId('study-ideas-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('study-ideas-subject').waitFor();
  const knowledgeThemeColors = await page.getByTestId('study-ideas-view').evaluate(async (element) => {
    const light = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const dark = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.remove('dark');
    return { light, dark };
  });
  assert.notEqual(knowledgeThemeColors.light, knowledgeThemeColors.dark, 'study ideas surface adapts between light and dark themes');
  await page.locator('[data-tour="nav-studyGraph"]').click();
  await page.getByTestId('study-graph-view').waitFor();
  await page.getByTestId('study-graph-subject').waitFor();
  await page.getByTestId('study-graph-view').getByTestId('stellar-canvas').waitFor();
  await page.getByTestId('study-graph-view').getByRole('combobox', { name: 'Buscar una idea', exact: true }).waitFor();
  // Memory-backed study graphs now enter through the same permanent themes hub.
  // Playback belongs to an exploration tab, so exercise that transition explicitly.
  const studyGraph = page.getByTestId('study-graph-view');
  await studyGraph.getByTestId('stellar-themes').waitFor();
  assert.equal(await studyGraph.getByRole('button', { name: 'Play', exact: true }).count(), 0, 'the themes hub does not expose playback');
  await studyGraph.getByRole('button', { name: 'Nuevo grafo', exact: true }).click();
  await studyGraph.getByTestId('stellar-workspace').waitFor();
  for (const control of ['Anterior', 'Play', 'Siguiente', 'Encuadrar']) await studyGraph.getByRole('button', { name: new RegExp(control) }).first().waitFor();
  console.log('[e2e] study Ideas reuse the original list and study Graph opens its themes hub and independent playback tab');

  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Modelos IA', exact: true }).click();
  assert.equal(await page.getByTestId('study-ai-settings').count(), 0, 'redundant study AI settings section is not rendered');
  const aiPolicyFixture = await page.evaluate(async () => ({ settings: await window.nodus.getSettings(), usage: await window.nodus.getStudyAiUsageSummary() }));
  assert.ok(aiPolicyFixture.usage.failedCalls >= 1, 'failed improvement request is auditable in task usage');
  assert.equal(aiPolicyFixture.usage.knownCostUsd, 0, 'unknown provider price is never guessed');
  console.log('[e2e] study AI policy remains active without redundant settings UI');

  assert.equal(aiPolicyFixture.settings.studyAiPrivacyMode, 'hybrid');
  assert.equal(aiPolicyFixture.settings.studyAiConfirmExternal, true);
  await page.getByRole('button', { name: 'Backup / copia de seguridad', exact: true }).click();
  const autoBackupToggle = page.getByText('Copias de seguridad automáticas', { exact: true }).locator('xpath=../..').locator('input[type="checkbox"]');
  if (!(await autoBackupToggle.isChecked())) await autoBackupToggle.click();
  const backupScopeNotice = page.getByTestId('automatic-backup-scope');
  await backupScopeNotice.waitFor();
  const backupScopeColors = await backupScopeNotice.evaluate(async (element) => {
    const light = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const dark = getComputedStyle(element).backgroundColor;
    document.documentElement.classList.remove('dark');
    return { light, dark };
  });
  assert.notEqual(backupScopeColors.light, backupScopeColors.dark, 'automatic-backup notice exposes distinct light and dark surfaces');

  // Backup health is stated plainly in the real UI. It used to be a truncated grey line
  // that kept showing the last success while the schedule was broken.
  const backupHealth = page.getByTestId('backup-health');
  await backupHealth.waitFor();
  const healthLevel = await backupHealth.getAttribute('data-level');
  assert.ok(['ok', 'warning', 'critical'].includes(healthLevel), 'backup health reports a level');
  assert.ok((await backupHealth.innerText()).trim().length > 0, 'backup health explains itself in words');

  // Light mode must actually be light. New utility classes are dark-only until they are
  // remapped in index.css, so a warning added without that renders dark-on-light and
  // becomes unreadable — measure the luminance instead of trusting the class names.
  const healthContrast = await backupHealth.evaluate(async (element) => {
    const luminance = (value) => {
      const [r, g, b] = value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const sample = () => {
      const style = getComputedStyle(element);
      return { bg: luminance(style.backgroundColor), fg: luminance(style.color) };
    };
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    root.classList.add('dark');
    root.classList.remove('light');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const dark = sample();
    root.classList.remove('dark');
    root.classList.add('light');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const light = sample();
    root.classList.remove('light');
    if (hadDark) root.classList.add('dark');
    return { dark, light };
  });
  assert.ok(healthContrast.light.bg > 0.75, `backup health sits on a light surface in light mode (${healthContrast.light.bg})`);
  assert.ok(healthContrast.light.fg < 0.55, `backup health text is dark in light mode (${healthContrast.light.fg})`);
  assert.ok(healthContrast.dark.bg < 0.35, `backup health sits on a dark surface in dark mode (${healthContrast.dark.bg})`);
  assert.ok(healthContrast.dark.fg > 0.45, `backup health text is light in dark mode (${healthContrast.dark.fg})`);

  // The global bar only renders while protection is actually broken, which this run is
  // not, so its stylesheet is probed directly rather than left unverified.
  const bannerContrast = await page.evaluate(async () => {
    const luminance = (value) => {
      const [r, g, b] = value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const probe = document.createElement('div');
    probe.className = 'backup-health-banner';
    document.body.appendChild(probe);
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const read = async (theme) => {
      root.classList.remove('dark', 'light');
      root.classList.add(theme);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const style = getComputedStyle(probe);
      return { bg: luminance(style.backgroundColor), fg: luminance(style.color) };
    };
    const dark = await read('dark');
    const light = await read('light');
    root.classList.remove('dark', 'light');
    if (hadDark) root.classList.add('dark');
    probe.remove();
    return { dark, light };
  });
  assert.ok(bannerContrast.light.bg > 0.75, `the backup warning bar is light in light mode (${bannerContrast.light.bg})`);
  assert.ok(bannerContrast.light.fg < 0.55, `the backup warning bar has dark text in light mode (${bannerContrast.light.fg})`);
  assert.ok(bannerContrast.dark.bg < 0.35, `the backup warning bar is dark in dark mode (${bannerContrast.dark.bg})`);

  // The health banner is inserted above the routed view, so main must still hand its
  // full remaining height to the content: a wrong flex chain here silently collapses
  // every scrollable view in the app.
  const mainFills = await page.evaluate(() => {
    const main = document.querySelector('main[data-nodi-view]');
    const content = main?.lastElementChild;
    if (!main || !content) return null;
    return { main: main.getBoundingClientRect().height, content: content.getBoundingClientRect().height };
  });
  assert.ok(mainFills && mainFills.main > 200, 'main still occupies the window');
  assert.ok(mainFills.content > mainFills.main - 60, 'the routed view still fills main below the banner slot');
  console.log('[e2e] backup health surface + main layout ok');
  await page.getByTestId('study-data-admin').waitFor({ timeout: 30_000 });
  const dataFixture = await page.evaluate(async () => await window.nodus.getStudyDataOverview());
  assert.equal(dataFixture.integrityOk, true, 'study data panel runs SQLite integrity checks');
  assert.deepEqual(dataFixture.foreignKeyErrors, [], 'study data panel detects no orphaned references');
  assert.ok(dataFixture.studyRows > 0, 'study data panel counts the E2E rows');
  console.log('[e2e] study privacy controls and real data administration checks ok');

  // Accessibility preferences are changed through the rendered controls and
  // applied at the document root, including the study-only reading mode.
  await page.getByRole('button', { name: 'Interfaz', exact: true }).click();
  const accessibility = page.getByTestId('accessibility-settings');
  await accessibility.waitFor({ timeout: 30_000 });
  await page.getByLabel('Tamaño de la interfaz', { exact: true }).fill('1.15');
  await waitForCondition('escala de interfaz persistida', () => page.evaluate(async () => (await window.nodus.getSettings()).interfaceScale === 1.15));
  const accessibilityPreferences = [
    ['accessibility-font', 'accessibleFont'],
    ['accessibility-contrast', 'highContrast'],
    ['accessibility-motion', 'reduceMotion'],
    ['accessibility-reading', 'readingFocusMode'],
  ];
  for (const [testId, key] of accessibilityPreferences) {
    const enabled = await page.evaluate(async (settingKey) => Boolean((await window.nodus.getSettings())[settingKey]), key);
    if (!enabled) await page.getByTestId(testId).click();
    await waitForCondition(`preferencia de accesibilidad ${key}`, () => page.evaluate(async (settingKey) => Boolean((await window.nodus.getSettings())[settingKey]), key));
  }
  await page.waitForFunction(() => document.documentElement.classList.contains('accessible-font')
    && document.documentElement.classList.contains('high-contrast')
    && document.documentElement.classList.contains('reduce-motion')
    && document.documentElement.classList.contains('reading-focus'));
  assert.equal(await page.getByTestId('app-shell').getAttribute('data-interface-scale'), '1.15');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByText('Salir del modo lectura', { exact: true }).waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  console.log('[e2e] accessibility controls + keyboard command palette apply globally');

  // A first-time primary-sources researcher must be able to go from an empty vault
  // to a reversible learning corpus, complete the six-step evidence-first tour, and
  // reach every derived view without using a repository helper or a hidden route.
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Primary sources demo smoke', type: 'primary_sources' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      tourComplete: true,
      advancedTourComplete: true,
      primarySourcesTourComplete: true,
    });
  });
  await page.reload();
  await page.getByTestId('primary-sources-home').waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-demo-offer').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cargar demo de fuentes primarias', exact: true }).click();
  await waitForCondition('corpus de aprendizaje de fuentes primarias cargado', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    const settings = await window.nodus.getSettings();
    return workspace.page.total === 10
      && workspace.repositories.length === 1
      && workspace.sessions.length === 1
      && settings.demoMode === true
      && settings.primarySourcesTourComplete === true;
  }));
  assert.equal(await page.getByTestId('tour-card').count(), 0, 'cargar la demo no reinicia ni abre el recorrido');

  // The walkthrough remains independently replayable. Relaunch it explicitly here so
  // this E2E still validates the invitation and all six spotlighted steps.
  await page.evaluate(async () => {
    await window.nodus.updateSettings({ primarySourcesTourComplete: false });
  });
  await page.reload();

  const primarySourcesTour = page.getByTestId('tour-card');
  await primarySourcesTour.getByText('Recorrido de fuentes primarias · 1/6', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-home').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('tour-spotlight').count(), 0, 'la invitación inicial no apunta ni navega antes del consentimiento');
  const unavailablePrimarySourcesVideo = primarySourcesTour.getByRole('button', {
    name: 'Ver el tutorial en vídeo (Próximamente)',
    exact: true,
  });
  await unavailablePrimarySourcesVideo.waitFor({ timeout: 30_000 });
  assert.equal(await unavailablePrimarySourcesVideo.isDisabled(), true, 'el vídeo futuro permanece visible pero deshabilitado');
  await primarySourcesTour.getByRole('button', { name: 'Sí, enséñame', exact: true }).click();

  const primarySourcesTourSteps = [
    { number: 1, target: 'nav-archive', action: 'Siguiente' },
    { number: 2, target: 'primary-sources-import', action: 'Siguiente' },
    { number: 3, target: 'primary-sources-provenance-tree', action: 'Siguiente' },
    { number: 4, target: 'primary-sources-view-modes', action: 'Siguiente' },
    { number: 5, target: 'nav-persons', action: 'Siguiente' },
    { number: 6, target: 'nav-notes', action: 'Empezar' },
  ];
  for (const step of primarySourcesTourSteps) {
    await primarySourcesTour.getByText(`Recorrido de fuentes primarias · ${step.number}/6`, { exact: true }).waitFor({ timeout: 30_000 });
    const target = page.locator(`[data-tour="${step.target}"]`);
    await target.waitFor({ state: 'visible', timeout: 30_000 });
    // The spotlight deliberately animates between anchors. The step copy updates at
    // the start of that 200 ms transition, so measuring immediately can observe the
    // rectangle halfway between the previous and current targets on a busy runner.
    await page.waitForFunction((targetName) => {
      const anchor = document.querySelector(`[data-tour="${targetName}"]`);
      const focus = document.querySelector('[data-testid="tour-spotlight"]');
      if (!(anchor instanceof HTMLElement) || !(focus instanceof HTMLElement)) return false;
      const targetRect = anchor.getBoundingClientRect();
      const focusRect = focus.getBoundingClientRect();
      return focusRect.left <= targetRect.left
        && focusRect.top <= targetRect.top
        && focusRect.right >= targetRect.right
        && focusRect.bottom >= targetRect.bottom;
    }, step.target, { timeout: 5_000 });
    const [targetBox, spotlightBox] = await Promise.all([
      target.boundingBox(),
      page.getByTestId('tour-spotlight').boundingBox(),
    ]);
    assert.ok(targetBox && spotlightBox, `el paso ${step.number}/6 conserva un ancla y un foco visibles`);
    assert.ok(
      spotlightBox.x <= targetBox.x
        && spotlightBox.y <= targetBox.y
        && spotlightBox.x + spotlightBox.width >= targetBox.x + targetBox.width
        && spotlightBox.y + spotlightBox.height >= targetBox.y + targetBox.height,
      `el foco del paso ${step.number}/6 encuadra su destino`
    );
    await primarySourcesTour.getByRole('button', { name: step.action, exact: true }).click();
  }
  await primarySourcesTour.waitFor({ state: 'detached', timeout: 30_000 });
  await waitForCondition('recorrido de fuentes primarias completado', () => page.evaluate(async () => (await window.nodus.getSettings()).primarySourcesTourComplete === true));

  await page.getByTestId('primary-sources-nav-archive').click();
  await page.getByTestId('primary-sources-archive').waitFor({ timeout: 30_000 });

  // Archive organisation actions must look and behave like real buttons. Exercise
  // every vocabulary through the renderer and preload bridge, including the
  // disabled, enabled, persisted, refreshed, and cleared-field states.
  await page.getByTestId('primary-sources-organize-open').click();
  const organizeButtons = {
    repository: page.getByTestId('primary-sources-create-repository'),
    session: page.getByTestId('primary-sources-create-session'),
    collection: page.getByTestId('primary-sources-create-collection'),
    template: page.getByTestId('primary-sources-create-template'),
  };
  for (const button of Object.values(organizeButtons)) {
    assert.equal(await button.isDisabled(), true, 'empty organisation actions begin disabled');
  }
  const disabledOrganizeStyle = await organizeButtons.repository.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, borderStyle: style.borderStyle };
  });
  assert.notEqual(disabledOrganizeStyle.backgroundColor, 'rgba(0, 0, 0, 0)', 'disabled organisation actions retain a visible button surface');
  assert.notEqual(disabledOrganizeStyle.borderStyle, 'none', 'disabled organisation actions retain a visible border');

  await page.getByTestId('primary-sources-repository-name').fill('Repositorio de prueba E2E');
  await page.getByTestId('primary-sources-repository-short-name').fill('RPE');
  assert.equal(await organizeButtons.repository.isEnabled(), true);
  const enabledOrganizeBackground = await organizeButtons.repository.evaluate((button) => getComputedStyle(button).backgroundColor);
  assert.notEqual(enabledOrganizeBackground, disabledOrganizeStyle.backgroundColor, 'enabled organisation actions use the primary visual state');
  await organizeButtons.repository.click();
  await waitForCondition('repositorio creado desde Organizar', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    return workspace.repositories.some((entry) => entry.name === 'Repositorio de prueba E2E' && entry.shortName === 'RPE');
  }));
  assert.equal(await page.getByTestId('primary-sources-repository-name').inputValue(), '');
  assert.equal(await organizeButtons.repository.isDisabled(), true);

  await page.getByTestId('primary-sources-session-title').fill('Consulta de prueba E2E');
  await page.getByTestId('primary-sources-session-repository').selectOption({ label: 'Repositorio de prueba E2E' });
  await organizeButtons.session.click();
  await waitForCondition('sesión creada desde Organizar', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    const repository = workspace.repositories.find((entry) => entry.name === 'Repositorio de prueba E2E');
    return workspace.sessions.some((entry) => entry.title === 'Consulta de prueba E2E' && entry.repositoryId === repository?.repositoryId);
  }));
  assert.equal(await page.getByTestId('primary-sources-session-title').inputValue(), '');
  assert.equal(await organizeButtons.session.isDisabled(), true);

  await page.getByTestId('primary-sources-collection-name').fill('Colección de prueba E2E');
  await organizeButtons.collection.click();
  await waitForCondition('colección creada desde Organizar', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    return workspace.collections.some((entry) => entry.name === 'Colección de prueba E2E');
  }));
  assert.equal(await page.getByTestId('primary-sources-collection-name').inputValue(), '');
  assert.equal(await organizeButtons.collection.isDisabled(), true);

  await page.getByTestId('primary-sources-template-name').fill('Plantilla de prueba E2E');
  await organizeButtons.template.click();
  await waitForCondition('plantilla creada desde Organizar', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    return workspace.templates.some((entry) => entry.name === 'Plantilla de prueba E2E' && entry.builtin === false);
  }));
  assert.equal(await page.getByTestId('primary-sources-template-name').inputValue(), '');
  assert.equal(await organizeButtons.template.isDisabled(), true);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  await page.getByTestId('primary-sources-nav-persons').click();
  await page.getByTestId('primary-sources-persons-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-nav-timeline').click();
  await page.getByRole('heading', { name: 'Cronología documental', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-nav-map').click();
  await page.getByRole('button', { name: 'Tabla accesible', exact: true }).click();
  await page.getByTestId('primary-sources-map-table').waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-nav-relations').click();
  await page.getByRole('button', { name: 'Tabla accesible', exact: true }).click();
  await page.getByTestId('primary-sources-relations-table').waitFor({ timeout: 30_000 });
  await page.getByTestId('primary-sources-nav-search').click();
  await page.getByTestId('primary-sources-search-input').fill('San Martín');
  await page.getByTestId('primary-sources-search-result').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-tour="nav-notes"]').click();
  await page.getByTestId('primary-sources-notes').waitFor({ timeout: 30_000 });

  // Primary Sources reuses the universal Toolkit catalogue. Its old dedicated
  // governance console must not hide the tools available in every other vault.
  await page.locator('[data-tour="toolkit"]').click();
  await page.getByTestId('toolkit-home').waitFor({ timeout: 30_000 });
  await page.getByTestId('toolkit-card-convert').click();
  await page.getByTestId('toolkit-convert-page').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('primary-sources-toolkit').count(), 0, 'the retired primary-source Toolkit console is absent');
  await page.getByTestId('toolkit-back').click();
  await page.getByTestId('toolkit-home').waitFor({ timeout: 30_000 });
  for (const tool of ['apps', 'convert', 'protect', 'translate', 'presenter', 'aiocr']) {
    await page.getByTestId(`toolkit-card-${tool}`).waitFor({ state: 'visible', timeout: 30_000 });
  }

  await page.getByRole('button', { name: 'Salir del modo demo', exact: true }).click();
  await waitForCondition('corpus de aprendizaje de fuentes primarias eliminado', () => page.evaluate(async () => {
    const workspace = await window.nodus.getPrimarySourcesWorkspace('', 0, 200);
    const settings = await window.nodus.getSettings();
    return workspace.page.total === 0 && settings.demoMode === false;
  }));
  await page.getByTestId('primary-sources-demo-offer').waitFor({ timeout: 30_000 });
  console.log('[e2e] primary-sources first-run corpus, tour, derived views, universal Toolkit, search, and cleanup work through the real UI');

  // A second, empty study vault exercises the real sample-data offer and the
  // reversible cleanup path without touching the study records created above.
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Study demo smoke', type: 'estudio' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
      studyTourComplete: true,
    });
  });
  await page.reload();
  await page.getByTestId('study-demo-offer').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cargar datos de ejemplo', exact: true }).click();
  await waitForCondition('datos de ejemplo de estudio cargados', () => page.evaluate(async () => {
    const workspace = await window.nodus.getStudyWorkspace();
    return workspace.courses.length === 1 && workspace.subjects.length === 2 && workspace.documents.length === 2;
  }));
  await page.getByText('Membrana plasmática · resumen', { exact: true }).waitFor({ timeout: 30_000 });
  const demoFixture = await page.evaluate(async () => ({
    settings: await window.nodus.getSettings(),
    questions: await window.nodus.listStudyQuestions(),
    cards: await window.nodus.listStudyFlashcards(),
    planner: await window.nodus.getStudyPlanner(),
    cellIdeas: await window.nodus.listStudyIdeas('demo-study-subject-cell'),
    cellGraph: await window.nodus.getStudyKnowledgeGraph('demo-study-subject-cell'),
    ecologyIdeas: await window.nodus.listStudyIdeas('demo-study-subject-ecology'),
  }));
  assert.equal(demoFixture.settings.demoMode, true);
  assert.equal(demoFixture.questions.length, 1);
  assert.equal(demoFixture.cards.length, 1);
  assert.equal(demoFixture.planner.plans.length, 1);
  assert.equal(demoFixture.cellIdeas.length, 4);
  assert.equal(demoFixture.cellGraph.edges.length, 3);
  assert.equal(demoFixture.ecologyIdeas.length, 3);
  assert.equal(await page.getByTestId('tour-card').count(), 0, 'cargar la demo de estudio no reinicia ni abre el tutorial');

  // Demo loading and tutorial replay are independent. Reopen the tour through the
  // same Settings control available to users so the E2E covers both guarantees.
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Tutoriales', exact: true }).click();
  await page.getByTestId('study-tour-replay').click();
  const studyTourCard = page.getByTestId('tour-card');
  const studyTourLabel = studyTourCard.getByText(/^Tutorial de estudio/);
  await studyTourLabel.waitFor({ timeout: 30_000 });
  await studyTourCard.getByRole('button', { name: 'Cerrar tutorial', exact: true }).click();
  await studyTourLabel.waitFor({ state: 'detached', timeout: 30_000 });
  await page.getByRole('button', { name: 'Salir del modo demo', exact: true }).click();
  await waitForCondition('datos de ejemplo de estudio eliminados', () => page.evaluate(async () => (await window.nodus.getStudyWorkspace()).courses.length === 0));
  await page.getByTestId('study-demo-offer').waitFor({ timeout: 30_000 });
  console.log('[e2e] reversible study sample workspace works through the real UI and IPC bridge');

  // The teaching vault gets the same treatment: its own demo offer, its own guided
  // tutorial, and — unlike the other tours — a spotlight that has to come out ORANGE.
  // The eyebrow and dots are remappable indigo utilities, but the spotlight outline is
  // an inline style no CSS rule can reach, so this is the assertion that catches an
  // accent regression.
  const studyDemoVaultId = await page.evaluate(async () => (await window.nodus.getActiveVault()).id);
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Teaching demo smoke', type: 'docencia' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true, docenciaTourComplete: true });
  });
  await page.reload();
  await page.getByTestId('teaching-demo-offer').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cargar demo de docencia', exact: true }).click();
  await waitForCondition('datos de ejemplo de docencia cargados', () => page.evaluate(async () => {
    const [groups, rubrics, exams, plans] = await Promise.all([
      window.nodus.listTeachingGroups(), window.nodus.listTeachingRubrics(),
      window.nodus.listTeachingExams(), window.nodus.listAssessmentPlans(),
    ]);
    return groups.length === 1 && rubrics.length === 1 && exams.length === 1 && plans.length === 1;
  }));
  assert.equal(await page.getByTestId('tour-card').count(), 0, 'cargar la demo de docencia no reinicia ni abre el tutorial');

  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Tutoriales', exact: true }).click();
  await page.getByTestId('teaching-tour-replay').click();
  const tourCard = page.getByTestId('tour-card');
  const teachingTourLabel = tourCard.getByText(/^Tutorial de docencia/);
  await teachingTourLabel.waitFor({ timeout: 30_000 });
  // Step 1 is target-less and centres; step 2 spotlights the courses nav entry.
  await tourCard.getByRole('button', { name: 'Sí, enséñame', exact: true }).click();
  const spotlight = page.getByTestId('tour-spotlight');
  await spotlight.waitFor({ timeout: 30_000 });
  assert.equal(
    await spotlight.evaluate((node) => getComputedStyle(node).outlineColor),
    'rgb(234, 88, 12)',
    'the teaching tutorial spotlights in the vault accent (orange), not the default indigo',
  );
  // Then walk every remaining step. A step whose `data-tour` anchor does not exist
  // degrades silently to a centred card, which looks deliberate and hides the bug, so
  // each middle step has to prove it landed on a laid-out element. This also mounts
  // every teaching view in turn, so the renderer-error assertion at the end covers them.
  const stepCounter = tourCard.getByText(/^Tutorial de docencia · \d+\/\d+$/);
  const totalSteps = Number((await stepCounter.textContent()).split('/')[1]);
  assert.ok(totalSteps >= 10, `the teaching tutorial covers every section, got ${totalSteps} steps`);
  // Deliberately short window. The card is placed against its own height, and a step
  // whose copy runs longer than the space reserved for it used to hang off the bottom
  // of the viewport with "Siguiente" unreachable — the tour could not be advanced at
  // all. A tall window hides that entirely, which is why CI saw it first.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setBounds({ width: 1280, height: 700 });
  }).catch(() => {});
  await page.waitForTimeout(300);
  for (let step = 2; step < totalSteps; step += 1) {
    await waitForCondition(`el paso ${step}/${totalSteps} del tutorial de docencia enfoca un elemento real`, async () => {
      const box = await spotlight.boundingBox().catch(() => null);
      return Boolean(box && box.width > 0 && box.height > 0);
    });
    const cardBox = await tourCard.boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    assert.ok(
      cardBox && cardBox.y >= 0 && cardBox.y + cardBox.height <= viewportHeight + 1,
      `step ${step}/${totalSteps} keeps its card on screen (y=${cardBox?.y}, height=${cardBox?.height}, viewport=${viewportHeight})`,
    );
    await tourCard.getByRole('button', { name: 'Siguiente', exact: true }).click();
  }
  await tourCard.getByRole('button', { name: 'Empezar', exact: true }).waitFor({ timeout: 30_000 });
  // Give the window back its height so the genealogy checks below are unaffected.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setBounds({ width: 1440, height: 900 });
  }).catch(() => {});
  await page.waitForTimeout(300);
  await tourCard.getByRole('button', { name: 'Cerrar tutorial', exact: true }).click();
  await teachingTourLabel.waitFor({ state: 'detached', timeout: 30_000 });

  // The Analizar group: the study chat/ideas/graph trio over the teaching corpus. The
  // tour already proved the sidebar entries exist and the views mount; what it cannot
  // see is whether they are wired to the teaching vault's own data. An Ideas view that
  // silently renders an empty list looks identical to one whose subject scope resolved
  // to nothing, so the seeded ideas are asserted on screen.
  await page.getByTestId('teaching-sidebar').getByRole('button', { name: 'Ideas', exact: true }).click();
  const teachingIdeas = page.getByTestId('study-ideas-view');
  await teachingIdeas.waitFor({ timeout: 30_000 });
  await teachingIdeas.getByText('Máquina de vapor', { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.getByTestId('teaching-sidebar').getByRole('button', { name: 'Research chat', exact: true }).click();
  const teachingChat = page.getByTestId('research-chat-view');
  await teachingChat.waitFor({ timeout: 30_000 });
  // The copy has to be the teacher's, not the learner's: same component, other voice.
  await teachingChat.getByText('Pregunta a tus materiales de clase con citas verificables.').waitFor({ timeout: 30_000 });
  await page.getByTestId('teaching-sidebar').getByRole('button', { name: 'Grafo', exact: true }).click();
  await page.getByTestId('study-graph-view').waitFor({ timeout: 30_000 });
  console.log('[e2e] teaching Analizar group (chat · ideas · graph) reads the teaching vault corpus');

  // Unit design: Deep Research over the teaching corpus. The seeded unit proves the
  // gallery reads the teaching vault, and the structure control is the one thing this
  // surface has that Deep Research does not — it must be reachable, and switching to
  // "I define it" must actually produce editable slots.
  await page.getByTestId('teaching-sidebar').getByRole('button', { name: 'Diseño de unidades', exact: true }).click();
  await page.getByRole('heading', { name: 'Diseño de unidades', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('Unidad 3 · La revolución industrial', { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Nueva unidad', exact: true }).first().click();
  const structure = page.getByTestId('unit-structure');
  await structure.waitFor({ timeout: 30_000 });
  await structure.getByTestId('unit-structure-manual').click();
  await structure.getByTestId('unit-structure-count').selectOption('3');
  await structure.getByTestId('unit-section-title-2').waitFor({ timeout: 30_000 });
  assert.equal(
    await structure.getByTestId('unit-section-title-3').count(),
    0,
    'the outline editor shows exactly the number of parts chosen',
  );
  await structure.getByTestId('unit-section-title-0').fill('Punto de partida');
  await structure.getByTestId('unit-structure-count').selectOption('5');
  assert.equal(
    await structure.getByTestId('unit-section-title-0').inputValue(),
    'Punto de partida',
    'growing the outline keeps what the teacher already typed',
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByTestId('teaching-sidebar').getByRole('button', { name: 'Cursos, asignaturas y grupos', exact: true }).click();
  console.log('[e2e] teaching Unit design gallery + teacher-defined structure editor work through the real UI');

  await page.getByRole('button', { name: 'Salir del modo demo', exact: true }).click();
  await waitForCondition('datos de ejemplo de docencia eliminados', () => page.evaluate(async () => (await window.nodus.listTeachingGroups()).length === 0));
  await page.getByTestId('teaching-demo-offer').waitFor({ timeout: 30_000 });
  console.log('[e2e] teaching sample workspace + orange-accented guided tutorial work through the real UI');

  // ── Worldbuilding: the Personajes section, through the real UI ──────────────
  // Worldbuilding graduated from an inert preview shell, so this proves the graduation
  // actually happened: its own sidebar renders, only the built sections are clickable,
  // and a character can be created, described and given life events end to end.
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Worldbuilding smoke', type: 'worldbuilding' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true });
  });
  await page.reload();

  // Its own sidebar, not the academic one — and the announced-but-unbuilt sections stay
  // inert rather than disappearing.
  const worldSidebar = page.getByTestId('worldbuilding-sidebar');
  await worldSidebar.waitFor({ timeout: 30_000 });
  // Every announced section has now graduated, so the assertion that used to pick an inert
  // one is replaced by its opposite: NOTHING in this sidebar is disabled. That is the
  // end state this control was always counting towards.
  assert.equal(
    await worldSidebar.locator('button[disabled]').count(),
    0,
    'every announced worldbuilding section is built and navigable'
  );
  assert.equal(await worldSidebar.getByRole('button', { name: 'Personajes', exact: true }).isDisabled(), false);
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'worldbuilding');
  // The violet accent comes from a CSS class remap that only applies when the root
  // carries `.worldbuilding`; a missing toggle would silently leave the app indigo.
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('worldbuilding')), true);

  await worldSidebar.getByRole('button', { name: 'Personajes', exact: true }).click();
  await page.getByTestId('characters-grid').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Crear el primero', exact: true }).click();
  await page.getByPlaceholder('Nombre', { exact: true }).fill('Kaelen Vor');
  await page.getByPlaceholder('Epíteto o título (opcional)').fill('El Cuervo de Vael');
  await page.getByPlaceholder('Especie', { exact: true }).fill('Semielfo');
  await page.getByPlaceholder('Pronombres', { exact: true }).fill('elle/le');
  await page.getByRole('button', { name: 'Crear personaje', exact: true }).click();

  // Saving opens the sheet. The epithet and the pronouns must survive verbatim — a
  // pronoun the app "tidies up" is the one error that makes a generated biography
  // unusable.
  await page.getByTestId('character-dossier-description').waitFor({ timeout: 30_000 });
  // Selecting does not REPLACE the collection any more: it shrinks to a left rail beside
  // the sheet, so both are on screen at once. Without this the workspace could silently
  // fall back to the old replace behaviour and every other assertion would still pass.
  assert.ok(
    await page.getByTestId('characters-grid').isVisible(),
    'the collection stays visible as a rail while the sheet is open'
  );
  const railBox = await page.getByTestId('characters-grid').boundingBox();
  const sheetBox = await page.getByTestId('character-dossier-description').boundingBox();
  assert.ok(
    railBox && sheetBox && railBox.x + railBox.width <= sheetBox.x + 1,
    'the rail sits to the LEFT of the sheet rather than on top of it'
  );
  await page.getByText('El Cuervo de Vael', { exact: true }).first().waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('character-dossier-aliases').innerText(), /Epíteto o título/);
  await waitForCondition('el personaje conserva especie y pronombres literales', () => page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    return character?.profile.species === 'Semielfo' && character?.profile.pronouns === 'elle/le';
  }));

  // The description autosaves on blur, and the appearance is what unlocks portrait
  // generation (the button stays disabled until there is something to draw).
  await page.getByPlaceholder('Rasgos, complexión, ropa, marcas distintivas…')
    .fill('Alto y enjuto, cicatriz sobre el ojo izquierdo, capa gris raída.');
  await page.getByTestId('character-dossier-biography').click();
  await waitForCondition('la apariencia se guarda al salir del campo', () => page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    return (character?.profile.appearance ?? '').startsWith('Alto y enjuto');
  }));

  // Two events in an invented calendar, entered out of order. The dates are unparseable
  // by the Earth-calendar parser on purpose: if the list ever fell back to `date_sort`
  // it would come out in insertion order and nothing would say so.
  const addWorldEvent = async (kind, date, year, place = null) => {
    await page.getByTestId('character-dossier-events').getByLabel('Añadir hecho').click();
    await page.getByLabel('Tipo de hecho').click();
    await page.getByRole('option', { name: kind, exact: true }).getByRole('button').click();
    await page.getByLabel('Fecha en tu calendario').fill(date);
    await page.getByLabel('Año del mundo', { exact: true }).fill(String(year));
    if (place) {
      await page.getByLabel('Lugar', { exact: true }).click();
      await page.getByLabel('Buscar lugar', { exact: true }).fill(place);
      await page.getByRole('button', { name: `Añadir «${place}»`, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Guardar hecho', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar hecho', exact: true }).waitFor({ state: 'detached', timeout: 30_000 });
  };
  await addWorldEvent('Exilio', 'Otoño de 1229 T.E.', 1229, 'Fortín de la Bruma');
  await addWorldEvent('Juramento', 'Primavera de 1221 T.E.', 1221);
  await waitForCondition('el lugar provisional se crea con el nombre y queda vinculado al hecho', () => page.evaluate(async () => {
    const places = await window.nodus.listWorldPlaces();
    const events = await window.nodus.listWorldEvents();
    return places.some((place) => place.name === 'Fortín de la Bruma')
      && events.some((event) => event.placeName === 'Fortín de la Bruma');
  }));
  await waitForCondition('los hechos se ordenan por el año del mundo, no por el de inserción', async () => {
    const rows = await page.getByTestId('character-dossier-events').locator('li').allInnerTexts();
    return rows.length === 2 && /1221/.test(rows[0]) && /1229/.test(rows[1]);
  });
  assert.equal(
    await page.evaluate(async () => {
      const [character] = await window.nodus.listCharacters();
      const events = await window.nodus.listCharacterEvents(character.personId);
      // The readable date is kept exactly as typed; only the integer orders.
      return events.map((event) => `${event.worldYear}:${event.date}`).join('|');
    }),
    '1221:Primavera de 1221 T.E.|1229:Otoño de 1229 T.E.',
    'the invented dates survive verbatim and the world year drives the order',
  );

  // The coherence check fires on a real contradiction and stays silent otherwise. It is
  // rendered ONLY when it has something to say, so its absence beforehand is the control.
  //
  // It now arrives through the CONTINUITY BADGE rather than through the character sheet's
  // own warnings block: the same finding, in one wording, for every kind of entity. Two
  // renderings of one problem taught a writer that the app did not know what it thought.
  assert.equal(await page.getByTestId('continuity-badge').count(), 0, 'a clean sheet shows no warnings');
  // Written straight through the IPC bridge, so the renderer's copy has to be refreshed
  // by a reload — otherwise the sheet keeps rendering the character it already had.
  await page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    // Dies in 1225, but the exile above happens in 1229.
    await window.nodus.updateCharacter(character.personId, { deathYearSort: 1225, lifeStatus: 'dead' });
  });
  const openFirstCharacter = async () => {
    await page.getByTestId('worldbuilding-sidebar').getByRole('button', { name: 'Personajes', exact: true }).click();
    await page.getByTestId('characters-grid').waitFor({ timeout: 30_000 });
    await page.getByTestId('character-card').first().click();
    await page.getByTestId('character-dossier-description').waitFor({ timeout: 30_000 });
  };
  await page.reload();
  await openFirstCharacter();
  const checks = page.getByTestId('continuity-badge');
  await checks.waitFor({ timeout: 30_000 });
  await checks.getByRole('button').first().click();
  assert.match(await checks.textContent(), /después de morir/, 'an event after death is reported');
  await page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    await window.nodus.updateCharacter(character.personId, { deathYearSort: null, lifeStatus: 'alive' });
  });
  await page.reload();
  await openFirstCharacter();
  assert.equal(
    await page.getByTestId('continuity-badge').count(),
    0,
    'and the warning disappears once the contradiction is gone'
  );

  // Arc and voice patch one field at a time. Two saves in a row must not wipe each other —
  // the bug a wholesale object patch would produce, and one the UI would never show.
  await page.getByTestId('character-dossier-arc').getByRole('button', { name: 'Arco', exact: true }).click();
  await page.getByPlaceholder('El objetivo que persigue y que mueve la trama.').fill('Recuperar el nombre de su casa');
  await page.getByPlaceholder('Lo que le impide conseguirlo.').fill('No sabe pedir ayuda');
  await page.getByTestId('character-dossier-abilities').click();
  await waitForCondition('el arco guarda cada campo sin pisar los demás', () => page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    return (
      character?.profile.arc.want === 'Recuperar el nombre de su casa' &&
      character?.profile.arc.flaw === 'No sabe pedir ayuda'
    );
  }));

  // An ability records a cost AND a limit; the sheet says so when the limit is missing.
  await page.getByTestId('character-dossier-abilities').getByLabel('Añadir habilidad').click();
  await page.getByPlaceholder('Nombre de la habilidad').fill('Voz de mando');
  await page.getByPlaceholder('Qué le cuesta usarla').fill('Pierde la voz un día entero');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await waitForCondition('la habilidad queda guardada con su coste', () => page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    const abilities = await window.nodus.listCharacterAbilities(character.personId);
    return abilities.length === 1 && abilities[0].cost === 'Pierde la voz un día entero';
  }));
  assert.match(
    await page.getByTestId('character-dossier-abilities').innerText(),
    /Sin límite definido/,
    'a power with no limit is called out rather than accepted quietly'
  );

  // A secret alias is stored as secret and kept OFF the card grid.
  await page.getByTestId('character-dossier-aliases').getByLabel('Añadir alias').click();
  // Deliberately sorts BEFORE "El Cuervo de Vael": person_names comes back ordered by
  // name, so a secret that sorted later would pass this check by luck of the alphabet
  // rather than because it is filtered out.
  await page.getByPlaceholder('El nombre…').fill('Ala Rota');
  await page.getByLabel('Tipo de nombre').selectOption({ label: 'Epíteto o título' });
  await page.getByLabel('Es un secreto').check();
  await page.getByPlaceholder('Quién lo conoce (p. ej. «solo su hermana y el archivero»)').fill('Solo el archivero');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await waitForCondition('el alias queda marcado como secreto', () => page.evaluate(async () => {
    const [character] = await window.nodus.listCharacters();
    const secret = character.names.find((entry) => entry.name === 'Ala Rota');
    return secret?.secret === true && secret?.knownBy === 'Solo el archivero';
  }));

  // Back to the grid: the card carries the character, and Inicio counts them.
  await page.getByRole('button', { name: 'Volver a los personajes', exact: true }).click();
  await page.getByTestId('character-card').first().waitFor({ timeout: 30_000 });
  const cardText = await page.getByTestId('character-card').first().innerText();
  assert.match(cardText, /Kaelen Vor/);
  assert.match(cardText, /El Cuervo de Vael/, 'the public epithet labels the card');
  assert.doesNotMatch(cardText, /Ala Rota/, 'a secret epithet must never be printed on the public card');
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.getByText('Personajes recientes', { exact: true }).waitFor({ timeout: 30_000 });
  console.log('[e2e] worldbuilding characters: own sidebar, card grid, sheet, and world-calendar ordering ok');

  // ── The other four collections, through the shared workspace ───────────────
  // Characters proved the workspace works; these prove each descriptor is wired to the
  // right data. Kept deliberately thin — the repo tests cover the rules, this covers that
  // the section exists, creates, and shows what it created.
  const openSection = async (label, testid) => {
    await page.getByTestId('worldbuilding-sidebar').getByRole('button', { name: label, exact: true }).click();
    await page.getByTestId(testid).waitFor({ timeout: 30_000 });
  };

  // Places: a tree, and the containment-scale warning that only fires on a real slip.
  await openSection('Lugares', 'places-grid');
  // The character event above deliberately created a provisional place, so this
  // collection is no longer empty. Prove that hand-off first, then use the normal
  // toolbar action instead of waiting for an empty-state button that cannot exist.
  await page.getByRole('button', { name: 'Fortín de la Bruma', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Nuevo lugar', exact: true }).click();
  await page.getByPlaceholder('Nombre del lugar').fill('Vael');
  await page.getByRole('button', { name: 'Crear lugar', exact: true }).click();
  await page.getByTestId('place-sheet-basics').waitFor({ timeout: 30_000 });
  await page.getByLabel('Tipo de lugar').first().selectOption('city');
  await waitForCondition('el lugar guarda su tipo', () => page.evaluate(async () => {
    const places = await window.nodus.listWorldPlaces();
    return places.find((place) => place.name === 'Vael')?.kind === 'city';
  }));
  // A continent inside a city: the one case the scale check exists for.
  await page.evaluate(async () => {
    const city = (await window.nodus.listWorldPlaces()).find((place) => place.name === 'Vael');
    if (!city) throw new Error('Vael was not persisted');
    const inner = await window.nodus.createWorldPlace({ name: 'Un continente entero', kind: 'continent' });
    await window.nodus.updateWorldPlace(inner.placeId, { parentId: city.placeId });
  });
  await page.reload();
  await openSection('Lugares', 'places-grid');
  await page.getByRole('button', { name: 'Un continente entero', exact: true }).click();
  await page.getByTestId('place-scale-warning').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('place-scale-warning').innerText(), /Continente/);

  // Factions and cultures: two sections over ONE table. Creating in one must not show up
  // in the other — the split by kind is the whole design.
  await openSection('Facciones', 'factions-grid');
  await page.getByRole('button', { name: 'Crear el primero', exact: true }).click();
  await page.getByPlaceholder('Nombre', { exact: true }).fill('Los Cuervos');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByTestId('group-sheet-basics').waitFor({ timeout: 30_000 });
  await openSection('Culturas', 'cultures-grid');
  assert.equal(
    await page.getByTestId('group-card').count(),
    0,
    'a faction must not appear under Culturas: the two sections filter one table by kind'
  );

  // Scenes, and the appearance that shows up back on the character sheet.
  await openSection('Escenas', 'scenes-grid');
  await page.getByRole('button', { name: 'Crear el primero', exact: true }).click();
  await page.getByPlaceholder('Título de la escena').fill('La caída de Vael');
  await page.getByRole('button', { name: 'Crear escena', exact: true }).click();
  await page.getByTestId('scene-sheet-cast').waitFor({ timeout: 30_000 });
  await page.getByTestId('scene-cast-picker').click();
  await page.getByTestId('scene-cast-picker-search').fill('Kaelen Vor');
  await page.getByTestId('scene-cast-picker-popover').getByText('Kaelen Vor', { exact: true }).click();
  await page.getByTestId('scene-sheet-cast').getByRole('button', { name: 'Añadir', exact: true }).click();
  await waitForCondition('el personaje queda en el reparto', () => page.evaluate(async () => {
    const [scene] = await window.nodus.listScenes();
    return (await window.nodus.listSceneCharacters(scene.sceneId)).length === 1;
  }));
  // The appearance is what closes the loop: it has to be visible from the character too.
  await openSection('Personajes', 'characters-grid');
  await page.getByTestId('character-card').first().click();
  await page.getByTestId('character-dossier-appearances').waitFor({ timeout: 30_000 });
  assert.match(await page.getByTestId('character-dossier-appearances').innerText(), /La caída de Vael/);
  {
    // The strip that fills three sections. It is the only place a writer is willing to say
    // "in this scene, this moves like so", so it has to work from inside the scene sheet
    // with no trip to another screen.
    // Back to the scene: the previous block navigated to Personajes to check the
    // appearance from the other side.
    await openSection('Escenas', 'scenes-grid');
    await page.getByTestId('scene-card').first().click();
    await page.getByTestId('scene-threads').waitFor({ timeout: 15_000 });
    await page.getByTestId('scene-threads').getByRole('button', { name: '+ Conflicto', exact: true }).click();
    await page.getByPlaceholder('Quién quiere qué contra quién').fill('La guerra por el vado');
    await page.getByTestId('scene-threads').getByRole('button', { name: 'Crear', exact: true }).click();
    const row = page.getByTestId('scene-thread-row').first();
    await row.waitFor({ timeout: 15_000 });
    assert.match(await row.textContent(), /La guerra por el vado/);

    // Creating it records a beat, so the scene already counts towards the conflict.
    const beats = await page.evaluate(async () => (await window.nodus.listWorldBeats()).length);
    assert.equal(beats, 1, 'a thread created from a scene starts moved by that scene');

    // The mark is a set, not a list: pressing another one replaces it.
    await row.getByRole('button', { name: 'Gira', exact: true }).click();
    await page.waitForFunction(
      async () => (await window.nodus.listWorldBeats())[0]?.mark === 'turn',
      undefined,
      { timeout: 15_000 }
    );

    // And the day chain writes the canonical world day from a relation, not a number.
    await page.getByTestId('scene-day-chain').waitFor({ timeout: 15_000 });
  }

  {
    // Continuity, as a badge on the sheet the writer is already looking at — built before
    // the section in the menu on purpose. Two scenes, one character, the same world day.
    const secondScene = await page.evaluate(async () => {
      const [first] = await window.nodus.listScenes('narrative');
      const places = await window.nodus.listWorldPlaces();
      const characters = await window.nodus.listCharacters();
      const other = await window.nodus.createScene({ title: 'En otra parte' });
      // A DIFFERENT place, so the two scenes really do contradict each other.
      const elsewhere = await window.nodus.createWorldPlace({ name: 'Ninguna parte', kind: 'city' });
      await window.nodus.updateScene(other.sceneId, { placeId: elsewhere.placeId });
      await window.nodus.updateScene(first.sceneId, { placeId: places[0].placeId });
      await window.nodus.addSceneCharacter(other.sceneId, characters[0].personId);
      await window.nodus.setSceneDayLink(first.sceneId, { mode: 'anchor', offsetDays: 0, anchorWorldDay: 412 });
      await window.nodus.setSceneDayLink(other.sceneId, { mode: 'same', offsetDays: 0, anchorWorldDay: null });
      return other.sceneId;
    });

    const found = await page.evaluate(async () => {
      const all = await window.nodus.runWorldContinuity();
      return all.filter((finding) => finding.checkId === 'presence.bilocation').length;
    });
    assert.equal(found, 1, 'two places on one day is a contradiction');

    // The badge has to reach the writer where they already are: the character sheet.
    await openSection('Personajes', 'characters-grid');
    await page.getByTestId('character-card').first().click();
    const badge = page.getByTestId('continuity-badge');
    await badge.waitFor({ timeout: 20_000 });
    assert.match(await badge.textContent(), /contradicciones/);

    // The section itself. It is a READING of the world: no create button, and the only
    // thing it writes is the silence.
    await openSection('Continuidad', 'continuity-grid');
    const row = page.getByTestId('continuity-row').filter({ hasText: 'a la vez' }).first();
    await row.waitFor({ timeout: 20_000 });
    assert.equal(
      await page.getByRole('button', { name: 'Crear el primero', exact: true }).count(),
      0,
      'a reading of the world has nothing to create'
    );
    await row.click();
    const sheet = page.getByTestId('continuity-sheet');
    await sheet.waitFor({ timeout: 15_000 });
    // "Why I say so" is not politeness: a warning whose reasoning cannot be followed is a
    // warning the writer learns to skip.
    assert.match(await sheet.textContent(), /Alguien está en dos lugares distintos/);

    // Silence it with a canned reason, and check the silence sticks.
    await sheet.getByTestId('mute-double').click();
    await page.waitForFunction(
      async () => !(await window.nodus.runWorldContinuity()).some((f) => f.checkId === 'presence.bilocation'),
      undefined,
      { timeout: 20_000 }
    );
    assert.equal(
      await page.evaluate(async () =>
        (await window.nodus.runWorldContinuityUnfiltered()).some((f) => f.checkId === 'presence.bilocation')
      ),
      true,
      'but the exceptions screen can still see it'
    );

    // THE POINT OF A NUMBERLESS FINGERPRINT: moving the date must not resurrect it.
    await page.evaluate(async () => {
      const [first] = await window.nodus.listScenes('narrative');
      await window.nodus.setSceneDayLink(first.sceneId, { mode: 'anchor', offsetDays: 0, anchorWorldDay: 999 });
    });
    assert.equal(
      await page.evaluate(async () =>
        (await window.nodus.runWorldContinuity()).some((f) => f.checkId === 'presence.bilocation')
      ),
      false,
      'changing the day must not bring back an exception the author already judged'
    );

    // And it is listed, readable, under the exceptions the author accepted.
    await page.getByTestId('continuity-exceptions').click();
    const modal = page.getByTestId('exceptions-modal');
    await modal.waitFor({ timeout: 15_000 });
    assert.match(await modal.textContent(), /Tiene un doble/, 'the reason is shown, not the fingerprint');
    await modal.getByRole('button', { name: 'Volver a avisarme', exact: true }).click();
    await page.waitForFunction(
      async () => (await window.nodus.listNoticeMutes()).length === 0,
      undefined,
      { timeout: 15_000 }
    );
    // Close it: a `fixed inset-0` backdrop left open swallows every later click in the
    // run, and the failure then points at whatever came next rather than at this.
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await modal.waitFor({ state: 'detached', timeout: 15_000 });

    await page.evaluate(async (sceneId) => window.nodus.deleteScene(sceneId), secondScene);
  }

  {
    // Conflicts. The board is the product: it is the one thing a writer cannot do in their
    // head past fifteen characters, so the section opens on it and not on a list.
    //
    // Somebody ON STAGE and wanting nothing has to exist, or the diagnosis the board is
    // built for has nothing to point at and the assertion below proves nothing.
    await page.evaluate(async () => {
      const walkOn = await window.nodus.createCharacter({ displayName: 'Bruma la Callada' });
      const [scene] = await window.nodus.listScenes('narrative');
      await window.nodus.addSceneCharacter(scene.sceneId, walkOn.personId);
    });
    await openSection('Conflictos', 'conflicts-board');
    const board = page.getByTestId('conflicts-board');
    await board.waitFor({ timeout: 20_000 });
    assert.match(await board.textContent(), /La guerra por el vado/, 'the conflict created from a scene is a column');

    // The diagnosis the board exists for: page time with nothing at stake, at the top.
    const firstRow = page.getByTestId('conflicts-board-row').first();
    assert.equal(await firstRow.getAttribute('data-stakes'), '0', 'whoever wants nothing comes first');
    assert.match(await firstRow.textContent(), /Bruma la Callada/);
    assert.match(
      await page.getByTestId('conflicts-gaps').textContent(),
      /Bruma la Callada/,
      'and the diagnosis names them under the board'
    );

    // The list tab is infrastructure around it, and the sheet writes prose, never beats.
    await page.getByTestId('conflicts-tab-list').click();
    await page.getByTestId('conflict-row').first().click();
    const sheet = page.getByTestId('conflict-sheet');
    await sheet.waitFor({ timeout: 15_000 });
    await page.getByPlaceholder('El paso del vado, y quién cobra por cruzarlo…').fill('Lo disputan [[Kaelen Vor]] y los suyos.');
    await page.getByTestId('conflict-beats').click();
    await waitForCondition('el pitch del conflicto se guarda y enlaza', () => page.evaluate(async () => {
      const [thread] = await window.nodus.listWorldThreads('conflict');
      return /nodus:\/\/world\/character\//.test(thread?.pitch ?? '');
    }));

    // A conflict is an encyclopedia entry: `[[la guerra…]]` has to resolve, and the
    // character it names has to know it is mentioned.
    const mentioned = await page.evaluate(async () => {
      const [thread] = await window.nodus.listWorldThreads('conflict');
      const entries = await window.nodus.listWorldEntries();
      const entry = entries.find((item) => item.kind === 'conflict' && item.id === thread.threadId);
      // By NAME, not by position: the cast is ordered by display name, so `[0]` is
      // whoever sorts first — which is not the character the pitch mentions.
      const characters = await window.nodus.listCharacters();
      const kaelen = characters.find((character) => character.displayName === 'Kaelen Vor');
      const backlinks = await window.nodus.worldBacklinks({ kind: 'character', id: kaelen.personId });
      return { hasEntry: Boolean(entry), fromConflict: backlinks.some((link) => link.source.kind === 'conflict') };
    });
    assert.deepEqual(mentioned, { hasEntry: true, fromConflict: true });
  }

  {
    // Arcs. The whole section is a READING of what the scene strip already writes, so the
    // test writes through that strip and then checks the lane.
    await openSection('Escenas', 'scenes-grid');
    await page.getByTestId('scene-card').first().click();
    const strip = page.getByTestId('scene-threads');
    await strip.waitFor({ timeout: 15_000 });
    await strip.getByRole('button', { name: '+ Arco', exact: true }).click();
    await page.getByPlaceholder('Qué cambia, y en quién').fill('El deshielo de Kaelen');
    await strip.getByRole('button', { name: 'Crear', exact: true }).click();
    await waitForCondition('el arco queda creado con su primer hito', () => page.evaluate(async () => {
      const arcs = await window.nodus.listWorldThreads('arc');
      const beats = await window.nodus.listWorldBeats();
      return arcs.length === 1 && beats.some((beat) => beat.threadKind === 'arc');
    }));

    await openSection('Arcos narrativos', 'arcs-lanes');
    const lane = page.getByTestId('arc-lane').first();
    await lane.waitFor({ timeout: 20_000 });
    assert.match(await lane.textContent(), /El deshielo/);
    // The lane has to have real width: an SVG drawn before the container is measured is
    // the classic way this kind of view ships invisible.
    const box = await lane.boundingBox();
    assert.ok(box && box.width > 100, 'the lane is actually drawn, not collapsed');

    // Selecting it opens the read-only sheet, which mirrors the character's own arc fields.
    await lane.click();
    await page.getByTestId('arc-sheet').waitFor({ timeout: 15_000 });

    // And the milestone sheet copies as plain text in scene positions.
    await page.getByTestId('arcs-copy-sheet').click();
    const copied = await page.evaluate(async () => navigator.clipboard.readText());
    assert.match(copied, /El deshielo de Kaelen/);
    assert.doesNotMatch(copied, /%/, 'positions, never percentages');
  }

  {
    // Rules. A law exists so that breaking it costs something, and the whole section turns
    // on ONE question asked in the scene: is that price on the page?
    await openSection('Reglas del mundo', 'rules-grid');
    await page.getByRole('button', { name: 'Nueva regla', exact: true }).click();
    await page.getByPlaceholder('Qué es siempre verdad en este mundo').fill('La sangre paga la sangre');
    await page.getByTestId('new-rule-modal').getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByTestId('rule-sheet').waitFor({ timeout: 15_000 });
    // The one model call this screen makes sits under a button, and the button exists only
    // while there is no proposal to judge — accepting is always a separate act.
    await page.getByTestId('rule-draft').waitFor({ timeout: 15_000 });

    // Put it to the test from the SCENE, which is the only place a writer will do it.
    await openSection('Escenas', 'scenes-grid');
    await page.getByTestId('scene-card').first().click();
    const inPlay = page.getByTestId('rules-in-play');
    await inPlay.waitFor({ timeout: 15_000 });
    assert.match(await inPlay.textContent(), /La sangre paga la sangre/, 'a world-wide law is in play by default');
    await inPlay.getByRole('button', { name: 'Se rompe', exact: true }).click();

    // Three states. Marked but not judged must NOT accuse.
    await waitForCondition('la rotura queda sin juzgar', () => page.evaluate(async () => {
      const beats = await window.nodus.listWorldBeats();
      const broken = beats.find((beat) => beat.threadKind === 'rule');
      return broken?.mark === 'breaks' && broken.paid === null;
    }));
    assert.equal(
      await page.evaluate(async () =>
        (await window.nodus.runWorldContinuity()).some((f) => f.checkId === 'rule.unpaid')
      ),
      false,
      'a break nobody has judged is not an accusation'
    );

    // Saying the price is NOT on the page is what turns it into a warning.
    await inPlay.getByTestId('rule-paid-no').click();
    await waitForCondition('el aviso de precio impagado aparece', () => page.evaluate(async () =>
      (await window.nodus.runWorldContinuity()).some((f) => f.checkId === 'rule.unpaid')
    ));

    // And the law is an encyclopedia entry, so it can be cited from anywhere.
    const isEntry = await page.evaluate(async () => {
      const [rule] = await window.nodus.listWorldRules();
      const entries = await window.nodus.listWorldEntries();
      return entries.some((entry) => entry.kind === 'rule' && entry.id === rule.ruleId);
    });
    assert.equal(isEntry, true);
  }

  {
    // Preguntas abiertas. The section is small; what has to work is the round trip that
    // makes it worth having: a hole left mid-sentence turns into a decision, answering it
    // rewrites the author's own sheet, and the undo puts back exactly what was there.
    await openSection('Personajes', 'characters-grid');
    await page.getByText('Kaelen Vor', { exact: true }).first().click();
    await page.getByTestId('character-dossier-description').waitFor({ timeout: 30_000 });

    // A hole left while writing. Nothing is stored for it — the scan finds it every time.
    const backstory = page.getByPlaceholder('Origen, historia previa, cómo llega al punto en que empieza el relato…');
    await backstory.fill('Nació en ??? y creció lejos del vado.');
    await page.getByTestId('character-dossier-biography').click();
    await waitForCondition('el trasfondo se guarda al salir del campo', () => page.evaluate(async () => {
      const kaelen = (await window.nodus.listCharacters()).find((c) => c.displayName === 'Kaelen Vor');
      return (kaelen?.profile.backstory ?? '').includes('???');
    }));

    // Capturing from the prose itself: select, one click, and the anchor and the field
    // come from where the caret already was. This is the affordance the whole section
    // depends on, so it is exercised through the real textarea selection.
    const personality = page.getByPlaceholder('Carácter, motivaciones, miedos, forma de hablar…');
    await personality.fill('Jura por una diosa que quizá no exista.');
    // Selected the way a person does it: the affordance appears from the field's own
    // selection events, so a programmatic `select()` would prove nothing about the UI.
    await personality.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.getByTestId('capture-question').first().click();
    await waitForCondition('la captura guarda el ancla y el campo', () => page.evaluate(async () => {
      const stored = await window.nodus.listWorldQuestions();
      const captured = stored.find((question) => question.anchorField === 'personality');
      return Boolean(captured && captured.origin === 'author' && captured.anchorKind === 'character');
    }));

    await openSection('Preguntas abiertas', 'questions-grid');
    const hole = page.locator('[data-testid="question-row"][data-origin="placeholder"]').first();
    await hole.waitFor({ timeout: 30_000 });
    assert.match(await hole.innerText(), /Nació en \?\?\?/, 'the evidence is the line verbatim');
    await hole.click();
    await page.getByTestId('question-sheet').waitFor({ timeout: 15_000 });

    // The write is NAMED before it happens. A button that edits a paragraph of somebody's
    // novel without saying where is the one thing this section must never do.
    await page.getByTestId('question-new-option').fill('la casa del carcelero');
    await page.getByRole('button', { name: 'Añadir', exact: true }).click();
    const apply = page.getByTestId('question-option-apply').first();
    await apply.waitFor({ timeout: 15_000 });
    assert.match(await apply.innerText(), /Kaelen Vor.*Trasfondo/, 'the button says what it will write');
    await apply.click();

    // The hole is REPLACED in the character's own sheet, not appended under it.
    await waitForCondition('la respuesta se escribe en el trasfondo', () => page.evaluate(async () => {
      const kaelen = (await window.nodus.listCharacters()).find((c) => c.displayName === 'Kaelen Vor');
      return kaelen?.profile.backstory === 'Nació en la casa del carcelero y creció lejos del vado.';
    }));

    await page.getByTestId('question-option-undo').first().click();
    await waitForCondition('deshacer devuelve exactamente lo que había', () => page.evaluate(async () => {
      const kaelen = (await window.nodus.listCharacters()).find((c) => c.displayName === 'Kaelen Vor');
      return kaelen?.profile.backstory === 'Nació en ??? y creció lejos del vado.';
    }));

    // Proposing answers is under a button too, beside the author's own. There is no accept
    // step: an option is a pending write, so choosing one IS the consent.
    await page.getByTestId('question-propose').waitFor({ timeout: 15_000 });

    // Both model calls refuse BEFORE they need a provider when there is nothing to work
    // from — a bare law, a question whose whole text is «???». Without that guard the
    // author's first click on either button is a provider error.
    const guarded = await page.evaluate(async () => {
      const bare = await window.nodus.createWorldRule({ title: 'Una ley sin nada detrás' });
      const drafted = await window.nodus.draftWorldRule(bare.ruleId);
      const hollow = await window.nodus.ensureQuestion({ question: '???', origin: 'author' });
      const proposed = await window.nodus.proposeQuestionOptions(hollow.questionId);
      await window.nodus.deleteWorldRule(bare.ruleId);
      await window.nodus.deleteWorldQuestion(hollow.questionId);
      return { rule: drafted.noMaterial, question: proposed.noMaterial };
    });
    assert.deepEqual(guarded, { rule: true, question: true }, 'no material is an answer, not an error');

    // And the scene the author is about to write says what it is waiting on, which is the
    // whole point of the section: they never come here to feed it.
    await page.evaluate(async () => {
      const kaelen = (await window.nodus.listCharacters()).find((c) => c.displayName === 'Kaelen Vor');
      const [first] = await window.nodus.listScenes('narrative');
      const cast = await window.nodus.listSceneCharacters(first.sceneId);
      if (!cast.some((entry) => entry.personId === kaelen.personId)) {
        await window.nodus.addSceneCharacter(first.sceneId, kaelen.personId);
      }
      await window.nodus.updateScene(first.sceneId, { status: 'outline' });
    });
    await openSection('Escenas', 'scenes-grid');
    await page.getByTestId('scene-card').first().click();
    const band = page.getByTestId('scene-question-band');
    await band.waitFor({ timeout: 30_000 });
    // Case-insensitive: the heading is uppercased by CSS and innerText reports it rendered.
    assert.match(await band.innerText(), /2 decisiones abiertas/i);
  }

  console.log('[e2e] worldbuilding rules: created, put to the test from the scene, unpaid price reaches Continuidad');

  {
    // The world chat. Nodus calculates and the model writes, so the half that can be proved
    // without a provider is the half that matters most: it refuses to answer about a world
    // it cannot anchor, instead of composing a plausible one.
    await openSection('Research chat', 'research-chat-view');
    await page.locator('.research-composer-input').fill('¿Y ahora qué hago?');
    const refusal = page.locator('.research-message').filter({ hasText: /No he encontrado nada de tu mundo/ }).first();
    try {
      // The shared chat loads the conversation's prompt selection before enabling send.
      await page.waitForFunction(() => document.querySelector('.research-composer-send')?.disabled === false);
      await page.keyboard.press('Enter');
      await refusal.waitFor({ timeout: 30_000 });
    } catch (error) {
      console.error('[e2e] world chat state:', await page.getByTestId('research-chat-view').innerText());
      throw error;
    }
    assert.match(
      await refusal.innerText(),
      /No he encontrado nada de tu mundo/,
      'a question that names nothing is refused before a provider is ever needed'
    );
  }

  {
    // El manuscrito: la columna que le faltaba a la escena. Se escribe desde la escena que
    // el autor ya tiene abierta, se cuenta solo, y lo que escribe entra en el mundo — que
    // es lo que separa esto de un procesador de textos.
    await openSection('Escenas', 'scenes-grid');
    await page.getByTestId('scene-card').first().click();
    await page.getByTestId('scene-sheet-summary').waitFor({ timeout: 30_000 });
    await page.getByTestId('scene-write').click();

    const editor = page.getByTestId('manuscript-editor');
    await editor.waitFor({ timeout: 30_000 });
    // Una sola puerta al mismo texto: «Escribir» abre el manuscrito EN esa escena.
    await editor.fill('Kaelen cruzó el vado antes del alba, con [[Kaelen Vor]] detrás.');
    await page.getByTestId('manuscript-spine').click();
    await waitForCondition('la prosa se guarda al salir del campo', () => page.evaluate(async () => {
      const [first] = await window.nodus.listScenes('narrative');
      const text = await window.nodus.getSceneText(first.sceneId);
      return (text.text ?? '').includes('antes del alba') && text.wordCount > 0;
    }));

    // El recuento no cuenta la URL del enlace resuelto — el único número que nadie
    // comprobaría a mano.
    const counted = await page.evaluate(async () => {
      const [first] = await window.nodus.listScenes('narrative');
      const text = await window.nodus.getSceneText(first.sceneId);
      return { words: text.wordCount, linked: (text.text ?? '').includes('nodus://world/character/') };
    });
    // Once: the label counts, the URL does not (it would be 12 with the URL in).
    assert.deepEqual(counted, { words: 11, linked: true }, 'the link is resolved and its URL is not words');

    // Un capítulo es DONDE empieza: se marca en la escena, no en una tabla con su orden.
    await page.getByTestId('manuscript-start-chapter').click();
    await page.getByPlaceholder('Título del capítulo').fill('Primera parte');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await waitForCondition('el capítulo agrupa desde su escena', () => page.evaluate(async () => {
      const spine = await window.nodus.manuscriptSpine();
      return spine.chapters.some((chapter) => chapter.title === 'Primera parte');
    }));
    assert.match(await page.getByTestId('manuscript-progress').innerText(), /Hoy/);

    // Y lo escrito ENTRA EN EL MUNDO: retroenlace en la ficha del personaje, y el aviso
    // que sólo el manuscrito hace posible cuando no está en el reparto.
    const entered = await page.evaluate(async () => {
      const characters = await window.nodus.listCharacters();
      const kaelen = characters.find((c) => c.displayName === 'Kaelen Vor');
      const backlinks = await window.nodus.worldBacklinks({ kind: 'character', id: kaelen.personId });
      const findings = await window.nodus.runWorldContinuity();
      return {
        fromManuscript: backlinks.some((link) => link.source.kind === 'scene' && link.sourceField === 'text'),
        uncast: findings.some((finding) => finding.checkId === 'manuscript.uncastMention'),
      };
    });
    assert.equal(entered.fromManuscript, true, 'the manuscript feeds the link graph like any other prose');
    // Kaelen fue añadido al reparto de la primera escena en el bloque de preguntas, así
    // que aquí NO debe haber aviso: el chequeo distingue nombrar de declarar.
    assert.equal(entered.uncast, false, 'somebody declared in the cast raises nothing');

    // El estante: un libro es DÓNDE empieza un libro, igual que un capítulo, así que no
    // añade un segundo eje de ordenación al del relato.
    await page.getByTestId('manuscript-start-book').click();
    await page.getByPlaceholder('Título del libro').fill('La marca de sangre');
    await page.getByTestId('manuscript-book-pill').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
    await waitForCondition('el libro agrupa desde su escena', () => page.evaluate(async () => {
      const spine = await window.nodus.manuscriptSpine();
      return spine.books.some((book) => book.title === 'La marca de sangre');
    }));

    // Una reescritura que se come la escena la guarda sola, y restaurar guarda antes lo que
    // hay: un deshacer que no se puede deshacer es una trampa.
    const undone = await page.evaluate(async () => {
      const [first] = await window.nodus.listScenes('narrative');
      await window.nodus.saveSceneText(first.sceneId, Array.from({ length: 80 }, (_, i) => `p${i}`).join(' '));
      await window.nodus.saveSceneText(first.sceneId, 'Dos palabras.');
      const shots = await window.nodus.listSceneSnapshots(first.sceneId);
      await window.nodus.restoreSceneSnapshot(shots[0].snapshotId);
      const back = await window.nodus.getSceneText(first.sceneId);
      return { reason: shots[0].reason, restored: back.wordCount, kept: (await window.nodus.listSceneSnapshots(first.sceneId)).length };
    });
    assert.deepEqual(undone, { reason: 'shrink', restored: 80, kept: 2 }, 'the save kept what the paste ate');

    // Modo máquina de escribir: la línea que se escribe se queda a la altura de los ojos.
    // Lo que se comprueba aquí es el mecanismo que lo hace posible al final del documento,
    // que es donde siempre está el autor: el relleno inferior. Sin él la última línea no
    // puede llegar a la banda porque no hay nada debajo que empujar.
    await editor.fill(Array.from({ length: 200 }, (_, i) => `Línea ${i} del capítulo.`).join('\n'));
    const flat = await editor.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    await page.getByTestId('manuscript-typewriter').click();
    await waitForCondition('el relleno deja llegar a la última línea', () =>
      editor.evaluate(
        (el, previous) => el.scrollHeight > previous.scrollHeight + previous.clientHeight * 0.4,
        flat
      )
    );
    // Y el modo quita de la vista todo lo que no es la frase.
    await page.getByTestId('manuscript-spine').waitFor({ state: 'detached', timeout: 10_000 });
    await page.getByTestId('manuscript-focus-veil').waitFor({ timeout: 10_000 });

    // Esc devuelve la pantalla entera, sin tener que buscar el botón.
    await editor.click();
    await page.keyboard.press('Escape');
    await page.getByTestId('manuscript-spine').waitFor({ timeout: 10_000 });
  }

  console.log('[e2e] worldbuilding open questions: a hole becomes a decision, answering rewrites the sheet, undo restores it');
  console.log('[e2e] worldbuilding manuscript: written from the scene, counted, chaptered, and part of the world');
  console.log('[e2e] worldbuilding world chat: refuses to answer about a world it cannot anchor');

  console.log('[e2e] worldbuilding arcs: lanes drawn from the scene strip, sheet, milestone sheet');

  console.log('[e2e] worldbuilding conflicts: board, stake gaps, sheet prose indexed as an encyclopedia entry');

  console.log('[e2e] worldbuilding continuity: badge on the sheet, section, canned silence that survives a date change');

  console.log('[e2e] worldbuilding places, factions, cultures and scenes work through the shared workspace');

  // ── The encyclopedia ───────────────────────────────────────────────────────
  // The one section that is an index over all the others, so it is also the only one
  // whose correctness depends on the rest of the vault already existing. Four things are
  // provable only here: that a character created in another section shows up as a
  // read-only projection, that `[[` writes a real link, that the backlink appears on the
  // other side, and that creating an entry from a red link repairs the body that was
  // waiting for it.
  await worldSidebar.getByRole('button', { name: 'Enciclopedia', exact: true }).click();
  await page.getByTestId('encyclopedia-grid').waitFor({ timeout: 30_000 });

  {
    // Kaelen was created in the Personajes block above, and the places/factions/scenes
    // block after it added more: the index is a read, so they are all here already.
    const kaelen = page.getByTestId('encyclopedia-entry').filter({ hasText: 'Kaelen Vor' }).first();
    await kaelen.waitFor({ timeout: 15_000 });
    await kaelen.click();
    await page.getByTestId('entry-reader').waitFor({ timeout: 15_000 });
    assert.equal(
      await page.getByTestId('entry-edit').count(),
      0,
      'a projected entry is read in the encyclopedia and edited in its own section'
    );
    assert.equal(await page.getByTestId('entry-full-sheet').count(), 1, 'and it offers the way there');
  }

  // A native article: the lore that hangs off no entity, which had nowhere to live before.
  await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
  await page.getByPlaceholder('Título de la entrada').fill('Magia de sangre');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByTestId('entry-reader').waitFor({ timeout: 15_000 });
  await page.getByTestId('entry-edit').click();
  await page.getByTestId('entry-editor').waitFor({ timeout: 15_000 });

  {
    // Typing `[[` must offer the whole world, not just the articles.
    const area = page.getByPlaceholder('Escribe la entrada…');
    await area.fill('La practican [[Kaelen');
    await page.getByTestId('entry-link-autocomplete').waitFor({ timeout: 15_000 });
    await page.getByTestId('entry-link-autocomplete').getByRole('button').first().click();
    const afterPick = await area.inputValue();
    assert.match(
      afterPick,
      /\[Kaelen Vor\]\(nodus:\/\/world\/character\//,
      'picking from the autocomplete writes the resolved form, which is what survives a rename'
    );
    // And a name typed straight through is promoted on save, so the author never has to
    // learn that there are two link forms.
    await area.fill(`${afterPick} y también [[Vael]], guardadas por [[Los Sin Nombre]].`);
    await page.getByTestId('entry-editor-save').click();
    // What the save must produce is an OUTGOING link rendered as a clickable world link.
    // (Backlinks belong to the other side — they are checked on Kaelen, below.)
    await page
      .getByTestId('entry-reader')
      .getByRole('button', { name: 'Kaelen Vor', exact: true })
      .first()
      .waitFor({ timeout: 15_000 });
  }

  {
    // The other side of the link: Kaelen now knows he is mentioned.
    const kaelen = page.getByTestId('encyclopedia-entry').filter({ hasText: 'Kaelen Vor' }).first();
    await kaelen.click();
    const backlinks = page.getByTestId('entry-backlinks');
    await backlinks.waitFor({ timeout: 15_000 });
    // textContent, not innerText: a panel that has scrolled only lays out part of itself.
    assert.match(await backlinks.textContent(), /Magia de sangre/, 'the backlink names the article');
  }

  {
    // What the world names but never defines. The deterministic half of this analysis
    // needs no AI provider — and there is none configured here — so a model failure must
    // degrade to the unresolved links rather than take the feature down.
    await page.getByTestId('analyze-missing').click();
    const panel = page.getByTestId('missing-entries');
    await panel.getByText('Los enlazaste y no existen', { exact: true }).waitFor({ timeout: 30_000 });
    assert.match(
      await panel.textContent(),
      /Los Sin Nombre/,
      'an unresolved [[link]] is a fact the author already stated, so it is always offered'
    );
  }

  {
    // The red link. `Los Sin Nombre` was never defined, so it stayed as [[…]] and is
    // rendered as an invitation; following it creates the entry and repairs the body.
    await page.getByTestId('encyclopedia-entry').filter({ hasText: 'Magia de sangre' }).first().click();
    await page.getByTestId('entry-reader').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Los Sin Nombre', exact: true }).first().click();
    await page.getByTestId('create-from-link').click();
    await page.getByTestId('create-from-link').waitFor({ state: 'detached', timeout: 15_000 });
    const resolved = await page.evaluate(async () => (await window.nodus.worldUnresolvedLinks()).length);
    assert.equal(resolved, 0, 'creating the entry linked every mention that was waiting for it');
  }

  {
    // The second tier of the search: a word that lives only inside a character's
    // appearance, deep in a paragraph no index row carries. `cicatriz` appears in
    // Kaelen's description, written in the Personajes block above, and nowhere in any
    // title or summary — so a hit proves the full-text path really ran.
    await page.getByPlaceholder('Buscar en todo el mundo…').fill('cicatriz');
    const footer = page.getByTestId('encyclopedia-fulltext');
    await footer.waitFor({ timeout: 15_000 });
    // The trigger keeps its place while the query runs, only saying «Buscando…», so waiting
    // for "a button in the footer" matches the trigger itself and races the search. Wait for
    // the trigger to be replaced by its outcome — the hit list, or the "no aparece" line.
    const trigger = footer.getByRole('button', { name: /texto completo|Buscando/ });
    await trigger.click();
    await trigger.waitFor({ state: 'detached', timeout: 20_000 });
    assert.match(
      await page.getByTestId('encyclopedia-fulltext').textContent(),
      /Kaelen Vor/,
      'the full-text search reaches prose that no index row carries'
    );
    await page.getByPlaceholder('Buscar en todo el mundo…').fill('');
  }

  {
    // The world bible. The export itself ends in a native save dialog, which cannot be
    // driven from here, so what this proves is the screen: that the three switches an
    // author could regret are OFF when the modal opens.
    await page.getByTestId('export-world-bible').click();
    const modal = page.getByTestId('world-bible-modal');
    await modal.waitFor({ timeout: 15_000 });
    const checked = await modal.locator('input[type="checkbox"]').evaluateAll((boxes) =>
      boxes.map((box) => box.checked)
    );
    assert.deepEqual(checked, [false, false, false], 'spoilers, private notes and AI drafts are opt-in');
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await modal.waitFor({ state: 'detached', timeout: 15_000 });
  }

  console.log('[e2e] worldbuilding encyclopedia: projections, [[links]], backlinks, red links and full-text search ok');

  // ── Maps ───────────────────────────────────────────────────────────────────
  // The one worldbuilding section whose core is a live Leaflet canvas, so this is the
  // only place the coordinate maths can be checked against real mouse gestures. Two
  // things in particular are only provable here: that a click lands where it looks like
  // it lands, and that dragging a vertex actually SAVES — a bug that moved the shape on
  // screen, reported exactly once, and wrote nothing.
  const mapImagePath = path.join(userData, 'e2e-map.png');
  const mapPngBytes = await page.evaluate(async () => {
    // A 2000x1000 plate, so the aspect ratio is not 1 and a mistake in the y axis or in
    // the aspect correction cannot hide.
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e8dcc0';
    context.fillRect(0, 0, 2000, 1000);
    context.fillStyle = '#7f1d1d';
    context.fillRect(0, 0, 40, 40);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await writeFile(mapImagePath, Buffer.from(mapPngBytes));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async (_window, options) => {
      const actual = options ?? _window;
      if (actual?.title === 'Elegir la imagen del mapa') return { canceled: false, filePaths: [filePath] };
      return { canceled: true, filePaths: [] };
    };
  }, mapImagePath);

  await page.getByTestId('worldbuilding-sidebar').getByRole('button', { name: 'Mapa', exact: true }).click();
  await page.getByTestId('world-maps-view').waitFor({ timeout: 30_000 });
  await page.getByTestId('world-map-create').click();
  await page.getByTestId('world-map-create-name').fill('El Norte');
  await page.getByTestId('world-map-create-confirm').click();
  await page.getByTestId('world-map-workbench').waitFor({ timeout: 30_000 });

  // Upload: stored at its native size, NOT through the 1280px decorative pipeline.
  await page.getByTestId('world-map-import-image').click();
  await waitForCondition('el mapa guarda su imagen a tamaño nativo', () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    return map?.widthPx === 2000 && map?.heightPx === 1000;
  }));
  await page.locator('.world-map-image').first().waitFor({ timeout: 30_000 });

  /**
   * Measure an element with `getBoundingClientRect` inside the page, NOT with Playwright's
   * `boundingBox()`.
   *
   * Measured here: `boundingBox()` intermittently reports `width: 0` for Leaflet's image
   * overlay and for its SVG handles — the first call was right and the next returned zero.
   * Every click then lands at `box.x`, i.e. the left edge, and the whole walk silently
   * measures the same point over and over. `getBoundingClientRect` returns the real box
   * every time.
   */
  const measure = (selector, index) => page.evaluate(([sel, i]) => {
    const element = document.querySelectorAll(sel)[i];
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }, [selector, index]);
  const rectOf = async (selector, index = 0) => {
    let rect = null;
    // Leaflet appends the overlay <img> before the blob has loaded and before it sizes it,
    // so the element EXISTS with a zero-width box for a moment. Clicking against that box
    // puts every click on the left edge and the walk silently measures the same point over
    // and over — which is exactly what happened while writing this.
    await waitForCondition(`${selector}[${index}] tiene tamaño`, async () => {
      rect = await measure(selector, index);
      return !!rect && rect.width > 0 && rect.height > 0;
    });
    return rect;
  };
  const centreOf = async (selector, index = 0) => {
    const rect = await rectOf(selector, index);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  /** Screen coordinates of a normalized point on the map image. */
  const mapPoint = async (nx, ny) => {
    const box = await rectOf('.world-map-image');
    return { x: box.x + nx * box.width, y: box.y + ny * box.height };
  };
  const clickMap = async (nx, ny) => {
    const at = await mapPoint(nx, ny);
    await page.mouse.click(at.x, at.y);
  };

  // Uncalibrated: the bar says so rather than showing a fabricated distance.
  await page.getByTestId('map-no-scale').waitFor({ timeout: 30_000 });

  // Calibrate by drawing a segment across the full width and calling it 400 km.
  await page.getByTestId('map-calibrate').click();
  await page.getByTestId('map-calibration-panel').waitFor({ timeout: 30_000 });
  // React owns this element's class attribute and Leaflet writes its own classes onto the
  // same element, so a className that varies with the tool wipes them — and with
  // `.leaflet-container` gone, Leaflet's `img { max-width: none !important }` goes too and
  // Tailwind's preflight collapses the map image to zero width. The map broke the instant
  // any tool was picked; this is the assertion that catches it coming back.
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-testid="world-map-canvas"]').classList.contains('leaflet-container')),
    true,
    'picking a tool must not strip Leaflet\'s classes from its container',
  );
  await clickMap(0.02, 0.5);
  await clickMap(0.98, 0.5);
  // 0.96 of the width called 384 km implies a map exactly 400 km across. The point of
  // calibrating on an inset segment rather than edge to edge is that this is what an
  // author actually does: they trace the scale bar printed on their own map.
  await page.getByTestId('map-calibration-distance').fill('384');
  await page.getByTestId('map-calibration-save').click();
  await waitForCondition('la calibración se guarda como DOS puntos separados', () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    // A separation is part of the claim: two identical endpoints store fine and leave the
    // map uncalibrated, which is exactly the failure this walk exists to catch.
    return map?.scaleDistance === 384 && map?.scaleUnit === 'km'
      && map?.scaleX0 != null && map?.scaleX1 != null && Math.abs(map.scaleX1 - map.scaleX0) > 0.5;
  }));
  // The click landed where it looked like it landed: a 0.02→0.98 segment called 384 km
  // implies a map 400 km wide, which is what the summary must say. A click that missed by
  // more than a pixel or two moves this number, so it is the real proof that the
  // normalized coordinate the app stored is the point the mouse was over.
  // The DB write and the React re-render are two separate events, so wait for the panel
  // rather than reading it the instant the row lands.
  // `textContent`, not `innerText`: the panel scrolls, and innerText only returns what is
  // currently laid out — the heading came back alone while the sentence under it existed.
  let scaleSummary = '';
  await waitForCondition('el panel muestra la anchura implícita', async () => {
    scaleSummary = (await page.getByTestId('map-scale-summary').textContent()) ?? '';
    return /km/.test(scaleSummary);
  });
  assert.match(scaleSummary, /39[89] km|40[0-2] km/, `the implied width is ~400 km, got: ${scaleSummary}`);
  assert.equal(await page.getByTestId('map-no-scale').count(), 0, 'the bar stops saying "sin escala"');

  // Pin a place, and check the click position round-trips through the stored coordinates.
  await page.getByTestId('world-map-tool-pin').click();
  await clickMap(0.25, 0.25);
  await page.getByTestId('map-marker-sheet').waitFor({ timeout: 30_000 });
  const pinned = await page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    const [marker] = await window.nodus.listMapMarkers(map.mapId);
    return { x: marker.x, y: marker.y };
  });
  assert.ok(Math.abs(pinned.x - 0.25) < 0.02, `pin x lands where it was clicked: ${pinned.x}`);
  assert.ok(Math.abs(pinned.y - 0.25) < 0.02, `pin y lands where it was clicked: ${pinned.y}`);
  await page.getByTestId('map-marker-place').selectOption({ label: 'Vael' });
  await waitForCondition('la chincheta queda vinculada al lugar', () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    const [marker] = await window.nodus.listMapMarkers(map.mapId);
    return marker.placeName === 'Vael';
  }));

  // The ladder: point → circle → editable shape, keeping the place through both steps.
  await page.getByTestId('map-marker-to-circle').click();
  // Give it a radius that is actually visible before converting. The seeded circle is a
  // few kilometres across, which at this zoom is ~25 px — smaller than the vertex and
  // midpoint handles, so every handle sits on top of its neighbours and a click cannot
  // pick one. (That is a real limitation of editing a tiny shape zoomed out; the author's
  // answer is to zoom in, and this walk's answer is to make the shape big.)
  await page.getByTestId('map-marker-radius').fill('60');
  await page.getByTestId('map-marker-radius').blur();
  await waitForCondition('el círculo toma el radio escrito en km', () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    const [marker] = await window.nodus.listMapMarkers(map.mapId);
    return marker.radius != null && Math.abs(marker.radius - 0.15) < 0.01;
  }));
  await page.getByTestId('map-marker-to-polygon').click();
  await waitForCondition('el círculo se convierte en forma conservando su lugar', () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    const [marker] = await window.nodus.listMapMarkers(map.mapId);
    return marker.geometryKind === 'polygon' && (marker.points?.length ?? 0) >= 3 && marker.placeName === 'Vael';
  }));

  const vertexCount = () => page.locator('.world-map-vertex').count();
  const storedPoints = () => page.evaluate(async () => {
    const [map] = await window.nodus.listWorldMaps();
    const [marker] = await window.nodus.listMapMarkers(map.mapId);
    return marker.points;
  });
  await page.locator('.world-map-vertex').first().waitFor({ timeout: 30_000 });
  const seededVertices = await vertexCount();
  assert.ok(seededVertices >= 3, `the outline is seeded around the circle: ${seededVertices}`);

  // DRAG a vertex — the gesture no synthetic event could reproduce faithfully.
  //
  // Note what this does NOT prove: the stale-ref bug (the shape moved on screen, the
  // gesture committed once, and the ORIGINAL outline was written back) does not reproduce
  // here, because Playwright's stepped drag leaves enough time between the last mousemove
  // and the mouseup for React to flush. That invariant is pinned in
  // scripts/test-world-map-markers-ui.mjs instead. What this proves is the other half:
  // that a real drag reaches Leaflet, passes the threshold, and saves.
  const before = await storedPoints();
  const handleAt = await centreOf('.world-map-vertex');
  const target = await mapPoint(0.72, 0.18);
  await page.mouse.move(handleAt.x, handleAt.y);
  await page.mouse.down();
  // Several steps, so Leaflet sees real mousemoves and the 4px drag threshold is passed.
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  let afterDrag = before;
  await waitForCondition('arrastrar un vértice GUARDA la forma movida', async () => {
    afterDrag = await storedPoints();
    // A drag MOVES one vertex: same count, different position. A changed count means the
    // gesture grabbed a midpoint handle instead, which is a different bug.
    if (afterDrag.length !== before.length) return false;
    return afterDrag.some((point, index) =>
      Math.abs(point.x - before[index].x) > 0.02 || Math.abs(point.y - before[index].y) > 0.02);
  });
  assert.equal(afterDrag.length, before.length, `a drag moves a vertex, it does not add or remove one: ${before.length} → ${afterDrag.length}`);

  // ADD one by dragging a midpoint, and REMOVE one with Alt+click. Both are single
  // gestures whose only proof is the vertex count changing in the database.
  const midAt = await centreOf('.world-map-midpoint');
  await page.mouse.move(midAt.x, midAt.y);
  await page.mouse.down();
  await page.mouse.move(midAt.x + 30, midAt.y + 20, { steps: 6 });
  await page.mouse.up();
  await waitForCondition('arrastrar un punto intermedio añade un vértice', async () =>
    (await storedPoints()).length === afterDrag.length + 1);
  // The IPC write can finish before React has replaced Leaflet's old layer group. Wait
  // for the handles too, or the next gesture can land on a detached vertex on a slow CI
  // runner even though the database already contains the inserted point.
  await waitForCondition('la capa editable refleja el vértice añadido', async () =>
    (await vertexCount()) === afterDrag.length + 1);

  const beforeDelete = (await storedPoints()).length;
  // Pick a vertex whose centre is actually HIT-TESTABLE as a vertex. Handles and midpoints
  // are drawn a few pixels apart, so a blind index can land on a midpoint and the gesture
  // does nothing — a flake, and the reason the midpoint handler now ignores Alt too.
  let victimIndex = null;
  for (let index = 0; index < (await page.locator('.world-map-vertex').count()); index += 1) {
    const at = await centreOf('.world-map-vertex', index);
    const onTop = await page.evaluate(([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element ? element.getAttribute('class') ?? '' : '';
    }, [at.x, at.y]);
    if (onTop.includes('world-map-vertex')) { victimIndex = index; break; }
  }
  assert.notEqual(victimIndex, null, 'at least one vertex handle is reachable by the mouse');
  // Let Playwright hold Alt for the complete native pointer gesture. Splitting keyboard
  // and mouse commands can lose the modifier when Electron processes a focus transition.
  await page.locator('.world-map-vertex').nth(victimIndex).click({ modifiers: ['Alt'] });
  await waitForCondition('Alt+clic elimina un vértice', async () => (await storedPoints()).length === beforeDelete - 1);

  // Measuring, with the travel modes seeded on first use.
  await page.getByTestId('world-map-tool-measure').click();
  await page.getByTestId('map-ruler-panel').waitFor({ timeout: 30_000 });
  await clickMap(0.1, 0.5);
  await clickMap(0.6, 0.5);
  const rulerText = await page.getByTestId('map-ruler-panel').innerText();
  // Half the width of a ~400 km map, measured along the equator of the image.
  assert.match(rulerText, /19[0-9] km|20[0-9] km/, `the ruler measures the ground, not the pixels: ${rulerText}`);
  assert.match(rulerText, /A caballo/, 'and answers in days of travel, which is why a writer opens it');
  await page.getByTestId('world-map-tool-measure').click();

  // The reports read the whole cast when none is selected, and stay quiet about what they
  // cannot know rather than inventing a warning.
  await page.getByTestId('map-reports-panel').waitFor({ timeout: 30_000 });
  // textContent again: the side panel scrolls, so innerText only returns the part that
  // happens to be laid out.
  const reports = (await page.getByTestId('map-reports-panel').textContent()) ?? '';
  assert.match(reports, /Viajes imposibles/);
  assert.match(reports, /Encuentros posibles/);
  console.log('[e2e] worldbuilding maps: upload, calibration, pins, vertex editing and measuring work on the real canvas');


  // Hand the empty study-demo vault back to the genealogy checks below.
  await page.evaluate(async (id) => {
    const switched = await window.nodus.switchVault(id);
    if (!switched.ok) throw new Error(switched.message);
  }, studyDemoVaultId);
  await page.reload();

  // The empty study-demo vault can now host the genealogy fixture without
  // disturbing earlier checks. Verify the real SVG renderer, including custom
  // user colours and recalculation when the focus changes to the co-parent.
  await page.evaluate(async () => {
    await window.nodus.seedGenealogyDemoData();
    await window.nodus.updateSettings({
      genealogyTourComplete: true,
      treeFocusPersonId: 'demo-p5',
      treePaternalColor: '#204060',
      treeMaternalColor: '#c080a0',
    });
  });
  await page.reload();
  await page.locator('[data-tour="nav-tree"]').click();
  await page.getByTestId('tree-pan-viewport').waitFor({ timeout: 30_000 });
  const expectedMergedTreeColor = await page.evaluate(() => document.documentElement.classList.contains('light') ? '#706080' : '#988da4');
  assert.equal(await page.locator('[data-tree-line-role="parental_merge"]').first().getAttribute('stroke'), expectedMergedTreeColor, 'the joined parental trunk mixes the configured paternal and maternal colours');
  assert.equal(await page.locator('[data-tree-line-role="focus_descendants"]').count(), 2, 'genealogy gold continues from the focused person through every recorded descendant generation');
  assert.deepEqual(await page.locator('[data-tree-line-role="focus_descendants"]').evaluateAll((lines) => lines.map((line) => line.getAttribute('stroke'))), ['#ca8a04', '#ca8a04'], 'every focused descendant trunk uses genealogy gold');
  await page.locator('[data-tree-person-id="demo-p5"]').click();
  await page.getByTestId('tree-person-sidebar').waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('tree-person-sidebar').getAttribute('data-person-id'), 'demo-p5', 'a single person click opens its right sidebar');
  await page.getByTestId('tree-person-sidebar').getByRole('button', { name: 'Cerrar' }).click();
  await page.locator('[data-tree-person-id="demo-p7"]').dblclick();
  await waitForCondition('doble clic centra el árbol en la persona', () => page.evaluate(async () => (await window.nodus.getSettings()).treeFocusPersonId === 'demo-p7'));
  assert.equal(await page.getByTestId('tree-focus-person').inputValue(), 'demo-p7', 'double click updates the visible tree focus');
  await page.getByTestId('tree-focus-person').selectOption('demo-p7');
  await page.waitForFunction(() => document.querySelector('[data-tree-line-role="focus_descendants"]')?.getAttribute('stroke') === '#ca8a04');
  assert.equal(await page.locator('[data-tree-line-role="focus_descendants"]').count(), 2, 'the complete gold descendant line follows the newly focused co-parent');
  console.log('[e2e] genealogy person click sidebar + double-click focus + branch colours rendered and recalculated');
  if (process.env.NODUS_E2E_TREE_ONLY === '1') {
    assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
    await closeElectronApp(app); app = null;
    await rm(userData, { recursive: true, force: true });
    console.log('[e2e] focused genealogy tree interactions passed');
    process.exit(0);
  }

  // Timeline filters are true multiselects, and person mentions across both the
  // timeline and map open the exact same full-record dossier.
  await page.locator('[data-tour="nav-timeline"]').click();
  await page.getByTestId('timeline-person-filter').waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    window.__timelinePopoverMountPositions = [];
    window.__timelinePopoverObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('person-multi-select-popover')) {
            window.__timelinePopoverMountPositions.push(getComputedStyle(node).position);
          }
        }
      }
    });
    window.__timelinePopoverObserver.observe(document.body, { childList: true });
  });
  await page.getByTestId('timeline-person-filter').getByRole('button').click();
  const peopleChecks = page.locator('.person-multi-select-popover input[type="checkbox"]');
  await peopleChecks.nth(0).check();
  await peopleChecks.nth(1).check();
  assert.equal(await page.locator('.person-multi-select-popover input[type="checkbox"]:checked').count(), 2, 'timeline person filter accepts multiple values');
  await page.keyboard.press('Escape');
  await page.getByTestId('timeline-type-filter').getByRole('button').click();
  const typeChecks = page.locator('.person-multi-select-popover input[type="checkbox"]');
  await typeChecks.nth(0).check();
  await typeChecks.nth(1).check();
  assert.equal(await page.locator('.person-multi-select-popover input[type="checkbox"]:checked').count(), 2, 'timeline type filter accepts multiple values');
  await page.keyboard.press('Escape');
  const timelinePopoverMountPositions = await page.evaluate(() => {
    window.__timelinePopoverObserver?.disconnect();
    return window.__timelinePopoverMountPositions;
  });
  assert.deepEqual(timelinePopoverMountPositions, ['fixed', 'fixed'], 'timeline dropdowns mount already positioned and never flash through document layout');
  await page.locator('[data-timeline-person-id]').first().click();
  await page.getByTestId('person-dossier-modal').waitFor({ timeout: 30_000 });
  await page.getByTestId('person-dossier-modal').getByRole('button', { name: 'Cerrar' }).click();

  await page.locator('[data-tour="nav-map"]').click();
  await page.getByTestId('places-map').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="places-map"] > div')?.getAttribute('data-map-fit') === 'ready');
  const fittedMapZoom = Number(await page.locator('[data-testid="places-map"] > div').getAttribute('data-map-zoom'));
  assert.ok(fittedMapZoom > 2, `genealogy map fits its regional points instead of staying at world zoom (${fittedMapZoom})`);
  await page.getByTestId('map-person-filter').getByRole('button').first().click();
  await page.getByTestId('map-person-filter-dropdown').waitFor({ timeout: 30_000 });
  const dropdownIsTopmost = await page.getByTestId('map-person-filter-dropdown').evaluate((dropdown) => {
    const bounds = dropdown.getBoundingClientRect();
    const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + Math.min(24, bounds.height / 2));
    return topmost != null && dropdown.contains(topmost);
  });
  assert.equal(dropdownIsTopmost, true, 'map person dropdown stays above Leaflet layers');
  await page.keyboard.press('Escape');
  await page.locator('.pm-marker [data-person-id]').first().click({ force: true });
  await page.getByTestId('person-dossier-modal').waitFor({ timeout: 30_000 });
  const dossierCoversMapToolbar = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="map-toolbar"]');
    const modal = document.querySelector('[data-testid="person-dossier-modal"]');
    if (!(toolbar instanceof HTMLElement) || !(modal instanceof HTMLElement)) return false;
    const bounds = toolbar.getBoundingClientRect();
    const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return topmost != null && modal.contains(topmost);
  });
  assert.equal(dossierCoversMapToolbar, true, 'person dossier fully covers the map toolbar');
  await page.getByTestId('person-dossier-modal').getByRole('button', { name: 'Cerrar' }).click();
  console.log('[e2e] genealogy timeline multiselects + shared dossier from timeline and map work');

  // ── No uncaught renderer errors during startup ──────────────────────────────
  assert.deepEqual(
    pageErrors.map((e) => String(e?.message ?? e)),
    [],
    'renderer produced uncaught errors'
  );
  console.log('[e2e] no renderer page errors');

  await closeElectronApp(app);
  app = null;

  // ── DB migrated to the current schema ───────────────────────────────────────
  const dbFile = await findSqlite(userData);
  assert.ok(dbFile, 'app created a SQLite database');
  const Database = require('better-sqlite3');
  const db = new Database(dbFile, { readonly: true });
  const version = db.pragma('user_version', { simple: true });
  const imageTable = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'decorative_images'").get();
  db.close();
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const expected = Number(source.match(/export const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.equal(version, expected, `DB migrated to schema v${expected}`);
  assert.equal(imageTable?.ok, 1, 'decorative_images table exists');
  console.log(`[e2e] database at schema v${version}`);

  console.log('e2e smoke test passed');
} finally {
  if (app) await closeElectronApp(app);
  await rm(userData, { recursive: true, force: true });
  await new Promise((resolve) => zoteroApiServer.close(resolve));
}

/** First .sqlite file under the profile dir (vault registry decides the layout). */
async function findSqlite(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.sqlite')) return path.join(e.parentPath ?? e.path, e.name);
  }
  return null;
}
