import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-library-ui-'));
const userData = path.join(testRoot, 'profile');
const backupRoot = path.join(testRoot, 'backups');
const screenshotPath = path.join(os.tmpdir(), 'nodus-global-library-e2e.png');
const itemId = 'zotero:E7FGXJFE';
const storageId = 'E7FGXJFE';
const pendingItemId = 'nodus:E2E-PENDING-READING';
const pendingStorageId = 'E2E-PENDING-READING';
// A port with nothing listening on it is a closed Zotero, which is both the
// commonest way this dialog fails and the one thing the run cannot control: without
// this, the test passed or skipped its Zotero assertions depending on whether the
// developer happened to have Zotero open.
const deadZoteroPort = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const childEnv = {
  ...process.env,
  NODUS_ZOTERO_API_BASE: `http://127.0.0.1:${deadZoteroPort}/api`,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timer;
  const closed = instance.close().then(() => true, () => false);
  const clean = await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]);
  clearTimeout(timer);
  if (!clean && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

async function hoverUntilTooltip(page, buttonTestId, tooltip) {
  // These tooltips are pure CSS `:hover`, and Chromium only recomputes the hover
  // chain when the pointer moves. A re-render of the scope switcher right after
  // the pointer lands leaves the element unhovered with no event to fix it, so
  // move the pointer away and back instead of waiting the state out.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByTestId(buttonTestId).hover();
    try {
      await tooltip.waitFor({ state: 'visible', timeout: 2_000 });
      return;
    } catch {
      await page.mouse.move(4, 4);
    }
  }
  await page.getByTestId(buttonTestId).hover();
  await tooltip.waitFor({ state: 'visible' });
}

async function writePendingReadingFixture(collectionId, now) {
  const pendingItemFolder = path.join(backupRoot, 'nodus-library', pendingStorageId);
  const pendingMarkdown = [
    '# Lectura pendiente E2E',
    '',
    'Este documento se prepara mientras su panel de detalle permanece abierto. La prueba conserva la selección durante toda la extracción y comprueba que la interfaz recibe el resultado sin cambiar de sección.',
    '',
    'Cuando finaliza el trabajo en segundo plano, tanto la fila del catálogo como la acción principal del panel deben indicar inmediatamente que la lectura está disponible.',
    '',
  ].join('\n');
  await mkdir(pendingItemFolder, { recursive: true });
  await writeFile(path.join(pendingItemFolder, 'original.md'), pendingMarkdown, 'utf8');
  await writeFile(path.join(pendingItemFolder, 'annotations.json'), '[]\n', 'utf8');
  await writeFile(path.join(pendingItemFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1, id: pendingItemId, storageId: pendingStorageId,
    source: 'nodus', sourceLibraryId: null, sourceKey: null,
    metadata: {
      title: 'Lectura pendiente E2E', itemType: 'document', creators: [],
      date: '2026', year: 2026, isbn: [], issn: [], tags: [],
    },
    collectionIds: [collectionId],
    attachments: [{
      id: 'nodus:E2E-PENDING-ATTACHMENT', title: 'Original Markdown', fileName: 'original.md',
      relativePath: 'original.md', mimeType: 'text/markdown', byteSize: Buffer.byteLength(pendingMarkdown),
      sha256: 'c'.repeat(64), role: 'original',
    }],
    files: { original: 'original.md', annotations: 'annotations.json' },
    extraction: { status: 'pending' },
    createdAt: now, deletedAt: null,
    clock: { deviceId: 'e2e-device-0001', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'd'.repeat(64) },
  }, null, 2)}\n`, 'utf8');
}

try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1540, height: 940 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const collections = await page.evaluate(async ({ version, backup }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999,
      tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', mascotStyle: 'orb',
      mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true, autoBackupFolder: backup,
    });
    await window.nodus.getGlobalLibraryStatus();
    const root = await window.nodus.createGlobalLibraryCollection('Historia contemporánea', null);
    const child = await window.nodus.createGlobalLibraryCollection('Mujeres y posguerra', root.id);
    const draggable = await window.nodus.createGlobalLibraryCollection('Por clasificar', null);
    const disposable = await window.nodus.createGlobalLibraryCollection('Colección temporal', null);
    return { root, child, draggable, disposable };
  }, { version: require(path.join(repoRoot, 'package.json')).version, backup: backupRoot });
  console.log('[global-library-e2e] profile and nested collections ready');

  const itemFolder = path.join(backupRoot, 'nodus-library', storageId);
  const now = new Date().toISOString();
  const markdown = '# Mujeres solas en la posguerra\n\n## Introducción\n\nTexto limpio de una fuente histórica.\n';
  await mkdir(itemFolder, { recursive: true });
  await writeFile(path.join(itemFolder, 'reader.md'), markdown, 'utf8');
  await writeFile(path.join(itemFolder, 'original.md'), markdown, 'utf8');
  await writeFile(path.join(itemFolder, 'annotations.json'), '[]\n', 'utf8');
  await writeFile(path.join(itemFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1, id: itemId, storageId,
    source: 'zotero', sourceLibraryId: 'users/0', sourceKey: storageId,
    metadata: {
      title: 'Mujeres solas en la posguerra', itemType: 'article-journal',
      creators: [{ creatorType: 'author', firstName: 'María', lastName: 'Aliaga' }],
      date: '2017', year: 2017, publicationTitle: 'Arenal', doi: '10.0000/nodus.fixture',
      url: 'https://doi.org/10.0000/nodus.fixture',
      isbn: [], issn: ['1134-6396'], tags: ['mujeres', 'posguerra'],
      abstract: 'Resumen de prueba para comprobar el panel de metadatos.',
    },
    collectionIds: [collections.child.id],
    attachments: [{
      id: 'zotero:ATTACHMENT', title: 'Texto completo', fileName: 'original.md',
      relativePath: 'original.md', mimeType: 'text/markdown', byteSize: Buffer.byteLength(markdown),
      sha256: 'a'.repeat(64), role: 'original',
    }],
    files: { original: 'original.md', reader: 'reader.md', annotations: 'annotations.json' },
    extraction: { status: 'ready', engineVersion: 'e2e', completedAt: now },
    createdAt: now, deletedAt: null,
    clock: { deviceId: 'e2e-device-0001', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'b'.repeat(64) },
  }, null, 2)}\n`, 'utf8');
  const syncFolder = path.join(backupRoot, 'nodus-library', '.nodus', 'zotero-sync');
  await mkdir(syncFolder, { recursive: true });
  await writeFile(path.join(syncFolder, 'e2e-interrupted.json'), `${JSON.stringify({
    format: 'nodus.zotero-sync', formatVersion: 1, id: 'e2e-interrupted', status: 'failed',
    selection: { libraryIds: ['users/0'], copyAttachments: true, includeUnfiled: true },
    progress: {
      requestId: 'e2e-interrupted', phase: 'failed', libraryId: null, libraryName: null,
      processedItems: 12, totalItems: 20, processedAttachments: 4, totalAttachments: 9,
      percent: 100, message: 'Zotero was closed; local progress is retained.',
    },
    report: null, startedAt: now, updatedAt: now, error: 'Zotero was closed.',
  }, null, 2)}\n`, 'utf8');

  await page.evaluate(() => window.nodus.rebuildGlobalLibrary());
  console.log('[global-library-e2e] fixture catalog rebuilt');
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const updateModal = page.getByTestId('startup-update-modal');
  // The update status arrives asynchronously after the root mounts. Give the
  // optional modal a chance to attach before deciding there is nothing to dismiss.
  await updateModal.waitFor({ state: 'attached', timeout: 2_000 }).catch(() => {});
  if (await updateModal.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }
  await page.locator('[data-tour="nav-library"]').click();
  // The academic Library walkthrough remains available explicitly; its backdrop
  // owns pointer events only after the user opens help.
  const libraryTutorial = page.getByTestId('library-tutorial-modal');
  assert.equal(await libraryTutorial.count(), 0, 'academic library walkthrough is opt-in');
  await page.getByTestId('library-open-tutorial').click();
  await libraryTutorial.waitFor({ state: 'visible' });
  await page.getByTestId('library-tutorial-close').click();
  await libraryTutorial.waitFor({ state: 'detached' });
  const scopeSwitcher = page.getByTestId('library-scope-switcher');
  await scopeSwitcher.waitFor({ state: 'visible' });
  assert.equal(await scopeSwitcher.getAttribute('data-scope-placement'), 'content-header');
  const vaultScopeLayout = await page.evaluate(() => {
    const switcher = document.querySelector('[data-testid="library-scope-switcher"]');
    const header = document.querySelector('[data-testid="library-vault-header"]');
    const shell = document.querySelector('[data-testid="library-scope-shell"]');
    if (!(switcher instanceof HTMLElement) || !(header instanceof HTMLElement) || !(shell instanceof HTMLElement)) throw new Error('Vault scope layout not found');
    const switcherRect = switcher.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    return {
      inHeader: header.contains(switcher),
      switcherWidth: switcherRect.width,
      shellWidth: shellRect.width,
      headerHeight: headerRect.height,
      fullWidth: Math.abs(headerRect.left - shellRect.left) < 0.5 && Math.abs(headerRect.right - shellRect.right) < 0.5,
      aligned: switcherRect.top >= headerRect.top && switcherRect.bottom <= headerRect.bottom,
      centerDelta: Math.abs((switcherRect.left + switcherRect.right) / 2 - (headerRect.left + headerRect.right) / 2),
    };
  });
  assert.equal(vaultScopeLayout.inHeader, true, 'This vault keeps scope controls inside its content header');
  assert.equal(vaultScopeLayout.aligned, true, 'This vault scope controls align with the header actions');
  assert.equal(vaultScopeLayout.fullWidth, true, 'This vault header spans the same full content width as Global');
  assert.ok(vaultScopeLayout.centerDelta < 1, `This vault scope controls are centered in the complete header (${JSON.stringify(vaultScopeLayout)})`);
  assert.ok(vaultScopeLayout.switcherWidth < Math.min(300, vaultScopeLayout.shellWidth * 0.4), `scope controls remain compact (${JSON.stringify(vaultScopeLayout)})`);
  const vaultScopeTooltip = page.getByTestId('library-scope-vault-tooltip');
  assert.equal(await vaultScopeTooltip.isVisible(), false, 'scope help is not persistent');
  await hoverUntilTooltip(page, 'library-scope-vault', vaultScopeTooltip);
  assert.match(await vaultScopeTooltip.innerText(), /colecciones|collections/i, 'This vault explanation appears on hover');
  assert.equal(await page.getByTestId('library-scope-vault').getAttribute('aria-pressed'), 'true', 'a v3-style profile starts in the unchanged vault corpus');
  const vaultSearch = page.getByTestId('library-vault-search');
  const vaultFiltersToggle = page.getByTestId('library-vault-filters-toggle');
  await vaultSearch.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-vault-filters-panel').count(), 0, 'secondary filters start collapsed');
  const vaultFilterGeometry = await page.evaluate(() => {
    const search = document.querySelector('[data-testid="library-vault-search"]');
    const card = search?.closest('.card');
    if (!(search instanceof HTMLElement) || !(card instanceof HTMLElement)) throw new Error('Vault search surface not found');
    return { searchWidth: search.getBoundingClientRect().width, cardWidth: card.getBoundingClientRect().width };
  });
  assert.ok(vaultFilterGeometry.searchWidth > vaultFilterGeometry.cardWidth * 0.7, `search owns the filter row (${JSON.stringify(vaultFilterGeometry)})`);
  await vaultFiltersToggle.click();
  await page.getByTestId('library-vault-filters-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-vault-filters-dark-wide.png'), fullPage: true });

  // The filters are a balloon anchored to their button: a three-position switch per
  // analysis condition, closed by clicking elsewhere, never reopened by itself.
  const ideasSwitch = page.getByTestId('library-status-switch-ideas');
  assert.equal(await ideasSwitch.getAttribute('data-state'), 'off');
  await ideasSwitch.getByRole('radio', { name: 'Ideas extraídas', exact: true }).click();
  assert.equal(await ideasSwitch.getAttribute('data-state'), 'pos');
  await ideasSwitch.getByRole('radio', { name: 'Sin ideas extraídas', exact: true }).click();
  assert.equal(await ideasSwitch.getAttribute('data-state'), 'neg');
  await ideasSwitch.getByRole('radio', { name: 'Indiferente', exact: true }).click();
  assert.equal(await ideasSwitch.getAttribute('data-state'), 'off');
  const unstartedFilter = page.getByRole('button', { name: 'Sin analizar', exact: true });
  await unstartedFilter.click();
  await page.locator('[data-tour="nav-home"]').click();
  await page.locator('[data-tour="nav-library"]').click();
  assert.equal(await page.getByTestId('library-vault-filters-panel').count(), 0, 'the filter balloon closes when the section is left');
  await vaultFiltersToggle.click();
  await page.getByTestId('library-vault-filters-panel').waitFor({ state: 'visible' });
  assert.match(await unstartedFilter.getAttribute('class'), /is-active/, 'an active Library filter survives leaving the section');
  await unstartedFilter.click();
  await page.locator('[data-tour="nav-home"]').click();
  await page.locator('[data-tour="nav-library"]').click();
  await vaultFiltersToggle.click();
  await page.getByTestId('library-vault-filters-panel').waitFor({ state: 'visible' });
  assert.doesNotMatch(await unstartedFilter.getAttribute('class'), /is-active/, 'an explicitly removed Library filter stays removed');
  await page.getByTestId('library-vault-search').click();
  assert.equal(await page.getByTestId('library-vault-filters-panel').count(), 0, 'clicking elsewhere closes the balloon');
  await page.getByTestId('library-collections-menu-toggle').click();
  await page.getByTestId('library-collections-menu').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('open-nodus-collections').innerText(), /Colecciones de Nodus[\s\S]*Global/);
  assert.match(await page.getByTestId('open-zotero-collections').innerText(), /Colecciones de Zotero[\s\S]*Este vault/);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-sources-dark-wide.png'), fullPage: true });
  await page.getByTestId('library-collections-menu-toggle').click();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-vault-dark-wide.png'), fullPage: true });
  await page.getByTestId('library-scope-global').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(160);
  const library = page.getByTestId('global-library-view');
  await library.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-scope-global').getAttribute('aria-pressed'), 'true');
  const globalScopeLayout = await page.evaluate(() => {
    const switcher = document.querySelector('[data-testid="library-scope-switcher"]');
    const header = document.querySelector('[data-testid="global-library-header"]');
    const shell = document.querySelector('[data-testid="library-scope-shell"]');
    if (!(switcher instanceof HTMLElement) || !(header instanceof HTMLElement) || !(shell instanceof HTMLElement)) throw new Error('Global scope layout not found');
    const switcherRect = switcher.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    return {
      inHeader: header.contains(switcher),
      switcherWidth: switcherRect.width,
      shellWidth: shellRect.width,
      headerHeight: headerRect.height,
      fullWidth: Math.abs(headerRect.left - shellRect.left) < 0.5 && Math.abs(headerRect.right - shellRect.right) < 0.5,
      centerDelta: Math.abs((switcherRect.left + switcherRect.right) / 2 - (headerRect.left + headerRect.right) / 2),
    };
  });
  assert.equal(globalScopeLayout.inHeader, true, 'Global keeps scope controls inside its content header');
  assert.equal(globalScopeLayout.fullWidth, true, 'Global header spans the full content width');
  assert.ok(globalScopeLayout.centerDelta < 1, `Global scope controls are centered in the complete header (${JSON.stringify(globalScopeLayout)})`);
  assert.ok(Math.abs(globalScopeLayout.headerHeight - vaultScopeLayout.headerHeight) < 0.5, `Global and This-vault headers share a height (${globalScopeLayout.headerHeight}px / ${vaultScopeLayout.headerHeight}px)`);
  assert.ok(globalScopeLayout.switcherWidth < Math.min(300, globalScopeLayout.shellWidth * 0.4), `Global scope controls remain compact (${JSON.stringify(globalScopeLayout)})`);
  const globalScopeTooltip = page.getByTestId('library-scope-global-tooltip');
  assert.equal(await globalScopeTooltip.isVisible(), false, 'Global help is not persistent');
  await hoverUntilTooltip(page, 'library-scope-global', globalScopeTooltip);
  assert.match(await globalScopeTooltip.innerText(), /Markdown/i, 'Global explanation appears on hover');
  const scopeSettings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(scopeSettings.libraryGlobalEnabled, true, 'global activation is opt-in');
  assert.equal(scopeSettings.libraryScope, 'global', 'the chosen scope is remembered');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-global-dark-wide.png'), fullPage: true });
  await page.getByTestId('open-global-library-settings').click();
  const librarySettingsDialog = page.getByTestId('global-library-settings-dialog');
  await librarySettingsDialog.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-auto-rename-attachments').getAttribute('aria-checked'), 'true', 'automatic attachment naming is enabled by default');
  assert.equal(await page.getByTestId('library-rename-template').inputValue(), 'creator-year-title', 'the Zotero-style creator, year, title pattern is the default');
  assert.equal(await page.getByTestId('library-rename-type-pdf').getAttribute('aria-pressed'), 'true', 'PDF files are renamed by default');
  assert.equal(await page.getByTestId('library-rename-type-epub').getAttribute('aria-pressed'), 'true', 'EPUB files are renamed by default');
  assert.equal(await page.getByTestId('library-rename-type-other').getAttribute('aria-pressed'), 'false', 'supplementary file types keep their informative names by default');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-settings-dark-wide.png'), fullPage: true });
  await librarySettingsDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await librarySettingsDialog.waitFor({ state: 'detached' });
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  await page.setViewportSize({ width: 1540, height: 940 });
  const lightRow = page.getByTestId(`global-library-item-${itemId}`);
  await lightRow.hover();
  const lightPalette = await page.evaluate((id) => {
    const row = document.querySelector(`[data-testid="global-library-item-${id}"]`);
    const canvas = document.querySelector('[data-testid="global-library-view"]');
    const scope = document.querySelector('[data-testid="library-scope-switcher"]');
    const header = document.querySelector('[data-testid="global-library-header"]');
    if (!(row instanceof HTMLElement) || !(canvas instanceof HTMLElement) || !(scope instanceof HTMLElement) || !(header instanceof HTMLElement)) throw new Error('Library surfaces not found');
    return {
      row: getComputedStyle(row).backgroundColor,
      canvas: getComputedStyle(canvas).backgroundColor,
      header: getComputedStyle(header).backgroundColor,
      scope: getComputedStyle(scope).backgroundColor,
    };
  }, itemId);
  const rgb = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  assert.ok(rgb(lightPalette.row).every((channel) => channel >= 240), `a hovered light row stays pale (${JSON.stringify(lightPalette)})`);
  assert.ok(lightPalette.header === 'rgba(0, 0, 0, 0)' || rgb(lightPalette.header).every((channel) => channel >= 240), `Library header remains transparent or pale over the light canvas (${JSON.stringify(lightPalette)})`);
  assert.ok(rgb(lightPalette.scope).every((channel) => channel >= 238), `compact scope control uses a light surface (${JSON.stringify(lightPalette)})`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-global-light-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  const narrowGlobalScopeLayout = await page.evaluate(() => {
    const switcher = document.querySelector('[data-testid="library-scope-switcher"]');
    const header = document.querySelector('[data-testid="global-library-header"]');
    if (!(switcher instanceof HTMLElement) || !(header instanceof HTMLElement)) throw new Error('Narrow Global header not found');
    const switcherRect = switcher.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      insideHeader: switcherRect.left >= headerRect.left && switcherRect.right <= headerRect.right && switcherRect.bottom <= headerRect.bottom,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      centerDelta: Math.abs((switcherRect.left + switcherRect.right) / 2 - (headerRect.left + headerRect.right) / 2),
    };
  });
  assert.equal(narrowGlobalScopeLayout.insideHeader, true, `compact Global scope control must stay within a narrow header (${JSON.stringify(narrowGlobalScopeLayout)})`);
  assert.equal(narrowGlobalScopeLayout.pageOverflow, false, `compact Global scope control must not overflow the page (${JSON.stringify(narrowGlobalScopeLayout)})`);
  assert.ok(narrowGlobalScopeLayout.centerDelta < 1, `compact Global scope control remains centered (${JSON.stringify(narrowGlobalScopeLayout)})`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-global-light-narrow.png'), fullPage: true });
  await page.getByTestId('library-scope-vault').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="library-scope-shell"]')?.getAttribute('data-library-scope') === 'vault');
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  const narrowVaultScopeLayout = await page.evaluate(() => {
    const switcher = document.querySelector('[data-testid="library-scope-switcher"]');
    const header = document.querySelector('[data-testid="library-vault-header"]');
    if (!(switcher instanceof HTMLElement) || !(header instanceof HTMLElement)) throw new Error('Narrow This-vault header not found');
    const switcherRect = switcher.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      insideHeader: switcherRect.left >= headerRect.left && switcherRect.right <= headerRect.right && switcherRect.bottom <= headerRect.bottom,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      centerDelta: Math.abs((switcherRect.left + switcherRect.right) / 2 - (headerRect.left + headerRect.right) / 2),
    };
  });
  assert.equal(narrowVaultScopeLayout.insideHeader, true, `compact This-vault scope control must stay within a narrow header (${JSON.stringify(narrowVaultScopeLayout)})`);
  assert.equal(narrowVaultScopeLayout.pageOverflow, false, `compact This-vault scope control must not overflow the page (${JSON.stringify(narrowVaultScopeLayout)})`);
  assert.ok(narrowVaultScopeLayout.centerDelta < 1, `compact This-vault scope control remains centered (${JSON.stringify(narrowVaultScopeLayout)})`);
  const narrowVaultFilters = await page.evaluate(() => {
    const search = document.querySelector('[data-testid="library-vault-search"]');
    const toggle = document.querySelector('[data-testid="library-vault-filters-toggle"]');
    const card = search?.closest('.card');
    if (!(search instanceof HTMLElement) || !(toggle instanceof HTMLElement) || !(card instanceof HTMLElement)) throw new Error('Narrow vault filters not found');
    const searchRect = search.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      searchWidth: searchRect.width,
      insideCard: searchRect.left >= cardRect.left && toggleRect.right <= cardRect.right,
      overlap: searchRect.right > toggleRect.left,
    };
  });
  assert.equal(narrowVaultFilters.insideCard, true, `search and filters stay inside the narrow card (${JSON.stringify(narrowVaultFilters)})`);
  assert.equal(narrowVaultFilters.overlap, false, `search and filters do not overlap (${JSON.stringify(narrowVaultFilters)})`);
  assert.ok(narrowVaultFilters.searchWidth >= 180, `search remains usable at narrow width (${JSON.stringify(narrowVaultFilters)})`);
  await page.getByTestId('library-vault-filters-toggle').click();
  await page.getByTestId('library-vault-filters-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-vault-light-narrow.png'), fullPage: true });
  await page.getByTestId('library-scope-global').click();
  await library.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('global-library-view').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-scope-global').getAttribute('aria-pressed'), 'true', 'Global remains selected after a renderer restart');
  assert.equal(await page.getByTestId('library-add-menu-toggle').isVisible(), true, 'the toolbar has one progressive Add action');
  assert.equal(await page.getByTestId('open-zotero-global-import').innerText(), 'Sincronizar Zotero', 'Zotero remains a clear top-level action');
  assert.equal(await page.getByTestId('library-more-menu-toggle').isVisible(), true, 'maintenance is grouped into one overflow menu');
  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('library-add-menu').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-progressive-add-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  const lightAddMenu = await page.getByTestId('library-add-menu').evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  assert.ok((lightAddMenu.background.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []).every((channel) => channel >= 245), `Add menu uses a light surface (${JSON.stringify(lightAddMenu)})`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-progressive-add-light-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.getByTestId('library-add-menu-toggle').click();
  console.log('[global-library-e2e] global Library visible');

  const sidebarNavigation = page.getByTestId('library-sidebar-navigation');
  const collectionsPane = page.getByTestId('library-collections-pane');
  const sidebarResizer = page.getByTestId('library-sidebar-section-resizer');
  const trashSection = page.getByTestId('library-trash-section');
  const tableFooter = page.getByTestId('library-table-footer');
  const catalogScroll = page.getByTestId('library-catalog-scroll');
  const catalogList = page.locator('.library-catalog-list');
  await sidebarResizer.waitFor({ state: 'visible' });
  const beforeCollectionHeight = (await collectionsPane.boundingBox()).height;
  const resizeBox = await sidebarResizer.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + 72, { steps: 5 });
  await page.mouse.up();
  const afterCollectionHeight = (await collectionsPane.boundingBox()).height;
  assert.ok(afterCollectionHeight > beforeCollectionHeight + 40, `the splitter resizes the collection pane (${beforeCollectionHeight}px → ${afterCollectionHeight}px)`);
  assert.ok(Number(await page.evaluate(() => localStorage.getItem('nodus.library.collectionsPaneRatio'))) > 48, 'the splitter persists its ratio');
  const trashHeight = (await trashSection.boundingBox()).height;
  const tableFooterHeight = (await tableFooter.boundingBox()).height;
  assert.ok(Math.abs(trashHeight - tableFooterHeight) < 0.5, `trash and table footer have the same height (${trashHeight}px / ${tableFooterHeight}px)`);
  const horizontalScrollbarHeight = await catalogScroll.evaluate((element) => Number.parseFloat(getComputedStyle(element, '::-webkit-scrollbar').height));
  assert.ok(horizontalScrollbarHeight <= 4, `the catalogue scrollbar is no thicker than 4px (${horizontalScrollbarHeight}px)`);
  assert.equal(await catalogList.evaluate((element) => getComputedStyle(element).overflowX), 'hidden', 'virtualized rows do not create a duplicate horizontal scrollbar');
  assert.ok((await sidebarNavigation.boundingBox()).height > afterCollectionHeight, 'smart searches retain their own remaining scroll area');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-adjustable-sidebar-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-adjustable-sidebar-light-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.getByTitle('Nueva búsqueda inteligente').click();
  const smartSearch = page.getByTestId('library-smart-search-dialog');
  await smartSearch.waitFor({ state: 'visible' });
  await smartSearch.getByLabel('Nombre', { exact: true }).fill('Lecturas activas');
  await smartSearch.getByTestId('smart-search-preview').getByText('1 resultado(s)', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-smart-search-editor-dark-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-smart-search-editor-dark-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1540, height: 940 });
  await smartSearch.getByRole('button', { name: 'Guardar', exact: true }).click();
  await smartSearch.waitFor({ state: 'detached' });
  await page.getByText('Lecturas activas', { exact: true }).waitFor();
  await page.getByTestId('library-table-settings').click();
  const tablePreferences = page.getByTestId('library-table-preferences');
  await tablePreferences.waitFor({ state: 'visible' });
  await tablePreferences.getByRole('button', { name: 'Adjuntos', exact: true }).click();
  await tablePreferences.getByRole('button', { name: 'DOI', exact: true }).click();
  await tablePreferences.getByRole('button', { name: 'Edición', exact: true }).click();
  await tablePreferences.locator('[data-column-id="doi"]').dragTo(tablePreferences.locator('[data-column-id="title"]'));
  await tablePreferences.getByLabel('Ancho de columna Título', { exact: true }).fill('320');
  assert.deepEqual(await tablePreferences.locator('[data-testid="library-visible-column-order"] [data-column-id]').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getAttribute('data-column-id'))), ['doi', 'title'], 'columns can be reordered by drag and drop');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-columns-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-columns-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await tablePreferences.getByRole('button', { name: 'Guardar', exact: true }).click();
  await tablePreferences.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Adjuntos', exact: true }).first().waitFor();
  assert.deepEqual(await page.getByTestId('global-library-table-header').locator('button > span.truncate').evaluateAll((labels) => labels.slice(0, 2).map((label) => label.textContent?.trim())), ['DOI', 'Título'], 'the stored column order is rendered in the table');
  const searchLayout = await page.getByTestId('global-library-search').evaluate((input) => {
    const icon = input.parentElement?.querySelector('svg'); const inputBox = input.getBoundingClientRect(); const iconBox = icon?.getBoundingClientRect();
    return { paddingLeft: parseFloat(getComputedStyle(input).paddingLeft), iconRight: iconBox ? iconBox.right - inputBox.left : 0 };
  });
  assert.ok(searchLayout.paddingLeft >= searchLayout.iconRight + 4, `search text starts after its icon (${JSON.stringify(searchLayout)})`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-smart-search-dark-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-smart-search-dark-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.getByTestId('library-more-menu-toggle').click();
  await page.getByTestId('open-library-migration').click();
  const migrationDialog = page.getByTestId('library-migration-dialog');
  await migrationDialog.waitFor({ state: 'visible' });
  await migrationDialog.getByText('Creando inventario de solo lectura…').waitFor({ state: 'detached' });
  assert.ok(await migrationDialog.locator('input[type="checkbox"]:checked').count(), 'academic vaults are selected by default');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-migration-preview-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-migration-preview-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.getByTestId('start-library-migration').click();
  await migrationDialog.getByText('Migración verificada', { exact: true }).waitFor();
  const migrationSessions = await page.evaluate(() => window.nodus.listLibraryMigrationSessions());
  assert.equal(migrationSessions[0]?.status, 'completed');
  assert.equal(Object.values(migrationSessions[0]?.verification ?? {}).filter((value) => value === false).length, 0);
  await migrationDialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await migrationDialog.waitFor({ state: 'detached' });
  await page.getByText('Historia contemporánea', { exact: true }).waitFor();

  const trashFolder = page.getByTestId('open-library-trash');
  await trashFolder.waitFor({ state: 'visible' });
  const trashTreePlacement = await trashFolder.evaluate((trash) => {
    const collectionRows = [...document.querySelectorAll('[data-testid^="global-library-collection-"]')];
    return collectionRows.length > 0 && collectionRows.every((row) => Boolean(row.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert.equal(trashTreePlacement, true, 'trash is the terminal folder after every collection and subcollection');
  const darkTrashColor = await trashFolder.evaluate((element) => getComputedStyle(element).color);
  assert.equal(darkTrashColor, 'rgb(252, 165, 165)', 'trash has a restrained red tone in dark mode');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-tree-trash-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  const lightTrashColor = await trashFolder.evaluate((element) => getComputedStyle(element).color);
  assert.equal(lightTrashColor, 'rgb(185, 28, 28)', 'trash remains legible and red in light mode');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-tree-trash-light-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });

  const childEdit = page.getByTestId(`library-collection-edit-${collections.child.id}`);
  const childMove = page.getByTestId(`library-collection-move-${collections.child.id}`);
  const childDelete = page.getByTestId(`library-collection-delete-${collections.child.id}`);
  await childEdit.waitFor({ state: 'visible' });
  assert.equal(await childMove.count(), 1, 'every local subcollection exposes a move icon');
  assert.equal(await childDelete.count(), 1, 'every local subcollection exposes a delete icon');
  await childEdit.click();
  const renameDialog = page.getByRole('dialog').filter({ hasText: 'Renombrar colección' });
  await renameDialog.waitFor({ state: 'visible' });
  await renameDialog.locator('input').fill('Mujeres y posguerra revisada');
  await renameDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Mujeres y posguerra revisada', { exact: true }).waitFor();

  await page.getByTestId(`library-collection-style-${collections.child.id}`).click();
  const styleDialog = page.getByTestId('library-collection-style-dialog');
  await styleDialog.waitFor({ state: 'visible' });
  assert.equal(await styleDialog.locator('[data-testid^="library-collection-color-preset-"]').count(), 6, 'the style picker offers exactly six predefined colors');
  await styleDialog.getByTestId('library-collection-icon-star').click();
  await styleDialog.getByTestId('library-collection-color-preset-rose').click();
  await styleDialog.getByTestId('library-collection-custom-color').fill('#0f766e');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-style-dark-wide.png'), fullPage: true });
  await styleDialog.getByTestId('save-library-collection-style').click();
  await styleDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(async (id) => {
    const entry = (await window.nodus.listGlobalLibraryCollections()).find((collection) => collection.id === id);
    return entry?.icon === 'star' && entry?.color === '#0f766e';
  }, collections.child.id);
  const styledCollectionIcon = page.getByTestId(`library-collection-style-${collections.child.id}`);
  assert.equal(await styledCollectionIcon.evaluate((element) => getComputedStyle(element).color), 'rgb(15, 118, 110)', 'the chosen custom color is rendered on the collection icon');

  await page.getByTestId(`library-collection-move-${collections.root.id}`).click();
  let moveDialog = page.getByTestId('library-collection-move-dialog');
  await moveDialog.waitFor({ state: 'visible' });
  const rootIndent = Number.parseFloat(await page.getByTestId(`library-collection-move-target-${collections.root.id}`).evaluate((element) => getComputedStyle(element).paddingLeft));
  const childIndent = Number.parseFloat(await page.getByTestId(`library-collection-move-target-${collections.child.id}`).evaluate((element) => getComputedStyle(element).paddingLeft));
  assert.ok(childIndent > rootIndent, `nested move targets retain visible hierarchy (${rootIndent}px → ${childIndent}px)`);
  const moveSearch = moveDialog.getByTestId('library-collection-move-search');
  const moveSearchLayout = await moveSearch.evaluate((input) => {
    const inputBox = input.getBoundingClientRect();
    const iconBox = input.previousElementSibling?.getBoundingClientRect();
    return { paddingLeft: parseFloat(getComputedStyle(input).paddingLeft), iconRight: iconBox ? iconBox.right - inputBox.left : 0 };
  });
  assert.ok(moveSearchLayout.paddingLeft >= moveSearchLayout.iconRight + 4, `move search text starts after its icon (${JSON.stringify(moveSearchLayout)})`);
  await moveSearch.fill('Mujeres y posguerra');
  await page.getByTestId(`library-collection-move-target-${collections.child.id}`).waitFor({ state: 'visible' });
  await page.getByTestId(`library-collection-move-target-${collections.root.id}`).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId(`library-collection-move-target-${collections.draggable.id}`).isVisible(), false, 'search hides unrelated branches while retaining the matching collection ancestry');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-move-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-collection-move-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await moveSearch.fill('');
  assert.equal(await page.getByTestId(`library-collection-move-target-${collections.child.id}`).isDisabled(), true, 'a collection cannot move inside its descendant');
  await moveDialog.getByLabel('Cerrar', { exact: true }).click();
  await moveDialog.waitFor({ state: 'detached' });

  await page.getByTestId(`library-collection-move-${collections.child.id}`).click();
  moveDialog = page.getByTestId('library-collection-move-dialog');
  await page.getByTestId('library-collection-move-root').click();
  await page.getByTestId('confirm-library-collection-move').click();
  await moveDialog.waitFor({ state: 'detached' });
  let movedChild = await page.evaluate(async (id) => (await window.nodus.listGlobalLibraryCollections()).find((entry) => entry.id === id), collections.child.id);
  assert.equal(movedChild.parentId, null, 'the modal moves a subcollection to the Library top level');

  await page.getByTestId(`library-collection-move-${collections.child.id}`).click();
  moveDialog = page.getByTestId('library-collection-move-dialog');
  await page.getByTestId(`library-collection-move-target-${collections.root.id}`).click();
  await page.getByTestId('confirm-library-collection-move').click();
  await moveDialog.waitFor({ state: 'detached' });
  movedChild = await page.evaluate(async (id) => (await window.nodus.listGlobalLibraryCollections()).find((entry) => entry.id === id), collections.child.id);
  assert.equal(movedChild.parentId, collections.root.id, 'the modal nests a collection under the selected destination');

  const dragSource = page.getByTestId(`global-library-collection-${collections.draggable.id}`);
  const dragTarget = page.getByTestId(`global-library-collection-${collections.child.id}`);
  await dragSource.dragTo(dragTarget);
  await page.waitForFunction(async ({ id, parentId }) => (await window.nodus.listGlobalLibraryCollections()).find((entry) => entry.id === id)?.parentId === parentId, { id: collections.draggable.id, parentId: collections.child.id });

  const itemCountBeforeCollectionDelete = (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 1 }))).total;
  await page.getByTestId(`library-collection-delete-${collections.disposable.id}`).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Eliminar colección' });
  await deleteDialog.waitFor({ state: 'visible' });
  assert.match(await deleteDialog.innerText(), /No se borrará ningún ítem, archivo, nota, anotación ni análisis/);
  await deleteDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await deleteDialog.waitFor({ state: 'detached' });
  await page.getByText('Colección eliminada; sus ítems siguen en la Biblioteca.', { exact: true }).waitFor();
  await page.waitForFunction(async (id) => !(await window.nodus.listGlobalLibraryCollections()).some((entry) => entry.id === id), collections.disposable.id);
  const collectionDeleteState = await page.evaluate(async () => ({
    collections: await window.nodus.listGlobalLibraryCollections(),
    items: (await window.nodus.listGlobalLibraryItems({ limit: 1 })).total,
  }));
  assert.equal(
    collectionDeleteState.collections.some((entry) => entry.id === collections.disposable.id),
    false,
    `deleted ${collections.disposable.id} remained visible: ${JSON.stringify(collectionDeleteState.collections.map((entry) => entry.id))}`,
  );
  assert.equal(collectionDeleteState.items, itemCountBeforeCollectionDelete, 'deleting a collection leaves every Library item intact');

  await page.getByText('Mujeres y posguerra revisada', { exact: true }).click();
  const row = page.getByTestId(`global-library-item-${itemId}`);
  await row.waitFor({ state: 'visible' });
  assert.match(await row.innerText(), /Mujeres solas en la posguerra/);
  assert.match(await row.innerText(), /María Aliaga/);

  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('create-library-reference').click();
  const createReference = page.getByTestId('library-create-reference-dialog');
  await createReference.waitFor({ state: 'visible' });
  await createReference.getByTestId('library-manual-item-type').selectOption('book-chapter');
  await createReference.getByTestId('library-manual-title').fill('Capítulo creado manualmente');
  await createReference.getByTestId('confirm-create-library-reference').click();
  await createReference.waitFor({ state: 'detached' });
  const manualEditor = page.getByTestId('library-metadata-editor');
  await manualEditor.waitFor({ state: 'visible' });
  assert.equal(await manualEditor.getByTestId('library-metadata-item-type').inputValue(), 'book-chapter');
  await manualEditor.getByLabel('Edición', { exact: true }).fill('2');
  await manualEditor.getByRole('button', { name: 'Guardar metadatos' }).click();
  await manualEditor.waitFor({ state: 'detached' });
  const manualRecord = await page.evaluate(async () => (await window.nodus.listGlobalLibraryItems({ search: 'Capítulo creado manualmente', limit: 5 })).items[0]);
  assert.equal(manualRecord.itemType, 'book-chapter');
  assert.equal(manualRecord.metadata.edition, '2');
  await page.getByTestId(`global-library-item-${manualRecord.id}`).getByRole('button').click();
  const noFileDetail = page.getByTestId('global-library-detail');
  assert.match(await noFileDetail.getByTestId('library-detail-primary-action').innerText(), /Añadir archivo/);
  assert.match(await noFileDetail.getByTestId('library-reading-status').innerText(), /Sin archivo/);

  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('magic-add-library-reference').click();
  const magicAdd = page.getByTestId('library-create-reference-dialog');
  await magicAdd.getByTestId('library-magic-identifier').fill('not-an-identifier');
  await magicAdd.getByTestId('confirm-create-library-reference').click();
  await magicAdd.getByRole('alert').getByText(/No se reconoce el identificador ni la dirección/).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-magic-add-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-magic-add-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await magicAdd.getByLabel('Cerrar', { exact: true }).click();
  await magicAdd.waitFor({ state: 'detached' });

  await row.getByRole('button').click();
  const detail = page.getByTestId('global-library-detail');
  await detail.waitFor({ state: 'visible' });
  await detail.getByText('10.0000/nodus.fixture').waitFor();
  console.log('[global-library-e2e] metadata detail visible');
  assert.match(await detail.innerText(), /10\.0000\/nodus\.fixture/);
  assert.match(await detail.innerText(), /1134-6396/);
  assert.match(await detail.innerText(), /Lista para leer/);
  await detail.getByTestId('library-online-source').waitFor({ state: 'visible' });
  assert.equal(await detail.getByTestId('library-online-source').getAttribute('title'), 'Abrir fuera de Nodus');
  assert.match(await detail.getByTestId('library-reading-status').innerText(), /Lista para leer/);
  assert.match(await detail.getByTestId('library-detail-primary-action').innerText(), /Leer/);
  assert.equal(await detail.getByTestId('library-extraction-advanced').getAttribute('open'), null, 'technical extraction details start collapsed');
  await writePendingReadingFixture(collections.child.id, now);
  await page.evaluate(() => window.nodus.rebuildGlobalLibrary());
  const pendingRow = page.getByTestId(`global-library-item-${pendingItemId}`);
  await pendingRow.waitFor({ state: 'visible' });
  await pendingRow.getByRole('button').click();
  const pendingDetail = page.getByTestId('global-library-detail');
  await pendingDetail.getByTestId('library-reading-status').getByText('Preparación pendiente').waitFor();
  assert.match(await pendingDetail.getByTestId('library-reading-status').innerText(), /Preparación pendiente/);
  const pendingEnqueue = await page.evaluate((id) => window.nodus.enqueueLibraryExtraction([id]), pendingItemId);
  assert.equal(pendingEnqueue.queued, 1, 'the pending reading enters the extraction queue');
  await page.waitForFunction(async (id) => (await window.nodus.getGlobalLibraryItem(id))?.extraction?.status === 'ready', pendingItemId);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="global-library-item-${id}"]`)?.textContent?.includes('Lista para leer'), pendingItemId);
  await pendingDetail.getByTestId('library-reading-status').getByText('Lista para leer', { exact: true }).waitFor();
  assert.match(await pendingDetail.getByTestId('library-detail-primary-action').innerText(), /Leer/, 'the selected detail refreshes without leaving Library');
  await row.getByRole('button').click();
  await detail.getByText('10.0000/nodus.fixture').waitFor();
  const toastDismissButtons = page.getByTestId('app-toast-stack').getByRole('button', { name: 'Cerrar' });
  while (await toastDismissButtons.count()) {
    await toastDismissButtons.first().evaluate((button) => (button instanceof HTMLButtonElement ? button.click() : undefined)).catch(() => undefined);
    await page.waitForTimeout(25);
  }
  await detail.getByTestId('library-reading-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-progressive-detail-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-progressive-detail-light-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });

  await page.getByTestId('add-library-item-to-vault').click();
  const vaultDialog = page.getByTestId('global-library-vault-dialog');
  await vaultDialog.waitFor({ state: 'visible' });
  await page.getByTestId('confirm-global-library-vault-link').click();
  await vaultDialog.waitFor({ state: 'detached' });
  const reuseBadges = detail.locator('[data-testid^="vault-reuse-"]');
  await reuseBadges.waitFor({ state: 'visible' });
  assert.equal(await reuseBadges.locator('span[title]').count(), 6, 'every reusable component exposes state and cause');
  await reuseBadges.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-reuse-status-dark-wide.png'), fullPage: true });

  await page.getByTestId('library-scope-vault').click();
  const vaultWorkTitle = page.getByTestId(`vault-library-title-${itemId}`);
  await vaultWorkTitle.waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid^="library-workspace-tab-document-"]').count(), 0, 'This vault starts without an open reader tab');
  await vaultWorkTitle.click();
  const vaultIdeasModal = page.getByTestId('work-ideas-modal');
  await vaultIdeasModal.waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid^="library-workspace-tab-document-"]').count(), 0, 'clicking a This-vault work opens analysis instead of the reader');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-vault-work-analysis-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-vault-work-analysis-light-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await vaultIdeasModal.getByRole('button', { name: 'Cerrar' }).click();
  await vaultIdeasModal.waitFor({ state: 'detached' });
  const vaultWorkRow = page.getByTestId(`vault-library-item-${itemId}`);
  await vaultWorkRow.getByRole('button', { name: 'Abrir lector limpio' }).click();
  await page.locator('[data-testid^="library-workspace-tab-document-"]').first().waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('work-ideas-modal').count(), 0, 'the reader action does not reopen the analysis modal');
  const readerFormatDialog = page.getByTestId('library-reader-format-dialog');
  await readerFormatDialog.waitFor({ state: 'visible' });
  await page.getByTestId('library-reader-format-clean').click();
  await readerFormatDialog.waitFor({ state: 'detached' });
  await page.getByTestId('library-workspace-tab-library').click();
  await page.getByTestId('library-scope-global').click();
  await row.getByRole('button').click();
  await detail.waitFor({ state: 'visible' });
  await detail.getByText('10.0000/nodus.fixture').waitFor();

  const editorToastDismissButtons = page.getByTestId('app-toast-stack').getByRole('button', { name: 'Cerrar' });
  while (await editorToastDismissButtons.count()) {
    await editorToastDismissButtons.first().evaluate((button) => (button instanceof HTMLButtonElement ? button.click() : undefined)).catch(() => undefined);
    await page.waitForTimeout(25);
  }
  await page.getByTestId('edit-library-metadata').click();
  const metadataEditor = page.getByTestId('library-metadata-editor');
  await metadataEditor.waitFor({ state: 'visible' });
  if (process.env.NODUS_METADATA_SCREENSHOT) {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
    await page.screenshot({ path: process.env.NODUS_METADATA_SCREENSHOT });
    await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
    await page.setViewportSize({ width: 1540, height: 940 });
  }
  await metadataEditor.getByLabel('Editorial', { exact: true }).fill('Editorial corregida en Nodus');
  await metadataEditor.getByRole('button', { name: 'Guardar metadatos' }).click();
  await metadataEditor.waitFor({ state: 'detached' });
  await page.getByText('Editorial corregida en Nodus', { exact: true }).waitFor();
  assert.equal((await page.evaluate((id) => window.nodus.getGlobalLibraryItem(id), itemId)).metadata.publisher, 'Editorial corregida en Nodus');
  console.log('[global-library-e2e] local metadata correction persisted');

  await page.getByTestId('library-detail-actions-toggle').click();
  await page.getByTestId('cite-library-item').click();
  const citationDialog = page.getByTestId('library-citation-export-dialog');
  await citationDialog.waitFor({ state: 'visible' });
  await page.getByTestId('library-citation-style-trigger').click();
  await page.getByTestId('library-citation-style-search').fill('chicago author');
  await page.getByTestId('library-citation-style').getByRole('option', { name: /Chicago author-date/ }).click();
  await page.getByTestId('copy-library-citation').click();
  await citationDialog.getByText(/Mujeres solas en la posguerra/).waitFor();
  const copiedCitation = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copiedCitation, /Mujeres solas en la posguerra/);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-citation-export-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-citation-export-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await citationDialog.getByRole('button').first().click();
  await citationDialog.waitFor({ state: 'detached' });

  await detail.getByTestId('library-detail-actions-toggle').click();
  await detail.getByTestId('manage-library-attachments').click();
  const itemManager = page.getByTestId('library-item-manager');
  await itemManager.waitFor({ state: 'visible' });
  await page.getByTestId('library-attachments').waitFor({ state: 'visible' });
  assert.ok(await page.getByTestId('library-attachments').locator('article').count(), 'the attachment manager renders the imported original');
  const managerHeight = (await itemManager.locator(':scope > section').boundingBox())?.height;
  assert.ok(managerHeight, 'the item manager has a measurable fixed height');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-item-manager-dark-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-item-manager-dark-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1540, height: 940 });
  await itemManager.getByRole('button', { name: 'Notas', exact: true }).click();
  assert.equal((await itemManager.locator(':scope > section').boundingBox())?.height, managerHeight, 'Notes keeps the same modal height as Attachments');
  await itemManager.getByRole('button', { name: 'Relaciones', exact: true }).click();
  assert.equal((await itemManager.locator(':scope > section').boundingBox())?.height, managerHeight, 'Relations keeps the same modal height as Attachments');
  await itemManager.getByRole('button', { name: 'Etiquetas', exact: true }).click();
  assert.equal((await itemManager.locator(':scope > section').boundingBox())?.height, managerHeight, 'Tags keeps the same modal height as Attachments');
  await itemManager.getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByTestId('library-notes').getByLabel('Título', { exact: true }).fill('Nota E2E');
  await page.getByTestId('library-notes').getByLabel('Markdown', { exact: true }).fill('# Nota\n\nContenido local.');
  await page.getByTestId('library-notes').getByRole('button', { name: 'Guardar nota' }).click();
  await itemManager.getByText('Nota E2E', { exact: true }).waitFor();
  assert.equal((await page.evaluate((id) => window.nodus.getGlobalLibraryItem(id), itemId)).notes.some((note) => note.title === 'Nota E2E'), true);
  await itemManager.getByText('Nota E2E', { exact: true }).click();
  await page.getByTestId('delete-global-library-note').click();
  const noteDeleteConfirm = page.getByRole('dialog', { name: 'Eliminar nota', exact: true });
  await noteDeleteConfirm.waitFor({ state: 'visible' });
  assert.match(await noteDeleteConfirm.innerText(), /no se puede deshacer/i, 'note deletion explains that it is destructive');
  assert.equal((await page.evaluate((id) => window.nodus.getGlobalLibraryItem(id), itemId)).notes.some((note) => note.title === 'Nota E2E'), true, 'the note remains until deletion is confirmed');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-note-delete-confirm-dark-wide.png'), fullPage: true });
  await noteDeleteConfirm.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await noteDeleteConfirm.waitFor({ state: 'detached' });
  await page.waitForFunction(async (id) => !(await window.nodus.getGlobalLibraryItem(id))?.notes.some((note) => note.title === 'Nota E2E'), itemId);
  await itemManager.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await itemManager.waitFor({ state: 'detached' });

  await page.getByTestId('library-more-menu-toggle').click();
  await page.getByTestId('open-library-duplicates').click();
  const duplicatesDialog = page.getByTestId('library-duplicates-dialog');
  await duplicatesDialog.waitFor({ state: 'visible' });
  await duplicatesDialog.getByText('No se han detectado duplicados.').waitFor();
  await duplicatesDialog.getByRole('button').first().click();
  await duplicatesDialog.waitFor({ state: 'detached' });

  await row.locator('input[type="checkbox"]').check();
  await page.getByTestId('global-library-bulk-actions').waitFor({ state: 'visible' });
  await page.getByTestId('bulk-resolve-library-metadata').click();
  const metadataBatch = page.getByTestId('library-metadata-batch-dialog');
  await metadataBatch.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-metadata-batch-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-metadata-batch-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await metadataBatch.getByRole('button').first().click();
  await metadataBatch.waitFor({ state: 'detached' });
  await page.getByTestId('global-library-search').fill('resultado inexistente');
  await page.waitForTimeout(350);
  await row.waitFor({ state: 'detached' });
  await page.getByTestId('global-library-search').fill('Mujeres');
  await page.waitForTimeout(350);
  await page.getByTestId(`global-library-item-${itemId}`).waitFor({ state: 'visible' });

  await page.getByTestId('open-zotero-global-import').click();
  const zoteroDialog = page.getByTestId('zotero-global-import-dialog');
  await zoteroDialog.waitFor({ state: 'visible' });
  assert.match(await zoteroDialog.innerText(), /solo lectura/);
  await page.getByTestId('zotero-sync-resume').waitFor({ state: 'visible' });
  await page.getByTestId('resume-zotero-sync').waitFor({ state: 'visible' });

  // A failure here used to reach the user as "Error invoking remote method
  // 'library:zoteroLibraries': Error: The operation could not be completed." — an IPC
  // channel and a sentence that named neither the cause nor the fix. It must now name
  // both: Zotero did not answer, and the setting that makes it answer.
  const zoteroFailure = page.getByTestId('zotero-global-import-error');
  await zoteroFailure.waitFor({ state: 'visible' });
  const failureText = await zoteroFailure.innerText();
  assert.doesNotMatch(failureText, /invoking remote method/, 'the IPC channel name is not an error message');
  assert.match(failureText, /No se pudo conectar con Zotero/, 'the dialog names why the import failed');
  await page.getByTestId('zotero-global-import-hint').waitFor({ state: 'visible' });
  assert.match(
    await page.getByTestId('zotero-global-import-hint').innerText(),
    /Comprueba que Zotero esté abierto/,
    'the dialog names the setting that fixes it',
  );
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-zotero-resume-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-zotero-resume-light-narrow.png'), fullPage: true });
  await zoteroDialog.getByLabel('Cerrar', { exact: true }).click();
  await zoteroDialog.waitFor({ state: 'detached' });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.evaluate((id) => window.nodus.setGlobalLibraryItemsDeleted([id], true), itemId);
  await trashFolder.click();
  assert.equal(await trashFolder.getAttribute('aria-current'), 'page', 'the trash folder stays selected while reviewing recoverable items');
  const activeTrashColors = await trashFolder.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(activeTrashColors, { background: 'rgba(127, 29, 29, 0.32)', color: 'rgb(254, 226, 226)' });
  const trashRow = page.getByTestId(`global-library-item-${itemId}`);
  await trashRow.waitFor({ state: 'visible' });
  await trashRow.locator('input[type="checkbox"]').check();
  await page.getByTestId('bulk-purge-library-trash').click();
  const trashImpact = page.getByTestId('library-trash-impact-dialog');
  await trashImpact.waitFor({ state: 'visible' });
  await page.getByTestId('library-trash-purge-blocked').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('purge-library-trash').isDisabled(), true, 'active vault links block manual emptying');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-trash-impact-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  const activeLightTrashColors = await trashFolder.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(activeLightTrashColors, { background: 'rgb(254, 226, 226)', color: 'rgb(153, 27, 27)' });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-trash-impact-light-narrow.png'), fullPage: true });
  await page.getByTestId('restore-library-trash').click();
  await trashImpact.waitFor({ state: 'detached' });
  await page.getByText('La papelera está vacía.', { exact: true }).waitFor();
  await page.getByTestId('close-library-trash').click();
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.getByTestId('library-more-menu-toggle').click();
  await page.getByTestId('open-library-recovery').click();
  const recoveryDialog = page.getByTestId('library-recovery-dialog');
  await recoveryDialog.waitFor({ state: 'visible' });
  await recoveryDialog.getByText('Adjuntos dañados', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-recovery-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-recovery-light-narrow.png'), fullPage: true });
  await page.getByTestId('rebuild-library-recovery').click();
  await page.getByTestId('rebuild-library-recovery').waitFor({ state: 'visible' });
  await recoveryDialog.getByRole('button').first().click();
  await recoveryDialog.waitFor({ state: 'detached' });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  console.log(`global Library UI test passed; screenshot: ${screenshotPath}`);
} finally {
  await closeElectronApp(app);
  await rm(testRoot, { recursive: true, force: true });
}
