import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('citation searches never block dismissal or leak into a reopened academic dialog', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { AcademicTools } from './src/components/editor/AcademicTools';
      import { normalizeAcademicMetadata } from './shared/academicDocument';
      window.requests = [];
      window.sourceDetails = [];
      window.writes = [];
      window.metadataChanges = [];
      const adapter = {
        searchSources: query => new Promise((resolve, reject) => window.requests.push({ query, resolve, reject })),
        resolveSource: source => window.holdSourceDetails ? new Promise(resolve => window.sourceDetails.push({source, resolve})) : Promise.resolve({...source, metadata:{...source.metadata,publisher:'Resolved press'}}),
        listChapters: async () => [],
        flush: async () => true,
        inspect: () => new Promise(resolve => { window.finishInspection = resolve; }),
        export: async () => { throw new Error('Unexpected export'); },
      };
      const metadata = normalizeAcademicMetadata(null);
      function App() {
        const tools = useRef(null);
        const [,setTick] = useState(0); window.rerender = () => setTick(value => value + 1);
        const canvas = useRef({
          selectionSnapshot: () => ({ range: { from: 1, to: 1 }, text: '' }),
          replaceAcademicCitation: () => {},
          insertAcademicInline: citation => window.writes.push(citation),
        });
        return <>
          <button id="cite" onClick={() => tools.current.open('cite')}>Citar fuente</button>
          <button id="settings" onClick={() => tools.current.open('settings')}>Ajustes</button>
          <button id="delivery" onClick={() => tools.current.open('delivery')}>Entrega</button>
          <AcademicTools ref={tools} id="fixture" title="Documento" document={[]}
            metadata={metadata} onChange={value => window.metadataChanges.push(value)}
            canvas={canvas} adapter={{...adapter,searchSources:query => adapter.searchSources(query)}} />
        </>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
    // These flows mount the production dialog without opening the rich footnote editor.
    plugins: [{ name: 'unused-footnote-editor', setup(build) {
      build.onResolve({ filter: /^\.\/BlockNoteCanvas$/ }, () => ({ path: 'BlockNoteCanvas', namespace: 'unused-editor' }));
      build.onLoad({ filter: /.*/, namespace: 'unused-editor' }, () => ({ contents: 'export function BlockNoteCanvas() { throw new Error("Footnote editor is outside this fixture"); }' }));
    } }],
    logLevel: 'silent',
  });
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: await readFile(path.join(root, 'src/components/editor/academicTools.css'), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const dialog = page.getByRole('dialog');
    const search = page.getByRole('textbox', { name: 'Buscar fuentes', exact: true });
    const dismiss = dialog.getByRole('button', { name: 'Cerrar', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true });
    const requestCount = () => page.evaluate(() => window.requests.length);
    const waitForRequest = count => page.waitForFunction(count => window.requests.length === count, count);
    const source = title => ({ id: 'vault:' + title, refId: title, scope: 'vault', metadata: { title, itemType: 'book', creators: [], year: 2026 } });
    const settle = (index, title) => page.evaluate(({ index, item }) => window.requests[index].resolve([item]), { index, item: source(title) });
    const openCitation = async () => {
      const count = await requestCount();
      await page.locator('#cite').focus();
      await page.locator('#cite').click();
      await waitForRequest(count + 1);
      await dialog.getByRole('status').waitFor();
      return count;
    };
    const expectClosed = async trigger => {
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(id => document.activeElement?.id === id, trigger).catch(async error => { throw new Error('Focus was not returned to ' + trigger + ': ' + await page.evaluate(() => document.activeElement?.outerHTML), { cause: error }); });
    };

    // Reproduce the screenshot with a source lookup that never completes.
    for (const method of ['close', 'cancel', 'escape', 'backdrop']) {
      const request = await openCitation();
      assert.equal(await dismiss.isEnabled(), true, 'the X must work during source lookup');
      assert.equal(await cancel.isEnabled(), true, 'Cancel must work during source lookup');
      const count = await requestCount(); await page.evaluate(() => window.rerender()); await page.waitForTimeout(250);
      assert.equal(await requestCount(), count, 'parent rerenders do not restart the lookup');
      await dialog.getByRole('heading').click();
      assert.equal(await dialog.isVisible(), true, 'clicks inside the dialog do not dismiss it');
      if (method === 'close') await dismiss.click();
      if (method === 'cancel') await cancel.click();
      if (method === 'escape') await search.press('Escape');
      if (method === 'backdrop') await page.locator('.academic-modal-backdrop').click({ position: { x: 5, y: 5 } });
      await expectClosed('cite');
      if (method === 'cancel') {
        await page.evaluate(index => window.requests[index].reject(new Error('Late search failure')), request);
      } else await settle(request, 'Late result');
      assert.equal(await dialog.count(), 0, 'late completion cannot reopen a dismissed dialog');
    }
    assert.deepEqual(await page.evaluate(() => [window.writes, window.metadataChanges]), [[], []], 'dismissal never modifies the document');

    // A previous request may complete after another search or after reopening.
    const old = await openCitation();
    await search.fill('Current');
    await waitForRequest(old + 2);
    await settle(old, 'Outdated source');
    assert.equal(await dialog.getByRole('button', { name: /Outdated source/ }).count(), 0);
    assert.equal(await dialog.getByRole('status').isVisible(), true);
    await settle(old + 1, 'Current source');
    await dialog.getByRole('button', { name: /Current source/ }).click();
    await dialog.getByRole('button', { name: 'Insertar cita bibliográfica', exact: true }).click();
    await expectClosed('cite');
    const inserted = await page.evaluate(() => JSON.parse(window.writes[0].props.payload));
    assert.equal(inserted.sources[0].metadata.title, 'Current source');

    const abandoned = await openCitation();
    await search.press('Escape');
    await expectClosed('cite');
    const reopened = await openCitation();
    assert.equal(await dialog.getByRole('button', { name: /Current source/ }).count(), 0, 'reopening clears previous results');
    await settle(abandoned, 'Abandoned source');
    assert.equal(await dialog.getByRole('button', { name: /Abandoned source/ }).count(), 0);
    assert.equal(await dialog.getByRole('status').isVisible(), true);
    await page.evaluate(index => window.requests[index].reject(new Error('Search unavailable')), reopened);
    await dialog.getByRole('alert').getByText('Error: Search unavailable', { exact: true }).waitFor();
    await dialog.getByRole('status').waitFor({ state: 'detached' });
    await cancel.click();
    await expectClosed('cite');

    // Loading a selected source also stays cancellable, and late details are discarded.
    const detailSearch = await openCitation();
    await settle(detailSearch, 'Detailed source');
    await page.evaluate(() => { window.holdSourceDetails = true; });
    await dialog.getByRole('button', { name: /Detailed source/ }).click();
    await page.waitForFunction(() => window.sourceDetails.length === 1);
    assert.equal(await dialog.getByRole('button', { name: 'Insertar cita bibliográfica', exact: true }).isDisabled(), true);
    await cancel.click(); await expectClosed('cite');
    await page.evaluate(() => { window.sourceDetails[0].resolve(window.sourceDetails[0].source); window.holdSourceDetails = false; });
    assert.equal(await dialog.count(), 0);

    // Choosing another source must preserve edits to the first source's bibliography.
    const editSearch = await openCitation();
    await page.evaluate(({index,items}) => window.requests[index].resolve(items), {index:editSearch,items:[source('Source A'),source('Source B')]});
    await dialog.getByRole('button', { name: /Source A/ }).click();
    await dialog.getByText('Datos bibliográficos de la cita', { exact: true }).click();
    await dialog.getByLabel('Editorial', { exact: true }).fill('My correction');
    await dialog.getByRole('button', { name: /Source B/ }).click();
    await dialog.getByLabel('Editorial', { exact: true }).first().waitFor();
    assert.equal(await dialog.getByLabel('Editorial', { exact: true }).first().inputValue(), 'My correction');
    await dialog.getByRole('button', { name: 'Insertar cita bibliográfica', exact: true }).click();
    await expectClosed('cite');
    const edited = await page.evaluate(() => JSON.parse(window.writes.at(-1).props.payload));
    assert.deepEqual(edited.sources.map(source => source.metadata.publisher), ['My correction', 'Resolved press']);

    // Cancel a lookup during its debounce, before the adapter is called.
    const beforeDebounce = await requestCount();
    await page.locator('#cite').focus();
      await page.locator('#cite').click();
    await search.fill('Cancelled before lookup');
    await search.press('Escape');
    await expectClosed('cite');
    await page.waitForTimeout(250);
    assert.equal(await requestCount(), beforeDebounce);

    await page.locator('#settings').focus();
    await page.locator('#settings').click();
    await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
    await expectClosed('settings');

    // Preparing a delivery still owns its separate busy state.
    await page.locator('#delivery').focus();
    await page.locator('#delivery').click();
    await page.waitForFunction(() => Boolean(window.finishInspection));
    await page.waitForFunction(() => document.querySelector('.academic-dialog header button')?.disabled);
    assert.equal(await dismiss.isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    await page.evaluate(() => window.finishInspection([]));
    await page.waitForFunction(() => !document.querySelector('.academic-dialog header button').disabled);
    await dismiss.click();
    await expectClosed('delivery');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
