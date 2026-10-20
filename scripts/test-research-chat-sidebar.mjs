// The research chat history in a browser, with synthetic data: Projects, Pinned chats and
// the other chats; search across chats, projects and notebooks; the pin limit; the chat
// menu and moving a chat into a project; renaming a project and its icon and colour. Then
// the folders inside a project in the history, with every chat on the project home:
// filing and unfiling by drag, nesting with its cycle guard, renaming, deletion;
// and long names that slide on hover without changing anything at rest.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

/** The menu mounts hidden and shows once placed. Its labels are read as text content:
 * innerText depends on layout and came back empty on CI runners for a visible menu. Plain
 * items and choice (radio) items alike, in order, once the menu has its items and the focus. */
async function placedTexts(menu) {
  await menu.waitFor();
  await menu.page().waitForFunction(element => element && getComputedStyle(element).visibility !== 'hidden' && element.querySelector('[role^="menuitem"]') && element.contains(document.activeElement), await menu.elementHandle(), { timeout: 10000 });
  return (await menu.locator('[role="menuitem"], [role="menuitemradio"]').allTextContents()).map(text => text.trim());
}

/** The label of whatever has the keyboard focus. */
const focusedText = page => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

test('research chat history: sections, search, pins, menu and projects', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-chat-sidebar-'));
  const { browser, close: closeBrowser } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/research-chat-sidebar/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.svg': 'dataurl' } });
    const css = componentStyles();
    const page = await browser.newPage({ viewport: { width: 900, height: 760 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://sidebar.test/', route => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
    await page.goto('http://sidebar.test/');
    await page.addStyleTag({ content: await readFile(css, 'utf8') });
    await page.addStyleTag({ content: await readFile(path.join(root, 'src/views/researchAssistant.css'), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sidebar = page.getByTestId('research-history-sidebar');
    await sidebar.getByTestId('research-chat-search').waitFor();
    const action = async (...expected) => page.waitForFunction(expected => window.actions.some(actual => JSON.stringify(actual) === JSON.stringify(expected)), expected);
    // A row reads as its name: a folder's count and the icons are not part of it.
    const order = () => sidebar.locator('.research-history-heading, .research-history-row, .research-history-empty').evaluateAll(nodes => nodes.map(node => (node.querySelector('.research-marquee') ?? node).textContent.trim()));
    const home = page.getByTestId('project-home');
    const logged = () => page.evaluate(() => window.actions.map(entry => JSON.stringify(entry)));

    await t.test('three sections: projects alphabetically, pinned chats, then the rest (project chats stay in their project)', async () => {
      assert.deepEqual(await order(), ['Proyectos', 'Alfa', 'Zeta', 'Cuadernos', 'Cuaderno de riegos', 'Chats destacados', 'Sevilla en guías de viaje', 'Chats', 'Réplica y cifras', 'Cartografía medieval']);
      await sidebar.getByTestId('research-project-p-a').click();
      assert.deepEqual((await order()).slice(0, 6), ['Proyectos', 'Alfa', 'Capítulo primero: fuentes, archivos y cartografía del regadío', 'Notas', 'Sin carpeta', 'Zeta'], 'filed chats stay inside their collapsed folders');
      await sidebar.getByTestId('research-project-p-a').click();
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Abrir Alfa' }).click();
      await action('openProject', 'p-a');
    });

    await t.test('notebooks have their own section; their chats live inside them and the page opens from the pencil', async () => {
      const notebook = sidebar.getByTestId('research-notebook-n1');
      await notebook.click();
      assert.deepEqual((await order()).slice(3, 6), ['Cuadernos', 'Cuaderno de riegos', 'Pozos y norias'], 'a notebook unfolds its chats');
      await notebook.click();
      await notebook.getByRole('button', { name: 'Abrir Cuaderno de riegos' }).click();
      await action('notebook', 'n1');
      await notebook.hover();
      await notebook.getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu', { name: 'Cuaderno de riegos' });
      await menu.getByRole('menuitem').first().waitFor();
      assert.deepEqual(await placedTexts(menu), ['Renombrar', 'Icono y color', 'Editar colecciones', 'Eliminar cuaderno']);
      await menu.getByRole('menuitem', { name: 'Editar colecciones' }).click();
      await action('editNotebook', 'n1');
      await notebook.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Icono y color' }).click();
      await page.getByTestId('research-project-style').getByRole('button', { name: 'flask' }).click();
      await action('updateNotebook', 'n1', { icon: 'flask' });
      await page.getByTestId('research-project-style').getByRole('button', { name: 'Cerrar', exact: true }).click();
    });

    await t.test('the menu handle is three vertical dots and the menu opens in place, with no jump', async () => {
      const handle = sidebar.getByTestId('research-conversation-c3').getByRole('button', { name: 'Más acciones' });
      assert.equal(await handle.locator('circle').count(), 3, 'three dots, not six');
      const xs = await handle.locator('circle').evaluateAll(circles => [...new Set(circles.map(circle => circle.getAttribute('cx')))]);
      assert.equal(xs.length, 1, 'stacked vertically');
      // The menu's first painted frame is already its final place.
      const frames = await page.evaluate(async () => {
        const button = document.querySelector('[data-testid="research-conversation-c3"] button[aria-label="Más acciones"]');
        const seen = [];
        const observer = new MutationObserver(() => {
          const menu = document.querySelector('[role="menu"]');
          if (menu && getComputedStyle(menu).visibility !== 'hidden') seen.push(Math.round(menu.getBoundingClientRect().left));
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        button.click();
        for (let i = 0; i < 6; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); const menu = document.querySelector('[role="menu"]'); if (menu && getComputedStyle(menu).visibility !== 'hidden') seen.push(Math.round(menu.getBoundingClientRect().left)); }
        observer.disconnect();
        return { seen, anchorRight: Math.round(button.getBoundingClientRect().right), width: Math.round(document.querySelector('[role="menu"]').getBoundingClientRect().width) };
      });
      assert.equal(new Set(frames.seen).size, 1, `the menu never moves once shown (${frames.seen.join(', ')})`);
      assert.ok(frames.seen[0] <= frames.anchorRight - frames.width + 1, 'it opens aligned to the right edge of its button');
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
    });

    await t.test('the search bar finds chats, projects and notebooks, accents aside', async () => {
      const search = sidebar.getByTestId('research-chat-search');
      const icon = await sidebar.locator('.research-chat-search > svg').boundingBox();
      const text = await search.evaluate(input => parseFloat(getComputedStyle(input).paddingLeft));
      const box = await search.boundingBox();
      assert.ok(icon.x + icon.width <= box.x + text, 'the magnifier does not overlap the text');
      await search.fill('replica');
      assert.deepEqual(await order(), ['Chats', 'Réplica y cifras']);
      await search.fill('riego');
      assert.deepEqual(await order(), ['Cuadernos', 'Cuaderno de riegos', 'Chats', 'Pozos y norias'], 'a notebook, and its chats by its name');
      await sidebar.getByTestId('research-search-notebook-n1').click();
      await action('notebook', 'n1');
      await search.fill('alf');
      assert.deepEqual(await order(), ['Proyectos', 'Alfa', 'Chats', 'Regadío del Tormeral'], 'a chat is found by its project name too');
      await search.fill('zzz');
      assert.deepEqual(await order(), ['Sin resultados']);
      await search.fill('');
    });

    await t.test('pinning moves a chat to the pinned section; a sixth pin is refused with a message', async () => {
      const row = sidebar.getByTestId('research-conversation-c3');
      await row.hover();
      await row.getByRole('button', { name: 'Destacar chat' }).click();
      await action('pin', 'c3', true);
      assert.deepEqual((await order()).slice(5, 8), ['Chats destacados', 'Sevilla en guías de viaje', 'Réplica y cifras']);
      await page.evaluate(() => { window.pinLimitReached = true; });
      await sidebar.getByTestId('research-conversation-c4').getByRole('button', { name: 'Destacar chat' }).click();
      await sidebar.getByRole('alert').getByText('Solo puedes destacar 5 chats. Quita uno para destacar otro.').waitFor();
      await page.evaluate(() => { window.pinLimitReached = false; });
    });

    await t.test('the chat menu renames, archives, deletes and moves into a project', async () => {
      const row = sidebar.getByTestId('research-conversation-c4');
      await row.getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu', { name: 'Cartografía medieval' });
      await menu.getByRole('menuitem').first().waitFor();
      assert.deepEqual(await placedTexts(menu), ['Renombrar', 'Destacar chat', 'Archivar', 'Eliminar', 'Mover a proyecto']);
      await menu.getByRole('menuitem', { name: 'Mover a proyecto' }).click();
      await menu.getByRole('menuitem').first().waitFor();
      assert.deepEqual(await placedTexts(menu), ['Mover a proyecto', 'Alfa', 'Zeta', 'Nuevo proyecto']);
      assert.equal(await menu.getByRole('menuitemradio', { name: 'Alfa' }).getAttribute('aria-checked'), 'false');
      await menu.getByRole('menuitemradio', { name: 'Zeta' }).click();
      await action('move', 'c4', 'p-z');
      await menu.waitFor({ state: 'detached' });
      assert.ok(!(await order()).includes('Cartografía medieval'), 'a chat in a project leaves the general list');
      // A pinned chat shows only its pin until the row is hovered or focused.
      await sidebar.getByTestId('research-conversation-c3').hover();
      await sidebar.getByTestId('research-conversation-c3').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Renombrar' }).click();
      const rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('Réplica revisada'); await rename.press('Enter');
      await action('rename', 'c3', 'Réplica revisada');
      await sidebar.getByTestId('research-conversation-c3').hover();
      await sidebar.getByTestId('research-conversation-c3').getByRole('button', { name: 'Más acciones' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
    });

    await t.test('folder expansion is local to the history; the project home always shows every chat', async () => {
      await sidebar.getByTestId('research-project-p-a').click();
      const count = id => sidebar.getByTestId(id).locator('.research-folder-count').textContent();
      assert.deepEqual([await count('research-folder-f-1'), await count('research-folder-f-3'), await count('research-folder-unfiled-p-a')], ['1', '0', '0']);
      await sidebar.getByTestId('research-folder-f-1').getByRole('button', { name: /^Desplegar/ }).click();
      const indent = id => sidebar.getByTestId(id).evaluate(row => parseFloat(getComputedStyle(row).paddingLeft));
      assert.ok(await indent('research-folder-f-2') > await indent('research-folder-f-1'));
      assert.equal(await sidebar.getByTestId('research-conversation-c2').count(), 0);
      await sidebar.getByTestId('research-folder-f-2').getByRole('button', { name: 'Fuentes', exact: true }).click();
      await sidebar.getByTestId('research-conversation-c2').waitFor();
      await sidebar.getByTestId('research-folder-f-3').getByRole('button', { name: 'Notas', exact: true }).click();
      assert.deepEqual(await home.getByTestId('research-project-chats').locator('li').allTextContents(), ['Regadío del Tormeral']);
      assert.equal(await home.getByTestId('research-project-tree').count(), 0);
    });

    await t.test('valid destinations stand out in both themes and clear after leaving or cancelling', async () => {
      const source = home.getByTestId('home-chat-c2');
      const target = sidebar.getByTestId('research-folder-f-3');
      const currentFolder = sidebar.getByTestId('research-folder-f-2');
      const project = sidebar.getByTestId('research-project-p-a');
      const unfiled = sidebar.getByTestId('research-folder-unfiled-p-a');
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      const highlighted = async row => page.waitForFunction(element => element.classList.contains('is-drop-inside'), await row.elementHandle());
      const cleared = async () => page.waitForFunction(() => !document.querySelector('.is-drop-inside'));
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.className = theme, theme);
        await source.dispatchEvent('dragstart', { dataTransfer: transfer });
        await target.hover();
        const resting = await target.evaluate(element => getComputedStyle(element).backgroundColor);
        await target.dispatchEvent('dragenter', { dataTransfer: transfer });
        await highlighted(target);
        await page.waitForFunction(element => getComputedStyle(element).boxShadow.includes('2px'), await target.elementHandle());
        const feedback = await target.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).boxShadow, weight: getComputedStyle(element.querySelector('.research-history-main')).fontWeight }));
        assert.notEqual(feedback.background, resting, `${theme}: drag feedback takes precedence over hover`);
        assert.match(feedback.border, /2px.*inset|inset.*2px/, `${theme}: destination has a visible outline`);
        assert.equal(feedback.weight, '600');
        await sidebar.screenshot({ path: path.join(os.tmpdir(), `nodus-research-drop-${theme}.png`) });
        await target.evaluate(element => element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: element.querySelector('button') })));
        await highlighted(target);
        await target.dispatchEvent('dragleave', { dataTransfer: transfer });
        await cleared();
        await currentFolder.dispatchEvent('dragover', { dataTransfer: transfer });
        assert.equal(await currentFolder.evaluate(element => element.classList.contains('is-drop-inside')), false, 'the current folder rejects the chat');
        for (const destination of [target, project, unfiled]) {
          await destination.dispatchEvent('dragover', { dataTransfer: transfer });
          await highlighted(destination);
          await source.dispatchEvent('dragend', { dataTransfer: transfer });
          await cleared();
          await source.dispatchEvent('dragstart', { dataTransfer: transfer });
        }
        await source.dispatchEvent('dragend', { dataTransfer: transfer });
      }
      await page.evaluate(() => document.documentElement.className = 'dark');
      await transfer.dispose();
    });

    await t.test('a chat dropped on a folder is filed there; dropped outside every folder it leaves it, in both places', async () => {
      await sidebar.getByTestId('research-conversation-c3').dragTo(sidebar.getByTestId('research-folder-f-3'));
      await action('file', 'c3', 'f-3');
      assert.equal(await sidebar.getByTestId('research-folder-f-3').locator('.research-folder-count').textContent(), '1');
      const rows = await order();
      assert.ok(rows.slice(rows.indexOf('Alfa'), rows.indexOf('Zeta')).includes('Réplica revisada'), 'a filed chat joins the folder\'s project');
      await home.getByTestId('home-chat-c3').dragTo(sidebar.getByTestId('research-folder-unfiled-p-a'));
      await action('file', 'c3', null);
      await home.getByTestId('home-chat-c2').dragTo(sidebar.getByTestId('research-folder-f-3'));
      await action('file', 'c2', 'f-3');
      await home.getByTestId('home-chat-c2').dragTo(sidebar.getByTestId('research-project-p-a'));
      await action('file', 'c2', null);
      await sidebar.getByTestId('research-conversation-c2').dragTo(sidebar.getByTestId('research-folder-f-2'));
      await action('file', 'c2', 'f-2');
      await sidebar.getByTestId('research-conversation-c2').dragTo(sidebar.getByTestId('research-project-p-a'));
      await action('file', 'c2', null);
      await sidebar.getByTestId('research-conversation-c2').dragTo(sidebar.getByTestId('research-folder-f-2'));
      await action('file', 'c2', 'f-2');
    });

    await t.test('"Move to folder…" files a chat in a folder of its project, by keyboard alone', async () => {
      const row = sidebar.getByTestId('research-conversation-c2');
      const trigger = row.getByRole('button', { name: 'Más acciones' });
      const menu = page.getByRole('menu', { name: 'Regadío del Tormeral' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await placedTexts(menu), ['Renombrar', 'Destacar chat', 'Archivar', 'Eliminar', 'Mover a proyecto', 'Mover a carpeta…']);
      assert.equal(await focusedText(page), 'Renombrar', 'the menu takes the focus');
      await page.keyboard.press('End');
      assert.equal(await focusedText(page), 'Mover a carpeta…');
      assert.equal(await menu.getByRole('menuitem', { name: 'Mover a carpeta…' }).getAttribute('aria-haspopup'), 'menu');
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await placedTexts(menu), ['Mover a carpeta…', 'Sacar de la carpeta', 'Capítulo primero: fuentes, archivos y cartografía del regadío', 'Fuentes', 'Notas'],
        'its project\'s folders in tree order, and a way out of the current one');
      assert.equal(await focusedText(page), 'Mover a carpeta…', 'the list keeps the focus when it changes');
      const checked = await menu.getByRole('menuitemradio').evaluateAll(items => items.map(item => [item.textContent.trim().slice(0, 8), item.getAttribute('aria-checked')]));
      assert.deepEqual(checked, [['Capítulo', 'false'], ['Fuentes', 'true'], ['Notas', 'false']], 'the current folder is the checked one');
      const indent = name => menu.getByRole('menuitemradio', { name, exact: typeof name === 'string' }).evaluate(item => parseFloat(getComputedStyle(item).paddingLeft));
      assert.ok(await indent('Fuentes') > await indent(/^Capítulo primero/), 'a subfolder is indented under its parent');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await focusedText(page), 'Renombrar', 'ArrowLeft goes back to the chat\'s actions');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await placedTexts(menu);
      await page.keyboard.press('End');
      assert.equal(await focusedText(page), 'Notas');
      await page.keyboard.press('Enter');
      await action('file', 'c2', 'f-3');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid')), 'research-conversation-c2', 'the focus returns to the row it came from');
      assert.equal(await sidebar.getByTestId('research-folder-f-3').locator('.research-folder-count').textContent(), '1');
      // Out of its folder, staying in the project; Escape closes without doing anything.
      await page.keyboard.press('Enter');
      await placedTexts(menu);
      await page.keyboard.press('End'); await page.keyboard.press('ArrowRight');
      await placedTexts(menu);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      await action('file', 'c2', null);
      await menu.waitFor({ state: 'detached' });
      await page.keyboard.press('Enter');
      await placedTexts(menu);
      await page.keyboard.press('End'); await page.keyboard.press('ArrowRight');
      assert.deepEqual(await placedTexts(menu), ['Mover a carpeta…', 'Capítulo primero: fuentes, archivos y cartografía del regadío', 'Fuentes', 'Notas'], 'an unfiled chat has nothing to leave');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Más acciones', 'Escape gives the focus back too');
      // Back where it was, by pointer this time, closing on a click away first.
      await trigger.click();
      await placedTexts(menu);
      await page.mouse.click(860, 740);
      await menu.waitFor({ state: 'detached' });
      await row.hover();
      await trigger.click();
      await menu.getByRole('menuitem', { name: 'Mover a carpeta…' }).click();
      await menu.getByRole('menuitemradio', { name: 'Fuentes', exact: true }).click();
      await action('file', 'c2', 'f-2');
      // A chat outside every project has no folders to go to.
      await sidebar.getByTestId('research-conversation-c1').hover();
      await sidebar.getByTestId('research-conversation-c1').getByRole('button', { name: 'Más acciones' }).click();
      const outside = page.getByRole('menu', { name: 'Sevilla en guías de viaje' });
      assert.ok(!(await placedTexts(outside)).includes('Mover a carpeta…'));
      await page.keyboard.press('Escape');
      await outside.waitFor({ state: 'detached' });
    });

    await t.test('a folder dropped on a folder nests; never into its own subtree', async () => {
      const before = (await logged()).length;
      await sidebar.getByTestId('research-folder-f-1').dragTo(sidebar.getByTestId('research-folder-f-2'));
      await page.waitForTimeout(150);
      assert.ok(!(await logged()).slice(before).some(entry => entry.startsWith('["moveFolder","f-1"')), 'a folder does not move into its own subfolder, nor fall back to the root');
      await sidebar.getByTestId('research-folder-f-3').dragTo(sidebar.getByTestId('research-folder-f-1'));
      await action('moveFolder', 'f-3', 'f-1', null);
      await sidebar.getByTestId('research-folder-f-3').dragTo(sidebar.getByTestId('research-folder-unfiled-p-a'));
      await action('moveFolder', 'f-3', null, null);
      const names = (await order()).filter(name => ['Notas', 'Capítulo primero: fuentes, archivos y cartografía del regadío'].includes(name));
      assert.deepEqual(names, ['Capítulo primero: fuentes, archivos y cartografía del regadío', 'Notas'], 'root folders remain alphabetical');
    });

    await t.test('folders rename by double click and from their menu, which closes on click-away; an emptied name takes the default', async () => {
      await sidebar.getByTestId('research-folder-f-3').getByRole('button', { name: 'Notas', exact: true }).dblclick();
      let rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('Lecturas'); await rename.press('Enter');
      await action('renameFolder', 'f-3', 'Lecturas');
      await sidebar.getByTestId('research-folder-f-3').getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu', { name: 'Lecturas' });
      assert.deepEqual(await placedTexts(menu), ['Renombrar', 'Nueva subcarpeta', 'Eliminar carpeta']);
      await page.mouse.click(860, 740);
      await menu.waitFor({ state: 'detached' });
      await sidebar.getByTestId('research-folder-f-3').hover();
      await sidebar.getByTestId('research-folder-f-3').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Renombrar' }).click();
      rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('   '); await rename.press('Enter');
      await action('renameFolder', 'f-3', 'Nueva carpeta');
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Nueva carpeta' }).click();
      await action('createFolder', 'p-a', null);
      rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      assert.equal(await rename.inputValue(), 'Nueva carpeta 2', 'a new folder is named in place, after its siblings');
      await rename.press('Escape');
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Nueva carpeta' }).click();
      await action('createFolder', 'p-a', null);
      await sidebar.getByRole('textbox', { name: 'Nuevo nombre' }).press('Escape');
    });

    await t.test('deleting a folder asks first, takes its subfolders and unfiles their chats', async () => {
      await sidebar.getByTestId('research-folder-f-1').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Eliminar carpeta' }).click();
      await page.getByRole('dialog').getByText('Sus chats no se borran', { exact: false }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
      await action('deleteFolder', 'f-1');
      await sidebar.getByTestId('research-folder-f-2').waitFor({ state: 'detached' });
      assert.equal(await sidebar.getByTestId('research-folder-unfiled-p-a').locator('.research-folder-count').textContent(), '2', 'its chat stays in the project, unfiled, beside the one unfiled before');
      await sidebar.getByTestId('research-folder-unfiled-p-a').getByRole('button', { name: 'Sin carpeta' }).click();
      const rows = await order();
      assert.deepEqual(rows.slice(rows.indexOf('Sin carpeta') + 1, rows.indexOf('Zeta')), ['Regadío del Tormeral', 'Réplica revisada'], '"No folder" lists them');
      await sidebar.getByTestId('research-folder-unfiled-p-a').getByRole('button', { name: 'Sin carpeta' }).click();
    });

    await t.test('a long name slides on hover only when it overflows; at rest nothing changes', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await sidebar.getByTestId('research-project-p-z').click();
      const row = sidebar.getByTestId('research-conversation-c6');
      const state = () => row.evaluate(element => {
        const outer = element.querySelector('.research-marquee');
        const inner = outer.firstElementChild;
        return { height: element.getBoundingClientRect().height, width: outer.getBoundingClientRect().width, overflow: getComputedStyle(outer).textOverflow,
          display: getComputedStyle(inner).display, animation: getComputedStyle(inner).animationName, x: new DOMMatrix(getComputedStyle(inner).transform).m41 };
      });
      await page.mouse.move(860, 740);
      const rest = await state();
      assert.deepEqual([rest.overflow, rest.display, rest.animation], ['ellipsis', 'inline', 'none'], 'at rest it truncates like any row');
      await row.hover();
      // It waits a moment at the start, then slides until the end of the name shows.
      await row.locator('.research-marquee > span').evaluate(inner => new Promise((resolve, reject) => {
        const started = performance.now();
        const tick = () => new DOMMatrix(getComputedStyle(inner).transform).m41 < -20 ? resolve() : performance.now() - started > 8000 ? reject(new Error('it never slid')) : requestAnimationFrame(tick);
        tick();
      }));
      const hovered = await state();
      assert.equal(hovered.animation, 'research-marquee');
      assert.ok(hovered.x < -20, `it slides sideways (${hovered.x}px)`);
      assert.equal(hovered.height, rest.height, 'the row keeps its height');
      assert.equal(hovered.width, rest.width, 'and its layout');
      await page.mouse.move(860, 740);
      assert.deepEqual(await state(), rest, 'back at rest when the pointer leaves');
      // A name that fits never moves.
      const short = sidebar.getByTestId('research-project-p-z');
      await short.hover();
      assert.equal(await short.locator('.research-marquee > span').evaluate(inner => getComputedStyle(inner).animationName), 'none');
      // The same on the project's page and for a folder name.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await row.hover();
      assert.equal(await row.locator('.research-marquee > span').evaluate(inner => getComputedStyle(inner).animationName), 'none', 'reduced motion keeps it still');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-chat-folders.png') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await sidebar.getByTestId('research-project-p-z').getByRole('button', { name: 'Zeta', exact: true }).click();
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Alfa', exact: true }).click();
    });
    await t.test('a new project appears in order and is named in place; its menu sets icon and colour', async () => {
      await sidebar.getByTestId('research-new-project').click();
      await action('newProject');
      const rename = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      await rename.fill('Archivo municipal'); await rename.press('Enter');
      await page.waitForFunction(() => window.actions.some(entry => entry[0] === 'updateProject' && entry[2]?.name === 'Archivo municipal'));
      assert.deepEqual((await order()).slice(0, 4), ['Proyectos', 'Alfa', 'Archivo municipal', 'Zeta']);
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Icono y color' }).click();
      const dialog = page.getByTestId('research-project-style');
      assert.ok(await dialog.locator('.research-project-icon').count() > 30, 'more icons than the basic set');
      await dialog.getByRole('button', { name: 'globe' }).click();
      await action('updateProject', 'p-a', { icon: 'globe' });
      await dialog.getByRole('button', { name: '#ef4444' }).click();
      await action('updateProject', 'p-a', { color: '#ef4444' });
      await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-project-style.png') });
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await sidebar.getByTestId('research-project-p-a').getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Eliminar proyecto' }).click();
      await page.getByRole('dialog').getByText('Sus chats no se borran', { exact: false }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
      await action('deleteProject', 'p-a');
    });
    await t.test('a pinned chat inside an open project renames from the row whose menu was opened', async () => {
      await sidebar.getByTestId('research-project-p-z').getByRole('button', { name: 'Zeta', exact: true }).click();
      const nested = sidebar.locator('[data-testid="research-conversation-c6"].is-nested');
      await nested.hover();
      await nested.getByRole('button', { name: 'Destacar chat' }).click();
      await action('pin', 'c6', true);
      assert.equal(await sidebar.getByTestId('research-conversation-c6').count(), 2, 'it shows pinned and inside its project');
      await nested.hover();
      await nested.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Renombrar' }).click();
      const field = sidebar.getByRole('textbox', { name: 'Nuevo nombre' });
      assert.equal(await field.count(), 1, 'one rename field, not one per row');
      await field.fill('Título largo, ya revisado'); await field.press('Enter');
      await action('rename', 'c6', 'Título largo, ya revisado');
      await sidebar.getByTestId('research-project-p-z').getByRole('button', { name: 'Zeta', exact: true }).click();
    });

    await t.test('another surface: Study\'s courses are its notebooks and their chats still move; a surface\'s own notebooks edit sources', async () => {
      const course = page.getByTestId('course-history-sidebar');
      const rowsOf = history => history.locator('.research-history-heading, .research-history-row, .research-history-empty').evaluateAll(nodes => nodes.map(node => (node.querySelector('.research-marquee') ?? node).textContent.trim()));
      assert.deepEqual(await rowsOf(course), ['Proyectos', 'Examen', 'Cursos', 'Biología celular', 'Chats', 'Repaso general'], 'a course chat lives in its course');
      const courseRow = course.getByTestId('research-notebook-course-n1');
      assert.equal(await courseRow.getByRole('button', { name: 'Abrir Biología celular' }).getAttribute('title'), 'Nuevo chat en el curso');
      assert.equal(await courseRow.getByRole('button', { name: 'Más acciones' }).count(), 0, 'courses are managed in Study, not from the chat history');
      assert.equal(await course.getByTestId('research-chat-search').getAttribute('title'), 'Buscar chats, proyectos, cursos…');
      await courseRow.getByRole('button', { name: 'Biología celular', exact: true }).click();
      const chatRow = course.getByTestId('research-conversation-course-c1');
      await chatRow.hover();
      await chatRow.getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu', { name: 'Membranas y transporte' });
      assert.ok((await placedTexts(menu)).includes('Mover a proyecto'), 'a course is only a scope: the chat still moves into a project');
      await menu.getByRole('menuitem', { name: 'Mover a proyecto' }).click();
      await menu.getByRole('menuitemradio', { name: 'Examen' }).click();
      await action('course', 'move', 'course-c1', 'course-p1');
      await course.getByTestId('research-chat-search').fill('plasmática');
      assert.deepEqual(await rowsOf(course), ['Cursos', 'Biología celular', 'Chats', 'Membranas y transporte'], 'a course is found by its subjects and topics, and so are its chats');
      await course.getByTestId('research-chat-search').fill('');

      const data = page.getByTestId('notebook-history-sidebar');
      const notebookRow = data.getByTestId('research-notebook-notebook-n1');
      await notebookRow.hover();
      await notebookRow.getByRole('button', { name: 'Más acciones' }).click();
      const notebookMenu = page.getByRole('menu', { name: 'Ventas' });
      assert.deepEqual(await placedTexts(notebookMenu), ['Renombrar', 'Icono y color', 'Editar fuentes', 'Eliminar cuaderno'], 'its own notebooks read sources, not collections');
      await notebookMenu.getByRole('menuitem', { name: 'Editar fuentes' }).click();
      await action('notebook', 'editSources', 'notebook-n1');
      await notebookRow.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Eliminar cuaderno' }).click();
      await page.getByRole('dialog').getByText('Se eliminará «Ventas». Sus chats no se borran: vuelven al historial general.', { exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
      await notebookRow.getByRole('button', { name: 'Ventas', exact: true }).click();
      const inNotebook = data.getByTestId('research-conversation-notebook-c1');
      assert.equal(await inNotebook.getAttribute('draggable'), null, 'a notebook\'s chat is not dragged into a project');
      await inNotebook.hover();
      await inNotebook.getByRole('button', { name: 'Más acciones' }).click();
      const locked = page.getByRole('menu', { name: 'Membranas y transporte' });
      assert.ok(!(await placedTexts(locked)).includes('Mover a proyecto'), 'nor moved from its menu');
      await page.keyboard.press('Escape');
      await locked.waitFor({ state: 'detached' });
    });
    await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-chat-sidebar.png') });
    assert.deepEqual(errors, []);
  } finally {
    await closeBrowser();
    await rm(dir, { recursive: true, force: true });
  }
});
