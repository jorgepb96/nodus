import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const builtAt = (await stat(path.join(root, 'dist/index.html'))).mtimeMs;
for (const file of ['src/views/Library.tsx', 'src/views/ManualIdeaEditor.tsx', 'src/views/WorkIdeasModal.tsx', 'electron/ai/manualIdeaIndex.ts', 'src/i18n.academicManual.ts']) {
  assert.ok((await stat(path.join(root, file))).mtimeMs <= builtAt, `Run npm run build before this E2E: ${file} is newer than the compiled app`);
}
const profile = process.env.NODUS_MANUAL_QA_PROFILE || await mkdtemp(path.join(os.tmpdir(), 'nodus-manual-ui-'));
const evidence = process.env.NODUS_MANUAL_QA_EVIDENCE || path.join(root, 'docs/verification/academic-manual');
await mkdir(profile, { recursive: true }); await mkdir(evidence, { recursive: true });
let zoteroDenied = false;
const zoteroFixture = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Last-Modified-Version', '1');
  if (zoteroDenied) { response.statusCode = 403; response.end('{}'); return; }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const collection = { key: 'MANUALCOL', version: 1, data: { key: 'MANUALCOL', name: 'Colección manual · Ejemplo', parentCollection: false } };
  const item = { key: 'SYNCDEMO', version: 1, data: { key: 'SYNCDEMO', version: 1, itemType: 'book', title: 'Fuente sincronizada · Ejemplo Zotero', creators: [], date: '2026', collections: ['MANUALCOL'], tags: [{ tag: 'leído' }] } };
  const data = pathname.endsWith('/groups') || pathname.endsWith('/MANUALCOL/collections') ? [] : /\/collections(?:\/top)?$/.test(pathname) ? [collection] : [item];
  response.setHeader('Total-Results', String(data.length)); response.end(JSON.stringify(data));
});
await new Promise(resolve => zoteroFixture.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, NODUS_ZOTERO_API_BASE: `http://127.0.0.1:${zoteroFixture.address().port}/api`, NODUS_USERDATA: profile, NODUS_PERF_JSONL: path.join(profile, 'manual-ai-requests.jsonl'), NODUS_MANUAL_INDEX_TRACE: '1', NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const results = [];
const log = message => { results.push(message); console.log(`[manual-e2e] ${message}`); };
async function boot() {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 90_000 });
  app.process().stdout?.on('data', data => { if (String(data).includes('[manual-index]')) console.log(String(data).trim()); });
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus), { timeout: 60_000 });
}
async function waitUntil(read, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error('Timed out waiting for the asynchronous application state');
}
async function settle() {
  // A new academic vault offers once to prepare its library for full-text search. It only
  // uses the local embeddings model, so Manual mode offers it too; answer it the way a
  // user postpones it, which records the choice for this vault.
  const welcome = page.getByTestId('research-preparation-welcome');
  if (await welcome.isVisible()) {
    await welcome.getByRole('button', { name: 'Más tarde', exact: true }).click();
    await welcome.waitFor({ state: 'detached' });
  }
  const hideBackup = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
  if (await hideBackup.isVisible()) await hideBackup.click();
}
try {
  await boot();
  await page.evaluate(async ({ profile, version }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4','nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.toolkitBetaGuideSeen.2.4.0','nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
    await window.nodus.updateSettings({ recoverySetupVersion: 999, mascotEnabled: false, reduceMotion: true, autoBackupFolder: `${profile}/backup`, uiLanguage: 'es' });
  }, { profile, version: require('../package.json').version });
  await page.getByTestId('tutorial-language-es').click();
  await page.getByTestId('first-vault-name').fill('Académico manual · Ejemplo');
  await page.getByTestId('first-vault-create').click();
  // The first-run start screen: Manual is an advanced option, chosen explicitly, and
  // "Not now" enters without asking for any model.
  await page.getByTestId('academic-learning-welcome').waitFor();
  await page.locator('.first-run-advanced summary').click();
  await page.getByRole('radio', { name: 'Manual', exact: true }).check();
  assert.equal(await page.getByTestId('onboarding-models').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'manual-onboarding.png') });
  await page.getByTestId('welcome-later').click();
  await page.getByTestId('library-vault-file-drop-surface').waitFor();
  // The first run starts in the Simple interface, which has no Home; the manual home is
  // the Advanced profile's (Intermediate shows a launcher there instead).
  await page.evaluate(() => window.nodus.updateSettings({ academicInterfaceProfile: 'advanced' }));
  await page.locator('[data-tour="nav-home"]').click();
  await page.getByTestId('manual-academic-home').waitFor(); await settle();
  const settings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(settings.academicMode, 'manual');
  assert.equal(settings.chatModel, null, 'Manual mode needs no generative model to start');
  assert.equal(settings.embeddingProvider, 'nodus', 'Manual ideas are indexed on this computer');
  assert.equal(settings.embeddingModel, 'multilingual-e5-small-int8');
  log('First run: Manual chosen explicitly, entered without a generative model.');
  await page.evaluate(async () => {
    await window.nodus.setApiKey('openai', 'sk-nodus-manual-test-not-a-real-key');
    await window.nodus.updateSettings({ synthesisModel: { provider: 'openai', model: 'gpt-4o-mini' } });
  });
  await page.getByRole('button', { name: /^Crear idea/ }).click();
  await page.locator('[data-testid="manual-idea-form"]:visible').waitFor();
  await page.getByTestId('manual-idea-title').fill('La memoria se construye en comunidad');
  await page.getByTestId('manual-idea-development').fill('La memoria colectiva se construye mediante **relaciones sociales**.\n\nEste ejemplo muestra una idea desarrollada manualmente, con dos fuentes y una relación elegida por el usuario.');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await waitUntil(() => page.evaluate(async () => (await window.nodus.getNotesTree()).notes.some(n => n.title === 'La memoria se construye en comunidad' && n.content.includes('relaciones sociales'))));
  assert.equal(await page.getByTestId('study-improve-toggle').count(), 0);
  const a = await page.evaluate(async () => (await window.nodus.getNotesTree()).notes.find(n => n.title === 'La memoria se construye en comunidad'));
  const fixtures = await page.evaluate(async () => {
    const global = await window.nodus.createGlobalLibraryItem({ title: 'Cuaderno de campo · Ejemplo Nodus', itemType: 'manuscript', creators: [{ creatorType: 'author', name: 'Investigadora de ejemplo' }], year: 2026 });
    const z = await window.nodus.ingestZoteroItems([{ key: 'MANUALDEMO', itemKey: 'MANUALDEMO', library: { type: 'user', id: 1 }, fields: {}, version: 1, title: 'Memoria e identidad · Ejemplo Zotero', authors: ['Autor de ejemplo'], creators: [{ creatorType: 'author', name: 'Autor de ejemplo' }], year: 2025, itemType: 'book', doi: null, abstract: '', tags: [], collections: [] }]);
    const b = await window.nodus.createManualIdea({ folderId: null, title: 'El contexto transforma los recuerdos' });
    await window.nodus.updateWorkspaceNote(b.note.id, { title: b.note.title, contentMarkdown: 'Los recuerdos cambian cuando se cuentan desde un contexto distinto. Idea de ejemplo redactada manualmente.' });
    const independent = await window.nodus.createManualIdea({ folderId: null, title: 'Pregunta abierta · Idea sin vínculos' });
    await window.nodus.updateWorkspaceNote(independent.note.id, { title: independent.note.title, contentMarkdown: '¿Qué cambia cuando una experiencia individual se convierte en relato compartido?\n\nEsta idea no necesita obras, citas ni relaciones para existir.' });
    return { global, z, b, independent };
  });
  const panel = page.locator('[data-testid="manual-idea-form"]:visible');
  await panel.getByPlaceholder('Buscar en Nodus y Zotero…').fill('Cuaderno de campo');
  await panel.getByRole('button', { name: /Cuaderno de campo/ }).click();
  await panel.getByPlaceholder('Buscar en Nodus y Zotero…').fill('Memoria e identidad');
  await panel.getByRole('button', { name: /Memoria e identidad/ }).focus(); await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: 'Añadir cita', exact: true }).click();
  await panel.getByPlaceholder('Cita textual…').fill('Ejemplo ilustrativo: «Recordamos con otros y a través de otros».');
  await panel.getByPlaceholder('p. 23 o pp. 23-25').fill('p. 12 · ejemplo');
  await panel.getByRole('button', { name: 'Añadir cita', exact: true }).click();
  await panel.getByPlaceholder('Cita textual…').last().fill('Ejemplo ilustrativo: «Cada relato conserva la perspectiva de quien lo cuenta».');
  await panel.getByPlaceholder('p. 23 o pp. 23-25').last().fill('p. 24 · ejemplo');
  await panel.getByTestId('manual-idea-citations').locator('select').last().selectOption({ label: 'Memoria e identidad · Ejemplo Zotero' });
  await panel.getByRole('button', { name: 'Añadir cita', exact: true }).click();
  await panel.getByPlaceholder('Cita textual…').last().fill('Anotación de ejemplo pendiente de localizar en una fuente.');
  await panel.getByTestId('manual-idea-citations').locator('select').last().selectOption('');
  await panel.getByPlaceholder(/Buscar.*idea/).fill('El contexto');
  await panel.getByRole('button', { name: /El contexto transforma/ }).click();
  await panel.getByRole('button', { name: 'Añadir tema', exact: true }).click();
  await panel.getByPlaceholder('Buscar o añadir tema…').fill('Tema que se cancela');
  assert.equal(await panel.getByTestId('manual-idea-themes').locator('.manual-idea-theme-chip').count(), 0, 'typing never creates a theme');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal((await page.evaluate(() => window.nodus.getThemes())).some(t => t.label.includes('cancela')), false);
  await panel.getByRole('button', { name: 'Añadir tema', exact: true }).click();
  await panel.getByPlaceholder('Buscar o añadir tema…').fill('Memoria colectiva');
  await panel.getByPlaceholder('Buscar o añadir tema…').press('Enter');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await panel.getByText('Guardado', { exact: true }).waitFor();
  const detail = await page.evaluate(id => window.nodus.getIdeaDetail(id), a.source.ref);
  assert.deepEqual(detail.themes, ['memoria colectiva']);
  assert.equal(detail.occurrences.length, 2); assert.equal(detail.evidence.length, 3);
  assert.ok(detail.evidence.some(item => !item.nodus_id), 'source-free quotation is optional');
  assert.ok(detail.idea.statement.includes('**relaciones sociales**'));
  assert.equal((await page.evaluate(id => window.nodus.getIdeaEdges(id), a.source.ref)).length, 1);
  assert.ok(await panel.locator('img[alt="Nodus"]').count()); assert.ok(await panel.locator('img[alt="Zotero"]').count());
  assert.equal(await page.getByRole('button', { name: 'Markdown crudo', exact: true }).count(), 0);
  log('Simple idea form: title, Markdown development, themes, Nodus/Zotero search (including keyboard selection), optional citation and directed relationship.');
  await page.evaluate(() => localStorage.removeItem('nodus.libraryTutorialSeen.v1'));
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-vault-header').waitFor();
  assert.equal(await page.locator('.library-status-pill').count(), 0, 'manual materials do not expose analysis retry controls');
  assert.equal(await page.getByTestId('document-index-manager-button').count(), 0);
  await page.getByTestId('library-vault-filters-toggle').click();
  assert.equal(await page.getByRole('button', { name: 'Filtros avanzados', exact: true }).count(), 0);
  await page.getByTestId(`vault-library-title-${detail.occurrences[0].nodus_id}`).click();
  const workIdeas = page.getByTestId('work-ideas-modal');
  await workIdeas.waitFor();
  assert.ok(!(await workIdeas.innerText()).includes('extraída'), 'work details describe authored ideas');
  await workIdeas.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.getByTestId('ideas-tab-idea').filter({ hasText: a.title }).click();
  log('Library exposes manual materials and authored ideas without analysis filters, status retries or document generation controls.');
  const savedEdges = await page.evaluate(id => window.nodus.getIdeaEdges(id), a.source.ref);
  await panel.getByRole('button', { name: 'Grafo', exact: true }).click();
  await page.locator(`.stellar-hit[data-node="${a.source.ref}"]`).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('graph-edit-manual-idea').click();
  await page.locator('[data-testid="manual-idea-form"]:visible').waitFor();
  assert.equal(await page.locator('[data-testid="manual-idea-form"]:visible').getByTestId('manual-idea-title').inputValue(), a.title);
  await page.getByTestId('ideas-tab-catalog').click();
  await page.getByTestId('ideas-catalog-table').getByText(fixtures.b.note.title, { exact: true }).click();
  const incomingForm = page.locator('[data-testid="manual-idea-form"]:visible');
  await incomingForm.getByTestId('manual-idea-development').fill('Los recuerdos cambian según el contexto. Desarrollo de ejemplo revisado desde el otro extremo de la relación.');
  await incomingForm.getByRole('button', { name: 'Guardar', exact: true }).click();
  await incomingForm.getByText('Guardado', { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(id => window.nodus.getIdeaEdges(id), a.source.ref)).map(row => [row.edge.id, row.edge.from_id, row.edge.to_id]), savedEdges.map(row => [row.edge.id, row.edge.from_id, row.edge.to_id]));
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId(`workspace-item-${a.id}`).click();
  // Since the Scriptor workspace (#1124, #1136) a manual idea opens as its text in the
  // editor, with its works, citations and relations in the side panel (`linksOnly`).
  await page.locator('[contenteditable="true"]:visible', { hasText: 'La memoria colectiva se construye mediante' }).first().waitFor();
  await page.getByRole('button', { name: 'Contexto', exact: true }).first().click();
  await page.locator('[data-testid="manual-idea-form"]:visible').first().waitFor();
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.getByTestId('ideas-tab-idea').filter({ hasText: a.title }).click();
  log('Graph opens the idea form and Scriptor opens the idea with its links panel; editing the destination preserves the original relationship identity and direction.');
  const blocked = await page.evaluate(async id => {
    const checks = [() => window.nodus.processFull(id), () => window.nodus.rescan(id, 'deep'), () => window.nodus.summarizeWork(id), () => window.nodus.discoverSemanticBridges(), () => window.nodus.reprocessThemeConnections({ relations: true }), () => window.nodus.reprocessRepairedThemeWorks(), () => window.nodus.startDocumentIndexCampaign({ nodusIds: [id] })];
    return Promise.all(checks.map(async run => { try { await run(); return 'NOT BLOCKED'; } catch (e) { return String(e); } }));
  }, detail.occurrences[0].nodus_id);
  assert.ok(blocked.every(result => /modo Manual|manual/i.test(result)), JSON.stringify(blocked));
  assert.equal((await page.evaluate(() => window.nodus.getQueue())).total, 0);
  log('Backend guards reject generative corpus operations with an empty scan queue.');
  // Graph health stays available in Manual mode: it is plain SQL. Manual ideas are owned by
  // their notes, so the audit must not call them ideas without a work, and a repair must
  // leave every one of them visible.
  const health = await page.evaluate(() => window.nodus.checkGraphIntegrity());
  assert.equal(health.checks.find(item => item.id === 'active_ideas_without_works').count, 0, JSON.stringify(health.checks));
  const healthRepair = await page.evaluate(() => window.nodus.repairGraphIntegrity());
  assert.equal(healthRepair.counts.sleptIdeas, 0, 'the repair puts no manual idea to sleep');
  assert.ok(healthRepair.backupPath, 'the manual repair takes a backup first');
  assert.equal((await page.evaluate(id => window.nodus.getIdeaDetail(id), a.source.ref))?.idea?.global_id, a.source.ref, 'the manual idea is still there after the repair');
  log('Graph health checks and repairs a Manual vault without touching its note-owned ideas.');
  await waitUntil(() => page.evaluate(async () => (await window.nodus.getManualIndexStatus()).state === 'ready'), 240_000);
  const search = await page.evaluate(() => window.nodus.semanticSearch('experiencia individual relato compartido', { kinds: ['idea'], minSimilarity: 0, limit: 10 }));
  assert.ok(search.results.some(hit => hit.id === fixtures.independent.globalId), 'standalone idea is retrieved through real local semantic search');
  await page.evaluate(async ({ id, title }) => window.nodus.updateWorkspaceNote(id, { title, contentMarkdown: '¿Cómo se convierte una experiencia individual en un relato compartido? Esta pregunta revisada es independiente y no necesita vínculos.' }), { id: fixtures.independent.note.id, title: fixtures.independent.note.title });
  await waitUntil(() => page.evaluate(async () => (await window.nodus.getManualIndexStatus()).state === 'ready'), 240_000);
  const revisedSearch = await page.evaluate(() => window.nodus.semanticSearch('pregunta revisada experiencia relato compartido', { kinds: ['idea'], minSimilarity: 0, limit: 10 }));
  assert.ok(revisedSearch.results.find(hit => hit.id === fixtures.independent.globalId)?.snippet.includes('revisada'));
  const requests = (await readFile(path.join(profile, 'manual-ai-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(event => event.phase === 'AI inference');
  assert.ok(requests.length >= 5, 'real inference events were recorded');
  assert.ok(requests.every(event => event.meta.class === 'embedding' && event.meta.provider === 'nodus'), 'manual workflow invoked local embeddings only, with a generative model and key configured');
  await writeFile(path.join(evidence, 'ai-requests.json'), JSON.stringify(requests, null, 2));
  log('Real Multilingual E5 Small inference, edited standalone idea and semantic search verified; instrumentation records embeddings only.');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme); await page.reload(); await settle();
    await page.locator('[data-tour="nav-ideas"]').click();
    await page.getByText('La memoria se construye en comunidad', { exact: true }).first().click();
    await page.locator('[data-testid="manual-idea-form"]:visible').waitFor();
    if (theme === 'light') {
      await panel.getByRole('button', { name: 'Quitar: memoria colectiva', exact: true }).click();
      await panel.getByRole('button', { name: 'Añadir tema', exact: true }).click();
      await panel.getByPlaceholder('Buscar o añadir tema…').fill('memor');
      assert.equal(await panel.locator('.manual-idea-theme-chip').count(), 0);
      await panel.getByRole('option', { name: 'memoria colectiva', exact: true }).click();
      assert.equal(await panel.locator('.manual-idea-theme-chip').count(), 1, 'existing theme adds on selection');
      await panel.getByPlaceholder('Buscar o añadir tema…').fill('MEMORIA COLECTIVA');
      await panel.getByPlaceholder('Buscar o añadir tema…').press('Enter');
      assert.equal(await panel.locator('.manual-idea-theme-chip').count(), 1, 'Enter on an existing theme never duplicates it');
      await panel.getByPlaceholder('Buscar o añadir tema…').press('Escape');
      assert.equal(await panel.getByPlaceholder('Buscar o añadir tema…').count(), 0);
      await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
      await panel.getByText('Guardado', { exact: true }).waitFor();
    }
    const boxes = await panel.evaluate(form => {
      const box = selector => { const r = form.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right }; };
      return { citations: box('.manual-idea-citations'), center: box('.manual-idea-center'), works: box('.manual-idea-works'), title: box('[data-testid="manual-idea-title"]'), themes: box('.manual-idea-themes'), development: box('[data-testid="manual-idea-development"]'), overflow: form.scrollWidth > form.clientWidth };
    });
    assert.ok(boxes.citations.right <= boxes.center.x && boxes.center.right <= boxes.works.x, 'citations left, idea center, works right');
    assert.ok(boxes.title.y < boxes.themes.y && boxes.themes.y < boxes.development.y, 'title, then themes, then development');
    assert.equal(boxes.overflow, false);
    await page.screenshot({ path: path.join(evidence, `manual-editor-${theme}.png`) });
  }
  await page.locator('[data-tour="nav-graph"]').click();
  await page.getByTestId('graph-view').waitFor();
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  assert.ok(graph.nodes.some(n => n.id === fixtures.independent.globalId)); assert.ok(graph.edges.length);
  await page.screenshot({ path: path.join(evidence, 'manual-graph.png') });
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.getByTestId('ideas-tab-catalog').click();
  assert.ok(await page.getByTestId('manual-create-idea').isVisible());
  await page.getByText('La memoria se construye en comunidad', { exact: true }).first().click();
  await page.locator('[data-testid="manual-idea-form"]:visible').waitFor();
  const original = await page.evaluate(() => window.nodus.getActiveVault());
  const duplicate = await page.evaluate(id => window.nodus.duplicateVault(id, 'QA · Duplicado manual'), original.id);
  await page.evaluate(id => window.nodus.switchVault(id), duplicate.vault.id);
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).academicMode, 'manual');
  await page.evaluate(id => window.nodus.switchVault(id), original.id);
  await page.evaluate(id => window.nodus.deleteVault(id, true), duplicate.vault.id);
  log('Mode and authored content survive duplication.');
  const auto = await page.evaluate(() => window.nodus.createVault({ name: 'QA · Auto', type: 'academic' }));
  await page.evaluate(id => window.nodus.switchVault(id), auto.vault.id); await page.reload();
  await page.getByTestId('onboarding-mode-auto').waitFor();
  await page.getByTestId('onboarding-mode-auto').click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByTestId('onboarding-models').waitFor();
  // Start waits for both models, except in the Simple profile, which reuses the chat model
  // the person already chose (#1136) — and this test chose one above.
  const fresh = await page.evaluate(() => window.nodus.getSettings());
  const reusesChatModel = fresh.academicInterfaceProfile === 'simple' && Boolean(fresh.chatModel || fresh.synthesisModel);
  assert.equal(await page.getByTestId('onboarding-start').isDisabled(), !reusesChatModel);
  await page.evaluate(id => window.nodus.switchVault(id), original.id);
  await page.evaluate(id => window.nodus.deleteVault(id, true), auto.vault.id);
  await page.reload(); await settle();
  log('Additional academic vault retains Auto model selection and validation.');
  async function addViaWizard(name) {
    await page.getByTestId('header-vault-badge').click();
    await page.getByRole('button', { name: 'Añadir', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Añadir bóveda' });
    await dialog.getByPlaceholder('Nombre de la bóveda').fill(name);
    await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByTestId('onboarding-mode-manual').waitFor();
  }
  await addViaWizard('QA · Cancelación');
  await page.getByTestId('onboarding-mode-manual').click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await page.getByRole('button', { name: 'Seguir configurando', exact: true }).click();
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await page.getByRole('button', { name: 'Salir y descartar', exact: true }).click();
  await waitUntil(() => page.evaluate(async () => !(await window.nodus.listVaults()).some(v => v.name === 'QA · Cancelación')));
  await addViaWizard('QA · Manual adicional');
  await page.getByTestId('onboarding-mode-manual').click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  zoteroDenied = true;
  await page.getByTestId('onboarding-library-zotero').click();
  await page.getByTestId('onboarding-zotero-error').waitFor();
  zoteroDenied = false;
  await page.getByRole('button', { name: 'Verificar conexión', exact: true }).click();
  await page.getByText(/Conectado \(userID/).waitFor();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByText('Colección manual · Ejemplo', { exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByTestId('onboarding-start').click();
  // A new academic vault starts in the Simple profile, which has no Home (#1136): wait for
  // the wizard to finish instead of for the Advanced profile's manual home.
  await waitUntil(() => page.evaluate(async () => { const s = await window.nodus.getSettings(); return s.onboardingComplete && s.academicMode === 'manual'; }));
  const extraManual = await page.evaluate(() => window.nodus.getActiveVault());
  assert.ok((await page.evaluate(() => window.nodus.listWorks())).some(work => work.title === 'Fuente sincronizada · Ejemplo Zotero'));
  assert.equal((await page.evaluate(() => window.nodus.getGraph('ideas'))).nodes.length, 0, 'sync adds bibliography without generated ideas');
  assert.equal((await page.evaluate(() => window.nodus.getQueue())).total, 0);
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).academicMode, 'manual');
  await page.evaluate(id => window.nodus.switchVault(id), original.id);
  await page.evaluate(id => window.nodus.deleteVault(id, true), extraManual.id);
  await page.reload(); await settle();
  log('Additional Manual + Zotero wizard: recoverable connection error, selected collection sync without generated ideas; keyboard, back and cancel/discard verified.');
  await app.close(); app = null; await boot();
  await settle();
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).academicMode, 'manual');
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.getByText('La memoria se construye en comunidad', { exact: true }).first().click();
  await page.locator('[data-testid="manual-idea-form"]:visible').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible())?.setSize(1100, 780));
  await page.waitForFunction(() => window.innerWidth <= 1100);
  const restartedPanel = page.locator('[data-testid="manual-idea-form"]:visible');
  assert.equal(await restartedPanel.evaluate(form => form.scrollWidth > form.clientWidth), false, 'compact form has no horizontal overflow');
  const stacked = await restartedPanel.evaluate(form => form.querySelector('.manual-idea-citations').getBoundingClientRect().y > form.querySelector('.manual-idea-center').getBoundingClientRect().y);
  assert.ok(stacked, 'sidebars move below the idea on compact windows');
  await page.screenshot({ path: path.join(evidence, 'manual-editor-compact.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible())?.setSize(1440, 950));
  log('Three-column layout in light/dark, responsive layout, existing theme selection, explicit Enter creation and cancellation verified.');
  log('Full app restart preserves the manual vault, editor, citations, relationships and index.');
  await page.evaluate(async () => { await window.nodus.clearApiKey('openai'); await window.nodus.updateSettings({ synthesisModel: null }); });
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'e2e-results.json'), JSON.stringify({ profile, results, errors }, null, 2));
  console.log(`DEMO_PROFILE=${profile}`);
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(-6500)); }
  throw error;
} finally { await app?.close(); await new Promise(resolve => zoteroFixture.close(resolve)); }
