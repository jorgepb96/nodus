import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-extraction-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-extraction-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function attachment(file, mime) {
  return {
    id: `attachment:${path.basename(file)}`, title: path.basename(file), fileName: path.basename(file),
    relativePath: path.basename(file), mimeType: mime, byteSize: 0, sha256: '', role: 'original',
  };
}

try {
  const { orderOcrLayoutLines } = require(path.join(repoRoot, 'electron/extraction/ocr.ts'));
  const ocrLine = (text, x0, y0, x1 = x0 + 180) => ({
    text, bbox: { x0, y0, x1, y1: y0 + 16 }, fontSize: 11, paragraphBreakBefore: false,
  });
  assert.deepEqual(
    orderOcrLayoutLines([
      ocrLine('Left one', 40, 120), ocrLine('Right one', 340, 120),
      ocrLine('Left two', 40, 145), ocrLine('Right two', 340, 145),
      ocrLine('Left next section', 40, 260), ocrLine('Right next section', 340, 260),
      ocrLine('Left continuation', 40, 285), ocrLine('Right continuation', 340, 285),
    ], 640).map((line) => line.text),
    ['Left one', 'Left two', 'Right one', 'Right two', 'Left next section', 'Left continuation', 'Right next section', 'Right continuation'],
    'OCR reading order keeps columns intact and respects large horizontal section breaks',
  );
  const { refineDocumentHeadings } = require(path.join(repoRoot, 'electron/library/libraryExtractionEngine.ts'));
  const sourceBlock = (kind, text, page) => ({
    kind, text, markdown: kind === 'heading' ? `## ${text}` : text,
    anchors: [{ page, bbox: [40, 40, 540, 60] }],
  });
  const ocrHeadingBlocks = [
    sourceBlock('heading', 'EXCURSIÓN FIN DE SEMANA ESTANCIA CIRCUITOS CULTURALES', 1),
    sourceBlock('heading', 'CIUDADES HISTÓRICAS', 1),
    sourceBlock('paragraph', 'Único Múltiple Visita en Ruta Excursión Pernoctación', 1),
    sourceBlock('paragraph', 'ALMAGRO X X ANTEQUERA X', 1),
    sourceBlock('heading', 'BIBLIOGRAFÍA', 2),
    sourceBlock('heading', 'AIEST (1996):', 2),
  ];
  refineDocumentHeadings(ocrHeadingBlocks, [{ ocr: true }, { ocr: true }]);
  assert.deepEqual(
    ocrHeadingBlocks.map((block) => block.kind),
    ['paragraph', 'paragraph', 'paragraph', 'paragraph', 'heading', 'paragraph'],
    'OCR table headers and bibliography entries never pollute the document outline',
  );
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const { createCanvas } = require('@napi-rs/canvas');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const canvas = createCanvas(220, 220);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, 220, 220);
  context.fillStyle = '#2563eb'; context.fillRect(20, 140, 40, 60);
  context.fillStyle = '#16a34a'; context.fillRect(90, 80, 40, 120);
  context.fillStyle = '#f97316'; context.fillRect(160, 30, 40, 170);
  const tile = (x, y, width, height) => {
    const output = createCanvas(width, height);
    output.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
    return output.toBuffer('image/png');
  };
  // Reproduce a real InDesign export: one logical illustration is stored as
  // three adjacent XObjects (main tile, right strip, bottom strip).
  const embeddedMain = await pdf.embedPng(tile(0, 0, 160, 160));
  const embeddedRight = await pdf.embedPng(tile(160, 0, 60, 220));
  const embeddedBottom = await pdf.embedPng(tile(0, 160, 160, 60));
  for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText('REVISTA DE HISTORIA · 2026', { x: 80, y: 810, size: 8, font });
    page.drawText(String(pageNumber), { x: 290, y: 18, size: 8, font });
    if (pageNumber === 1) {
      page.drawText('ISSN 2254-6901 | pp. 1-3 | https://doi.org/10.0000/nodus', { x: 80, y: 790, size: 8, font });
      page.drawText('Entre norma y deseo', { x: 70, y: 760, size: 24, font: bold });
      page.drawText('Quantitative analysis: A methodological', { x: 70, y: 738, size: 11, font });
      page.drawText('Proposal', { x: 70, y: 722, size: 13, font: bold });
      page.drawText('Introducción', { x: 70, y: 695, size: 16, font: bold });
      page.drawText('Este estudio inter-', { x: 70, y: 680, size: 11, font });
      page.drawText('disciplinar evita  espacios dobles y conserva la puntuación .', { x: 70, y: 664, size: 11, font });
      page.drawText('Un argumento documentado', { x: 90, y: 640, size: 11, font });
      page.drawText('1', { x: 224, y: 646, size: 7, font });
      page.drawText(' continúa en esta misma línea.', { x: 228, y: 640, size: 11, font });
      page.drawText('y conserva la continuidad del primer párrafo.', { x: 70, y: 624, size: 11, font });
      page.drawText('Otra afirmación documentada', { x: 70, y: 612, size: 11, font });
      page.drawText('2', { x: 220, y: 618, size: 7, font });
      page.drawText(' completa la prueba.', { x: 224, y: 612, size: 11, font });
      page.drawText('Segundo párrafo con una primera línea sangrada.', { x: 90, y: 596, size: 11, font });
      page.drawText('Su separación debe sobrevivir a la extracción.', { x: 70, y: 580, size: 11, font });
      page.drawText('“Esta cita textual ocupa un párrafo independiente', { x: 100, y: 540, size: 10, font });
      page.drawText('y debe mostrarse como una cita sangrada.”', { x: 100, y: 525, size: 10, font });
      page.drawText('Tabla 1. Resultados', { x: 70, y: 480, size: 11, font: bold });
      const rows = [['Año', 'Mujeres', 'Total'], ['1940', '120', '500'], ['1941', '135', '520']];
      rows.forEach((row, rowIndex) => row.forEach((cell, column) => page.drawText(cell, {
        x: [70, 220, 370][column], y: 455 - rowIndex * 20, size: 10, font,
      })));
      page.drawText('1', { x: 70, y: 78, size: 8, font });
      page.drawText('Nota al pie conservada al final del documento.', { x: 82, y: 78, size: 8, font });
      page.drawText('2. Nota numerada con punto y enlace de retorno.', { x: 70, y: 64, size: 8, font });
    } else if (pageNumber === 2) {
      page.drawText('Resultados', { x: 70, y: 760, size: 16, font: bold });
      page.drawText('Los resultados confirman la hipótesis planteada.', { x: 70, y: 725, size: 11, font });
      page.drawImage(embeddedMain, { x: 180, y: 480, width: 160, height: 160 });
      page.drawImage(embeddedRight, { x: 340, y: 420, width: 60, height: 220 });
      page.drawImage(embeddedBottom, { x: 180, y: 420, width: 160, height: 60 });
      page.drawText('Figura 1. Distribución de resultados', { x: 170, y: 400, size: 10, font });
      page.drawText('Tabla 2. Matriz compleja preservada visualmente', { x: 70, y: 360, size: 11, font: bold });
      for (let row = 0; row < 10; row += 1) {
        page.drawText(`Categoría extensa ${row + 1}`, { x: 70, y: 335 - row * 20, size: 9, font });
        page.drawText(`Resultado ${100 + row}`, { x: 350, y: 335 - row * 20, size: 9, font });
      }
      page.drawText('Fuente: elaboración de prueba', { x: 70, y: 120, size: 9, font });
    } else if (pageNumber === 3) {
      page.drawText('Conclusiones', { x: 70, y: 760, size: 16, font: bold });
      page.drawText('La conclusión mantiene separado el original del texto limpio [1].', { x: 70, y: 725, size: 11, font });
      page.drawText('Referencias', { x: 70, y: 680, size: 16, font: bold });
      page.drawText('[1] Pérez, J. Una referencia de prueba. 2026.', { x: 70, y: 650, size: 10, font });
    } else if (pageNumber === 4) {
      // The layout that broke the Documentary Index on real papers: the tail of a left-column
      // sentence and the head of the one beside it share a baseline, and grouping fragments by
      // height alone stitched them together — "We introduce two simple global hyperaccuracy".
      page.drawText('Two-column fixture', { x: 50, y: 780, size: 16, font: bold });
      // Lines are as short as a real column's: a column's text never reaches the gutter.
      const leftColumn = [
        'LEFT ONE: first words of the left column.',
        'LEFT TWO: the sentence continues here.',
        'LEFT THREE: more words in the left column.',
        'LEFT FOUR: the paragraph nears its end.',
        'LEFT FIVE: it ends with global hyper',
      ];
      const rightColumn = [
        'accuracy of the right column opens RIGHT ONE.',
        'Then a second sentence carries RIGHT TWO.',
        'A third sentence keeps RIGHT THREE going.',
        'A fourth sentence reaches RIGHT FOUR.',
        'The last sentence closes RIGHT FIVE.',
      ];
      leftColumn.forEach((text, index) => page.drawText(text, { x: 50, y: 720 - index * 18, size: 10, font }));
      rightColumn.forEach((text, index) => page.drawText(text, { x: 320, y: 720 - index * 18, size: 10, font }));
    } else if (pageNumber === 5) {
      // A captioned table reaches the bottom of the page and continues without
      // a source footer. The next page must retain wrapped cells and stop before
      // its first clearly separated body paragraph.
      page.drawText('Table 3. Continued measurements', { x: 70, y: 220, size: 11, font: bold });
      [['Measure', 'Value'], ['Alpha', '10'], ['Beta', '20']].forEach((row, rowIndex) => row.forEach((cell, column) => page.drawText(cell, {
        x: [70, 300][column], y: 195 - rowIndex * 18, size: 10, font,
      })));
    } else {
      [['Gamma', '30'], ['Delta', '40'], ['Epsilon', '50']].forEach((row, rowIndex) => row.forEach((cell, column) => page.drawText(cell, {
        x: [70, 300][column], y: 760 - rowIndex * 20, size: 10, font,
      })));
      // This single-column line is a wrapped value for the preceding row.
      page.drawText('wrapped', { x: 70, y: 700, size: 10, font });
      page.drawText('detail', { x: 115, y: 700, size: 10, font });
      // A one-item PDF text line without a paragraph gap stays prose even while
      // it falls inside the table's broad continuation region.
      page.drawText('single-item note stays prose.', { x: 70, y: 685, size: 10, font });
      page.drawText('The following paragraph describes the measurements in prose.', { x: 70, y: 650, size: 10, font });
    }
  }
  const pdfBytes = Buffer.from(await pdf.save());

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryExtractionQueue } = require(path.join(repoRoot, 'electron/library/libraryExtractionQueue.ts'));
  const store = new LibraryDiskStore(root, 'extract-device-0001');
  store.initialize();
  const folder = store.itemFolder('EXTRACT01');
  await mkdir(folder, { recursive: true });
  const original = path.join(folder, 'original.pdf');
  await writeFile(original, pdfBytes);
  const originalHash = createHash('sha256').update(pdfBytes).digest('hex');
  const item = store.upsertItem({
    id: 'zotero:EXTRACT01', storageId: 'EXTRACT01', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'EXTRACT01',
    metadata: { title: 'Entre norma y deseo', itemType: 'article-journal', creators: [], year: 2020, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.pdf', 'application/pdf')],
    files: { original: 'original.pdf', annotations: 'annotations.json' }, extraction: { status: 'pending' },
  });
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  catalog.rebuild(store);
  const progress = [];
  const queue = new LibraryExtractionQueue({ store, catalog, onProgress: (value) => progress.push(value) });
  const enqueued = queue.enqueue([item.id], { ocrMode: 'off' });
  assert.equal(enqueued.queued, 1);
  await queue.waitForIdle(30_000);
  assert.equal(catalog.getExtractionJob(enqueued.jobIds[0]).status, 'done');
  const extractedRecord = store.readMaterializedItem('EXTRACT01');
  const markdown = await readFile(path.join(folder, extractedRecord.files.reader), 'utf8');
  assert.match(markdown, /^# Entre norma y deseo/m);
  assert.doesNotMatch(markdown, /ISSN 2254-6901/, 'one-off first-page journal chrome is removed');
  assert.match(markdown, /^Quantitative analysis: A methodological Proposal$/m, 'a short orphaned title continuation is rejoined');
  assert.doesNotMatch(markdown, /^## Proposal$/m);
  assert.match(markdown, /interdisciplinar evita espacios dobles/);
  assert.doesNotMatch(markdown, /REVISTA DE HISTORIA/, 'repeated page chrome is removed');
  assert.doesNotMatch(markdown, / {2,}/, 'normalizer leaves no accidental double spaces');
  assert.match(markdown, /documentado\[\^1\][\s\S]*\n\nSegundo párrafo/, 'first-line indentation becomes a real paragraph boundary');
  assert.match(markdown, /^> “Esta cita textual ocupa un párrafo independiente y debe mostrarse como una cita sangrada\.”$/m);
  assert.match(markdown, /^## Notas$/m);
  assert.match(markdown, /^\[\^1\]: Nota al pie conservada al final del documento\.$/m);
  assert.match(markdown, /^\[\^2\]: Nota numerada con punto y enlace de retorno\.$/m);
  assert.match(markdown, /texto limpio \[\[1\]\]\(#nodus-reference-1\)\./, 'numeric citations link to their final reference');
  assert.match(markdown, /^\[\[1\]\]\(#nodus-reference-1\) Pérez, J\. Una referencia de prueba\. 2026\.$/m);
  assert.match(markdown, /\| Año \| Mujeres \| Total \|/);
  assert.match(markdown, /!\[Table · page 2\]\(assets\/table-p0002-/);
  assert.match(markdown, /<!-- nodus-table-transcription/);
  assert.match(markdown, /!\[Figura 1\. Distribución de resultados\]\(assets\//);

  // A two-column page is read column by column, and a line never crosses the gutter between
  // them. Before this, "global hyper" at the end of the left column and "accuracy of the right
  // column opens…" beside it became one sentence, and the corrupted quote reached the profile.
  // Every fixture line carries its own column marker, so a paragraph that mixes the two is the
  // bug: "global hyper" closing one column and "accuracy…" opening the next were once joined
  // into a single sentence, and the corrupted quote reached the profile as literal support.
  const columnParagraphs = markdown.split(/\n{2,}/).filter((block) => /(LEFT|RIGHT) (ONE|TWO|THREE|FOUR|FIVE)/.test(block));
  assert.equal(columnParagraphs.length, 2, 'each column is one paragraph');
  for (const block of columnParagraphs) {
    const sides = [/LEFT (ONE|TWO|THREE|FOUR|FIVE)/.test(block), /RIGHT (ONE|TWO|THREE|FOUR|FIVE)/.test(block)];
    assert.ok(!(sides[0] && sides[1]), `a paragraph must not mix the two columns: ${block.slice(0, 90)}`);
  }
  const columnOrder = [
    'Two-column fixture',
    'LEFT ONE', 'LEFT TWO', 'LEFT THREE', 'LEFT FOUR', 'LEFT FIVE',
    'accuracy of the right column opens RIGHT ONE', 'RIGHT TWO', 'RIGHT THREE', 'RIGHT FOUR', 'RIGHT FIVE',
  ].map((marker) => {
    const at = markdown.indexOf(marker);
    assert.ok(at >= 0, `the two-column fixture keeps ${marker}`);
    return at;
  });
  assert.deepEqual([...columnOrder].sort((a, b) => a - b), columnOrder, 'the left column is read whole before the right one');
  const assets = await readdir(path.join(path.dirname(path.join(folder, extractedRecord.files.reader)), 'assets'));
  assert.equal(assets.filter((file) => file.startsWith('figure-') && file.endsWith('.png')).length, 1, 'adjacent InDesign image tiles render as one logical figure');
  assert.equal(assets.filter((file) => file.startsWith('table-') && file.endsWith('.png')).length, 1, 'complex tables use one faithful visual while retaining a hidden text transcript');
  const sourceMap = JSON.parse(await readFile(path.join(folder, extractedRecord.files.sourceMap), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(folder, extractedRecord.files.qualityReport), 'utf8'));
  assert.equal(sourceMap.pages.length, 6);
  assert.equal(sourceMap.source.sha256, originalHash);
  assert.equal(sourceMap.reader.sha256, createHash('sha256').update(markdown).digest('hex'));
  assert.ok(sourceMap.blocks.every((block) => markdown.slice(block.markdown.start, block.markdown.end).length > 0));
  const continuedTableBlock = sourceMap.blocks.find((block) => block.kind === 'table' && block.anchors.some((anchor) => anchor.page === 6));
  assert.ok(continuedTableBlock, 'the continued table retains a page-6 source locator');
  const continuedTableText = markdown.slice(continuedTableBlock.markdown.start, continuedTableBlock.markdown.end);
  for (const value of ['Gamma', '30', 'Delta', '40', 'Epsilon', '50', 'wrapped detail']) {
    assert.ok(continuedTableText.includes(value), `continued table preserves ${value} in its table transcription`);
  }
  assert.doesNotMatch(continuedTableText, /single-item note stays prose/);
  assert.ok(sourceMap.blocks.some((block) => block.kind === 'paragraph'
    && block.anchors.some((anchor) => anchor.page === 6)
    && markdown.slice(block.markdown.start, block.markdown.end).includes('single-item note stays prose')),
  'a zero-cell line inside the broad table region remains searchable prose');
  const bodyAfterContinuedTable = sourceMap.blocks.find((block) => block.kind === 'paragraph'
    && block.anchors.some((anchor) => anchor.page === 6)
    && markdown.slice(block.markdown.start, block.markdown.end).includes('paragraph describes the measurements'));
  assert.ok(bodyAfterContinuedTable, 'body prose after a visual paragraph gap stays outside the table');
  assert.equal(quality.doubleSpaces, 0);
  assert.equal(quality.softHyphens, 0);
  assert.equal(quality.brokenWordLineWraps, 0);
  assert.equal(quality.footnoteReferences, 2);
  assert.equal(quality.footnoteDefinitions, 2);
  assert.equal(quality.unresolvedFootnotes, 0);
  assert.ok(quality.tables >= 1);
  assert.ok(quality.figures >= 1);
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'), originalHash, 'extraction never mutates the original');
  assert.ok(['ready', 'needs-review'].includes(store.readMaterializedItem('EXTRACT01').extraction.status));
  assert.equal(extractedRecord.contentRevision.components.extraction.freshness, 'current');
  assert.equal(extractedRecord.contentRevision.contentFingerprint, sourceMap.reader.sha256);
  assert.match(extractedRecord.files.reader, /^\.nodus[/\\]extractions[/\\][a-f0-9]{64}[/\\]reader\.md$/);
  assert.ok(progress.some((value) => value.phase === 'assets'));

  // Legacy safe storage encoded the dot in unsafe Unicode file names. The
  // extractor must infer the real format without renaming or mutating them.
  const encodedFolder = store.itemFolder('ENCODED01');
  await mkdir(encodedFolder, { recursive: true });
  const encodedName = 'An%C3%A1lisis_cuantitativo%2Epdf';
  await writeFile(path.join(encodedFolder, encodedName), pdfBytes);
  const encodedItem = store.upsertItem({
    id: 'nodus:ENCODED01', storageId: 'ENCODED01', source: 'nodus',
    metadata: { title: 'Análisis cuantitativo', itemType: 'document', creators: [], year: 2026, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [{ ...attachment(encodedName, 'application/pdf'), fileName: 'Análisis_cuantitativo.pdf' }],
    files: { original: encodedName, annotations: 'annotations.json' }, extraction: { status: 'pending' },
  });
  catalog.rebuild(store);
  const encodedExtraction = queue.enqueue([encodedItem.id], { ocrMode: 'off' });
  await queue.waitForIdle(30_000);
  assert.equal(catalog.getExtractionJob(encodedExtraction.jobIds[0]).status, 'done', 'an encoded .pdf suffix is still extracted as PDF');
  assert.ok(store.readMaterializedItem('ENCODED01').files.reader, 'encoded files publish clean Markdown');

  // A failed replacement keeps the published readable revision and its files.
  await writeFile(original, Buffer.from('not a pdf'));
  const failedReplacement = queue.enqueue([item.id], { ocrMode: 'off', force: true });
  await queue.waitForIdle(30_000);
  assert.equal(catalog.getExtractionJob(failedReplacement.jobIds[0]).status, 'failed');
  const retained = store.readMaterializedItem('EXTRACT01');
  assert.equal(retained.files.reader, extractedRecord.files.reader);
  assert.equal(retained.contentRevision.contentFingerprint, extractedRecord.contentRevision.contentFingerprint);
  assert.equal(retained.contentRevision.components.extraction.freshness, 'failed');
  assert.equal(await readFile(path.join(folder, retained.files.reader), 'utf8'), markdown);

  // A job left processing by a shutdown is reset to queued and resumed by the next queue.
  queue.dispose();
  const textFolder = store.itemFolder('TEXT01');
  await mkdir(textFolder, { recursive: true });
  await writeFile(path.join(textFolder, 'original.txt'), 'Documento de texto\n\nContenido reanudado sin  espacios dobles.');
  const textItem = store.upsertItem({
    id: 'nodus:TEXT01', storageId: 'TEXT01', source: 'nodus',
    metadata: { title: 'Documento de texto', itemType: 'document', creators: [], year: 2026, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.txt', 'text/plain')], files: { original: 'original.txt' }, extraction: { status: 'pending' },
  });
  catalog.indexItem(textItem, store);
  const interrupted = {
    id: 'interrupted-job', itemId: textItem.id, status: 'processing', phase: 'extract', progress: 0.4, priority: 2,
    options: { ocrMode: 'off', ocrLanguages: 'spa+eng', maxOcrPages: 10, extractImages: true, detectTables: true, force: false },
    attempts: 1, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  catalog.putExtractionJob(interrupted);
  const resumedQueue = new LibraryExtractionQueue({ store, catalog });
  await resumedQueue.waitForIdle(10_000);
  assert.equal(catalog.getExtractionJob('interrupted-job').status, 'done');
  const resumedItem = store.readMaterializedItem('TEXT01');
  assert.match(await readFile(path.join(textFolder, resumedItem.files.reader), 'utf8'), /sin espacios dobles/);

  // Cancellation is durable and returns a processing item to pending.
  resumedQueue.dispose();
  const cancelFolder = store.itemFolder('CANCEL01');
  await mkdir(cancelFolder, { recursive: true });
  await writeFile(path.join(cancelFolder, 'original.txt'), 'Cancelar esta extracción.');
  const cancelItem = store.upsertItem({
    id: 'nodus:CANCEL01', storageId: 'CANCEL01', source: 'nodus',
    metadata: { title: 'Cancelar', itemType: 'document', creators: [], year: 2026, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [attachment('original.txt', 'text/plain')], files: { original: 'original.txt' }, extraction: { status: 'pending' },
  });
  catalog.indexItem(cancelItem, store);
  const slowExtract = async ({ signal }) => {
    for (let index = 0; index < 100; index += 1) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const cancelQueue = new LibraryExtractionQueue({ store, catalog, extract: slowExtract });
  const cancelJob = cancelQueue.enqueue([cancelItem.id]).jobIds[0];
  while (catalog.getExtractionJob(cancelJob).status !== 'processing') await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cancelQueue.cancel(cancelJob), true);
  await cancelQueue.waitForIdle(5_000);
  assert.equal(catalog.getExtractionJob(cancelJob).status, 'canceled');
  assert.equal(store.readMaterializedItem('CANCEL01').extraction.status, 'pending');
  cancelQueue.dispose();
  catalog.close();
  console.log('Clean Markdown extraction, assets, source maps, persistent queue, resume and cancellation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
