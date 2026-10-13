import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-scriptor-polish-'));
const output = path.join(root, 'output/qa/scriptor-polish');
await mkdir(output, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app;
const errors = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1' })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    localStorage.setItem('nodus.sidebarWidth', '246');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: true, academicMode: 'manual' });
  }, require('../package.json').version);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  const fixture = await page.evaluate(async () => {
    const folder = await window.nodus.createNoteFolder({ name: 'Tesis · Memoria y territorio' });
    const prompt = await window.nodus.createStudyStyle({ name: 'Mi prompt guardado', prompt: 'Mejora la claridad sin añadir información nueva.', icon: 'wand', active: true });
    await window.nodus.updateSettings({ studyImproveToolbarStyleIds: [prompt.id] });
    const note = await window.nodus.createNote({ title: 'La mirada turística y la memoria del paisaje', content: '', folderId: folder.id });
    const props = { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' };
    const native = [
      { id: 'title-block', type: 'heading', props: { ...props, level: 2, isToggleable: false }, content: [{ type: 'text', text: 'La memoria del paisaje', styles: {} }], children: [] },
      { id: 'argument-block', type: 'paragraph', props, content: [{ type: 'text', text: 'La mirada turística', styles: { bold: true } }, { type: 'text', text: ' construye una memoria del paisaje.', styles: {} }], children: [] },
      { id: 'reference-block', type: 'paragraph', props, content: [{ type: 'text', text: 'Referencias: ', styles: {} }], children: [] },
      { id: 'untouched-block', type: 'paragraph', props: { ...props, nodusEvidence: 'keep-me' }, content: [{ type: 'text', text: 'Esta fuente conserva su color y su identificador.', styles: { textColor: '#b04a72' } }], children: [] },
    ];
    await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '', nativeDocument: native });
    const notes = [note.id];
    for (let i = 1; i <= 7; i++) notes.push((await window.nodus.createNote({ title: `Documento ${i} · Un título largo para comprobar las pestañas`, content: `Texto del documento ${i}.`, folderId: folder.id })).id);
    return { noteId: note.id, promptId: prompt.id, notes };
  });
  const referenceFixture = await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < 65; i++) { const created = await window.nodus.createManualIdea({ folderId: null, title: `Memoria audit ${String(i).padStart(3, '0')}` }); ids.push(created.globalId); }
    return { ids, vault: await window.nodus.getActiveVault() };
  });
  await app.evaluate((_electron, args) => {
    const request = process.getBuiltinModule('module').createRequire(args.root + '/package.json');
    const Database = request('better-sqlite3'), db = new Database(args.file);
    try {
      db.prepare('INSERT INTO authors(author_id,name) VALUES(?,?)').run('audit-author', 'Alba [historiadora]');
      db.prepare('INSERT INTO works(nodus_id,title,year) VALUES(?,?,?)').run('audit-work', 'Memoria y territorio', 2026);
    } finally { db.close(); }
  }, { root, file: referenceFixture.vault.path });
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + fixture.noteId).click();
  const editor = page.locator('.nodus-blocknote .bn-editor');
  await editor.waitFor();
  const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
  if (await warning.isVisible().catch(() => false)) await warning.click();
  const capture = async name => {
    if (await warning.isVisible().catch(() => false)) await warning.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(output, name + '.png') });
  };
  const assertBounds = async () => {
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return { workspace: rect('.editorial-workspace'), header: rect('.editorial-editor-header'), navigator: rect('.editorial-navigator'), inspector: rect('.editorial-inspector'), headerScroll: document.querySelector('.editorial-editor-header').scrollWidth, headerWidth: document.querySelector('.editorial-editor-header').clientWidth };
    });
    assert.ok(geometry.headerScroll <= geometry.headerWidth + 1, 'header never scrolls horizontally');
    for (const name of ['navigator', 'inspector']) if (geometry[name]) {
      assert.ok(geometry[name].left >= geometry.workspace.left - 1, name + ' stays inside workspace');
      assert.ok(geometry[name].top >= geometry.header.bottom - 1, name + ' stays below header');
    }
  };
  for (const { width, height } of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize({ width, height });
    const before = await page.getByTestId('workspace-tab-home').boundingBox();
    await page.getByRole('button', { name: 'Navegador de documentos', exact: true }).click();
    await page.locator('.editorial-navigator').waitFor();
    await page.getByRole('button', { name: 'Contexto', exact: true }).click();
    await page.locator('.editorial-inspector').waitFor();
    await assertBounds();
    const after = await page.getByTestId('workspace-tab-home').boundingBox();
    assert.equal(after.y, before.y, 'tabs keep their vertical position');
    assert.equal(after.x, before.x, 'tabs keep their horizontal position');
    await capture('panels-' + width);
    await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click();
    const menu = page.locator('.editorial-options-panel');
    await menu.waitFor();
    assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'options never scroll horizontally');
    assert.ok(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+30));}),'inspector cannot cover document options');
    await capture('options-' + width);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cerrar contexto', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar navegador', exact: true }).click();
  }
  // The real [[ controller searches the complete vault, including results beyond page one.
  await page.locator('[data-id="reference-block"] .bn-inline-content').click(); await page.keyboard.press('Meta+ArrowRight');
  assert.equal(await editor.evaluate(element=>getComputedStyle(element).outlineStyle),'none','editing uses the caret without a large focus frame');
  for (const {width,height} of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]) {
    await page.setViewportSize({width,height});
    await page.keyboard.type('[[');
    const menu = page.getByTestId('editor-reference-menu'); await menu.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-reference-href]').length > 0);
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width <= width+1 && bounds.y+bounds.height <= height+1, 'reference menu stays inside viewport');
    assert.ok(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'reference menu has no horizontal scrolling');
    await capture('references-'+width);
    await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('[[Memoria audit');
  await page.getByTestId('editor-reference-menu').waitFor();
  await page.waitForFunction(()=>document.querySelector('.editorial-reference-menu header small')?.textContent==='65');
  await page.keyboard.press('PageDown'); await page.locator(`[data-reference-href="nodus://idea/${referenceFixture.ids.at(-1)}"]`).waitFor(); await page.keyboard.press('Enter');
  await page.locator(`.bn-editor a[href="nodus://idea/${referenceFixture.ids.at(-1)}"]`).waitFor();
  await page.keyboard.type('[[historiadora');
  await page.locator('[data-reference-href="nodus://author/audit-author"]').click();
  await page.locator('.bn-editor a[href="nodus://author/audit-author"]').waitFor();
  await page.keyboard.type('[[zz-no-result');
  await page.getByTestId('editor-reference-menu').getByRole('status').waitFor();
  await page.keyboard.press('Enter');
  assert.match(await editor.innerText(), /\[\[zz-no-result/, 'Enter on no results preserves literal input');
  for (let i=0;i<14;i++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+s');
  await page.getByTestId('workspace-tab-home').click();
  const linked = await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId);
  assert.ok(linked.contentMarkdown.includes('[Alba \\[historiadora\\]](nodus://author/audit-author)'), 'reference titles escape Markdown brackets');
  await page.getByTestId('workspace-item-'+fixture.noteId).click(); await editor.waitFor();
  assert.deepEqual((await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId)).nativeDocument,linked.nativeDocument,'reopen keeps native references and block IDs');
  await page.getByRole('button',{name:'Contexto',exact:true}).click();
  assert.match(await page.getByTestId('editor-linked-references').innerText(),/Memoria audit 064/);
  await capture('linked-context');
  await page.getByRole('button',{name:'Cerrar contexto',exact:true}).click();
  await page.locator('.bn-editor a[href="nodus://author/audit-author"]').click();
  await page.getByTestId('authors-workspace').waitFor(); await page.getByTestId('author-detail').waitFor();
  assert.match(await page.getByTestId('author-detail').innerText(),/Alba/);
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-tab-'+fixture.noteId).click(); await editor.waitFor();
  // All tabs remain at the same height through asynchronous document loading.
  await page.setViewportSize({ width: 1440, height: 900 });
  const headerY = (await page.getByTestId('workspace-tab-home').boundingBox()).y;
  for (const id of fixture.notes.slice(1)) {
    await page.getByTestId('workspace-tab-home').click();
    assert.equal((await page.getByTestId('workspace-tab-home').boundingBox()).y, headerY);
    await page.getByTestId('workspace-item-' + id).click();
    await editor.waitFor();
    assert.equal((await page.getByTestId('workspace-tab-home').boundingBox()).y, headerY);
    await assertBounds();
  }
  await page.getByTestId('workspace-tab-' + fixture.noteId).click();
  await editor.waitFor();
  await capture('many-tabs');
  await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click();
  await page.getByTestId('study-improve-toggle').click();
  await page.getByTestId('study-improve-dialog').waitFor();
  await page.getByTestId('study-style-' + fixture.promptId.replace(':', '-')).click();
  assert.match(await page.getByTestId('study-prompt-detail').innerText(), /Mi prompt guardado/);
  await capture('saved-prompts');
  await page.getByTestId('study-improve-dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.keyboard.press('Escape');
  // Replace only the AI transport with a deterministic stream, never call a real provider.
  await app.evaluate(({ ipcMain }) => {
    const controllers = new Map();
    ipcMain.removeHandler('study:improve');
    ipcMain.removeHandler('study:improve:cancel');
    ipcMain.removeHandler('study:improve:action');
    ipcMain.handle('study:improve', async (event, id, request) => {
      const controller = { cancelled: false };
      controllers.set(id, controller);
      const chunks = ['La mirada turística ', 'transforma la memoria ', 'del paisaje.'];
      for (const delta of chunks) {
        await new Promise(resolve => setTimeout(resolve, 600));
        if (controller.cancelled) throw new Error('Cancelled');
        event.sender.send('study:improve:delta', id, delta);
      }
      await new Promise(resolve => setTimeout(resolve, 3500));
      if (controller.cancelled) throw new Error('Cancelled');
      controllers.delete(id);
      return { logId: 'controlled-qa', text: chunks.join(''), styleId: request.styleId, warnings: [], protectedSpanCount: 0, modelProvider: 'qa', modelName: 'controlled', originalHash: '', resultHash: '', estimatedInputTokens: 10, estimatedOutputTokens: 10 };
    });
    ipcMain.handle('study:improve:cancel', (_event, id) => { const controller = controllers.get(id); if (controller) controller.cancelled = true; });
    ipcMain.handle('study:improve:action', async () => undefined);
  });
  const selectArgument = async () => {
    await page.locator('[data-id="argument-block"] .bn-inline-content').click();
    await page.evaluate(() => {
      const paragraph = document.querySelector('[data-id="argument-block"] .bn-inline-content');
      const range = document.createRange(); range.selectNodeContents(paragraph);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(100);
    await page.locator('.editorial-editor-body').dispatchEvent('mouseup');
    await page.getByTestId('study-selection-improve').waitFor();
  };
  const originalText = await editor.innerText();
  const storedBeforeStreaming = await page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, fixture.noteId);
  await selectArgument();
  await capture('selection-ai');
  await page.getByTestId('study-selection-improve').click();await page.getByTestId('scriptor-ai-send').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="scriptor-ai-added"]')?.textContent?.includes('La mirada turística'));
  assert.deepEqual(await page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, fixture.noteId), storedBeforeStreaming, 'preview leaves stored native document intact');
  const titleBefore = await page.getByTestId('editor-title').boundingBox();
  for (const {width,height} of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]) {
    await page.setViewportSize({width,height});
    const preview = page.getByTestId('scriptor-ai-panel');
    assert.notEqual(await preview.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','AI panel has an opaque Nodus paper surface');
    assert.ok((await preview.boundingBox()).height <= 240,'AI feedback is compact');
    await capture('streaming-'+width);
  }
  await capture('streaming');
  await page.getByTestId('scriptor-ai-accept').click();
  await page.getByTestId('study-improve-complete').waitFor();
  await capture('improvement-complete');
  assert.match(await editor.innerText(), /transforma la memoria del paisaje/);
  await page.getByTestId('study-improve-undo').click();
  assert.equal(await editor.innerText(), originalText, 'one undo restores original text and formatting');
  assert.ok(await page.locator('[data-id="argument-block"] strong').count(), 'bold original survives undo');
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(async id => {
    const data = await window.nodus.getWorkspaceNoteEditorData(id);
    return data.nativeDocument?.some(block => block.id === 'argument-block' && JSON.stringify(block).includes('construye'));
  }, fixture.noteId);
  const beforeCancel = await page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, fixture.noteId);
  await selectArgument();
  await page.getByTestId('study-selection-improve').click();
  await page.getByTestId('scriptor-ai-send').click();
  await page.locator('[data-testid=scriptor-ai-panel][data-streaming=true]').waitFor();
  await page.getByTestId('study-improve-cancel').click();
  await page.locator('[data-testid=scriptor-ai-panel][data-streaming=true]').waitFor({ state: 'hidden' });
  assert.equal(await editor.innerText(), originalText, 'cancel preserves original');
  assert.equal(await page.getByTestId('study-improve-stream-error').count(), 0, 'cancel is not an error');
  assert.deepEqual(await page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, fixture.noteId), beforeCancel, 'cancel does not save partial stream');
  assert.equal(beforeCancel.find(block => block.id === 'untouched-block').props.nodusEvidence, 'keep-me');
  assert.equal(beforeCancel.find(block => block.id === 'untouched-block').content[0].styles.textColor, '#b04a72');
  // Native full screen and temporary sidebar changes; existing sidebar preference survives.
  const sidebarBefore = await page.evaluate(() => localStorage.getItem('nodus.navCollapsed'));
  await page.getByRole('button', { name: 'Foco', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('[data-editorial-focus="true"]'));
  assert.equal(await page.getByTestId('resizable-sidebar').count(), 0);
  await capture('focus');
  await page.getByTestId('editorial-focus-navigation').click();
  await page.getByTestId('resizable-sidebar').waitFor();
  await page.getByRole('button', { name: 'Navegador de documentos', exact: true }).click();
  await page.getByRole('button', { name: 'Contexto', exact: true }).click();
  await page.locator('.editorial-navigator').waitFor();
  await page.locator('.editorial-inspector').waitFor();
  await assertBounds();
  await capture('focus-panels');
  await page.getByRole('button', { name: 'Salir de foco', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('[data-editorial-focus="true"]'));
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.navCollapsed')), sidebarBefore);
  await page.getByRole('button', { name: 'Cerrar contexto', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar navegador', exact: true }).click();
  await page.keyboard.press('Meta+s'); await page.waitForFunction(()=>document.querySelector('[data-testid="study-editor-save-state"]')?.textContent==='Guardado');
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.reload();
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + fixture.noteId).click();
  await editor.waitFor();
  await capture('dark');
  await page.locator('[data-id="reference-block"] .bn-inline-content').evaluate(element=>{element.closest('.bn-editor').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.waitForTimeout(50);
  await page.keyboard.type('[['); await page.getByTestId('editor-reference-menu').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-reference-href]').length > 0);
  await capture('references-dark');
  await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, errors, checks: ['stable header and tabs', 'bounded panels', 'no horizontal menu scrolling', 'saved custom prompts in manual mode', 'selection AI including rich text', 'visible streaming', 'cancel preserves native JSON', 'one-step undo preserves rich text, IDs and custom properties', 'native fullscreen and optional sidebars', 'unchanged sidebar preference', 'dark theme', 'all 65 ideas reachable with keyboard', 'native links to ideas and authors', 'link persistence and Markdown escaping', 'reference context and real author navigation', 'compact white AI preview'], aiTransport: 'controlled IPC stream; no provider request' }, null, 2));
  console.log('Scriptor polish QA passed:', output);
} catch (error) {
  if (app) { const page = app.windows()[0]; if (page) { console.error('Visible error:', await page.locator('[data-testid=study-improve-stream-error]').allTextContents()); console.error('Focus state:', await page.evaluate(() => ({ fullscreen: Boolean(document.fullscreenElement), shell: document.querySelector('[data-testid=app-shell]')?.getAttribute('data-editorial-focus') })));  await page.screenshot({ path: path.join(output, 'failure.png') }); } }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
