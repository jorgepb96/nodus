import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { buildTextPdf } from './toolkit-fixtures.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-global-library-reader-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-reader-'));
const userData = path.join(scratch, 'profile');
const backupRoot = path.join(scratch, 'backups');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

function writeZip(file, entries) {
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value));
  zip.writeZip(file);
}

try {
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const readerStore = require(path.join(repoRoot, 'electron/libraryReader/libraryReaderStore.ts'));
  const readerChat = require(path.join(repoRoot, 'electron/ai/libraryReaderChat.ts'));
  const cslStyles = require(path.join(repoRoot, 'electron/library/libraryCslStyles.ts'));
  writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const store = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'reader-device-0001');
  store.initialize();
  const folder = store.itemFolder('E7FGXJFE');
  const markdown = '# Mujeres solas en la posguerra\n\n## Introducción\n\nTexto limpio y anotable.\n\n## Conclusiones\n\nResultado final.\n';
  const introduction = markdown.indexOf('## Introducción');
  const conclusions = markdown.indexOf('## Conclusiones');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'reader.md'), markdown);
  await buildTextPdf(folder, 'original.pdf');
  await writeFile(path.join(folder, 'figure.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(path.join(folder, 'notes.txt'), 'Texto adjunto seleccionable.\n');
  writeZip(path.join(folder, 'sample.epub'), {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><manifest><item id="chapter-one" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-one"/></spine></package>',
    'OEBPS/chapter.xhtml': '<html><head><title>Primer capítulo</title></head><body><h1>Entrada EPUB</h1><p>Texto seleccionable del libro electrónico.</p></body></html>',
  });
  writeZip(path.join(folder, 'sample.docx'), {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento Word seleccionable.</w:t></w:r></w:p></w:body></w:document>',
  });
  writeZip(path.join(folder, 'sample.xlsx'), {
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Autor</t></si><si><t>Obra</t></si><si><t>María Aliaga</t></si><si><t>Mujeres solas</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>',
  });
  await writeFile(path.join(folder, 'annotations.json'), '[]\n');
  await writeFile(path.join(folder, 'source-map.json'), `${JSON.stringify({
    version: 1,
    pages: [{ page: 1, width: 612, height: 792 }, { page: 2, width: 612, height: 792 }, { page: 3, width: 612, height: 792 }],
    blocks: [
      { kind: 'heading', markdown: { start: introduction, end: introduction + 16 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: conclusions, end: conclusions + 16 }, anchors: [{ page: 2 }] },
    ],
  })}\n`);
  store.upsertItem({
    id: 'zotero:E7FGXJFE', storageId: 'E7FGXJFE', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'E7FGXJFE',
    citationKey: 'aliamirandaMujeresSolasPosguerra2017',
    metadata: {
      title: 'Mujeres solas en la posguerra', itemType: 'article-journal', year: 2017,
      creators: [{ creatorType: 'author', firstName: 'María', lastName: 'Aliaga' }], isbn: [], issn: [], tags: [],
    },
    collectionIds: [], attachments: [{
      id: 'zotero:PDF1', title: 'PDF', fileName: 'original.pdf', relativePath: 'original.pdf',
      mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), role: 'original', position: 0,
    }, {
      id: 'local:IMAGE1', title: 'Figura', fileName: 'figure.png', relativePath: 'figure.png',
      mimeType: 'image/png', byteSize: 8, sha256: 'b'.repeat(64), role: 'image', position: 1,
    }, {
      id: 'local:TEXT1', title: 'Notas', fileName: 'notes.txt', relativePath: 'notes.txt',
      mimeType: 'text/plain', byteSize: 29, sha256: 'c'.repeat(64), role: 'supplement', position: 2,
    }, {
      id: 'local:EPUB1', title: 'EPUB', fileName: 'sample.epub', relativePath: 'sample.epub',
      mimeType: 'application/epub+zip', byteSize: 1, sha256: 'd'.repeat(64), role: 'original', position: 3,
    }, {
      id: 'local:DOCX1', title: 'Word', fileName: 'sample.docx', relativePath: 'sample.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 1, sha256: 'e'.repeat(64), role: 'supplement', position: 4,
    }, {
      id: 'local:XLSX1', title: 'Hoja de cálculo', fileName: 'sample.xlsx', relativePath: 'sample.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteSize: 1, sha256: 'f'.repeat(64), role: 'supplement', position: 5,
    }],
    files: { reader: 'reader.md', original: 'original.pdf', sourceMap: 'source-map.json', annotations: 'annotations.json', chat: 'chat.json' },
    extraction: { status: 'ready' },
  });

  const encodedFolder = store.itemFolder('ENCODEDPDF');
  const encodedRelativePath = 'attachments/d3844809-Ana%CC%81lisis_cuantitativo_diarios_pioneros%2Epdf';
  const readableFileName = 'd3844809-Análisis_cuantitativo_diarios_pioneros.pdf';
  const encodedPdf = Buffer.from('%PDF-1.4 one physical PDF with an encoded storage path\n');
  await mkdir(path.dirname(path.join(encodedFolder, encodedRelativePath)), { recursive: true });
  await writeFile(path.join(encodedFolder, 'reader.md'), '# Análisis cuantitativo\n');
  await writeFile(path.join(encodedFolder, encodedRelativePath), encodedPdf);
  store.upsertItem({
    id: 'nodus:encoded-pdf', storageId: 'ENCODEDPDF', source: 'nodus', sourceLibraryId: null, sourceKey: null,
    metadata: { title: 'Análisis cuantitativo', itemType: 'article-journal', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [{
      id: 'local:ENCODEDPDF', title: 'Análisis cuantitativo', fileName: readableFileName, relativePath: encodedRelativePath,
      mimeType: 'application/pdf', byteSize: encodedPdf.byteLength,
      sha256: createHash('sha256').update(encodedPdf).digest('hex'), role: 'original', position: 0,
    }],
    files: { reader: 'reader.md', original: encodedRelativePath }, extraction: { status: 'ready' },
  });

  const encodedDocument = readerStore.getLibraryReaderDocument('nodus:encoded-pdf');
  assert.ok(encodedDocument);
  assert.deepEqual(encodedDocument.attachments.map((entry) => entry.id), ['local:ENCODEDPDF'], 'an encoded legacy original and its declared attachment resolve to one physical file');
  assert.equal(encodedDocument.attachments[0].fileName, readableFileName, 'the declared human-readable filename wins over the encoded storage path');
  assert.equal(encodedDocument.attachments[0].viewer, 'pdf', 'an encoded PDF extension keeps the native PDF viewer');
  assert.equal(encodedDocument.originalMimeType, 'application/pdf', 'legacy original metadata decodes the extension for MIME detection');

  const cloudFolder = store.itemFolder('CLOUDPDF');
  const cloudRelativePath = 'attachments/43591cd5-N%C3%BA%C3%B1ez_Florencio%2Epdf';
  const cloudPdf = Buffer.from('%PDF-1.4 Google Drive appended a literal extension\n');
  await mkdir(path.dirname(path.join(cloudFolder, cloudRelativePath)), { recursive: true });
  await writeFile(path.join(cloudFolder, 'reader.md'), '# Cloud PDF\n');
  await writeFile(`${path.join(cloudFolder, cloudRelativePath)}.pdf`, cloudPdf);
  store.upsertItem({
    id: 'nodus:cloud-pdf', storageId: 'CLOUDPDF', source: 'nodus', sourceLibraryId: null, sourceKey: null,
    metadata: { title: 'Cloud PDF', itemType: 'article-journal', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [{
      id: 'local:CLOUDPDF', title: 'Cloud PDF', fileName: 'Núñez Florencio.pdf', relativePath: cloudRelativePath,
      mimeType: 'application/pdf', byteSize: cloudPdf.byteLength,
      sha256: createHash('sha256').update(cloudPdf).digest('hex'), role: 'original', position: 0,
    }],
    files: { reader: 'reader.md', original: cloudRelativePath }, extraction: { status: 'ready' },
  });
  const cloudDocument = readerStore.getLibraryReaderDocument('nodus:cloud-pdf');
  assert.ok(cloudDocument?.originalAvailable, 'a cloud-appended extension remains available as the original');
  assert.equal(cloudDocument.attachments[0].available, true);
  assert.equal(readerStore.libraryReaderAttachmentPath('nodus:cloud-pdf', 'local:CLOUDPDF'), `${path.join(cloudFolder, cloudRelativePath)}.pdf`);

  const hashFolder = store.itemFolder('HASHPDF');
  const duplicatePdf = Buffer.from('%PDF-1.4 two paths preserving the same immutable bytes\n');
  const duplicateSha = createHash('sha256').update(duplicatePdf).digest('hex');
  await mkdir(path.join(hashFolder, 'attachments'), { recursive: true });
  await writeFile(path.join(hashFolder, 'reader.md'), '# Hash duplicate\n');
  await writeFile(path.join(hashFolder, 'attachments', 'first.pdf'), duplicatePdf);
  await writeFile(path.join(hashFolder, 'attachments', 'second.pdf'), duplicatePdf);
  store.upsertItem({
    id: 'nodus:hash-pdf', storageId: 'HASHPDF', source: 'nodus', sourceLibraryId: null, sourceKey: null,
    metadata: { title: 'Hash duplicate', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [{
      id: 'local:FIRST', title: 'Original PDF', fileName: 'first.pdf', relativePath: 'attachments/first.pdf',
      mimeType: 'application/pdf', byteSize: duplicatePdf.byteLength, sha256: duplicateSha, role: 'original', position: 0,
    }, {
      id: 'legacy:SECOND', title: 'Legacy copy', fileName: 'second.pdf', relativePath: 'attachments/second.pdf',
      mimeType: 'application/pdf', byteSize: duplicatePdf.byteLength, sha256: duplicateSha, role: 'supplement', position: 1,
    }],
    files: { reader: 'reader.md', original: 'attachments/first.pdf' }, extraction: { status: 'ready' },
  });
  assert.deepEqual(readerStore.getLibraryReaderDocument('nodus:hash-pdf').attachments.map((entry) => entry.id), ['local:FIRST'], 'attachment SHA-256 removes duplicate metadata records that point at equivalent copies');

  const document = readerStore.getLibraryReaderDocument('zotero:E7FGXJFE');
  assert.ok(document);
  assert.equal(document.workId, 'zotero:E7FGXJFE');
  assert.equal(document.storageId, 'E7FGXJFE');
  assert.equal(document.zoteroKey, 'E7FGXJFE');
  assert.deepEqual(document.authors, ['María Aliaga']);
  assert.equal(document.pageCount, 3);
  assert.deepEqual(document.sections.map((section) => section.page), [1, 1, 2]);
  assert.equal(document.originalMimeType, 'application/pdf');
  assert.match(document.originalUrl, /^nodus-library:\/\/original\/zotero%3AE7FGXJFE\?v=/);
  assert.deepEqual(document.attachments.map((entry) => entry.viewer), ['pdf', 'image', 'text', 'epub', 'html', 'text']);
  assert.ok(document.attachments.every((entry) => entry.annotationsSupported));
  assert.match(document.attachments[1].url, /^nodus-library:\/\/attachment\/zotero%3AE7FGXJFE\/local%3AIMAGE1/);
  assert.equal(readerStore.libraryReaderAttachmentPath('E7FGXJFE', 'local:TEXT1'), path.join(folder, 'notes.txt'));
  assert.equal((await readerStore.getLibraryReaderAttachmentContent('E7FGXJFE', 'local:TEXT1')).text, 'Texto adjunto seleccionable.\n');
  assert.match((await readerStore.getLibraryReaderAttachmentContent('E7FGXJFE', 'local:EPUB1')).chapters[0].text, /Texto seleccionable del libro electrónico/);
  assert.match((await readerStore.getLibraryReaderAttachmentContent('E7FGXJFE', 'local:DOCX1')).text, /Documento Word seleccionable/);
  assert.match((await readerStore.getLibraryReaderAttachmentContent('E7FGXJFE', 'local:XLSX1')).text, /Autor: María Aliaga/);
  assert.equal(readerStore.libraryReaderOriginalPath('E7FGXJFE'), path.join(folder, 'original.pdf'), 'storage id resolves to the same global document');

  const groundedChat = readerChat.buildLibraryReaderNodiContext({
    documentId: document.workId,
    title: document.title,
    authors: document.authors,
    year: document.year,
    markdown,
    sourceLabel: 'Markdown',
    sourceId: 'clean',
    annotations: [],
    sections: document.sections.map((section) => ({ id: section.id, title: section.title, page: section.page })),
  });
  assert.equal(groundedChat.currentView.complete, true);
  assert.match(groundedChat.currentView.text, /Mujeres solas en la posguerra/);
  assert.match(groundedChat.currentView.text, /tracedOutline/);
  assert.match(groundedChat.readerGrounding.citationUri, /^nodus:\/\/reader\/zotero%3AE7FGXJFE$/);
  assert.deepEqual(groundedChat.readerGrounding.sections.map((section) => section.page), [1, 1, 2]);

  const localizedReaderMarkers = {
    es: ['Markdown', 'contenido central omitido'],
    en: ['Markdown', 'middle content omitted'],
    fr: ['Markdown', 'contenu central omis'],
    de: ['Markdown', 'mittlerer Inhalt'],
    pt: ['Markdown', 'conteúdo central omitido'],
    'pt-BR': ['Markdown', 'conteúdo central omitido'],
    it: ['Markdown', 'contenuto centrale omesso'],
    tr: ['Markdown', 'orta bölüm atlandı'],
  };
  for (const [language, [sourceMarker, truncationMarker]] of Object.entries(localizedReaderMarkers)) {
    const localized = readerChat.buildLibraryReaderNodiContext({
      documentId: document.workId,
      title: document.title,
      authors: document.authors,
      year: document.year,
      markdown: `# Title\n\n${'x'.repeat(2_500)}`,
      sourceId: 'clean',
      annotations: [],
      sections: [],
      documentCharLimit: 2_000,
      language,
    });
    assert.match(localized.currentView.text, new RegExp(sourceMarker), `${language} localizes the clean-source label`);
    assert.match(localized.currentView.text, new RegExp(truncationMarker), `${language} localizes the truncation marker`);
    assert.match(localized.currentView.text, /<open_document>[\s\S]*<document_content>/, `${language} uses neutral structural tags`);
    if (language !== 'es') assert.doesNotMatch(localized.currentView.text, /contenido central omitido|Markdown limpio/, `${language} does not leak Spanish reader scaffolding`);
  }

  const selectedText = 'Texto limpio';
  const startOffset = markdown.indexOf(selectedText);
  const created = readerStore.createLibraryReaderAnnotation('zotero:E7FGXJFE', {
    draftId: 'zotero:E7FGXJFE', scope: 'source', kind: 'highlight', color: 'yellow',
    startOffset, endOffset: startOffset + selectedText.length, selectedText, prefix: '', suffix: '', comment: null,
  });
  assert.equal(created.draftId, 'zotero:E7FGXJFE');
  assert.equal(readerStore.listLibraryReaderAnnotations('zotero:E7FGXJFE').length, 1);
  const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(folder, 'annotations.json'), 'utf8'));
  assert.equal(persisted[0].documentId, 'E7FGXJFE', 'annotation identity remains the stable Zotero storage key');
  assert.equal(readerStore.deleteLibraryReaderAnnotation('zotero:E7FGXJFE', created.id), true);
  assert.equal(readerStore.listLibraryReaderAnnotations('zotero:E7FGXJFE').length, 0);
  const region = readerStore.createLibraryReaderAnnotation('zotero:E7FGXJFE', {
    draftId: 'zotero:E7FGXJFE', scope: 'attachment:local:IMAGE1', kind: 'highlight', color: 'rose',
    startOffset: 0, endOffset: 1, selectedText: '◼', prefix: '', suffix: '', comment: null,
    target: { type: 'region', attachmentId: 'local:IMAGE1', x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
  });
  assert.equal(region.target?.type, 'region');
  assert.equal(readerStore.listLibraryReaderAnnotations('zotero:E7FGXJFE')[0].target?.attachmentId, 'local:IMAGE1');
  assert.equal(readerStore.deleteLibraryReaderAnnotation('zotero:E7FGXJFE', region.id), true);
  const chat = [
    { id: 'u1', role: 'user', content: '¿Cuál es la conclusión?', createdAt: new Date().toISOString() },
    { id: 'a1', role: 'assistant', content: 'El documento presenta un resultado final.', createdAt: new Date().toISOString() },
  ];
  readerStore.saveLibraryReaderChatMessages('zotero:E7FGXJFE', chat);
  assert.deepEqual(readerStore.listLibraryReaderChatMessages('E7FGXJFE'), chat, 'chat follows the stable document identity');
  assert.equal((readerStore.getLibraryReaderRawContent('zotero:E7FGXJFE')).markdown, markdown);
  readerStore.clearLibraryReaderChat('zotero:E7FGXJFE');
  assert.deepEqual(readerStore.listLibraryReaderChatMessages('zotero:E7FGXJFE'), []);
  const customStyle = path.join(scratch, 'centro-estudios-clm.csl');
  await writeFile(customStyle, `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info><title>Centro de Estudios de Castilla-La Mancha</title><id>http://www.zotero.org/styles/centro-estudios-clm</id><rights license="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</rights><updated>2026-08-11T00:00:00+00:00</updated></info>
  <citation><layout prefix="[" suffix="]"><text variable="title"/></layout></citation>
  <bibliography><layout suffix="."><text variable="title" text-case="uppercase"/></layout></bibliography>
</style>`);
  const importedStyles = cslStyles.importLibraryCitationStyleFiles([customStyle], 'file');
  assert.equal(importedStyles.imported, 1);
  assert.equal(importedStyles.styles.find((entry) => entry.id === 'centro-estudios-clm').license, 'https://creativecommons.org/licenses/by-sa/3.0/');
  const citationRecord = store.readMaterializedItem('E7FGXJFE');
  assert.ok(citationRecord);
  for (const id of ['apa-7', 'chicago-author-date', 'mla-9', 'ieee', 'vancouver']) {
    assert.equal(cslStyles.listLibraryCitationStyles().find((entry) => entry.id === id)?.availableOffline, true, `${id} must ship offline`);
  }
  const chicagoBibliography = await cslStyles.formatLibraryCitationCsl([citationRecord], 'chicago-author-date', 'bibliography', 'es-ES');
  assert.match(chicagoBibliography.text, /Mujeres solas en la posguerra/);
  const cslCitation = await cslStyles.formatLibraryCitationCsl([citationRecord], 'centro-estudios-clm', 'citation', 'es-ES');
  assert.equal(cslCitation.text, '[Mujeres solas en la posguerra]');
  const cslBibliography = await cslStyles.formatLibraryCitationCsl([citationRecord], 'centro-estudios-clm', 'bibliography', 'es-ES');
  assert.match(cslBibliography.text, /MUJERES SOLAS EN LA POSGUERRA\./);
  const dependentStyle = path.join(scratch, 'casa-velazquez-fixture.csl');
  await writeFile(dependentStyle, `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info><title>Casa de Velázquez fixture</title><id>http://www.zotero.org/styles/casa-velazquez-fixture</id><link href="http://www.zotero.org/styles/centro-estudios-clm" rel="independent-parent"/><updated>2026-08-11T00:00:00+00:00</updated></info>
</style>`);
  const dependentImport = cslStyles.importLibraryCitationStyleFiles([dependentStyle], 'zotero');
  assert.equal(dependentImport.styles.find((entry) => entry.id === 'casa-velazquez-fixture').availableOffline, true, 'an installed independent parent keeps the Zotero dependent style offline');
  const dependentCitation = await cslStyles.formatLibraryCitationCsl([citationRecord], 'casa-velazquez-fixture', 'citation', 'es-ES');
  assert.equal(dependentCitation.text, '[Mujeres solas en la posguerra]');
  assert.equal(dependentCitation.styleTitle, 'Casa de Velázquez fixture');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ truncated: false, tree: [
    { path: 'estilo-casa-compra.csl', type: 'blob' },
    { path: 'apa.csl', type: 'blob' },
    { path: 'dependent/ignore.csl', type: 'blob' },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const repositoryMatches = await cslStyles.searchRepositoryCitationStyles('estilo casa', 20);
    assert.deepEqual(repositoryMatches.map((entry) => entry.id), ['estilo-casa-compra'], 'repository search ignores separators while preserving every query token');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(cslStyles.removeLibraryCitationStyle('casa-velazquez-fixture'), true);
  assert.equal(cslStyles.removeLibraryCitationStyle('centro-estudios-clm'), true);
  console.log('Global reader attachments, annotations, chat and CSL parity tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
