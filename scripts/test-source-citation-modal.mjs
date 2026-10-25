import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);

test('source citations size to content, search the visible tab and retain historical source links', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { SourceCitationModal } from './src/components/SourceCitationModal';
      import { FindInPage } from './src/components/FindInPage';
      const title = 'Bienvenido, Mr. Turismo: Cultura visual del boom en España';
      const text = 'El cántaro en la cultura visual española. ARCHIVO_HISTÓRICO.\\nLa mujer con cántaro constituye un icono de primer orden.';
      const passage = { passage_id: 'receipt', nodus_id: 'work-1', historical: true,
        page_label: 'pp. 110–111', page_number: 110, source_ref: 'attachment-A', text,
        work: { title, authors: ['Fuentes Vega, A.'], year: 2017, zotero_key: 'ZOTERO01' } };
      const work = { nodus_id: 'work-1', title, authors: ['Fuentes Vega, A.'], year: 2017, zotero_key: 'ZOTERO01', item_type: 'book', themes: [], ideaCount: 0 };
      window.jumps = []; window.selects = [];
      window.nodus = {
        listAuthors: async () => [{ author_id: 'author-1', name: 'Fuentes Vega, A.', fullName: 'Alicia Fuentes Vega', firstName: 'Alicia', lastName: 'Fuentes Vega' }],
        getPassage: id => id === 'long' ? Promise.resolve({...passage, text: Array(60).fill(text).join('\\n\\n')}) : new Promise(resolve => { window.finishPassage = () => resolve(passage); }),
        getWork: async () => work, getWorkMeta: async () => null, getWorkSummary: async () => null,
        getIdeasByWork: async () => ({total:0,ideas:[]}), getWorkIdeaSynthesis: async () => null,
        getGlobalLibraryItem: async () => null, getLibraryReaderDocument: async () => null,
        getAuthorDossier: async () => ({ author: { name: 'Fuentes Vega, A.' }, fullName: 'Alicia Fuentes Vega', relations: [], works: [], ideas: [], themes: [], synthesis: null }),
        openEvidenceAtPage: async (id, locator) => { window.jumps.push({id,locator}); return {ok:true, mode:'pdf-page',page:locator.pageNumber,local:null}; },
        openInZotero: async key => window.selects.push(key),
      };
      function App() {
        const background = useRef(null);
        const [target,setTarget] = useState({ kind:'passage', id:'receipt' });
        window.openCitation = id => setTarget({kind:'passage',id});
        return <><div ref={background}>Texto del informe: cántaro.</div>
          <FindInPage targetRef={background} />
          <SourceCitationModal key={target?.id} target={target} onClose={() => setTarget(null)} />
        </>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  const css = await postcss([tailwindcss({ content: [path.join(root, 'src/components/SourceCitationModal.tsx'), path.join(root, 'src/components/FindInPage.tsx'), path.join(root, 'src/components/ui.tsx')], darkMode: 'class' })])
    .process((await readFile(path.join(root, 'src/index.css'), 'utf8')).replace(/^@import .*;$/gm, ''), { from: path.join(root, 'src/index.css') });
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: '<html class="light"><body><div id="root"></div></body></html>' }));
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const modal = page.getByTestId('source-citation-modal');
    await modal.waitFor();

    // Open find before the asynchronous source loads; it must update afterwards.
    await page.keyboard.press('Control+f');
    assert.equal(await page.getByTestId('find-in-page').count(), 1, 'only the modal owns find');
    await page.getByTestId('find-in-page-input').fill('cántaro');
    await page.evaluate(() => window.finishPassage());
    await page.getByTestId('source-citation-passage').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'Coincidencia 1 de 2');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'Coincidencia 2 de 2');
    await page.keyboard.press('Shift+Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'Coincidencia 1 de 2');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('find-in-page').count(), 0);
    assert.equal(await modal.count(), 1, 'Escape dismisses find before the source');
    const bounds = await modal.boundingBox();
    assert.ok(bounds.width <= 1024 && bounds.height < 550, JSON.stringify(bounds));
    await modal.getByRole('status').filter({hasText:'revisión anterior'}).waitFor();

    await modal.getByTestId('source-citation-open-zotero-work-1').click();
    assert.deepEqual(await page.evaluate(() => window.jumps), [{id:'work-1',locator:{pageNumber:110,sourceRef:'attachment-A',location:'pp. 110–111'}}]);
    assert.deepEqual(await page.evaluate(() => window.selects), [], 'a page citation never degrades to selecting its item in the renderer');
    if (process.env.NODUS_CITATION_SCREENSHOT) await page.screenshot({path:process.env.NODUS_CITATION_SCREENSHOT});

    await modal.getByTestId('source-citation-passage-work').click();
    await modal.getByTestId('source-citation-work').waitFor();
    assert.equal(await modal.getByRole('tab').count(), 2);
    await page.keyboard.press('Meta+f');
    await page.getByTestId('find-in-page-input').fill('ARCHIVO_HISTÓRICO');
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'No se encontró ese texto');
    await modal.getByTestId('source-citation-tab-passage:receipt').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'Coincidencia 1 de 1');
    await page.keyboard.press('Escape');
    await modal.getByRole('button', {name:'Fuentes Vega, A.',exact:true}).filter({visible:true}).click();
    await modal.getByTestId('source-citation-author').waitFor();
    assert.equal(await modal.getByRole('tab').count(), 3, 'the author opens its own tab');
    await page.keyboard.press('Escape');
    assert.equal(await modal.count(), 0);

    await page.keyboard.press('Control+f');
    await page.getByTestId('find-in-page-input').fill('cántaro');
    await page.waitForFunction(() => document.querySelector('[data-testid="find-in-page-status"]')?.textContent === 'Coincidencia 1 de 1');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.openCitation('long'));
    await modal.getByTestId('source-citation-passage').waitFor();
    const longBounds = await modal.boundingBox();
    assert.ok(longBounds.height <= 860, JSON.stringify(longBounds));
    const pane = modal.getByRole('tabpanel');
    assert.ok(await pane.evaluate(el => el.scrollHeight > el.clientHeight), 'long sources scroll inside the bounded modal');
    await page.setViewportSize({width:390,height:600});
    const mobile = await modal.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.width <= 390 && mobile.height <= 516, JSON.stringify(mobile));
    await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await pane.evaluate(el => el.scrollTop > 0));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
