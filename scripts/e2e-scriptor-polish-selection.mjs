import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-polish-selection-'));
const output = path.join(root, 'output/qa/scriptor-polish-selection');
await mkdir(output, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app, page;
const errors = [], checks = [];

try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 90000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key, value] of Object.entries({
      'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1',
      'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1',
      'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1',
    })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: true, academicMode: 'manual' });
  }, require('../package.json').version);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await app.evaluate(({ ipcMain }) => {
    globalThis.selectionRequests = [];
    globalThis.selectionActions = [];
    globalThis.selectionMode = 'normal';
    globalThis.selectionRelease = false;
    const controllers = new Map();
    for (const channel of ['study:improve', 'study:improve:cancel', 'study:improve:action']) ipcMain.removeHandler(channel);
    ipcMain.handle('study:improve', async (event, id, request) => {
      const controller = { cancelled: false };
      controllers.set(id, controller);
      globalThis.selectionRequests.push(request);
      const mode = globalThis.selectionMode;
      const text = request.text + ' Texto pulido.';
      event.sender.send('study:improve:delta', id, text);
      while (mode === 'late' && !globalThis.selectionRelease) await new Promise(resolve => setTimeout(resolve, 20));
      if (controller.cancelled && mode !== 'late') throw new Error('Cancelled');
      controllers.delete(id);
      return { logId: id, text, styleId: request.styleId, warnings: [], protectedSpanCount: 0, modelProvider: 'qa', modelName: 'controlled', originalHash: '', resultHash: '', estimatedInputTokens: 5, estimatedOutputTokens: 5 };
    });
    ipcMain.handle('study:improve:cancel', (_, id) => { const controller = controllers.get(id); if (controller) controller.cancelled = true; });
    ipcMain.handle('study:improve:action', (_, id, action) => { globalThis.selectionActions.push({ id, action }); });
  });

  const props = { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' };
  const native = [
    { id: 'first', type: 'paragraph', props, content: [{ type: 'text', text: 'La memoria del paisaje.', styles: {} }], children: [] },
    { id: 'second', type: 'paragraph', props, content: [{ type: 'text', text: 'El paisaje', styles: { bold: true } }, { type: 'text', text: ' conserva una memoria.', styles: {} }], children: [] },
    { id: 'duplicate', type: 'paragraph', props: { ...props, nodusEvidence: 'keep' }, content: [{ type: 'text', text: 'La memoria del paisaje.', styles: { italic: true } }], children: [] },
    { id: 'protected', type: 'paragraph', props, content: [{ type: 'text', text: 'Una fórmula ', styles: {} }, { type: 'nodusFormula', props: { formula: 'x^2' } }, { type: 'text', text: ' protegida.', styles: {} }], children: [] },
  ];
  const noteId = await page.evaluate(async native => {
    const note = await window.nodus.createNote({ title: 'Selección de Pulir', content: '' });
    await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '', nativeDocument: native });
    return note.id;
  }, native);
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + noteId).click();
  const editor = page.locator('.nodus-blocknote .bn-editor');
  await editor.waitFor();
  const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
  if (await warning.isVisible().catch(() => false)) await warning.click();
  const saved = () => page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, noteId);
  const original = await saved();
  const select = async (id, keyboard = false, dispatchEditorEvent = true) => {
    const inline = page.locator(`[data-id="${id}"] .bn-inline-content`);
    await inline.scrollIntoViewIfNeeded();
    await inline.evaluate(element => {
      element.closest('.bn-editor').focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(100);
    if (!dispatchEditorEvent) return;
    await inline.dispatchEvent(keyboard ? 'keyup' : 'mouseup', keyboard ? { key: 'Shift' } : {});
    await page.getByTestId('study-selection-improve').waitFor();
  };
  const open = async () => {
    await select('first');
    await page.getByTestId('study-selection-improve').click();
    await page.getByTestId('scriptor-ai-panel').waitFor();
  };
  const send = async text => {
    // Moving focus to the prompt must retain the most recent editor selection.
    await page.getByTestId('scriptor-ai-input').fill('Conserva el sentido.');
    await page.getByTestId('scriptor-ai-send').click();
    await page.getByTestId('scriptor-ai-accept').waitFor();
    const request = await app.evaluate(() => globalThis.selectionRequests.at(-1));
    assert.equal(request.text, text, 'Pulir sends the most recently selected text');
    assert.equal(request.variables.selectedText, text);
  };
  const acceptAndUndo = async id => {
    await page.getByTestId('scriptor-ai-accept').click();
    await page.waitForFunction(async ({ noteId, id }) => {
      const blocks = (await window.nodus.getWorkspaceNoteEditorData(noteId)).nativeDocument;
      return JSON.stringify(blocks.find(block => block.id === id)).includes('Texto pulido.');
    }, { noteId, id });
    const accepted = await saved();
    for (const block of original.filter(block => block.id !== id)) assert.deepEqual(accepted.find(entry => entry.id === block.id), block, 'only the latest selected block changes');
    const before = original.find(block => block.id === id), after = accepted.find(block => block.id === id);
    assert.deepEqual(after.props, before.props);
    assert.deepEqual(after.content[0].styles, before.content[0].styles);
    await page.getByTestId('study-editor-undo').click();
    await page.waitForFunction(async ({ noteId, original }) => JSON.stringify((await window.nodus.getWorkspaceNoteEditorData(noteId)).nativeDocument) === JSON.stringify(original), { noteId, original });
  };

  await open();
  await select('second');
  await send('El paisaje conserva una memoria.');
  await acceptAndUndo('second');
  checks.push('mouse selection updates an open composer; acceptance and undo preserve other blocks and formatting');

  await open();
  await select('second', false, false);
  await send('El paisaje conserva una memoria.');
  await acceptAndUndo('second');
  checks.push('submission reads the latest native selection even without an editor mouseup or keyup event');

  await open();
  await send('La memoria del paisaje.');
  await select('second', false, false);
  await send('El paisaje conserva una memoria.');
  await acceptAndUndo('second');
  checks.push('regeneration reads a changed native selection without editor events');

  await open();
  await send('La memoria del paisaje.');
  const requestsBeforeProtected = await app.evaluate(() => globalThis.selectionRequests.length);
  await select('protected', false, false);
  await page.getByTestId('scriptor-ai-send').click();
  await page.getByTestId('scriptor-ai-error').waitFor();
  assert.equal(await app.evaluate(() => globalThis.selectionRequests.length), requestsBeforeProtected);
  assert.equal(await page.getByTestId('scriptor-ai-accept').count(), 0, 'a preflight failure cannot leave an old proposal attached to the new range');
  assert.deepEqual(await saved(), original);
  await page.getByTestId('scriptor-ai-close').click();
  checks.push('a protected new selection clears the old proposal before preflight and makes no provider request');

  await open();
  await select('duplicate', true);
  await send('La memoria del paisaje.');
  await acceptAndUndo('duplicate');
  checks.push('keyboard selection distinguishes identical text at different native ranges');

  await open();
  await send('La memoria del paisaje.');
  const reviewLogId = await app.evaluate(() => globalThis.selectionActions.length);
  await select('second');
  assert.equal(await page.getByTestId('scriptor-ai-accept').count(), 0, 'changing selection clears the previous proposal');
  assert.equal(await page.getByTestId('scriptor-ai-added').count(), 0);
  assert.deepEqual(await saved(), original);
  assert.equal((await app.evaluate(() => globalThis.selectionActions)).length, reviewLogId + 1);
  assert.equal((await app.evaluate(() => globalThis.selectionActions)).at(-1).action, 'rejected');
  await send('El paisaje conserva una memoria.');
  await page.getByTestId('scriptor-ai-reject').click();
  await page.getByTestId('scriptor-ai-close').click();
  checks.push('a new selection rejects the old proposal without editing the document');

  await open();
  await app.evaluate(() => { globalThis.selectionMode = 'late'; });
  await page.getByTestId('scriptor-ai-send').click();
  await page.getByTestId('scriptor-ai-added').first().waitFor();
  await select('second');
  await page.getByTestId('study-improve-cancel').waitFor({ state: 'hidden' });
  await app.evaluate(() => { globalThis.selectionMode = 'normal'; });
  await send('El paisaje conserva una memoria.');
  await app.evaluate(() => { globalThis.selectionRelease = true; });
  await page.waitForTimeout(300);
  await acceptAndUndo('second');
  checks.push('selection during streaming cancels the old request and ignores its late response');

  await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown crudo', exact: true }).click();
  if (await page.locator('.editorial-editor-header .editorial-options').getAttribute('open') !== null) await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click();
  const raw = page.getByTestId('study-markdown-editor');
  await raw.waitFor();
  const rawOriginal = await raw.inputValue();
  const selectRaw = async (text, keyboard = false) => {
    await raw.evaluate((element, text) => {
      element.focus();
      const from = element.value.indexOf(text);
      element.setSelectionRange(from, from + text.length);
    }, text);
    await raw.dispatchEvent(keyboard ? 'keyup' : 'mouseup', keyboard ? { key: 'Shift' } : {});
    await page.getByTestId('study-selection-improve').waitFor();
  };
  await selectRaw('La memoria del paisaje.');
  await page.getByTestId('study-selection-improve').click();
  await page.getByTestId('scriptor-ai-panel').waitFor();
  await selectRaw('conserva una memoria.', true);
  await send('conserva una memoria.');
  await page.getByTestId('scriptor-ai-accept').click();
  await raw.waitFor();
  assert.equal(await raw.inputValue(), rawOriginal.replace('conserva una memoria.', 'conserva una memoria. Texto pulido.'));
  await page.getByTestId('study-editor-undo').click();
  assert.equal(await raw.inputValue(), rawOriginal);
  checks.push('Markdown keyboard selection updates exact offsets and supports exact undo');

  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, aiTransport: 'controlled IPC; no provider requests' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error('Visible AI errors:', await page.getByTestId('scriptor-ai-error').allTextContents().catch(() => []));
  }
  throw error;
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit()).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
}
