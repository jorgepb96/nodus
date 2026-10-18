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

test('uploaded and generated images require confirmation, retain bytes, and support cancellation and undo', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { StrictMode, useEffect, useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { BlockNoteCanvas } from './src/components/editor/BlockNoteCanvas';
      import { uploadEditorFile, storeEditorImage } from './src/components/editor/editorAttachments';
      import { Markdown } from './src/components/Markdown';
      import { renderEditorAssetImage } from './src/components/editor/EditorAssetImage';
      const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const assets = new Map();
      window.assetWrites = 0;
      window.nodus = {
        storePageAsset: async ({bytes}) => {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
          assets.set(hash, bytes); window.assetWrites++; return { blobHash: hash };
        },
        getPageAsset: async hash => assets.get(hash) ?? null,
      };
      window.prepareAssets = async () => {
        const bytes = Uint8Array.from(atob(pixel.split(',')[1]), character => character.charCodeAt(0));
        window.uploaded = await uploadEditorFile(new File([bytes], 'uploaded.png', {type:'image/png'}));
        window.generated = await storeEditorImage(pixel);
        window.svg = await uploadEditorFile(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>'], 'figure.svg', {type:'image/svg+xml'}));
      };
      function App() {
        const canvas = useRef(null);
        const [doc,setDoc] = useState([{id:'start',type:'paragraph',props:{},content:[{type:'text',text:'Texto conservado',styles:{}}],children:[]}]);
        const [preview,setPreview] = useState(false);
        useEffect(() => { window.canvas = canvas.current; window.doc = doc; }, [doc]);
        return <>
          <button id="upload" onClick={() => canvas.current.insertGeneratedImage('start', window.uploaded, 'Imagen subida')}>Subida</button>
          <button id="generate" onClick={() => canvas.current.insertGeneratedImage('start', window.generated, 'Imagen IA')}>IA</button>
          <button id="preview" onClick={() => setPreview(value => !value)}>Preview</button>
          <BlockNoteCanvas ref={canvas} documentId="images" value="Texto conservado" nativeDocument={doc}
            onChange={(_markdown,next) => setDoc(next)} />
          {preview && <div id="markdown-preview"><Markdown content={'![Imagen](' + window.uploaded + ')' + String.fromCharCode(10,10) + '![SVG](' + window.svg + ')'} verify={false} allowDataImages renderLocalImage={renderEditorAssetImage} /></div>}
        </>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
    ` },
    bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    logLevel: 'silent',
  });
  const downloads = await mkdtemp(path.join(os.tmpdir(), 'nodus-image-downloads-'));
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto('http://localhost/');
    await page.addStyleTag({ content: await readFile(componentStyles(), 'utf8') });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    await page.waitForFunction(() => Boolean(window.canvas));
    await page.evaluate(() => window.prepareAssets());
    assert.equal(await page.evaluate(() => window.assetWrites), 3);
    const images = page.locator('.nodus-blocknote .bn-block-content[data-content-type="image"] img');
    const imageCount = () => page.evaluate(() => window.doc.filter(block => block.type === 'image').length);
    const openDelete = async () => {
      await images.first().click();
      await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Eliminar', exact: false }).click();
      await page.getByRole('dialog', { name: 'Eliminar imagen', exact: true }).waitFor();
    };
    const dialog = page.getByRole('dialog', { name: 'Eliminar imagen', exact: true });
    for (const origin of ['upload', 'generate']) {
      await page.locator('#' + origin).click();
      await page.waitForFunction(() => window.doc.some(block => block.type === 'image'));
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.bn-block-content[data-content-type="image"] img')).some(img => img.complete && img.naturalWidth > 0));
      assert.equal(await imageCount(), 1);
      await images.first().click();
      const downloaded = page.waitForEvent('download');
      await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Descargar', exact: false }).click();
      const file = await downloaded;
      const downloadPath = path.join(downloads, origin + '.png');
      await file.saveAs(downloadPath);
      const bytes = await readFile(downloadPath);
      assert.ok(bytes.length > 50, 'stored media downloads as a real image file');
      assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
      for (const method of ['cancel', 'escape', 'backdrop']) {
        await openDelete();
        assert.equal(await imageCount(), 1, 'trash never removes the image before confirmation');
        assert.equal(await dialog.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(button => button === document.activeElement), true);
        if (method === 'cancel') await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        if (method === 'escape') await page.keyboard.press('Escape');
        if (method === 'backdrop') await page.mouse.click(5, 5);
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await imageCount(), 1);
      }
      await openDelete();
      await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-scriptor-image-confirmation.png') });
      await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => !window.doc.some(block => block.type === 'image'));
      await page.evaluate(() => window.canvas.undo());
      await page.waitForFunction(() => window.doc.some(block => block.type === 'image'));
      assert.equal(await imageCount(), 1, 'confirmed removal can be undone');
      await openDelete();
      await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await page.waitForFunction(() => !window.doc.some(block => block.type === 'image'));
    }
    await page.locator('#preview').click();
    await page.waitForFunction(() => { const images = Array.from(document.querySelectorAll('#markdown-preview img')); return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0); });
    assert.deepEqual(errors, []);
  } finally { await close(); await rm(downloads, { recursive: true, force: true }); }
});
