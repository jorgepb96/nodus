import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The real pdf.js reader, analyzer and page loop, on a PDF whose second page object is
// damaged (an integer where the page tree expects a page dictionary). pdf.js reports the
// document as two pages and rejects getPage(2) with "Page dictionary kid reference points
// to wrong type of object". Page 1 is intact and must not be lost with it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'pdf-damaged-page-'));
test.after(() => rm(dir, { recursive: true, force: true }));

const stubs = new Map([
  ['adm-zip', 'export default class AdmZip {}'],
  ['../zotero/zoteroClient', 'export const itemChildren = () => []; export const itemAsAttachment = () => null; export const getFulltext = () => null; export const attachmentFilePath = () => null; export class ZoteroRequestError extends Error {}'],
  ['./schemeDeclutter', 'export const declutterForWorkSource = () => false; export const schemeClassifierForWorkSource = () => null; export const declutterCacheKey = f => f; export const pdfBodySize = async () => 0;'],
  ['../db/settingsRepo', 'export const getSettings = () => ({});'],
  ['./ocr', 'export const ocrPdfPages = async () => { throw new Error("OCR is not part of this test"); }; export const ocrImageFile = async () => "";'],
  ['./tabular', 'export const csvFileToText = () => ""; export const xlsxFileToText = () => "";'],
  ['../db/extractionCacheRepo', 'export const getExtractionCache = () => null; export const upsertExtractionCache = () => {};'],
  ['../perf', 'export const startPerf = () => () => {}; export const perfLog = () => {};'],
  ['../libraryReader/libraryReaderStore', 'export const getLibraryReaderRawContent = () => null;'],
  ['../library/librarySourcePages', 'export const libraryMarkdownWithPageMarkers = t => t; export const readDocumentarySourceMap = () => null;'],
  ['../logging/pipelineLogCore', 'export const logPipelineWarning = () => {};'],
]);
const bundle = path.join(dir, 'extractor.mjs');
// pdfjsLoader resolves pdf.js from its own __filename: point it at the checkout.
const loaderFile = path.join(root, 'electron/extraction/pdfjsLoader.ts');
await build({
  absWorkingDir: root, entryPoints: ['electron/extraction/textExtractor.ts'], outfile: bundle,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', external: ['pdfjs-dist', '@napi-rs/canvas'],
  banner: { js: `const __filename = ${JSON.stringify(loaderFile)};` },
  plugins: [{ name: 'extraction-dependencies', setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: 'stubs' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stubs' }, (args) => ({ contents: stubs.get(args.path), loader: 'js' }));
  } }],
});
const { extractFromPath } = await import(pathToFileURL(bundle).href);

function damagedPdf() {
  const line = '(When we look to the individuals of the same variety of our older cultivated plants and animals, one) \'';
  const text = `BT /F1 11 Tf 50 740 Td 14 TL ${Array(30).fill(line).join(' ')} ET`;
  const page = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>';
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R 4 0 R 3 0 R] /Count 3 >>',
    3: page,
    4: '42',
    5: `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    6: '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
  };
  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (const id of Object.keys(objects)) { offsets[id] = pdf.length; pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 7\n0000000000 65535 f \n${Object.keys(objects).map((id) => `${String(offsets[id]).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('a damaged page object leaves the readable pages of the PDF in the extracted text', async () => {
  const file = path.join(dir, 'damaged.pdf');
  await writeFile(file, damagedPdf());
  const warn = console.warn;
  console.warn = () => {};
  try {
    const doc = await extractFromPath(file, { ocr: { enabled: false, languages: 'eng', maxPages: 10 } });
    assert.match(doc.text, /\[\[p\. 1\]\]\nWhen we look to the individuals/);
    assert.doesNotMatch(doc.text, /\[\[p\. 2\]\]/);
    assert.match(doc.notes, /1 página\(s\) sin texto recuperado/);
  } finally {
    console.warn = warn;
  }
});

test('with OCR on, a damaged page is reported as missing text, never as over the OCR cap', async () => {
  const file = path.join(dir, 'damaged-ocr.pdf');
  await writeFile(file, damagedPdf());
  const warn = console.warn;
  console.warn = () => {};
  try {
    const doc = await extractFromPath(file, { ocr: { enabled: true, languages: 'eng', maxPages: 10 } });
    assert.match(doc.text, /\[\[p\. 1\]\]/);
    assert.equal(doc.ocrFailed, undefined, 'no OCR pass is attempted on a page pdf.js cannot open');
    assert.doesNotMatch(doc.notes, /límite de OCR/);
    assert.match(doc.notes, /1 página\(s\) sin texto recuperado/);
  } finally {
    console.warn = warn;
  }
});
