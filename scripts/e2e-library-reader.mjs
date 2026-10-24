// Real-renderer acceptance test for the clean Library reader. The fixture lives in
// an isolated backup folder so the test exercises the same nodus-library contract as
// a Zotero import without touching a user's documents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildTextPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-reader-ui-'));
const userData = path.join(testRoot, 'profile');
const backupRoot = path.join(testRoot, 'backups');
const screenshotDirectory = path.join(repoRoot, 'output', 'library-reader-e2e');
const formatDialogDarkScreenshotPath = path.join(screenshotDirectory, '00-reader-format-choice-dark.png');
const formatDialogLightScreenshotPath = path.join(screenshotDirectory, '00b-reader-format-choice-light.png');
const workspaceTabsScreenshotPath = path.join(screenshotDirectory, '00c-library-document-tabs-dark.png');
const screenshotPath = path.join(screenshotDirectory, '01-clean-reader-chat-dark.png');
const originalScreenshotPath = path.join(screenshotDirectory, '02-original-page-preview.png');
const pdfScreenshotPath = path.join(screenshotDirectory, '03-pdf-reader.png');
const pdfZoomScreenshotPath = path.join(screenshotDirectory, '03b-pdf-reader-zoom.png');
const pdfZoomNarrowScreenshotPath = path.join(screenshotDirectory, '03c-pdf-reader-zoom-narrow.png');
const epubScreenshotPath = path.join(screenshotDirectory, '04-epub-reader-highlight.png');
const imageScreenshotPath = path.join(screenshotDirectory, '05-image-region-highlight.png');
const docxScreenshotPath = path.join(screenshotDirectory, '06-docx-reader.png');
const spreadsheetScreenshotPath = path.join(screenshotDirectory, '07-spreadsheet-reader.png');
const citationScreenshotPath = path.join(screenshotDirectory, '08-csl-style-manager.png');
const lightScreenshotPath = path.join(screenshotDirectory, '09-clean-reader-light-narrow.png');
const responsiveChatScreenshotPath = path.join(screenshotDirectory, '10-reader-chat-responsive.png');
const lightControlsScreenshotPath = path.join(screenshotDirectory, '11-reader-controls-light.png');
const lightOutlineScreenshotPath = path.join(screenshotDirectory, '12-reader-outline-light-hover.png');
const cleanFindScreenshotPath = path.join(screenshotDirectory, '13-reader-find-clean.png');
const pdfFindScreenshotPath = path.join(screenshotDirectory, '14-reader-find-pdf.png');
const epubFindScreenshotPath = path.join(screenshotDirectory, '15-reader-find-epub.png');
const imageFindScreenshotPath = path.join(screenshotDirectory, '16-reader-find-image.png');
const lightFindScreenshotPath = path.join(screenshotDirectory, '17-reader-find-light-narrow.png');
const pdfContinuousScreenshotPath = path.join(screenshotDirectory, '18-reader-pdf-continuous.png');
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  // A real backup disk can take hundreds of milliseconds to fsync. The reader
  // must paint the highlight before durable persistence acknowledges it.
  NODUS_E2E_LIBRARY_READER_WRITE_DELAY_MS: '750',
  HOME: testRoot,
  USERPROFILE: testRoot,
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAcL7reQAAAAASUVORK5CYII=',
  'base64',
);

function writeZip(file, entries) {
  const AdmZip = require('adm-zip'); const zip = new AdmZip();
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value));
  zip.writeZip(file);
}

let app;
try {
  await mkdir(screenshotDirectory, { recursive: true });
  const zoteroStyles = path.join(testRoot, 'Zotero', 'styles');
  await mkdir(zoteroStyles, { recursive: true });
  await writeFile(path.join(zoteroStyles, 'casa-velazquez-e2e.csl'), `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Casa de Velázquez — E2E</title><id>http://www.zotero.org/styles/casa-velazquez-e2e</id><rights license="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</rights><updated>2026-08-11T00:00:00+00:00</updated></info><citation><layout prefix="[" suffix="]"><text variable="title"/></layout></citation><bibliography><layout suffix="."><text variable="title"/></layout></bibliography></style>`, 'utf8');
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1500, height: 980 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const work = await page.evaluate(async ({ version, backup }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: true,
      advancedTourComplete: true,
      uiLanguage: 'es',
      mascotStyle: 'orb',
      mascotStyleChosen: true,
      mascotEnabled: false,
      reduceMotion: true,
      autoBackupFolder: backup,
      favorites: [
        { provider: 'openai', model: 'gpt-5.2' },
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      ],
      nodiModel: { provider: 'openai', model: 'gpt-5.2' },
    });
    await window.nodus.seedDemoData();
    return (await window.nodus.listWorksPage(undefined, { offset: 0, limit: 1 })).items[0];
  }, { version: require(path.join(repoRoot, 'package.json')).version, backup: backupRoot });
  assert.ok(work?.nodus_id && work?.zotero_key, 'the demo provides a work with a stable Zotero id');

  const documentFolder = path.join(backupRoot, 'nodus-library', work.zotero_key);
  const encodedOriginalPath = 'd3844809-Ana%CC%81lisis_cuantitativo_diarios_pioneros%2Epdf';
  const readableOriginalName = 'Análisis_cuantitativo_diarios_pioneros.pdf';
  const longReaderBody = Array.from({ length: 180 }, (_, index) =>
    `Párrafo de carga ${index + 1}. La biblioteca debe conservar una interacción inmediata aunque el documento tenga muchas páginas, notas, citas y fragmentos seleccionables.`
  ).join('\n\n');
  const markdown = `# ${work.title}

Texto introductorio para comprobar una lectura limpia, cómoda y persistente.

La afirmación principal conserva una nota al pie navegable[^1] y remite a una referencia bibliográfica [[1]](#nodus-reference-1).

> “Una cita textual independiente debe permanecer sangrada y claramente separada del cuerpo.”

## Introducción

Este fragmento se puede subrayar y anotar sin modificar el PDF original. La selección conserva su posición y su contexto.

![Figura de prueba](assets/figura.png)

*Figura 1. Recurso extraído junto al documento.*

## Resultados

| Dimensión | Resultado |
| --- | ---: |
| Claridad | 95 |
| Fidelidad | 98 |

La segunda sección permite comprobar el índice, la página de origen y el marcador de lectura.

Este párrafo adicional conserva el ritmo de lectura académica y hace visible la separación regular entre párrafos sin introducir controles innecesarios.

Otro párrafo de comprobación confirma que la primera línea se sangra, que el texto se justifica y que la composición sigue siendo legible en ventanas estrechas.

${longReaderBody}

## Referencias

[[1]](#nodus-reference-1) Pérez, J. *Referencia académica de prueba*. Nodus, 2026.

[^1]: Nota al pie con retorno bidireccional a la afirmación documentada.
`;
  const titleOffset = markdown.indexOf('# ');
  const introOffset = markdown.indexOf('## Introducción');
  const resultsOffset = markdown.indexOf('## Resultados');
  await mkdir(path.join(documentFolder, 'assets'), { recursive: true });
  await writeFile(path.join(documentFolder, 'reader.md'), markdown, 'utf8');
  await buildTextPdf(documentFolder, encodedOriginalPath);
  await writeFile(path.join(documentFolder, 'assets', 'figura.png'), tinyPng);
  await writeFile(path.join(documentFolder, 'figure.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="560" viewBox="0 0 960 560"><rect width="960" height="560" fill="#111827"/><rect x="70" y="70" width="820" height="420" rx="24" fill="#312e81"/><text x="110" y="150" fill="#e0e7ff" font-family="sans-serif" font-size="38">Figura preservada</text><path d="M120 410 L300 250 L455 360 L640 180 L840 410" fill="none" stroke="#a5b4fc" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><circle cx="640" cy="180" r="28" fill="#fbbf24"/></svg>`, 'utf8');
  writeZip(path.join(documentFolder, 'reader.epub'), {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><manifest><item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/><item id="results" href="results.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="intro"/><itemref idref="results"/></spine></package>',
    'OEBPS/intro.xhtml': '<html><head><title>Introducción EPUB</title></head><body><h1>Introducción EPUB</h1><p>Este texto refluye y admite subrayados independientes del Markdown.</p></body></html>',
    'OEBPS/results.xhtml': '<html><head><title>Resultados EPUB</title></head><body><h1>Resultados</h1><p>El segundo capítulo conserva su propio contexto de anotación.</p></body></html>',
  });
  writeZip(path.join(documentFolder, 'reader.docx'), {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento Word abierto dentro de Nodus.</w:t></w:r></w:p><w:p><w:r><w:t>Su texto también se puede seleccionar, subrayar y anotar.</w:t></w:r></w:p></w:body></w:document>',
  });
  writeZip(path.join(documentFolder, 'reader.xlsx'), {
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Dimensión</t></si><si><t>Resultado</t></si><si><t>Claridad</t></si><si><t>95</t></si><si><t>Fidelidad</t></si><si><t>98</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row></sheetData></worksheet>',
  });
  const now = new Date().toISOString();
  const contentFingerprint = createHash('sha256').update(markdown).digest('hex');
  const components = Object.fromEntries(['extraction', 'light', 'deep', 'passages', 'ideas', 'embeddings', 'summary'].map((component) => [component, {
    freshness: component === 'extraction' ? 'current' : 'none',
    fingerprint: component === 'extraction' ? 'c'.repeat(64) : null,
    reason: null,
    generatedAt: component === 'extraction' ? now : null,
  }]));
  await writeFile(path.join(documentFolder, 'annotations.json'), `${JSON.stringify([{
    id: 'orphaned-fixture', documentId: work.zotero_key, scope: 'source', kind: 'comment', color: null,
    startOffset: 0, endOffset: 16, selectedText: 'Fragmento antiguo', prefix: '', suffix: '',
    comment: 'Comentario recuperable', anchorStatus: 'orphaned', contentFingerprint,
    orphanReason: 'The quoted text could not be located in the new clean Markdown.', createdAt: now, updatedAt: now,
  }], null, 2)}\n`, 'utf8');
  const globalItemId = `zotero:${work.zotero_key}`;
  await writeFile(path.join(documentFolder, 'chat.json'), `${JSON.stringify([{
    id: 'assistant:grounded-fixture', role: 'assistant', createdAt: now,
    content: `La lectura distingue la introducción del bloque de resultados ([§ Introducción](nodus://reader/${encodeURIComponent(globalItemId)}/section/reader-section-2)). El documento abierto sigue siendo la fuente verificable ([${work.authors[0]}, ${work.year}](nodus://work/${globalItemId})).`,
  }], null, 2)}\n`, 'utf8');
  await writeFile(path.join(documentFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1,
    id: globalItemId, storageId: work.zotero_key, source: 'zotero', sourceLibraryId: 'users/0', sourceKey: work.zotero_key,
    citationKey: 'readerFixture2026',
    metadata: {
      title: work.title, itemType: 'article-journal', year: work.year,
      creators: work.authors.map((name) => ({ creatorType: 'author', name })), url: 'https://doi.org/10.0000/nodus-reader-fixture', isbn: [], issn: [], tags: ['lector'],
    },
    collectionIds: [], attachments: [
      { id: 'zotero:READERPDF', title: 'PDF original', fileName: readableOriginalName, relativePath: encodedOriginalPath, mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), role: 'original', position: 0 },
      { id: 'local:READEREPUB', title: 'EPUB original', fileName: 'reader.epub', relativePath: 'reader.epub', mimeType: 'application/epub+zip', byteSize: 1, sha256: 'b'.repeat(64), role: 'original', position: 1 },
      { id: 'local:READERIMAGE', title: 'Figura original', fileName: 'figure.svg', relativePath: 'figure.svg', mimeType: 'image/svg+xml', byteSize: 1, sha256: 'c'.repeat(64), role: 'image', position: 2 },
      { id: 'local:READERDOCX', title: 'Documento Word', fileName: 'reader.docx', relativePath: 'reader.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 1, sha256: 'd'.repeat(64), role: 'supplement', position: 3 },
      { id: 'local:READERXLSX', title: 'Datos XLSX', fileName: 'reader.xlsx', relativePath: 'reader.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteSize: 1, sha256: 'e'.repeat(64), role: 'supplement', position: 4 },
    ],
    files: { reader: 'reader.md', original: encodedOriginalPath, sourceMap: 'source-map.json', annotations: 'annotations.json', orphanedAnnotations: 'orphaned-annotations.json', chat: 'chat.json' },
    extraction: { status: 'ready', lastSuccessfulAt: now, lastSuccessfulFingerprint: 'c'.repeat(64) },
    contentRevision: {
      format: 'nodus.library-content-revision', formatVersion: 1, revision: 1,
      extractionFingerprint: 'c'.repeat(64), bibliographicFingerprint: 'd'.repeat(64), contentFingerprint,
      embeddingFingerprint: null, summaryFingerprint: null, components, previousReadable: null,
      pendingInvalidations: [], updatedAt: now,
    }, createdAt: now, deletedAt: null,
    clock: { deviceId: 'reader-e2e-device', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'b'.repeat(64) },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(documentFolder, 'source-map.json'), `${JSON.stringify({
    reader: { file: 'reader.md', sha256: contentFingerprint },
    pages: [{ page: 1, width: 612, height: 792 }, { page: 2, width: 612, height: 792 }],
    blocks: [
      { kind: 'title', markdown: { start: titleOffset, end: titleOffset + work.title.length + 2 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: introOffset, end: introOffset + 16 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: resultsOffset, end: resultsOffset + 13 }, anchors: [{ page: 2 }] },
    ],
  }, null, 2)}\n`, 'utf8');

  const secondStorageId = 'READER02';
  const secondGlobalItemId = `zotero:${secondStorageId}`;
  const secondTitle = `${work.title} — Segunda lectura`;
  const secondDocumentFolder = path.join(backupRoot, 'nodus-library', secondStorageId);
  await cp(documentFolder, secondDocumentFolder, { recursive: true });
  const secondMetadata = JSON.parse(await readFile(path.join(secondDocumentFolder, 'metadata.json'), 'utf8'));
  secondMetadata.id = secondGlobalItemId;
  secondMetadata.storageId = secondStorageId;
  secondMetadata.sourceKey = secondStorageId;
  secondMetadata.citationKey = 'readerFixtureSecond2026';
  secondMetadata.metadata.title = secondTitle;
  secondMetadata.clock.revision += 1;
  secondMetadata.clock.updatedAt = new Date().toISOString();
  await writeFile(path.join(secondDocumentFolder, 'metadata.json'), `${JSON.stringify(secondMetadata, null, 2)}\n`, 'utf8');

  await page.evaluate(() => window.nodus.rebuildGlobalLibrary());

  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const updateModal = page.getByTestId('startup-update-modal');
  await updateModal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await updateModal.isVisible().catch(() => false)) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  const globalPage = await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 10, offset: 0 }));
  assert.equal(globalPage.total, 2, `expected the two isolated global reader fixtures; catalog contained ${JSON.stringify(globalPage.items)}`);
  assert.ok(globalPage.items.some((item) => item.id === globalItemId));
  assert.ok(globalPage.items.some((item) => item.id === secondGlobalItemId));

  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-global').click();
  const globalRow = page.getByTestId(`global-library-item-${globalItemId}`);
  await globalRow.waitFor({ state: 'visible' });
  await globalRow.getByRole('button').click();
  await page.getByTestId('global-library-detail').getByRole('button', { name: 'Leer', exact: true }).click();
  const openingFormatDialog = page.getByTestId('library-reader-format-dialog');
  await openingFormatDialog.waitFor({ state: 'visible' });
  assert.equal(await openingFormatDialog.getByTestId('library-reader-format-clean').isEnabled(), true, 'clean Markdown is offered on first open');
  assert.equal(await openingFormatDialog.getByTestId('library-reader-format-original').isEnabled(), true, 'the preserved original is offered on first open');
  await page.screenshot({ path: formatDialogDarkScreenshotPath, fullPage: true });
  await openingFormatDialog.getByTestId('library-reader-format-remember').check();
  await openingFormatDialog.getByTestId('library-reader-format-clean').click();
  await openingFormatDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.libraryReader.openingFormat')), 'clean', 'the user can remember one opening format across Library items');
  const documentRoot = page.getByTestId('library-reader-document');
  await documentRoot.waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-freshness').innerText(), /Markdown/);

  await page.getByTestId(`library-workspace-close-${globalItemId}`).click();
  await globalRow.waitFor({ state: 'visible' });
  await globalRow.getByRole('button').dblclick();
  await documentRoot.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-reader-format-dialog').count(), 0, 'double-click uses the remembered opening format without asking again');

  await page.getByTestId('library-workspace-tab-library').click();
  const secondRow = page.getByTestId(`global-library-item-${secondGlobalItemId}`);
  await secondRow.waitFor({ state: 'visible' });
  await secondRow.dblclick();
  await page.getByTestId(`library-workspace-tab-document-${secondGlobalItemId}`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid^="library-workspace-tab-document-"]').count(), 2, 'two documents remain open in the compact Library workspace');
  const workspaceStripBox = await page.getByTestId('library-workspace-tabs').boundingBox();
  assert.ok(workspaceStripBox && workspaceStripBox.height <= 38, `document tabs use one low-height row (${workspaceStripBox?.height}px)`);
  await page.screenshot({ path: workspaceTabsScreenshotPath, fullPage: true });
  await page.getByTestId(`library-workspace-tab-document-${globalItemId}`).click();
  await page.locator('.library-document-reader > header h1').filter({ hasText: work.title }).waitFor({ state: 'visible' });
  await page.getByTestId(`library-workspace-tab-document-${secondGlobalItemId}`).click();
  await page.locator('.library-document-reader > header h1').filter({ hasText: secondTitle }).waitFor({ state: 'visible' });
  await page.getByTestId(`library-workspace-close-${secondGlobalItemId}`).click();
  await page.getByTestId(`library-workspace-tab-document-${globalItemId}`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid^="library-workspace-tab-document-"]').count(), 1, 'closing one document leaves the other reader tab intact');

  // Leaving the section unmounts it, tabs and all. What was open has to be open again
  // on the way back — and at the page it was left on, which the reader stores per
  // document rather than in the section's snapshot.
  const cleanScroller = page.locator('main.library-reader-clean-surface');
  await page.mouse.move(760, 520);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  const leftAtOffset = await cleanScroller.evaluate((element) => element.scrollTop);
  assert.ok(leftAtOffset > 200, `the wheel moved the document (scrollTop ${leftAtOffset})`);
  await page.locator('[data-tour="nav-ideas"]').click();
  await documentRoot.waitFor({ state: 'detached' });
  await page.locator('[data-tour="nav-library"]').click();
  await documentRoot.waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid^="library-workspace-tab-document-"]').count(), 1, 'the open document is open again');
  await page.getByTestId(`library-workspace-tab-document-${globalItemId}`).waitFor({ state: 'visible' });
  await page.waitForFunction(
    (expected) => Math.abs((document.querySelector('main.library-reader-clean-surface')?.scrollTop ?? 0) - expected) <= 4,
    leftAtOffset,
  );

  assert.match(await documentRoot.innerText(), /Texto introductorio/);
  assert.equal(await documentRoot.locator('img').count(), 1, 'local extracted images render inside the clean document');
  assert.equal(await documentRoot.locator('table').count(), 1, 'Markdown tables remain structured');
  await page.keyboard.press('Control+f');
  const cleanFindPanel = page.getByTestId('find-in-page');
  await cleanFindPanel.waitFor({ state: 'visible' });
  const [readerHeaderBox, cleanFindBox, persistentReaderSidebarBox] = await Promise.all([
    page.locator('.library-document-reader > header').boundingBox(),
    cleanFindPanel.boundingBox(),
    page.getByTestId('library-reader-sidebar').boundingBox(),
  ]);
  assert.ok(readerHeaderBox && cleanFindBox && persistentReaderSidebarBox);
  assert.ok(cleanFindBox.y >= readerHeaderBox.y + readerHeaderBox.height - 1, `document search opens below the reader header (${JSON.stringify({ readerHeaderBox, cleanFindBox })})`);
  assert.ok(cleanFindBox.x + cleanFindBox.width <= persistentReaderSidebarBox.x + 1, `document search does not cover the persistent notes or chat rail (${JSON.stringify({ cleanFindBox, persistentReaderSidebarBox })})`);
  assert.equal(await cleanFindPanel.locator('input[type="checkbox"]').count(), 3, 'document search exposes three compact search options');
  const cleanFindInput = page.getByTestId('find-in-page-input');
  const cleanFindStatus = page.getByTestId('find-in-page-status');
  await cleanFindInput.fill('párrafo de carga');
  await cleanFindStatus.filter({ hasText: 'Coincidencia 1 de 180' }).waitFor();
  await page.waitForFunction(() => CSS.highlights?.get('nodus-find')?.size === 180 && CSS.highlights?.get('nodus-find-current')?.size === 1);
  await page.getByTestId('find-option-case').check();
  await cleanFindStatus.filter({ hasText: 'No se encontró ese texto' }).waitFor();
  await page.getByTestId('find-option-case').uncheck();
  await cleanFindStatus.filter({ hasText: 'Coincidencia 1 de 180' }).waitFor();
  await cleanFindInput.fill('carg');
  await cleanFindStatus.filter({ hasText: 'Coincidencia 1 de 180' }).waitFor();
  await page.getByTestId('find-option-whole').check();
  await cleanFindStatus.filter({ hasText: 'No se encontró ese texto' }).waitFor();
  await page.getByTestId('find-option-whole').uncheck();
  await cleanFindInput.fill('párrafo de carga');
  await cleanFindStatus.filter({ hasText: 'Coincidencia 1 de 180' }).waitFor();
  await cleanFindPanel.getByRole('button', { name: 'Ir a la coincidencia siguiente' }).click();
  await cleanFindStatus.filter({ hasText: 'Coincidencia 2 de 180' }).waitFor();
  await page.getByTestId('find-option-mark-all').uncheck();
  await page.waitForFunction(() => !CSS.highlights?.get('nodus-find') && CSS.highlights?.get('nodus-find-current')?.size === 1);
  await page.getByTestId('find-option-mark-all').check();
  await page.screenshot({ path: cleanFindScreenshotPath, fullPage: true });
  await page.keyboard.press('Escape');
  await cleanFindPanel.waitFor({ state: 'detached' });
  const academicProseLayout = await documentRoot.evaluate((root) => {
    const paragraph = root.querySelector('.md > p');
    const quotation = root.querySelector('.md blockquote');
    if (!(paragraph instanceof HTMLElement) || !(quotation instanceof HTMLElement)) throw new Error('academic prose fixture missing');
    return {
      alignment: getComputedStyle(paragraph).textAlign,
      lastAlignment: getComputedStyle(paragraph).textAlignLast,
      indent: Number.parseFloat(getComputedStyle(paragraph).textIndent),
      quoteInset: Number.parseFloat(getComputedStyle(quotation).marginLeft),
    };
  });
  assert.equal(academicProseLayout.alignment, 'justify');
  assert.match(academicProseLayout.lastAlignment, /^(?:start|left)$/);
  assert.ok(academicProseLayout.indent >= 20, 'reader prose has a visible first-line indent');
  assert.ok(academicProseLayout.quoteInset >= 24, 'standalone quotations are inset from the prose column');

  const cleanSurface = page.locator('.library-reader-clean-surface');
  const numericReference = documentRoot.locator('a[href="#nodus-reference-1"]').first();
  assert.equal(await numericReference.evaluate((element) => element.closest('#nodus-reference-1') !== null), false, 'the first numeric link is the in-text citation');
  await numericReference.click();
  await page.waitForTimeout(750);
  const numericForwardScroll = await cleanSurface.evaluate((element) => element.scrollTop);
  assert.ok(numericForwardScroll > 100, 'numeric citation scrolls to the final reference');
  const numericTarget = documentRoot.locator('#nodus-reference-1');
  await numericTarget.locator('a[href="#nodus-reference-1"]').click();
  await page.waitForTimeout(750);
  const numericReturnScroll = await cleanSurface.evaluate((element) => element.scrollTop);
  assert.ok(numericReturnScroll < numericForwardScroll - 50, `numeric reference returns to its citation (${numericReturnScroll} < ${numericForwardScroll})`);
  const footnoteReference = documentRoot.locator('a[data-footnote-ref]').first();
  await footnoteReference.click();
  await page.waitForTimeout(750);
  const footnoteForwardScroll = await cleanSurface.evaluate((element) => element.scrollTop);
  assert.ok(footnoteForwardScroll > 100, 'footnote citation scrolls to its definition');
  await documentRoot.locator('a[data-footnote-backref]').first().click();
  await page.waitForTimeout(750);
  const footnoteReturnScroll = await cleanSurface.evaluate((element) => element.scrollTop);
  assert.ok(footnoteReturnScroll < footnoteForwardScroll - 50, `footnote returns to its citation (${footnoteReturnScroll} < ${footnoteForwardScroll})`);
  await cleanSurface.evaluate((element) => element.scrollTo({ top: 0 }));
  const readerOutline = page.locator('.library-reader-outline');
  assert.match(await readerOutline.innerText(), /Índice del documento[\s\S]*Introducción[\s\S]*Resultados/i, 'traced headings lead the reader rail');
  const filesToggle = page.getByTestId('library-reader-files-toggle');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'preserved files start in one compact control');
  assert.equal(await page.getByTestId('library-reader-files').count(), 0);
  await filesToggle.click();
  assert.equal(await page.getByTestId('library-reader-files').locator('[data-testid^="library-reader-file-"]').count(), 6, 'the compact file control reveals every preserved source');
  assert.equal(await page.getByTestId('library-reader-reset-format-preference').isVisible(), true, 'a remembered format can be reset from the file chooser');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'true');
  const filesInteraction = await page.evaluate(async () => {
    const clean = document.querySelector('[data-testid="library-reader-file-clean"]');
    if (!(clean instanceof HTMLButtonElement)) throw new Error('clean reader source is unavailable');
    const started = performance.now();
    clean.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return { elapsed: performance.now() - started, active: clean.classList.contains('is-active') };
  });
  assert.ok(filesInteraction.elapsed < 150, `the file menu remains responsive on a long document (${filesInteraction.elapsed.toFixed(1)}ms)`);
  assert.equal(filesInteraction.active, true, 'the expanded menu remains interactive');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'choosing the current source also closes the compact menu');
  await filesToggle.click();
  await page.getByTestId('library-reader-reset-format-preference').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('nodus.libraryReader.openingFormat')), null, 'reset restores the choice on the next open');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'resetting the opening choice closes the compact menu');
  await filesToggle.click();
  const sourceSwitchStarted = Date.now();
  await page.getByTestId('library-reader-file-zotero:READERPDF').click();
  const firstPdfViewer = page.getByTestId('library-reader-pdf-viewer');
  await firstPdfViewer.waitFor({ state: 'visible' });
  assert.ok(Date.now() - sourceSwitchStarted < 300, 'choosing a preserved file switches the reader without blocking the interface');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'the compact file menu closes after choosing a source');
  await Promise.race([
    page.waitForFunction(() => Number(document.querySelector('[data-testid="library-reader-pdf-viewer"]')?.getAttribute('data-rendered-scale')) > 0),
    firstPdfViewer.getByRole('alert').waitFor({ state: 'visible' }).then(async () => { throw new Error(`PDF load failed: ${await firstPdfViewer.getByRole('alert').innerText()}`); }),
  ]);
  assert.equal(await firstPdfViewer.getByRole('alert').count(), 0, 'the first clean-to-PDF switch finishes without a transport error');
  await page.getByTestId('library-reader-source-picker').locator('select').selectOption('clean');
  await documentRoot.waitFor({ state: 'visible' });
  await page.getByTestId('library-reader-source-picker').locator('select').selectOption('zotero:READERPDF');
  const repeatedPdfViewer = page.getByTestId('library-reader-pdf-viewer');
  await Promise.race([
    page.waitForFunction(() => Number(document.querySelector('[data-testid="library-reader-pdf-viewer"]')?.getAttribute('data-rendered-scale')) > 0),
    repeatedPdfViewer.getByRole('alert').waitFor({ state: 'visible' }).then(async () => { throw new Error(`Repeated PDF load failed: ${await repeatedPdfViewer.getByRole('alert').innerText()}`); }),
  ]);
  assert.equal(await page.getByTestId('library-reader-pdf-viewer').getByRole('alert').count(), 0, 'PDF also finishes after switching away and back');
  await page.getByTestId('library-reader-source-picker').locator('select').selectOption('clean');
  await documentRoot.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-reader-source-picker').locator('option').count(), 6, 'clean Markdown and five preserved attachments are directly selectable');
  const sourcePickerText = await page.getByTestId('library-reader-source-picker').locator('select').innerText();
  assert.match(sourcePickerText, new RegExp(readableOriginalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the source picker keeps the human-readable PDF name');
  assert.doesNotMatch(sourcePickerText, /%2Epdf/i, 'the encoded storage path never appears as a second reader source');
  const darkReaderColors = await page.evaluate(() => {
    const surface = document.querySelector('.library-reader-clean-surface');
    const paper = document.querySelector('.library-reader-paper');
    const text = document.querySelector('.library-reader-document .md');
    if (!surface || !paper || !text) throw new Error('clean reader colors unavailable');
    return {
      surface: getComputedStyle(surface).backgroundColor,
      paper: getComputedStyle(paper).backgroundColor,
      text: getComputedStyle(text).color,
    };
  });
  assert.notEqual(darkReaderColors.paper, 'rgb(255, 255, 255)', 'dark mode never renders a white clean page');
  assert.match(darkReaderColors.surface, /rgb\((?:9, 9, 11|10, 10, 10)\)/);
  const outlineToggle = page.getByTestId('library-reader-outline-toggle');
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'true');
  await outlineToggle.click();
  await page.locator('.library-reader-outline').waitFor({ state: 'detached' });
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
  await outlineToggle.click();
  await page.locator('.library-reader-outline').waitFor({ state: 'visible' });

  const sidebarToggle = page.getByTestId('library-reader-sidebar-toggle');
  assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'true');
  await sidebarToggle.click();
  await page.getByTestId('library-reader-sidebar').waitFor({ state: 'detached' });
  assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'false');
  await sidebarToggle.click();
  await page.getByTestId('library-reader-sidebar').waitFor({ state: 'visible' });
  await page.getByTestId('library-reader-layout').getByText(work.zotero_key, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preguntar al chat' }).waitFor();

  await page.getByRole('button', { name: 'Ver página 1' }).click();
  const originalPreview = page.getByTestId('library-original-preview');
  await originalPreview.waitFor({ state: 'visible' });
  await originalPreview.locator('canvas').waitFor({ state: 'visible' });
  assert.equal(await originalPreview.locator('canvas').getAttribute('data-page'), '1');
  assert.equal((await originalPreview.getByRole('button', { name: 'Anterior' }).innerText()).trim(), '', 'page navigation uses an icon-only previous control');
  assert.equal((await originalPreview.getByRole('button', { name: 'Siguiente' }).innerText()).trim(), '', 'page navigation uses an icon-only next control');
  await page.screenshot({ path: originalScreenshotPath, fullPage: true });
  await originalPreview.getByRole('button', { name: 'Cerrar' }).click();

  const readerSidebar = page.getByTestId('library-reader-sidebar');
  const notesTab = readerSidebar.getByRole('tab', { name: 'Notas' });
  const infoTab = readerSidebar.getByRole('tab', { name: 'Info' });
  assert.equal((await notesTab.innerText()).trim(), 'Notas', 'the active sidebar tab shows its label');
  assert.equal((await infoTab.innerText()).trim(), '', 'inactive sidebar tabs stay icon-only');
  await infoTab.click();
  assert.equal((await infoTab.innerText()).trim(), 'Info', 'the selected information tab reveals its compact label');
  assert.equal((await notesTab.innerText()).trim(), '', 'the previous tab collapses back to its icon');
  assert.match(await page.getByTestId('library-reader-metadata').innerText(), new RegExp(work.zotero_key));
  await page.getByTestId('library-reader-online-source').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-online-source').innerText(), /doi\.org/);
  const provenance = page.getByTestId('library-reader-provenance');
  assert.match(await provenance.innerText(), new RegExp(contentFingerprint));
  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  const readerCitation = page.getByTestId('library-reader-chat').locator('[data-citation-kind="reader"]');
  await readerCitation.waitFor({ state: 'visible' });
  assert.match(await readerCitation.innerText(), /Introducción/);
  await readerCitation.click();
  await page.waitForFunction(() => (document.querySelector('.library-reader-clean-surface')?.scrollTop ?? 0) > 0);
  await page.locator('.library-reader-clean-surface').evaluate((element) => element.scrollTo({ top: 0 }));
  const chatModel = page.getByTestId('library-reader-chat-model');
  await chatModel.getByRole('button', { name: /OpenAI · gpt-5.2/ }).click();
  assert.equal(await chatModel.getByRole('option').count(), 2, 'the reader model menu lists the configured featured models');
  await chatModel.getByRole('option', { name: /Anthropic · claude-sonnet-4-5/ }).click();
  assert.match(await chatModel.innerText(), /Anthropic · claude-sonnet-4-5/);
  const chatInput = page.getByTestId('library-reader-chat-input');
  await chatInput.waitFor();
  await chatInput.fill('¿Cuál es la tesis principal?');
  assert.equal(await page.getByTestId('library-reader-chat-send').isEnabled(), true, 'the embedded contextual chat composer is interactive');
  await chatInput.fill('');
  await page.setViewportSize({ width: 1120, height: 680 });
  const responsiveSidebar = await readerSidebar.boundingBox();
  const responsiveComposer = await page.getByTestId('library-reader-chat-input').boundingBox();
  assert.ok(responsiveSidebar && responsiveComposer);
  assert.ok(responsiveSidebar.y >= 0 && responsiveSidebar.y + responsiveSidebar.height <= 681, 'the resized right rail remains inside the reader viewport');
  assert.ok(responsiveComposer.y + responsiveComposer.height <= responsiveSidebar.y + responsiveSidebar.height, 'the chat composer remains fully reachable after resizing');
  const toastStack = await page.getByTestId('app-toast-stack').boundingBox();
  if (toastStack && toastStack.width > 0 && toastStack.height > 0) {
    assert.ok(toastStack.x + toastStack.width <= responsiveSidebar.x, 'transient notifications do not cover the reader chat rail');
  }
  await page.screenshot({ path: responsiveChatScreenshotPath, fullPage: true });
  await page.setViewportSize({ width: 1500, height: 980 });
  await readerSidebar.getByRole('tab', { name: 'Notas' }).click();
  await page.getByTestId('library-reader-orphaned-annotations').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-orphaned-annotations').innerText(), /Comentario recuperable/);

  const selectCandidate = async (index) => {
    return page.evaluate((candidateIndex) => {
      const root = document.querySelector('[data-testid="library-reader-document"]');
      if (!(root instanceof HTMLElement)) throw new Error('reader document missing');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const candidates = [];
      let node = walker.nextNode();
      while (node) {
        const start = node.data.search(/\S/);
        if (start >= 0 && node.data.slice(start).trim().length >= 16) candidates.push({ node, start });
        node = walker.nextNode();
      }
      const candidate = candidates[candidateIndex % candidates.length];
      if (!candidate) throw new Error('no selectable reader text');
      const range = document.createRange();
      range.setStart(candidate.node, candidate.start);
      range.setEnd(candidate.node, Math.min(candidate.node.data.length, candidate.start + 16));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const releaseRect = range.getBoundingClientRect();
      // A real selection ends under the pointer, and the ribbon is placed there.
      const release = { x: releaseRect.right, y: releaseRect.top + releaseRect.height / 2 };
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: release.x, clientY: release.y }));
      return { text: range.toString(), release };
    }, index);
  };

  const waitForSavedAnnotations = async (predicate, label, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const saved = await page.evaluate((id) => window.nodus.listLibraryReaderAnnotations(id), globalItemId);
      if (predicate(saved)) return saved;
      await page.waitForTimeout(50);
    }
    throw new Error(`Timed out waiting for persisted reader annotation: ${label}`);
  };

  const assertViewerContained = async (viewer, label) => {
    const [layoutBox, viewerBox, sidebarBox, geometry] = await Promise.all([
      page.getByTestId('library-reader-layout').boundingBox(),
      viewer.boundingBox(),
      readerSidebar.boundingBox(),
      page.getByTestId('library-reader-layout').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    ]);
    assert.ok(layoutBox && viewerBox && sidebarBox, `${label} exposes measurable reader regions`);
    assert.ok(sidebarBox.x >= layoutBox.x && sidebarBox.x + sidebarBox.width <= layoutBox.x + layoutBox.width + 1, `${label} keeps the right rail fully inside the reader`);
    assert.ok(viewerBox.x >= layoutBox.x && viewerBox.x + viewerBox.width <= sidebarBox.x + 1, `${label} cannot render underneath or beyond the right rail`);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${label} never expands the complete reader viewport`);
  };

  const cleanSelection = await selectCandidate(1);
  const selectionBar = page.locator('.reader-selection-actions');
  await selectionBar.waitFor({ state: 'visible' });
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 6);
  // Highlighting from the library follows the pointer that ended the selection.
  const cleanRibbonBox = await selectionBar.boundingBox();
  assert.ok(Math.abs(cleanRibbonBox.x + cleanRibbonBox.width / 2 - cleanSelection.release.x) <= 2, `ribbon centred on the pointer (${cleanRibbonBox.x + cleanRibbonBox.width / 2} vs ${cleanSelection.release.x})`);
  assert.ok(cleanRibbonBox.y + cleanRibbonBox.height <= cleanSelection.release.y, 'ribbon sits above the pointer');
  const highlightStarted = Date.now();
  await selectionBar.locator('.reader-selection-color').first().click();
  await page.waitForFunction(() => {
    const registry = CSS.highlights;
    const highlight = registry?.get('nodus-reader-yellow');
    return Boolean(highlight && highlight.size > 0);
  }, undefined, { timeout: 300 });
  const highlightPaintLatency = Date.now() - highlightStarted;
  assert.ok(highlightPaintLatency < 300, `highlight paints optimistically before the delayed disk write (${highlightPaintLatency}ms)`);
  await waitForSavedAnnotations((items) => items.some((item) => item.kind === 'highlight'), 'clean highlight');

  await selectCandidate(2);
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.getByRole('button', { name: 'Añadir comentario' }).click();
  const commentEditor = page.locator('.reader-comment-editor');
  await commentEditor.locator('textarea').fill('Una nota vinculada al fragmento seleccionado.');
  await commentEditor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await waitForSavedAnnotations((items) => items.some((item) => item.kind === 'comment'), 'clean comment');

  const bookmarkMenu = page.getByTestId('library-reader-bookmark-menu');
  await bookmarkMenu.click();
  await page.getByRole('menuitem', { name: 'Marcar esta sección' }).click();
  await bookmarkMenu.click();
  const goToBookmark = page.getByRole('menuitem', { name: 'Ir al marcador de lectura' });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="menuitem"]')).some((item) => item.textContent?.includes('Ir al marcador de lectura') && !item.disabled), undefined, { timeout: 300 });
  assert.equal(await goToBookmark.isEnabled(), true, 'the bookmark menu exposes navigation once a mark exists');
  await goToBookmark.click();
  assert.match(await page.locator('.library-reader-notes').innerText(), /2 fragmentos guardados/);

  await waitForSavedAnnotations((items) => items.some((item) => item.kind === 'bookmark'), 'reader bookmark');
  await waitForSavedAnnotations((items) => items.length >= 3, 'complete clean annotation set');
  const diskAnnotations = JSON.parse(await readFile(path.join(documentFolder, 'annotations.json'), 'utf8'));
  assert.equal(diskAnnotations.length, 4);
  assert.ok(diskAnnotations.every((item) => item.documentId === work.zotero_key), 'annotations retain the stable Zotero identifier');

  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  await page.getByTestId('library-reader-chat-input').waitFor();
  await page.locator('.library-reader-clean-surface').evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const sourceChooser = page.getByTestId('library-reader-source-picker').locator('select');
  await sourceChooser.selectOption('zotero:READERPDF');
  const pdfViewer = page.getByTestId('library-reader-pdf-viewer');
  await pdfViewer.waitFor({ state: 'visible' });
  await pdfViewer.locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-reader-pdf-viewer"] .textLayer span').length > 0);
  assert.equal(await pdfViewer.getAttribute('data-view-mode'), 'single', 'the focused single-page view remains the default');
  assert.equal(await page.getByTestId('library-reader-pdf-view-single').getAttribute('aria-pressed'), 'true');
  // Change scale and view while PDF.js is still painting. Every transition must
  // receive its own canvas rather than racing a previous render on the same one.
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId('library-reader-pdf-zoom-in').click();
    await page.getByTestId('library-reader-pdf-zoom-out').click();
    await page.getByTestId('library-reader-pdf-view-continuous').click();
    await page.getByTestId('library-reader-pdf-view-single').click();
  }
  await page.getByTestId('library-reader-pdf-view-continuous').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-library-pdf-page]').length === 3);
  assert.equal(await pdfViewer.getAttribute('data-view-mode'), 'continuous');
  assert.equal(await page.getByTestId('library-reader-pdf-view-continuous').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: pdfContinuousScreenshotPath, fullPage: true });
  await page.getByTestId('library-reader-pdf-view-single').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-library-pdf-page]').length === 1);
  await page.keyboard.press('Control+f');
  const pdfFindPanel = page.getByTestId('find-in-page');
  await pdfFindPanel.waitFor({ state: 'visible' });
  await page.getByTestId('find-in-page-input').fill('hipotesis inicial');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Coincidencia 1 de 1' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="library-reader-pdf-viewer"] input[aria-label="Página"]')?.value === '3');
  await page.waitForFunction(() => CSS.highlights?.get('nodus-find-current')?.size === 1);
  await page.screenshot({ path: pdfFindScreenshotPath, fullPage: true });
  await page.keyboard.press('Escape');
  await pdfFindPanel.waitFor({ state: 'detached' });
  await pdfViewer.getByRole('spinbutton', { name: 'Página' }).fill('1');
  await page.waitForFunction(() => document.querySelector('[data-testid="library-reader-pdf-viewer"] input[aria-label="Página"]')?.value === '1');
  await page.waitForFunction(() => document.querySelector('[data-testid="library-reader-pdf-viewer"]')?.getAttribute('data-rendered-scale') && document.querySelector('[data-testid="library-reader-pdf-viewer"] .textLayer')?.textContent?.includes('rapido zorro'));
  assert.match(await page.getByTestId('library-reader-freshness').innerText(), /Archivo original/);
  assert.match(await page.locator('.library-reader-outline').innerText(), /Introducción[\s\S]*Resultados/, 'the clean-document outline remains available while the PDF is open');
  assert.equal((await pdfViewer.getByRole('button', { name: 'Anterior' }).innerText()).trim(), '');
  assert.equal((await pdfViewer.getByRole('button', { name: 'Siguiente' }).innerText()).trim(), '');
  await page.evaluate(() => {
    const span = document.querySelector('[data-testid="library-reader-pdf-viewer"] .textLayer span');
    if (!(span instanceof HTMLElement) || !span.firstChild?.textContent) throw new Error('PDF text layer is empty');
    const range = document.createRange(); range.selectNodeContents(span.firstChild); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const spanRect = range.getBoundingClientRect();
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: spanRect.right, clientY: spanRect.top + spanRect.height / 2 }));
  });
  await page.locator('.reader-selection-actions').waitFor({ state: 'visible' });
  await page.locator('.reader-selection-actions .reader-selection-color').first().click();
  await waitForSavedAnnotations((items) => items.some((item) => item.scope === 'attachment:zotero:READERPDF:page:1'), 'PDF highlight');
  await page.waitForFunction(() => {
    const highlight = CSS.highlights?.get('nodus-reader-yellow');
    return Boolean(highlight && highlight.size > 0 && Array.from(highlight).every((range) => range.startContainer.isConnected && range.endContainer.isConnected));
  });
  const sidebarBeforeZoom = await readerSidebar.boundingBox();
  assert.ok(sidebarBeforeZoom);
  for (let index = 0; index < 3; index += 1) await page.getByTestId('library-reader-pdf-zoom-in').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="library-reader-pdf-viewer"]')?.getAttribute('data-rendered-scale')) >= 1.69);
  await page.waitForFunction(() => {
    const highlight = CSS.highlights?.get('nodus-reader-yellow');
    return Boolean(highlight && highlight.size > 0 && Array.from(highlight).every((range) => range.startContainer.isConnected && range.endContainer.isConnected));
  });
  const sidebarAfterZoom = await readerSidebar.boundingBox();
  assert.ok(sidebarAfterZoom);
  assert.ok(Math.abs(sidebarAfterZoom.width - sidebarBeforeZoom.width) < 1, 'PDF zoom cannot progressively shrink the right rail');
  await assertViewerContained(pdfViewer, 'zoomed PDF');
  const pdfScrollGeometry = await pdfViewer.locator('main').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(pdfScrollGeometry.scrollWidth > pdfScrollGeometry.clientWidth, 'an enlarged PDF scrolls horizontally inside its own viewport');
  await page.screenshot({ path: pdfZoomScreenshotPath, fullPage: true });
  await page.setViewportSize({ width: 1120, height: 760 });
  const [narrowLayoutBox, narrowSidebarBox, narrowLayoutGeometry, narrowSidebarBackground] = await Promise.all([
    page.getByTestId('library-reader-layout').boundingBox(),
    readerSidebar.boundingBox(),
    page.getByTestId('library-reader-layout').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    readerSidebar.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  assert.ok(narrowLayoutBox && narrowSidebarBox);
  assert.ok(narrowSidebarBox.x >= narrowLayoutBox.x && narrowSidebarBox.x + narrowSidebarBox.width <= narrowLayoutBox.x + narrowLayoutBox.width + 1, 'the overlay rail remains fully visible beside a zoomed PDF in a narrow window');
  assert.ok(narrowLayoutGeometry.scrollWidth <= narrowLayoutGeometry.clientWidth + 1, 'PDF width cannot expand the narrow reader shell');
  assert.equal(narrowSidebarBackground, 'rgb(9, 9, 11)', 'the dark overlay rail is opaque over the enlarged PDF');
  await page.waitForFunction(() => {
    const highlight = CSS.highlights?.get('nodus-reader-yellow');
    return Boolean(highlight && highlight.size > 0 && Array.from(highlight).every((range) => range.startContainer.isConnected && range.endContainer.isConnected));
  });
  await page.screenshot({ path: pdfZoomNarrowScreenshotPath, fullPage: true });
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.screenshot({ path: pdfScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READEREPUB');
  const epubViewer = page.getByTestId('library-reader-epub-viewer');
  await epubViewer.waitFor({ state: 'visible' });
  assert.match(await epubViewer.innerText(), /Este texto refluye/);
  await page.keyboard.press('Control+f');
  const epubFindPanel = page.getByTestId('find-in-page');
  await epubFindPanel.waitFor({ state: 'visible' });
  await page.getByTestId('find-in-page-input').fill('segundo capítulo');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Coincidencia 1 de 1' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="library-reader-epub-viewer"] select')?.value === '1');
  await page.waitForFunction(() => CSS.highlights?.get('nodus-find-current')?.size === 1);
  const [epubFindBox, epubSurfaceBox] = await Promise.all([
    epubFindPanel.boundingBox(),
    page.getByTestId('library-reader-epub-content').boundingBox(),
  ]);
  assert.ok(epubFindBox && epubSurfaceBox);
  assert.ok(epubFindBox.x >= epubSurfaceBox.x && epubFindBox.x + epubFindBox.width <= epubSurfaceBox.x + epubSurfaceBox.width + 1, `EPUB search remains fully visible inside its reading surface (${JSON.stringify({ epubFindBox, epubSurfaceBox })})`);
  await page.screenshot({ path: epubFindScreenshotPath, fullPage: true });
  await page.keyboard.press('Escape');
  await epubFindPanel.waitFor({ state: 'detached' });
  await epubViewer.locator('select').selectOption('0');
  await assertViewerContained(epubViewer, 'EPUB');
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="library-reader-epub-content"] .library-attachment-text');
    if (!(root instanceof HTMLElement)) throw new Error('EPUB text surface missing');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node = walker.nextNode();
    while (node && !node.textContent?.includes('Este texto')) node = walker.nextNode();
    if (!node?.textContent) throw new Error('EPUB text missing'); const start = node.textContent.indexOf('Este texto');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 28); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rect = range.getBoundingClientRect();
    root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.right, clientY: rect.top + rect.height / 2 }));
  });
  await page.locator('.reader-selection-actions').waitFor({ state: 'visible' });
  await page.locator('.reader-selection-actions .reader-selection-color').nth(2).click();
  await waitForSavedAnnotations((items) => items.some((item) => item.scope.startsWith('attachment:local:READEREPUB:chapter:')), 'EPUB highlight');
  await page.screenshot({ path: epubScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READERIMAGE');
  const imageViewer = page.getByTestId('library-reader-image-viewer');
  await imageViewer.waitFor({ state: 'visible' });
  await assertViewerContained(imageViewer, 'image');
  const image = imageViewer.locator('img'); await image.waitFor(); await image.evaluate((element) => element.complete || new Promise((resolve) => element.addEventListener('load', resolve, { once: true })));
  await imageViewer.getByRole('button', { name: 'Marcar región' }).click();
  const imageBox = await image.boundingBox(); assert.ok(imageBox);
  await page.mouse.move(imageBox.x + imageBox.width * .18, imageBox.y + imageBox.height * .2);
  await page.mouse.down(); await page.mouse.move(imageBox.x + imageBox.width * .68, imageBox.y + imageBox.height * .7, { steps: 8 }); await page.mouse.up();
  await waitForSavedAnnotations((items) => items.some((item) => item.target?.type === 'region' && item.target.attachmentId === 'local:READERIMAGE'), 'image region');
  await page.screenshot({ path: imageScreenshotPath, fullPage: true });
  await page.keyboard.press('Control+f');
  const imageFindPanel = page.getByTestId('find-in-page');
  await imageFindPanel.waitFor({ state: 'visible' });
  assert.equal(await imageFindPanel.locator('input[type="checkbox"]:disabled').count(), 3, 'text-only options are disabled for image files');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Las imágenes no contienen una capa textual' }).waitFor();
  await page.screenshot({ path: imageFindScreenshotPath, fullPage: true });
  await page.keyboard.press('Escape');
  await imageFindPanel.waitFor({ state: 'detached' });

  await sourceChooser.selectOption('local:READERDOCX');
  const textViewer = page.getByTestId('library-reader-text-viewer');
  await textViewer.waitFor({ state: 'visible' });
  assert.match(await textViewer.innerText(), /Documento Word abierto dentro de Nodus/);
  await page.keyboard.press('Control+f');
  await page.getByTestId('find-in-page-input').fill('seleccionar');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Coincidencia 1 de 1' }).waitFor();
  await page.waitForFunction(() => CSS.highlights?.get('nodus-find-current')?.size === 1);
  await page.keyboard.press('Escape');
  await assertViewerContained(textViewer, 'office document');
  await page.screenshot({ path: docxScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READERXLSX');
  await textViewer.waitFor({ state: 'visible' });
  assert.match(await textViewer.innerText(), /Claridad[\s\S]*95/);
  await page.keyboard.press('Control+f');
  await page.getByTestId('find-in-page-input').fill('Fidelidad');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Coincidencia 1 de 1' }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: spreadsheetScreenshotPath, fullPage: true });

  await page.getByTestId(`library-workspace-close-${globalItemId}`).click();
  await globalRow.waitFor({ state: 'visible' });
  await globalRow.getByRole('button').click();
  const detail = page.getByTestId('global-library-detail'); await detail.waitFor({ state: 'visible' });
  await detail.getByTestId('library-detail-actions-toggle').click();
  await detail.getByTestId('cite-library-item').click();
  const citationDialog = page.getByTestId('library-citation-export-dialog'); await citationDialog.waitFor({ state: 'visible' });
  await citationDialog.getByRole('button', { name: 'Gestionar estilos' }).click();
  await citationDialog.getByTestId('import-zotero-csl').click();
  await citationDialog.locator('b').filter({ hasText: 'Casa de Velázquez — E2E' }).waitFor();
  await citationDialog.getByTestId('library-citation-style-trigger').click();
  await citationDialog.getByTestId('library-citation-style-search').fill('casa velazquez');
  await citationDialog.getByTestId('library-citation-style').getByRole('option', { name: /Casa de Velázquez — E2E/ }).click();
  await citationDialog.getByTestId('copy-library-citation').click();
  await citationDialog.locator('pre').filter({ hasText: work.title }).waitFor();
  await page.screenshot({ path: citationScreenshotPath, fullPage: true });
  await citationDialog.locator('header button').click();

  await detail.getByRole('button', { name: 'Leer', exact: true }).click();
  const reopenedFormatDialog = page.getByTestId('library-reader-format-dialog');
  await reopenedFormatDialog.waitFor({ state: 'visible' });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 1500, height: 820 });
  await page.screenshot({ path: formatDialogLightScreenshotPath, fullPage: true });
  await reopenedFormatDialog.getByTestId('library-reader-format-clean').click();
  await reopenedFormatDialog.waitFor({ state: 'detached' });
  const lightSourcePicker = page.getByTestId('library-reader-source-picker');
  const lightSourceSelect = lightSourcePicker.locator('select');
  await lightSourceSelect.selectOption('clean');
  await page.getByTestId('library-reader-sidebar').getByRole('tab', { name: 'Notas' }).click();
  const lightOutlineRow = page.locator('.library-reader-outline-section:not(.is-active)').first();
  await lightOutlineRow.hover();
  const lightOutlineHoverColors = await lightOutlineRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(lightOutlineHoverColors, { background: 'rgb(244, 244, 245)', color: 'rgb(39, 39, 42)' }, 'hovered outline rows stay legible in light mode');
  const lightOutlinePage = lightOutlineRow.locator('.library-reader-outline-page');
  if (await lightOutlinePage.count()) assert.equal(await lightOutlinePage.evaluate((element) => getComputedStyle(element).opacity), '1', 'hover reveals the original-page shortcut without dimming its label');
  await page.screenshot({ path: lightOutlineScreenshotPath, fullPage: true });
  const sourcePickerGeometry = await lightSourcePicker.evaluate((picker) => {
    const select = picker.querySelector('select');
    const icon = picker.querySelector('svg');
    if (!(select instanceof HTMLSelectElement) || !(icon instanceof SVGElement)) throw new Error('source picker controls missing');
    const selectRect = select.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      iconRight: iconRect.right,
      textStart: selectRect.left + Number.parseFloat(getComputedStyle(select).paddingLeft),
      paddingLeft: Number.parseFloat(getComputedStyle(select).paddingLeft),
    };
  });
  assert.ok(sourcePickerGeometry.paddingLeft >= 32, 'the source picker reserves a leading-icon gutter');
  assert.ok(sourcePickerGeometry.iconRight + 4 <= sourcePickerGeometry.textStart, 'the source icon never overlaps the selected filename');

  await lightSourceSelect.selectOption('zotero:READERPDF');
  await page.getByTestId('library-reader-pdf-viewer').waitFor({ state: 'visible' });
  const lightSourceBadge = page.getByTestId('library-reader-freshness');
  assert.equal(await lightSourceBadge.getAttribute('data-source-kind'), 'original');
  const originalBadgeColors = await lightSourceBadge.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(originalBadgeColors, { background: 'rgb(255, 255, 255)', color: 'rgb(82, 82, 91)' }, 'the original-file badge uses the light semantic palette');

  const lightFilesToggle = page.getByTestId('library-reader-files-toggle');
  if (await lightFilesToggle.getAttribute('aria-expanded') !== 'true') await lightFilesToggle.click();
  const activeOriginal = page.getByTestId('library-reader-file-zotero:READERPDF');
  const activeFileColors = await activeOriginal.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(activeFileColors, { background: 'rgb(238, 242, 255)', color: 'rgb(67, 56, 202)' }, 'the selected file remains light and legible');

  const highlighter = page.getByTestId('deep-research-fixed-highlighter');
  await highlighter.click();
  const cursorMode = page.locator('.reader-highlighter-palette .reader-highlighter-off');
  await cursorMode.hover();
  const cursorColors = await cursorMode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(cursorColors, { background: 'rgb(238, 242, 255)', color: 'rgb(67, 56, 202)' }, 'the light highlighter menu keeps the cursor arrow visible');
  await page.screenshot({ path: lightControlsScreenshotPath, fullPage: true });
  await highlighter.click();

  await lightSourceSelect.selectOption('clean');
  await page.setViewportSize({ width: 860, height: 820 });
  assert.equal(await page.getByTestId('library-reader-sidebar').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)', 'the light overlay rail is also opaque');
  await page.screenshot({ path: lightScreenshotPath, fullPage: true });
  await page.getByTestId('library-reader-sidebar-toggle').click();
  await page.keyboard.press('Control+f');
  const lightFindPanel = page.getByTestId('find-in-page');
  await page.getByTestId('find-in-page-input').fill('Texto introductorio');
  await page.getByTestId('find-in-page-status').filter({ hasText: 'Coincidencia 1 de 1' }).waitFor();
  const lightFindGeometry = await lightFindPanel.boundingBox();
  const lightFindColors = await lightFindPanel.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  assert.ok(lightFindGeometry && lightFindGeometry.x >= 0 && lightFindGeometry.x + lightFindGeometry.width <= 861, 'the search panel stays inside a narrow reader');
  assert.match(lightFindColors.background, /rgba?\(255, 255, 255/);
  assert.equal(lightFindColors.color, 'rgb(23, 23, 23)', 'the light search panel uses readable foreground text');
  await page.screenshot({ path: lightFindScreenshotPath, fullPage: true });
  await page.keyboard.press('Escape');
  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  console.log(`library reader UI test passed; file menu ${filesInteraction.elapsed.toFixed(1)}ms; optimistic highlight ${highlightPaintLatency}ms; screenshots: ${screenshotDirectory}`);
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}
