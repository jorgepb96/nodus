// The chat histories of Databases, Study, Teaching and Worldbuilding, in the real chat view
// against the renderer-only harness (http://127.0.0.1:5198, or NODUS_VISUAL_URL): each
// creates a project, files a chat in it and in a folder from the chat's menu with the
// keyboard, pins, renames and archives it, and uses its notebook-equivalent (the surface's
// own notebooks, or Study's courses). The harness keeps the store in memory; no Electron,
// no model calls. Screenshots go to artifacts/research-assistant/history-*.png.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'artifacts/research-assistant';
await mkdir(output, { recursive: true });
const executablePath = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html`;
const chat = id => page.evaluate(key => window.native.get(key), id);
const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
try {
  for (const view of ['database', 'study', 'teaching', 'world']) {
    await page.goto(`${url}?view=${view}&sources=2`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    if (!(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
    const history = page.getByTestId('research-history-sidebar');
    const input = page.locator('.research-composer-input');
    // A first chat.
    if (view !== 'database') {
      await page.getByTestId('research-context-toggle').click();
      const panel = page.getByTestId('research-context-sidebar');
      if (view === 'world') { await panel.locator('select').selectOption('manual'); await panel.locator('input[type=checkbox]').first().check(); }
      await page.getByTestId('research-context-toggle').click();
    }
    await input.fill(`Pregunta ${view}`);
    await input.press('Enter');
    await page.waitForFunction(() => window.saved.length > 0);
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
    const row = history.getByTestId('research-conversation-native-1');
    await row.waitFor();

    // A project, named in place; the chat moves into it from its menu.
    await history.getByTestId('research-new-project').click();
    const rename = history.getByRole('textbox', { name: 'Nuevo nombre' });
    await rename.fill('Tesis'); await rename.press('Enter');
    await page.waitForFunction(() => window.chatHistoryStore.projects[0]?.name === 'Tesis');
    await row.hover();
    await row.getByRole('button', { name: 'Más acciones' }).click();
    await page.getByRole('menuitem', { name: 'Mover a proyecto' }).click();
    await page.getByRole('menuitemradio', { name: 'Tesis' }).click();
    await page.waitForFunction(() => !!window.native.get('native-1').projectId);

    // A folder inside it, then the chat into the folder, by keyboard alone.
    const project = history.getByTestId('research-project-project-1');
    await project.hover();
    await project.getByRole('button', { name: 'Más acciones' }).click();
    await page.getByRole('menuitem', { name: 'Nueva carpeta' }).click();
    const folderName = history.getByRole('textbox', { name: 'Nuevo nombre' });
    await folderName.fill('Capítulo 1'); await folderName.press('Enter');
    await page.waitForFunction(() => window.chatHistoryStore.folders[0]?.name === 'Capítulo 1');
    const nested = history.getByTestId('research-conversation-native-1').first();
    await nested.getByRole('button', { name: 'Más acciones' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    await page.keyboard.press('End');
    assert.equal(await focusedText(), 'Mover a carpeta…', `${view}: the folder list is reachable by keyboard`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    assert.equal(await focusedText(), 'Capítulo 1');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.native.get('native-1').folderId === 'folder-1');
    assert.equal((await chat('native-1')).projectId, 'project-1', `${view}: filed in the folder, in its project`);

    // Filing places the chat inside a collapsed leaf folder; reveal its contents.
    await history.getByTestId('research-folder-folder-1').getByRole('button', { name: 'Capítulo 1', exact: true }).click();
    await nested.waitFor();

    // Pin, rename and archive, from the row and its menu.
    await nested.hover();
    await nested.getByRole('button', { name: 'Destacar chat' }).click();
    await page.waitForFunction(() => !!window.native.get('native-1').pinnedAt);
    await history.getByTestId('research-conversation-native-1').first().hover();
    await history.getByTestId('research-conversation-native-1').first().getByRole('button', { name: 'Más acciones' }).click();
    await page.getByRole('menuitem', { name: 'Renombrar' }).click();
    const title = history.getByRole('textbox', { name: 'Nuevo nombre' });
    await title.fill(`Capítulo de ${view}`); await title.press('Enter');
    await page.waitForFunction(expected => window.native.get('native-1').title === expected, `Capítulo de ${view}`);
    await page.screenshot({ path: `${output}/history-${view}-project.png` });
    await history.getByTestId('research-conversation-native-1').first().hover();
    await history.getByTestId('research-conversation-native-1').first().getByRole('button', { name: 'Más acciones' }).click();
    await page.getByRole('menuitem', { name: 'Archivar' }).click();
    await page.waitForFunction(() => window.native.get('native-1').archived === true);
    await page.getByRole('button', { name: 'Ver archivadas (1)' }).waitFor();
    assert.equal((await chat('native-1')).pinnedAt, null, `${view}: archiving unpins`);

    // The notebook-equivalent.
    if (view === 'study' || view === 'teaching') {
      await history.getByText('Cursos', { exact: true }).waitFor();
      await history.getByTestId('research-notebook-course').getByRole('button', { name: 'Abrir Bachillerato' }).click();
      await page.getByTestId('research-adapter-notebook-title').getByText('Bachillerato').waitFor();
      await input.fill('Pregunta del curso'); await input.press('Enter');
      await page.waitForFunction(() => window.native.get('native-2')?.selection?.courseId === 'course');
      await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
      await history.getByTestId('research-notebook-course').getByRole('button', { name: 'Bachillerato', exact: true }).click();
      await history.getByTestId('research-conversation-native-2').waitFor();
      await history.getByTestId('research-chat-search').fill('biolog');
      await history.getByTestId('research-search-notebook-course').waitFor();
    } else {
      await history.getByTestId('research-new-notebook').click();
      const dialog = page.getByTestId('chat-notebook-dialog');
      await dialog.getByRole('textbox').first().fill('Ventas');
      await dialog.locator('input[type=checkbox]').first().check();
      await dialog.getByRole('button', { name: 'Crear cuaderno' }).click();
      await page.getByTestId('research-adapter-notebook-title').getByText('Ventas').waitFor();
      await page.getByTestId('research-context-toggle').click();
      await page.getByTestId('chat-notebook-context').waitFor();
      await input.fill('Pregunta del cuaderno'); await input.press('Enter');
      await page.waitForFunction(() => window.native.get('native-2')?.notebookId === 'notebook-1');
      await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
      assert.equal(await page.getByTestId('chat-notebook-context').count(), 0, `${view}: a new chat is free of the notebook again`);
      await page.getByTestId('research-context-toggle').click();
      await history.getByTestId('research-notebook-notebook-1').getByRole('button', { name: 'Ventas', exact: true }).click();
      await history.getByTestId('research-conversation-native-2').waitFor();
    }
    await page.screenshot({ path: `${output}/history-${view}-notebooks.png` });
  }
  assert.deepEqual(errors, []);
  console.log('Databases, Study, Teaching and Worldbuilding: projects, folders by keyboard, pins, rename, archive and notebooks (own or courses) work in the real chat view.');
} catch (error) {
  await page.screenshot({ path: `${output}/history-failure.png` }).catch(() => undefined);
  throw error;
} finally { await browser.close(); }
