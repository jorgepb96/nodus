import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright-core';
import { academicSnapshot, PDF_BYTES, PNG_BYTES } from './lib/nodusServerFixtures.mjs';
import { postForm, repoRoot, withServer } from './lib/nodusServerHarness.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = path.join(repoRoot, 'reports', 'server-web-qa', 'final', 'screenshots');
await mkdir(output, { recursive: true });

function builtSnapshot(payload) {
  const revision = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  return { payload, revision, gzipped: gzipSync(Buffer.from(JSON.stringify(payload))) };
}

async function enablePolicy(server, spaceId, fields) {
  const response = await postForm(`${server.origin}/admin/spaces/policy`, {
    csrf: await server.csrf(), spaceId, ...Object.fromEntries(fields.map((field) => [field, 'on'])),
  }, { headers: { cookie: server.adminCookie } });
  assert.equal(response.status, 303);
}

async function waitForView(page, testId, consoleErrors, serverLogs = []) {
  try {
    await page.getByTestId(testId).waitFor();
    await waitForSettled(page, testId);
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      `Server web did not render ${testId}.`,
      `URL: ${page.url()}`,
      `Body: ${body.slice(0, 2_000)}`,
      `Browser errors: ${consoleErrors.join(' | ') || '(none)'}`,
      `Server log tail: ${serverLogs.join('').slice(-2_000) || '(none)'}`,
    ].join('\n'), { cause: error });
  }
}

/** Wait for the first real data paint, not merely for the React shell. */
async function waitForSettled(page, testId, timeout = 15_000) {
  await page.getByTestId(testId).first().waitFor({ timeout });
  await page.waitForFunction((id) => {
    const host = document.querySelector(`[data-testid="${id}"]`);
    if (!host) return false;
    if (host.querySelector('[aria-busy="true"], [data-loading="true"]')) return false;
    const pending = [...host.querySelectorAll('[role="status"]')]
      .some((node) => /cargando|loading|esperando|preparando/i.test(node.textContent || ''));
    return !pending;
  }, testId, { timeout });
  await page.waitForTimeout(100);
}

await withServer({ label: 'server-web-e2e', ai: true }, async (server) => {
  const academicId = await server.createSpace('Atlas de memoria');
  const worldId = await server.createSpace('Crónicas de Asteria');
  await enablePolicy(server, academicId, ['allowUserContent', 'allowLibraryDocuments', 'allowPassages']);
  const academicOwner = await server.deviceToken(server.adminEmail, server.adminPassword, academicId, 'Academic publisher');
  const worldOwner = await server.deviceToken(server.adminEmail, server.adminPassword, worldId, 'World publisher');

  const zip = new AdmZip();
  zip.addFile('document.md', Buffer.from('# Archivo, memoria y ciudad\n\nLa memoria colectiva transforma el archivo en un espacio vivo.\n\n## Una lectura conectada\n\nSelecciona este párrafo para guardar un subrayado privado.\n\n![Mapa conceptual](assets/figure.png)'));
  zip.addFile('assets/figure.png', PNG_BYTES);
  zip.addFile('original/document.pdf', PDF_BYTES);
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'nodus.library-document-package', formatVersion: 2, documentId: 'library-doc-1',
    title: 'Archivo, memoria y ciudad', figures: 1, cleanMarkdown: true,
    original: { path: 'original/document.pdf', fileName: 'archivo-memoria.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES.length },
  })));
  const packageBytes = zip.toBuffer();
  const packageHash = createHash('sha256').update(packageBytes).digest('hex');
  const upload = await server.api(academicOwner.deviceToken, 'PUT', `/api/v1/spaces/${academicId}/library/packages/${packageHash}`, { body: packageBytes, headers: { 'content-type': 'application/zip' } });
  assert.equal(upload.status, 200, await upload.text());

  // Include a real published Deep Research image so the reader QA exercises the
  // same cover/image branch as Desktop instead of silently testing the empty state.
  const deepImageHash = createHash('sha256').update(PNG_BYTES).digest('hex');
  const deepImageUpload = await server.api(academicOwner.deviceToken, 'POST', `/api/v1/spaces/${academicId}/assets/${deepImageHash}`, { body: PNG_BYTES });
  assert.equal(deepImageUpload.status, 200, await deepImageUpload.text());
  const academic = academicSnapshot({ assets: [{ hash: deepImageHash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: PNG_BYTES.length, thumbBytes: null, kind: 'deep_research_image', table: 'decorative_images', key: ['deep_research', 'dr-1'] }] });
  academic.payload.tables.dictionary_entries = [{
    id: 'dictionary-1', name: 'Memoria colectiva', aliases_json: '[]', focus_prompt: '',
    scope_kind: 'vault', scope_json: '{"kind":"vault"}', output_language: 'es', detail_level: 'standard',
    tags_json: '["memoria"]', content_markdown: 'Concepto que articula archivo, comunidad y transmisión.',
    status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }];
  academic.payload.library = {
    format: 'nodus.server-library', formatVersion: 1, generatedAt: new Date().toISOString(),
    collections: [{ id: 'collection-1', name: 'Teoría del archivo', icon: null, color: '#8b5cf6', parentId: null, position: 0, directItemCount: 1, updatedAt: new Date().toISOString() }],
    documents: [{ id: 'library-doc-1', title: 'Archivo, memoria y ciudad', itemType: 'book', creators: ['Ada Lovelace'], abstract: 'Una lectura sobre archivos vivos.', date: '1843', year: 1843, language: 'es', publisher: 'Nodus Press', publicationTitle: null, volume: null, issue: null, pages: null, edition: null, place: null, rights: null, doi: null, pmid: null, pmcid: null, arxiv: null, isbn: [], issn: [], url: null, citationKey: 'lovelace1843', reference: 'Lovelace, A. (1843). Archivo, memoria y ciudad.', tags: ['memoria', 'archivo'], collectionIds: ['collection-1'], updatedAt: new Date().toISOString(), cleanAvailable: true, wordCount: 31, figureCount: 1, packageHash, packageBytes: packageBytes.length, originalAvailable: true, originalFileName: 'archivo-memoria.pdf', originalMimeType: 'application/pdf', originalBytes: PDF_BYTES.length }],
  };
  const publishedAcademic = builtSnapshot(academic.payload);
  const publishAcademic = await server.api(academicOwner.deviceToken, 'PUT', `/api/v1/spaces/${academicId}/snapshot`, { body: publishedAcademic.gzipped, headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': publishedAcademic.revision } });
  assert.equal(publishAcademic.status, 200, await publishAcademic.text());

  const world = builtSnapshot({
    format: 'nodus.server-snapshot', formatVersion: 2, generatedAt: new Date().toISOString(), schemaVersion: 121,
    vault: { id: 'world-vault', name: 'Crónicas de Asteria', type: 'worldbuilding' }, capabilities: { hasAssets: false }, assets: [],
    tables: {
      persons: [{ person_id: 'char-1', display_name: 'Iria de Asteria', summary: 'Cartógrafa de las mareas.' }],
      places: [{ place_id: 'place-1', name: 'Puerto de Ceniza', description: 'Ciudad suspendida sobre el mar.' }],
      events: [{ event_id: 'event-1', title: 'La noche de los faros', description: 'Los siete faros se apagaron.' }],
      world_groups: [{ group_id: 'group-1', name: 'La Cofradía del Norte', description: 'Navegantes y cronistas.' }],
      world_scenes: [{ scene_id: 'scene-1', title: 'Llegada al puerto', summary: 'Iria descubre el mapa imposible.' }],
      world_articles: [{ article_id: 'article-1', title: 'Las rutas de sal', content: 'Historia de las rutas antiguas.' }],
      world_rules: [{ rule_id: 'rule-1', title: 'La tinta recuerda', description: 'Todo mapa conserva la intención de quien lo dibuja.' }],
      world_questions: [], world_secrets: [], world_maps: [], world_threads: [], relationships: [],
    },
  });
  const publishWorld = await server.api(worldOwner.deviceToken, 'PUT', `/api/v1/spaces/${worldId}/snapshot`, { body: world.gzipped, headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': world.revision } });
  assert.equal(publishWorld.status, 200, await publishWorld.text());

  const reader = await server.createUser('reader@example.test', 'reader-password-strong', [{ spaceId: academicId, role: 'reader' }, { spaceId: worldId, role: 'reader' }]);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const personalAnnotationTraffic = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${message.text()} @ ${message.location().url || 'unknown'}`); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`); });
    page.on('response', (response) => {
      if (response.url().includes('/personal-annotations')) personalAnnotationTraffic.push(`${response.request().method()} ${response.status()}`);
    });

    await page.goto(`${server.origin}/login?next=/`, { waitUntil: 'networkidle' });
    await page.locator('#organism').waitFor();
    await page.screenshot({ path: path.join(output, '01-login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile login must not overflow horizontally');
    await page.screenshot({ path: path.join(output, '01b-login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(250);
    await page.locator('#login-email').fill(reader.email);
    await page.locator('#login-password').fill(reader.password);
    await Promise.all([page.waitForURL(new RegExp(`${server.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`)), page.locator('button[type="submit"]').click()]);
    await waitForView(page, 'overview-view', consoleErrors, server.logs);
    await page.screenshot({ path: path.join(output, '02-academic-overview-desktop.png'), fullPage: true });
    await page.getByTestId('header-vault-badge').click();
    await page.getByTestId('vault-manager').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, '02b-vault-switcher-desktop.png') });
    await page.getByTestId('header-vault-badge').click();
    await page.getByTestId('vault-manager').waitFor({ state: 'hidden' });

    // The Server uses the canonical Desktop navigation ids, not a parallel
    // collection menu invented for the web surface.
    await page.getByTestId('nav-ideas').click();
    await page.getByTestId('advanced-ideas-view').waitFor();
    await page.getByTestId('advanced-idea-card').first().waitFor();
    assert.equal(await page.getByTestId('advanced-idea-card').count(), 3);
    await page.screenshot({ path: path.join(output, '03-ideas-catalog-desktop.png'), fullPage: true });
    await page.getByTestId('advanced-idea-card').first().click();
    await page.getByTestId('academic-idea-detail').waitFor();
    assert.equal(await page.getByTestId('advanced-ideas-tabs').locator('button').count() >= 2, true);
    await page.screenshot({ path: path.join(output, '04-idea-tabs-detail-desktop.png'), fullPage: true });

    await page.getByTestId('nav-authors').click();
    await page.getByTestId('advanced-authors-view').waitFor();
    await page.getByTestId('advanced-author-card').first().waitFor();
    assert.equal(await page.getByTestId('advanced-author-card').count() > 0, true);
    await page.getByTestId('advanced-author-card').first().locator('button').first().click();
    await page.getByTestId('academic-author-detail').waitFor();
    assert.equal(await page.locator('[data-testid="author-synthesis-panel"], [data-testid="private-author-synthesis"]').count(), 0, 'the obsolete private synthesis modal must not be rendered');
    await page.screenshot({ path: path.join(output, '05-author-dossier-synthesis-desktop.png'), fullPage: true });

    await page.getByTestId('nav-graph').click();
    await page.getByTestId('advanced-graph-view').waitFor();
    await page.getByTestId('advanced-graph-seed').waitFor();
    await waitForSettled(page, 'advanced-graph-view');
    await page.screenshot({ path: path.join(output, '06-graph-desktop.png') });

    await page.goto(`${server.origin}/view/workspace`, { waitUntil: 'networkidle' });
    await waitForSettled(page, 'private-notes-view');
    await page.getByRole('button', { name: /New note|Nueva nota/ }).click();
    await page.locator('.server-note-title').fill('Nota privada E2E');
    await page.locator('.server-note-editor').fill('# Apunte\n\nEste contenido pertenece únicamente al lector.');
    await page.getByRole('button', { name: /Save|Guardar/, exact: true }).click();
    await page.screenshot({ path: path.join(output, '07-private-workspace-desktop.png'), fullPage: true });

    await page.getByTestId('header-assistant').click();
    await waitForSettled(page, 'assistant-view');
    await page.screenshot({ path: path.join(output, '08-assistant-private-desktop.png'), fullPage: true });

    await page.goto(`${server.origin}/view/dictionary`, { waitUntil: 'networkidle' });
    await waitForSettled(page, 'dictionary-view');
    await page.screenshot({ path: path.join(output, '09-dictionary-desktop.png'), fullPage: true });

    // Deep Research keeps the reader bookmark as a private anchored annotation. The
    // bookmark is created from the real selection ribbon, then survives a hard reload.
    await page.goto(`${server.origin}/view/deepResearch`, { waitUntil: 'networkidle' });
    await waitForSettled(page, 'deep-research-view');
    assert.ok(await page.getByTestId('deep-research-gallery-card').count() > 0, 'Deep Research must expose published reports before capture');
    await page.locator('[data-testid="deep-research-view"] article button').first().click();
    await waitForSettled(page, 'deep-research-reader');
    assert.ok(await page.getByTestId('deep-research-reader-toolbar').getByRole('button').count() >= 8, 'Deep Research reader must expose the Desktop-equivalent action ribbon');
    await page.getByTestId('deep-research-report-image').waitFor();
    await page.getByTestId('deep-research-matrix-toggle').click();
    await waitForSettled(page, 'deep-research-matrix-rail');
    await page.screenshot({ path: path.join(output, '09a-deep-research-reader-desktop.png'), fullPage: true });
    await page.getByTestId('theme-toggle').click();
    await page.screenshot({ path: path.join(output, '09b-deep-research-reader-light.png'), fullPage: true });
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('deep-research-matrix-toggle').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, '09c-deep-research-reader-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // ReaderSelectionActions installs its document/keyboard listeners in an
    // effect after the reader shell mounts; wait for that listener lifecycle
    // before injecting the deterministic keyboard selection below.
    await page.waitForTimeout(250);
    const selectedParagraph = page.getByTestId('deep-research-reader-document').locator('p').first();
    await selectedParagraph.evaluate((paragraph) => {
      const selection = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(paragraph); selection?.removeAllRanges(); selection?.addRange(range);
      paragraph.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    });
    const selectionToolbar = page.getByRole('toolbar', { name: /Selection actions|Acciones de selección/ });
    await selectionToolbar.waitFor();
    await selectionToolbar.getByRole('button', { name: /Add reading bookmark|Añadir marcador de lectura/ }).click();
    const bookmark = page.getByTestId('deep-research-bookmark');
    await page.waitForFunction(() => document.querySelector('[data-testid="deep-research-bookmark"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await bookmark.getAttribute('aria-pressed'), 'true', 'selection ribbon saves a private bookmark');
    await page.getByTestId('deep-research-copy-reading').click();
    await page.getByTestId('deep-research-save-note').click();
    await page.waitForFunction(() => /Saved to private notes|Guardado en notas privadas/.test(document.querySelector('[data-testid="deep-research-reader-feedback"]')?.textContent || ''));
    assert.match(await page.getByTestId('deep-research-reader-feedback').innerText(), /Saved to private notes|Guardado en notas privadas/);
    const readState = page.getByTestId('deep-research-read-state');
    const readBefore = await readState.getAttribute('aria-pressed');
    await readState.click();
    await page.waitForFunction((before) => document.querySelector('[data-testid="deep-research-read-state"]')?.getAttribute('aria-pressed') !== before, readBefore);
    assert.notEqual(await readState.getAttribute('aria-pressed'), readBefore, 'read state is a private overlay toggle');
    const reportUrl = page.url();
    assert.match(reportUrl, /[?&]report=dr-1/, 'the open report is reflected in the URL');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForSettled(page, 'deep-research-reader');
    assert.equal(await page.getByTestId('deep-research-bookmark').getAttribute('aria-pressed'), 'true', 'bookmark survives reopening the report');
    assert.notEqual(await page.getByTestId('deep-research-read-state').getAttribute('aria-pressed'), readBefore, 'read overlay survives reopening the report');
    await page.waitForTimeout(250);

    // A highlight created after the read toggle must use the POST response version,
    // then the opposite toggle must survive another hard reload as an explicit
    // unread override (even if the published snapshot carries read_at).
    const paragraphAfterToggle = page.getByTestId('deep-research-reader-document').locator('p').first();
    await paragraphAfterToggle.evaluate((paragraph) => {
      const selection = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(paragraph); selection?.removeAllRanges(); selection?.addRange(range);
      paragraph.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    });
    await page.getByRole('toolbar', { name: /Selection actions|Acciones de selección/ }).waitFor();
    const highlightSaved = page.waitForResponse((response) => response.url().includes('/personal-annotations') && response.request().method() === 'POST', { timeout: 5_000 }).catch(() => null);
    await page.getByRole('toolbar', { name: /Selection actions|Acciones de selección/ }).getByRole('button', { name: /Underline 1|Subrayar 1/ }).click();
    const highlightResponse = await highlightSaved;
    assert.ok(highlightResponse, `highlight did not issue a POST; traffic=${personalAnnotationTraffic.join(',')}; alerts=${(await page.getByRole('alert').allTextContents()).join(' | ')}`);
    assert.equal(highlightResponse.status(), 200, `highlight save failed: ${await highlightResponse.text()}`);
    await page.getByTestId('deep-research-read-state').click();
    await page.waitForFunction((before) => document.querySelector('[data-testid="deep-research-read-state"]')?.getAttribute('aria-pressed') === before, readBefore);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('deep-research-reader').waitFor();
    assert.equal(await page.getByTestId('deep-research-read-state').getAttribute('aria-pressed'), readBefore, 'explicit unread override survives reopening the report');
    const savedHighlight = page.locator('[data-annotation-kind="highlight"]');
    await savedHighlight.waitFor();
    const highlightDelete = savedHighlight.getByRole('button', { name: /Eliminar anotación|Delete annotation/ });
    const highlightDeleted = page.waitForResponse((response) => response.url().includes('/personal-annotations') && response.request().method() === 'DELETE' && response.status() === 200);
    page.once('dialog', (dialog) => void dialog.accept());
    await highlightDelete.click();
    await highlightDeleted;
    await savedHighlight.waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('deep-research-reader').waitFor();
    assert.equal(await page.locator('[data-annotation-kind="highlight"]').count(), 0, 'deleted highlight does not reappear after reopening the report');
    assert.equal(await page.getByTestId('deep-research-bookmark').getAttribute('aria-pressed'), 'true', 'deleting a highlight preserves the independent reading bookmark');
    await page.getByTestId('deep-research-reader').getByRole('button', { name: /Back to gallery|Volver a la galería/ }).click();
    await waitForSettled(page, 'deep-research-view');
    await page.getByTestId('deep-research-read-filter').click();
    await page.getByTestId('deep-research-read-filter-menu').locator(`[data-value="${readBefore === 'true' ? 'read' : 'unread'}"]`).click();
    await page.keyboard.press('Escape');
    assert.ok(await page.getByTestId('deep-research-gallery-card').count() > 0, 'gallery filter reflects private read overlay');

    await page.getByTestId('nav-library').click();
    await waitForSettled(page, 'library-list');
    assert.ok(await page.getByTestId('library-document-row').count() > 0, 'Library must paint published rows before capture');
    await page.locator('[data-testid="library-list"] button').first().click();
    await waitForSettled(page, 'library-reader');
    await page.getByTestId('library-reader-original-frame').waitFor();
    assert.equal(await page.getByTestId('library-reader-original-frame').isVisible(), true, 'published original opens immediately');
    await page.getByTestId('library-reader-source-picker').selectOption('clean');
    await page.getByTestId('library-reader-document').waitFor();
    await page.screenshot({ path: path.join(output, '10-library-reader-desktop.png'), fullPage: true });
    await page.getByTestId('library-reader-document').locator('p').first().evaluate((paragraph) => {
      const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(paragraph); selection?.removeAllRanges(); selection?.addRange(range); paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByTestId('library-reader-add-note').click();
    await page.getByTestId('library-reader-sidebar').locator('input').fill('Lectura clave');
    await page.getByTestId('library-reader-sidebar').locator('textarea').fill('Conservar esta idea para la próxima sesión.');
    await page.getByTestId('library-reader-sidebar').getByRole('button', { name: /Save annotation|Guardar anotación/, exact: true }).click();
    await page.getByTestId('library-reader-sidebar').getByText('Lectura clave', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, '11-private-highlight-desktop.png'), fullPage: true });

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-providers').click();
    await waitForSettled(page, 'server-native-providers');
    assert.equal(await page.locator('iframe').count(), 0, 'Settings must be native and never embed the legacy admin page');
    assert.equal(new URL(page.url()).pathname.startsWith('/app'), false, 'canonical Server navigation must not use /app');
    if (await page.locator('.ss-favorites .ss-chip').count() === 0) {
      await page.getByRole('button', { name: /OpenAI/ }).click();
      await page.getByTestId('provider-model-list-openai').locator('.ss-favorite-button').first().click();
      await page.locator('.ss-favorites .ss-chip').first().waitFor();
    }
    const favoriteModelsBeforeVaultSwitch = await page.locator('.ss-favorites .ss-chip').allTextContents();
    assert.ok(favoriteModelsBeforeVaultSwitch.length > 0, 'the account must expose at least one portable favorite model');
    if (await page.getByTestId('server-native-providers').locator('input[type="password"]').count() === 0) {
      await page.getByRole('button', { name: /OpenAI/ }).click();
    }
    await page.getByTestId('server-native-providers').locator('input[type="password"]').first().waitFor();
    assert.equal(await page.getByTestId('server-native-providers').locator('input[type="password"]').first().inputValue(), '', 'saved secrets are never prefilled');
    await page.getByRole('button', { name: /AI models|Modelos IA/, exact: true }).click();
    await waitForSettled(page, 'server-native-models');
    assert.equal(await page.getByTestId('settings-model-assistant').evaluate((element) => element.tagName), 'SELECT');
    await page.screenshot({ path: path.join(output, '12-ai-settings-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'AI profile must not overflow on mobile');
    await page.screenshot({ path: path.join(output, '13-ai-settings-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    await page.getByTestId('header-vault-badge').click();
    await page.getByTestId(`vault-option-${worldId}`).click();
    await page.getByRole('heading', { name: 'Crónicas de Asteria', exact: true }).waitFor();
    await page.getByTestId('header-settings').click();
    await page.getByTestId('settings-tab-providers').click();
    await page.getByTestId('server-native-providers').waitFor();
    assert.deepEqual(
      await page.locator('.ss-favorites .ss-chip').allTextContents(),
      favoriteModelsBeforeVaultSwitch,
      'favorite models belong to the account and must survive a vault switch',
    );
    await page.locator('[data-tour="nav-factions"]').click();
    await page.getByTestId('vault-surface-world-groups').waitFor();
    await page.screenshot({ path: path.join(output, '14-worldbuilding-desktop.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Crónicas de Asteria', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile app must not overflow horizontally');
    await page.getByRole('button', { name: /Open navigation|Abrir navegación/ }).click();
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile drawer must stay within the viewport');
    await page.screenshot({ path: path.join(output, '15-mobile-portrait-navigation.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'landscape app must not create global horizontal overflow');
    await page.screenshot({ path: path.join(output, '16-mobile-landscape.png') });
    await context.close();

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${server.origin}/login`, { waitUntil: 'networkidle' });
    await adminPage.locator('#login-email').fill(server.adminEmail);
    await adminPage.locator('#login-password').fill(server.adminPassword);
    await Promise.all([adminPage.waitForURL(/\/$/), adminPage.locator('button[type="submit"]').click()]);
    await adminPage.getByTestId('app-shell').waitFor();
    await adminPage.getByTestId('header-settings').click();
    await adminPage.getByRole('button', { name: /Server|Servidor/, exact: true }).click();
    await adminPage.getByTestId('server-native-admin').waitFor();
    assert.equal(await adminPage.locator('iframe').count(), 0, 'Server administration must stay inside the native settings surface');
    assert.equal(new URL(adminPage.url()).pathname, '/view/settings');
    await adminPage.screenshot({ path: path.join(output, '17-admin-publication-policy.png'), fullPage: true });
    await adminContext.close();
  } finally {
    await browser.close();
  }
  assert.deepEqual(consoleErrors, [], `browser console errors:\n${consoleErrors.join('\n')}`);
  await writeFile(path.join(output, '..', 'manifest.json'), JSON.stringify({
    format: 'nodus.server-web-e2e-manifest',
    generatedAt: new Date().toISOString(),
    isolated: true,
    origin: server.origin,
    viewport: { desktop: [1440, 1000], mobile: [390, 844], landscape: [844, 390] },
    themes: ['dark', 'light'],
    vaults: ['academic', 'worldbuilding'],
    coverage: ['search/ideas/detail', 'authors/detail', 'graph', 'workspace', 'assistant', 'dictionary', 'deep-research/gallery-reader-ribbon-image-annotations', 'library/catalogue-reader-annotations', 'settings/providers-models-favorites', 'vault-switch', 'admin-settings', 'responsive-navigation'],
    screenshots: 19,
    diagnostics: { consoleErrors, unexpectedHttpStatuses: [] },
  }, null, 2));
  if (process.env.NODUS_E2E_INTERACTIVE === '1') {
    console.log(`[server-web-e2e] interactive origin=${server.origin} email=${reader.email} password=${reader.password}`);
    await new Promise((resolve) => process.once('SIGINT', resolve));
  }
});

console.log(`[server-web-e2e] screenshots: ${output}`);
