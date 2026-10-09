import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The real OCR page loop and the real canvas; only the Tesseract worker and the PDF
// reader are controlled, so a page's size and a page's failure can be chosen.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'ocr-page-isolation-'));
test.after(() => rm(dir, { recursive: true, force: true }));
const bundle = path.join(dir, 'ocr.mjs');
await build({
  absWorkingDir: root, entryPoints: ['electron/extraction/ocr.ts'], outfile: bundle,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'ocr-worker', setup(builder) {
    // The real canvas, loaded from the checkout although the bundle is written elsewhere.
    const canvas = pathToFileURL(createRequire(path.join(root, 'package.json')).resolve('@napi-rs/canvas')).href;
    builder.onResolve({ filter: /^@napi-rs\/canvas$/ }, () => ({ path: canvas, external: true }));
    builder.onResolve({ filter: /^tesseract\.js$/ }, () => ({ path: 'tesseract', namespace: 'ocr-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'ocr-stub' }, () => ({ loader: 'js', contents: `
      export default { createWorker: async () => globalThis.__ocrIsolation.worker() };
      export const createWorker = async () => globalThis.__ocrIsolation.worker();` }));
  } }],
});
const { ocrPdfPages, ocrRenderScale, OCR_MAX_RENDER_SIDE } = await import(pathToFileURL(bundle).href);

function fixture(pages) {
  const observed = { rendered: [], recognized: [], terminated: 0 };
  globalThis.__ocrIsolation = {
    worker: () => ({
      recognize: async (png) => { observed.recognized.push(png.length); return { data: { text: `page ${observed.recognized.length}` } }; },
      terminate: async () => { observed.terminated++; },
    }),
  };
  const pdf = {
    getPage: async (n) => {
      const spec = pages[n];
      return {
        getViewport: ({ scale }) => ({ width: spec.width * scale, height: spec.height * scale, scale }),
        render: ({ viewport }) => {
          observed.rendered.push({ page: n, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
          return { promise: spec.broken ? Promise.reject(new Error(`render failed on ${n}`)) : Promise.resolve() };
        },
        cleanup() {},
      };
    },
  };
  return { pdf, observed };
}

const letter = { width: 612, height: 792 };

test('a sheet at the largest size PDF allows is rendered within the canvas limit and read', async () => {
  // 14400 pt at the OCR scale would be a 36000 px canvas, which cannot be allocated.
  const { pdf, observed } = fixture({ 1: letter, 2: { width: 14400, height: 14400 }, 3: letter });
  const result = await ocrPdfPages(pdf, [1, 2, 3], 'eng');
  assert.deepEqual([...result.keys()], [1, 2, 3]);
  const sheet = observed.rendered.find((entry) => entry.page === 2);
  assert.ok(Math.max(sheet.width, sheet.height) <= OCR_MAX_RENDER_SIDE, JSON.stringify(sheet));
  const page = observed.rendered.find((entry) => entry.page === 1);
  assert.deepEqual([page.width, page.height], [1530, 1980], 'an ordinary page keeps the full OCR resolution');
  assert.equal(observed.terminated, 1);
});

test('the render scale only shrinks pages too large for the canvas', () => {
  assert.equal(ocrRenderScale(612, 792), 2.5);
  assert.equal(ocrRenderScale(2384, 3370), 2.5 * OCR_MAX_RENDER_SIDE / (3370 * 2.5));
  assert.equal(ocrRenderScale(Number.NaN, 792), 2.5);
});

test('one page that cannot be read leaves the pages around it in the result', async () => {
  const { pdf, observed } = fixture({ 1: letter, 2: { ...letter, broken: true }, 3: letter });
  const failed = [];
  const progress = [];
  const result = await ocrPdfPages(pdf, [1, 2, 3], 'eng', (p) => progress.push(p.page), {
    onPageError: (page, error) => failed.push([page, error.message]),
  });
  assert.deepEqual([...result.keys()], [1, 3]);
  assert.deepEqual(failed, [[2, 'render failed on 2']]);
  assert.deepEqual(progress, [1, 2, 3], 'progress still reaches the end of the pass');
  assert.equal(observed.terminated, 1);
});

test('without a page-error handler a page failure still rejects the pass', async () => {
  const { pdf, observed } = fixture({ 1: letter, 2: { ...letter, broken: true } });
  await assert.rejects(ocrPdfPages(pdf, [1, 2], 'eng'), /render failed on 2/);
  assert.equal(observed.terminated, 1);
});

test('an abort is never swallowed as a page failure', async () => {
  const { pdf } = fixture({ 1: letter, 2: { ...letter, broken: true }, 3: letter });
  const controller = new AbortController();
  const failed = [];
  await assert.rejects(ocrPdfPages(pdf, [1, 2, 3], 'eng', (p) => { if (p.page === 1) controller.abort(); }, {
    signal: controller.signal, onPageError: (page) => failed.push(page),
  }), { name: 'AbortError' });
  assert.deepEqual(failed, []);
});
