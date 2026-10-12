import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-provenance-'));
test.after(() => rm(dir, { recursive: true, force: true }));
// Exercise the real extraction, cleanup, assembly and note parser. The PDF reader
// and OCR worker supply controlled page results, including startup/mid-batch errors.
const stubs = new Map([
  ['adm-zip', 'export default class AdmZip {}'],
  ['../zotero/zoteroClient', 'export const itemChildren = () => []; export const itemAsAttachment = () => null; export const getFulltext = () => null; export const attachmentFilePath = () => null; export class ZoteroRequestError extends Error {}'],
  ['./pdfjsLoader', 'export const openPdf = async () => globalThis.__pdfOcrProvenance.pdf; export const pageText = async page => page.text; export const pageTextWithSchemes = async page => ({ text: page.text, declutteredText: "[scheme]", schemeLines: [], marginLines: [] });'],
  // Durable work/attachment choices have real-SQLite coverage in test-scheme-declutter.
  ['./schemeDeclutter', 'export const declutterForWorkSource = () => false; export const schemeClassifierForWorkSource = () => null; export const declutterCacheKey = file => `${file}#declutter`; export const pdfBodySize = async () => 0;'],
  ['../db/settingsRepo', 'export const getSettings = () => ({ declutterNewDocuments: true });'],
  ['./pdfAnalyzer', 'export const analyzePdf = async () => globalThis.__pdfOcrProvenance.analysis;'],
  ['./ocr', 'export const ocrPdfPages = (...args) => globalThis.__pdfOcrProvenance.ocr(...args); export const ocrImageFile = async () => ({text:""});'],
  ['./tabular', 'export const csvFileToText = () => ""; export const xlsxFileToText = () => "";'],
  ['../db/extractionCacheRepo', 'export const getExtractionCache = key => globalThis.__pdfOcrProvenance.cache.get(JSON.stringify(key)) ?? null; export const upsertExtractionCache = (key,doc) => { globalThis.__pdfOcrProvenance.cacheWrites++; globalThis.__pdfOcrProvenance.cache.set(JSON.stringify(key),doc); };'],
  ['../perf', 'export const startPerf = () => () => {}; export const perfLog = () => {};'],
  ['../libraryReader/libraryReaderStore', 'export const getLibraryReaderRawContent = () => null;'],
  ['../library/librarySourcePages', 'export const libraryMarkdownWithPageMarkers = text => text; export const readDocumentarySourceMap = () => null;'],
  ['../logging/pipelineLogCore', 'export const logPipelineWarning = () => {};'],
]);
const extractorBundle = path.join(dir, 'extractor.mjs');
await build({
  absWorkingDir: root, entryPoints: ['electron/extraction/textExtractor.ts'], outfile: extractorBundle,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'extraction-dependencies', setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: 'extraction-stubs' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'extraction-stubs' }, (args) => ({ contents: stubs.get(args.path), loader: 'js' }));
  } }],
});
const { extractPdfStreaming, extractFromPath } = await import(pathToFileURL(extractorBundle).href);
const parserBundle = path.join(dir, 'parser.mjs');
await build({ entryPoints: [path.join(root, 'shared/textProvenance.ts')], outfile: parserBundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { parseTextNotes } = await import(pathToFileURL(parserBundle).href);

async function extract({ total, cap, failures = [], scanPages = null, weakPages = [], enabled = true, throwAfter = null, pageErrors = [], signal, onProgress }) {
  const fail = new Set(failures);
  const scan = scanPages && new Set(scanPages);
  const weak = new Set(weakPages);
  const observed = { selected: [], completed: [], destroyed: 0 };
  const goodText = 'Scientific text about chemistry and scholarly research, with enough characters to be retained. '.repeat(3);
  globalThis.__pdfOcrProvenance = {
    analysis: { strategy: scan ? 'digital' : 'scanned', pageCount: total },
    cache: new Map(), cacheWrites: 0, ocrCalls: 0, throwAfter,
    pdf: {
      numPages: total,
      getPage: async (p) => ({ text: weak.has(p) ? '1234567890'.repeat(10) : scan && !scan.has(p) ? goodText : '', cleanup() {} }),
      destroy: async () => { observed.destroyed++; },
    },
    ocr: async (_pdf, pages, _languages, progress, options = {}) => {
      globalThis.__pdfOcrProvenance.ocrCalls++;
      observed.selected = [...pages];
      const results = new Map();
      for (const page of pages) {
        if (globalThis.__pdfOcrProvenance.throwAfter === observed.completed.length) throw new Error('OCR worker failed');
        // Like the real loop: a page failure rejects the pass unless the caller handles it.
        if (pageErrors.includes(page)) {
          const error = new Error('Create skia surface failed');
          if (!options.onPageError) throw error;
          options.onPageError(page, error);
          continue;
        }
        observed.completed.push(page);
        results.set(page, { text: fail.has(page) ? '' : goodText });
        progress?.({ page: observed.completed.length, totalPages: pages.length });
      }
      return results;
    },
  };
  const doc = await extractPdfStreaming('/fixture.pdf', {
    ocr: { enabled, languages: 'eng', maxPages: cap },
    analysis: { strategy: scan ? 'digital' : 'scanned', pageCount: total }, signal, onProgress,
  });
  return { ...observed, doc, provenance: parseTextNotes(doc.notes) };
}

test('a 1342-page scan with a 1000-page cap retains the first 1000 and explicitly reports 342 excluded', async () => {
  const { selected, completed, destroyed, doc, provenance } = await extract({ total: 1342, cap: 1000 });
  assert.equal(selected.length, 1000);
  assert.equal(completed.length, 1000);
  assert.equal(destroyed, 1);
  assert.match(doc.text, /\[\[p\. 1000\]\]/);
  assert.doesNotMatch(doc.text, /\[\[p\. 1001\]\]/);
  assert.deepEqual(provenance, { ocrPages: 1000, cappedPages: 342, cap: 1000, blankPages: 0, unresolvedPages: 0, ocrFailed: false });
});

test('300 successes among 302 attempts never become a fictitious 300-page cap', async () => {
  const { completed, doc, provenance } = await extract({ total: 302, cap: 1000, failures: [301, 302] });
  assert.equal(completed.length, 302);
  assert.match(doc.notes, /300 página\(s\) recuperadas por OCR/);
  assert.deepEqual(provenance, { ocrPages: 300, cappedPages: 0, cap: null, blankPages: 2, unresolvedPages: 0, ocrFailed: false });
});

test('the exact old 1000-recovered/342-missing note can describe a fully attempted document', async () => {
  const failures = Array.from({ length: 342 }, (_, i) => i + 1001);
  const { completed, provenance } = await extract({ total: 1342, cap: 2000, failures });
  assert.equal(completed.length, 1342);
  assert.equal(provenance.ocrPages, 1000);
  assert.equal(provenance.blankPages, 342);
  assert.equal(provenance.cappedPages, 0);
});

test('unreadable pages inside the cap are separate from excluded pages', async () => {
  const { completed, provenance } = await extract({ total: 1342, cap: 1000, failures: [1, 2] });
  assert.equal(completed.length, 1000);
  assert.deepEqual(provenance, { ocrPages: 998, cappedPages: 342, cap: 1000, blankPages: 2, unresolvedPages: 0, ocrFailed: false });
});

test('startup and mid-batch failures never label selected pages as OCR results', async () => {
  for (const throwAfter of [0, 1]) {
    const { completed, destroyed, provenance } = await extract({ total: 1342, cap: 1000, throwAfter });
    assert.equal(completed.length, throwAfter);
    assert.equal(destroyed, 1);
    assert.deepEqual(provenance, { ocrPages: 0, cappedPages: 342, cap: 1000, blankPages: 0, unresolvedPages: 1000, ocrFailed: true });
  }
});

test('one page OCR cannot read keeps every other recognised page, and the result is not final', async () => {
  const { completed, doc, provenance } = await extract({ total: 6, cap: 1000, pageErrors: [3] });
  assert.deepEqual(completed, [1, 2, 4, 5, 6]);
  assert.match(doc.text, /\[\[p\. 2\]\]/);
  assert.match(doc.text, /\[\[p\. 6\]\]/);
  assert.doesNotMatch(doc.text, /\[\[p\. 3\]\]/);
  assert.equal(doc.ocrFailed, true, 'an incomplete OCR pass is never cached as the final text');
  assert.deepEqual(provenance, { ocrPages: 5, cappedPages: 0, cap: null, blankPages: 0, unresolvedPages: 1, ocrFailed: true });
});

test('an uncapped OCR failure preserves digital pages and reports only the missing text', async () => {
  const { doc, provenance } = await extract({ total: 5, cap: 1000, scanPages: [4, 5], throwAfter: 0 });
  assert.match(doc.text, /\[\[p\. 3\]\]/);
  assert.deepEqual(provenance, { ocrPages: 0, cappedPages: 0, cap: null, blankPages: 0, unresolvedPages: 2, ocrFailed: true });
});

test('disabled OCR is neither an attempted OCR result nor a reached OCR cap', async () => {
  const { selected, doc, provenance } = await extract({ total: 5, cap: 1, scanPages: [4, 5], enabled: false });
  assert.deepEqual(selected, []);
  assert.match(doc.text, /\[\[p\. 3\]\]/);
  assert.match(doc.notes, /OCR desactivado/);
  assert.deepEqual(provenance, { ocrPages: 0, cappedPages: 0, cap: null, blankPages: 0, unresolvedPages: 2, ocrFailed: false });
});

test('weak digital text beyond the OCR cap is retained, not reported as missing pages', async () => {
  const { selected, doc, provenance } = await extract({ total: 5, cap: 2, scanPages: [1], weakPages: [2, 3, 4, 5] });
  assert.deepEqual(selected, [1, 2], 'blank pages are prioritised before weak digital layers');
  assert.match(doc.text, /\[\[p\. 5\]\]/);
  assert.equal(provenance.ocrPages, 2);
  assert.equal(provenance.cappedPages, 0);
});

test('aborting OCR rejects extraction rather than publishing misleading notes', async () => {
  const controller = new AbortController();
  await assert.rejects(extract({ total: 5, cap: 3, signal: controller.signal, onProgress(progress) {
    if (progress.phase === 'ocr') controller.abort();
  } }), { name: 'AbortError' });
});

test('an OCR failure is not cached, so a retry with unchanged settings can recover the text', async () => {
  await extract({ total: 2, cap: 1000, throwAfter: 0 });
  const fixture = globalThis.__pdfOcrProvenance;
  fixture.ocrCalls = 0;
  const file = path.join(dir, 'retry.pdf');
  await writeFile(file, 'PDF fixture handled by the controlled reader');
  const opts = { ocr: { enabled: true, languages: 'eng', maxPages: 1000 } };
  const failed = await extractFromPath(file, opts);
  assert.equal(failed.ocrFailed, true);
  assert.equal(fixture.cacheWrites, 0);
  fixture.throwAfter = null;
  const recovered = await extractFromPath(file, opts);
  assert.match(recovered.text, /\[\[p\. 2\]\]/);
  assert.equal(parseTextNotes(recovered.notes).ocrFailed, false);
  assert.equal(fixture.ocrCalls, 2, 'the same file and settings actually retry the worker');
  assert.equal(fixture.cacheWrites, 1);
  assert.deepEqual(await extractFromPath(file, opts), recovered);
  assert.equal(fixture.ocrCalls, 2, 'successful extraction still benefits from the cache');
});

test('plain and explicitly decluttered extraction of a shared PDF keep independent cache entries', async () => {
  await extract({ total: 2, cap: 1000, scanPages: [] });
  const fixture = globalThis.__pdfOcrProvenance;
  const file = path.join(dir, 'new-book.pdf');
  await writeFile(file, 'PDF fixture handled by the controlled reader');
  const opts = { ocr: { enabled: false, languages: 'eng', maxPages: 1000 } };
  fixture.cache = new Map();
  const cleaned = await extractFromPath(file, { ...opts, declutter: true });
  assert.match(cleaned.text, /\[scheme\]/);
  const keys = [...fixture.cache.keys()].map((key) => JSON.parse(key).filePath);
  assert.deepEqual(keys, [`${file}#declutter`], 'cached under the decluttered key only');
  const plain = await extractFromPath(file, opts);
  assert.match(plain.text, /Scientific text/);
  assert.notEqual(plain.text, cleaned.text);
  assert.deepEqual([...fixture.cache.keys()].map((key) => JSON.parse(key).filePath), [`${file}#declutter`, file]);
  assert.deepEqual(await extractFromPath(file, { ...opts, declutter: true }), cleaned);
  assert.deepEqual(await extractFromPath(file, opts), plain);
});

test('scheme-only text stays decluttered without triggering OCR just because the result is short', async () => {
  await extract({ total: 2, cap: 1000, scanPages: [] });
  const fixture = globalThis.__pdfOcrProvenance;
  const doc = await extractPdfStreaming('/fixture.pdf', {
    declutter: true, ocr: { enabled: true, languages: 'eng', maxPages: 1000 }, analysis: fixture.analysis,
  });
  assert.match(doc.text, /\[scheme\]/);
  assert.equal(fixture.ocrCalls, 0);
});
