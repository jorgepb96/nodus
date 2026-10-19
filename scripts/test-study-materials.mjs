// Study vault phase 5: multi-format local ingestion, hash dedupe, placements,
// annotations, note provenance, replacement/versioning and lifecycle.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-study-materials-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-materials.mjs'), '--electron-study-materials-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-materials-test-'));
installRuntimeHooks(root);

try {
  const AdmZip = require('adm-zip');
  const shared = require(path.join(repoRoot, 'shared/studyMaterials.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const annotationExport = require(path.join(repoRoot, 'electron/export/studyMaterialAnnotations.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 73);
  for (const table of ['study_materials', 'study_material_placements', 'study_material_annotations', 'study_material_fragment_links', 'study_material_versions']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }
  for (const column of ['visual_description', 'visual_analysis_status', 'embedding', 'embedding_provider', 'embedding_model', 'embedding_dim', 'embedding_text_hash', 'index_status', 'index_error', 'indexed_at']) {
    assert.ok(getDb().prepare('PRAGMA table_info(study_materials)').all().some((info) => info.name === column), `study_materials.${column} exists`);
  }
  for (const column of ['kind', 'rects_json', 'path_json', 'thickness']) {
    assert.ok(getDb().prepare('PRAGMA table_info(study_material_annotations)').all().some((info) => info.name === column), `study_material_annotations.${column} exists`);
  }
  assert.equal(shared.studyMaterialPreviewKind('pdf'), 'pdf');
  assert.equal(shared.studyMaterialPreviewKind('mp3'), 'audio');
  assert.equal(shared.studyMaterialLocationLabel({ materialId: 'm', materialTitle: 'Manual', pageNumber: 7 }), 'Manual · p. 7');
  assert.deepEqual(shared.parseStudyMaterialMarkers('[[p. 2]] A [[slide. 3]] B').map((item) => [item.kind, item.number]), [['page', 2], ['slide', 3]]);

  require(path.join(repoRoot, 'electron/db/settingsRepo.ts')).updateSettings({ embeddingProvider: 'openai', embeddingModel: 'embedding-test' });

  const course = org.createStudyCourse({ name: 'Curso materiales' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Asignatura materiales' });
  const folder = org.createStudyFolder({ courseId: course.id, subjectId: subject.id, name: 'Carpeta fuentes' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Tema fuentes' });

  const textPath = path.join(root, 'manual.txt');
  const replacementPath = path.join(root, 'manual-revisado.md');
  const htmlPath = path.join(root, 'articulo.html');
  const pptxPath = path.join(root, 'clase.pptx');
  const audioPath = path.join(root, 'clase.wav');
  fs.writeFileSync(textPath, 'Manual inicial con concepto de prueba.');
  fs.writeFileSync(replacementPath, '# Manual actualizado\n\nNueva redacción conservada.');
  fs.writeFileSync(htmlPath, '<html><body><h1>Artículo</h1><p>Texto HTML extraído.</p></body></html>');
  fs.writeFileSync(audioPath, Buffer.from('RIFFfakeWAVE'));
  const zip = new AdmZip();
  zip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld xmlns:a="a" xmlns:p="p"><a:t>Primera diapositiva</a:t><a:t>Concepto A</a:t></p:sld>'));
  zip.addFile('ppt/slides/slide2.xml', Buffer.from('<p:sld xmlns:a="a" xmlns:p="p"><a:t>Segunda diapositiva</a:t></p:sld>'));
  zip.writeZip(pptxPath);

  const first = await materials.importStudyMaterialFile(textPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id, tags: ['manual'] });
  assert.equal(first.duplicate, false);
  assert.equal(first.material.previewKind, 'document');
  assert.equal(first.material.extractionStatus, 'ready');
  assert.ok(first.material.extractedChars > 20);
  assert.equal(first.material.indexStatus, 'pending');
  materials.setStudyMaterialEmbedding(first.material.id, [0.1, 0.2, 0.3], { provider: 'openai', model: 'embedding-test', textHash: 'hash-test' });
  assert.equal(materials.getStudyMaterial(first.material.id).indexStatus, 'indexed');
  assert.equal(materials.getStudyMaterial(first.material.id).embeddingDim, 3);
  const duplicate = await materials.importStudyMaterialFile(textPath, { courseId: course.id });
  assert.equal(duplicate.duplicate, true, 'same bytes dedupe by SHA-256');
  assert.equal(materials.getStudyMaterial(first.material.id).placements.length, 2, 'duplicate import adds a missing placement without copying the blob');
  assert.deepEqual(Buffer.from(materials.getStudyMaterialContent(first.material.id).bytes), fs.readFileSync(textPath));

  const zoteroLibrary = { type: 'group', id: '42', name: 'Research team' };
  const zoteroItem = { key: 'groups:42:ITEM', itemKey: 'ITEM', library: zoteroLibrary, version: 1, title: 'Shared Zotero source', creators: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }], year: 2025, itemType: 'journalArticle', doi: null, abstract: null, tags: ['shared'], collections: ['groups:42:COLL'], publisher: null, publicationTitle: 'Journal', isbn: null, url: null };
  const zoteroAttachment = { key: 'groups:42:ATT', itemKey: 'ATT', library: zoteroLibrary, title: 'PDF', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'paper.pdf', available: true };
  const linked = materials.linkStudyMaterialFromZotero(zoteroLibrary, zoteroItem, zoteroAttachment, { courseId: course.id });
  assert.equal(linked.material.origin, 'zotero_link');
  assert.equal(linked.material.zoteroLibraryId, '42');
  assert.equal(linked.material.zoteroItemKey, 'ITEM');
  assert.equal(materials.linkStudyMaterialFromZotero(zoteroLibrary, zoteroItem, zoteroAttachment, { subjectId: subject.id }).duplicate, true, 'same Zotero target is linked once and gains another placement');
  assert.equal(materials.getStudyMaterial(linked.material.id).bibliography.zoteroKey, 'groups:42:ITEM');

  const updated = materials.updateStudyMaterial(first.material.id, {
    readState: 'reviewed', favorite: true, metadata: { tags: ['manual', 'examen'], comments: ['Útil'] },
    bibliography: { citation: 'Autora (2026). Manual.', authors: ['Autora'] },
  });
  assert.equal(updated.readState, 'reviewed');
  assert.equal(updated.favorite, true);
  assert.equal(updated.indexStatus, 'pending', 'metadata changes invalidate the material embedding');
  assert.deepEqual(updated.metadata.tags, ['manual', 'examen']);
  assert.equal(updated.bibliography.citation, 'Autora (2026). Manual.');
  assert.equal(materials.listStudyMaterials({ search: 'concepto de prueba' })[0].id, first.material.id, 'extracted text is searchable');
  assert.equal(materials.listStudyMaterials({ readState: 'reviewed', favorite: true }).length, 1);
  assert.equal(materials.listStudyMaterials()[0].placements.length, 2, 'global list exposes every placement for table columns');
  materials.setPrimaryStudyMaterialPlacement(first.material.id, { courseId: course.id, subjectId: subject.id, folderId: folder.id });
  assert.deepEqual(materials.listStudyMaterials()[0].placements.map((placement) => placement.folderId), [folder.id], 'moving replaces the prior locations');
  materials.addStudyMaterialPlacement(first.material.id, { courseId: course.id, subjectId: subject.id, topicId: topic.id });
  assert.equal(materials.listStudyMaterials()[0].placements.length, 2, 'duplicating a location keeps the same material in both destinations');
  const removablePlacement = materials.listStudyMaterials()[0].placements.find((placement) => placement.folderId === folder.id && !placement.topicId);
  assert.ok(removablePlacement, 'the folder-only placement can be selected for removal');
  materials.removeStudyMaterialPlacement(first.material.id, removablePlacement.id);
  assert.equal(materials.listStudyMaterials()[0].placements.some((placement) => placement.id === removablePlacement.id), false, 'a single material placement can be removed');
  materials.addStudyMaterialPlacement(first.material.id, { courseId: course.id, subjectId: subject.id, folderId: folder.id });
  const destinationCourse = org.createStudyCourse({ name: 'Curso de destino' });
  const destinationSubject = org.createStudySubject({ courseId: destinationCourse.id, name: 'Asignatura de destino' });
  org.moveStudyEntity('topic', topic.id, { subjectId: destinationSubject.id });
  const movedMaterialPlacement = materials.listStudyMaterials()[0].placements.find((placement) => placement.topicId === topic.id);
  assert.equal(movedMaterialPlacement.courseId, destinationCourse.id, 'moving a topic updates linked material course locations');
  assert.equal(movedMaterialPlacement.subjectId, destinationSubject.id, 'moving a topic updates linked material subject locations');

  await materials.replaceStudyMaterialFile(first.material.id, replacementPath);
  let detail = materials.getStudyMaterial(first.material.id);
  assert.match(detail.extractedText, /Manual actualizado/);
  assert.equal(detail.versions.length, 1, 'replacement snapshots the prior blob and extraction');
  assert.equal(detail.placements.length, 2, 'replacement preserves placements');
  materials.restoreStudyMaterialVersion(first.material.id, detail.versions[0].id);
  detail = materials.getStudyMaterial(first.material.id);
  assert.match(detail.extractedText, /Manual inicial/);
  assert.ok(detail.versions.length >= 2, 'restoring also preserves the replaced version');

  const annotation = materials.createStudyMaterialAnnotation(first.material.id, {
    kind: 'highlight', pageNumber: 1, rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 }, rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }], selectedText: 'concepto de prueba', note: 'Convertir en apunte', thickness: 5,
  });
  assert.equal(annotation.pageNumber, 1);
  assert.equal(annotation.kind, 'highlight');
  assert.equal(annotation.rects.length, 1);
  assert.equal(annotation.thickness, 5);
  assert.equal(materials.updateStudyMaterialAnnotation(annotation.id, { color: '#00ff00' }).color, '#00ff00');
  const brush = materials.createStudyMaterialAnnotation(first.material.id, { kind: 'brush', path: [{ x: .1, y: .1 }, { x: .2, y: .2 }], color: '#2563eb', thickness: 7 });
  assert.deepEqual(brush.path, [{ x: .1, y: .1 }, { x: .2, y: .2 }]);
  const note = materials.createStudyNoteFromMaterial(first.material.id, annotation.id, 'Nota enlazada');
  const noteDoc = org.getStudyWorkspace().documents.find((document) => document.id === note.documentId);
  assert.ok(noteDoc);
  assert.match(noteDoc.contentMarkdown, /nodus:\/\/study\/material/);
  assert.match(noteDoc.contentMarkdown, /concepto de prueba/);
  assert.equal(materials.getStudyMaterial(first.material.id).fragmentLinks[0].documentId, note.documentId, 'fragment-to-note provenance is durable');

  // #779: moving changes only one placement; all durable material data survives.
  materials.setStudyMaterialEmbedding(first.material.id, [0.1, 0.2, 0.3], { provider: 'openai', model: 'embedding-test', textHash: 'stable' });
  const beforeMove = materials.getStudyMaterial(first.material.id);
  const beforeRow = getDb().prepare('SELECT * FROM study_materials WHERE id = ?').get(first.material.id);
  const movingPlacement = beforeMove.placements.find((p) => p.folderId === folder.id);
  const untouched = beforeMove.placements.filter((p) => p.id !== movingPlacement.id);
  const targetFolder = org.createStudyFolder({ subjectId: destinationSubject.id, name: 'Destino anidado' });
  const nestedFolder = org.createStudyFolder({ parentId: targetFolder.id, name: 'Lecturas' });
  const moved = materials.moveStudyMaterialPlacement(first.material.id, movingPlacement.id, { folderId: nestedFolder.id });
  assert.equal(moved.id, movingPlacement.id, 'move preserves the placement identity');
  assert.equal(moved.courseId, destinationCourse.id, 'folder destination resolves its course');
  assert.equal(moved.subjectId, destinationSubject.id, 'folder destination resolves its subject');
  const afterMove = materials.getStudyMaterial(first.material.id);
  assert.deepEqual(afterMove.placements.filter((p) => p.id !== moved.id), untouched);
  for (const field of ['annotations', 'fragmentLinks', 'versions', 'bibliography', 'metadata', 'extractedText', 'contentHash', 'indexStatus']) assert.deepEqual(afterMove[field], beforeMove[field], field);
  assert.deepEqual(getDb().prepare('SELECT * FROM study_materials WHERE id = ?').get(first.material.id), beforeRow, 'file, embeddings and every material column are unchanged');
  assert.equal(afterMove.annotations.find((a) => a.id === annotation.id).pageNumber, 1, 'old citation/annotation still targets the same material and page');
  assert.equal(org.getStudyWorkspace().documents.find((d) => d.id === note.documentId).contentMarkdown, noteDoc.contentMarkdown, 'the linked note remains unchanged');
  for (const invalid of [{ folderId: 'missing' }, { subjectId: subject.id, folderId: nestedFolder.id }, { courseId: course.id, subjectId: destinationSubject.id }, { folderId: nestedFolder.id, topicId: topic.id }]) {
    assert.throws(() => materials.moveStudyMaterialPlacement(first.material.id, moved.id, invalid));
    assert.deepEqual(materials.getStudyMaterial(first.material.id), afterMove, 'invalid destination rolls back fully');
  }
  assert.throws(() => materials.moveStudyMaterialPlacement(first.material.id, null, {}), /origen/);
  assert.throws(() => materials.moveStudyMaterialPlacement(first.material.id, 'missing-placement', {}), /origen/);
  const existingDestination = materials.addStudyMaterialPlacement(first.material.id, { courseId: destinationCourse.id, subjectId: destinationSubject.id });
  assert.equal(materials.moveStudyMaterialPlacement(first.material.id, moved.id, { subjectId: destinationSubject.id }).id, existingDestination.id, 'an existing destination is reused');
  assert.equal(materials.getStudyMaterial(first.material.id).placements.length, 2, 'collision removes only the moved duplicate');
  const generalFolder = org.createStudyFolder({ name: 'Fuentes generales' });
  materials.moveStudyMaterialPlacement(first.material.id, existingDestination.id, { folderId: generalFolder.id });
  const general = materials.getStudyMaterial(first.material.id).placements.find((p) => p.folderId === generalFolder.id);
  assert.equal(general.subjectId, null, 'general folders are valid destinations');
  const attachment = materials.addStudyMaterialPlacement(first.material.id, { subjectId: subject.id, documentId: note.documentId });
  const attachedMove = materials.moveStudyMaterialPlacement(first.material.id, attachment.id, { subjectId: destinationSubject.id });
  assert.equal(attachedMove.documentId, note.documentId, 'document provenance survives movement');

  const { PDFDocument } = require('pdf-lib');
  const sourcePdf = await PDFDocument.create(); sourcePdf.addPage([400, 500]);
  const sourcePdfBytes = await sourcePdf.save();
  const exportedPdf = await annotationExport.annotatedPdfBytes({ bytes: sourcePdfBytes, mimeType: 'application/pdf', fileName: 'manual.pdf' }, materials.getStudyMaterial(first.material.id));
  const checkedPdf = await PDFDocument.load(exportedPdf);
  assert.ok(checkedPdf.getPageCount() >= 2, 'portable PDF export flattens marks and appends comment notes');

  const epubZip = new AdmZip();
  epubZip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'));
  epubZip.addFile('OEBPS/content.opf', Buffer.from('<?xml version="1.0"?><package><manifest></manifest><spine></spine></package>'));
  const exportedEpub = annotationExport.annotatedEpubBytes({ bytes: epubZip.toBuffer(), mimeType: 'application/epub+zip', fileName: 'manual.epub' }, materials.getStudyMaterial(first.material.id));
  const checkedEpub = new AdmZip(Buffer.from(exportedEpub));
  assert.match(checkedEpub.readAsText('OEBPS/nodus-annotations.xhtml'), /Anotaciones de Nodus/);
  assert.match(checkedEpub.readAsText('OEBPS/content.opf'), /nodus-annotations/);
  materials.deleteStudyMaterialAnnotation(annotation.id);
  materials.deleteStudyMaterialAnnotation(brush.id);
  assert.equal(materials.getStudyMaterial(first.material.id).annotations.length, 0);

  const html = await materials.importStudyMaterialFile(htmlPath);
  assert.match(materials.getStudyMaterial(html.material.id).extractedText, /Texto HTML extraído/);
  const presentation = await materials.importStudyMaterialFile(pptxPath);
  assert.equal(presentation.material.previewKind, 'presentation');
  assert.equal(presentation.material.metadata.slideCount, 2);
  assert.match(materials.getStudyMaterial(presentation.material.id).extractedText, /\[\[slide\. 2\]\]/);
  const audio = await materials.importStudyMaterialFile(audioPath);
  assert.equal(audio.material.previewKind, 'audio');
  assert.equal(audio.material.extractionStatus, 'unsupported');

  const unplacedMove = materials.moveStudyMaterialPlacement(html.material.id, null, { subjectId: subject.id });
  assert.equal(unplacedMove.subjectId, subject.id);
  materials.moveStudyMaterialPlacement(html.material.id, unplacedMove.id, {});
  assert.equal(materials.getStudyMaterial(html.material.id).placements.length, 0, 'returning to unfiled keeps the material');
  const archivedPlacement = materials.addStudyMaterialPlacement(html.material.id, { courseId: course.id, subjectId: subject.id });
  getDb().prepare('UPDATE study_material_placements SET archived_at = ? WHERE id = ?').run('2026-09-01', archivedPlacement.id);
  const fromArchived = materials.moveStudyMaterialPlacement(html.material.id, null, { subjectId: subject.id });
  assert.notEqual(fromArchived.id, archivedPlacement.id, 'moving an unfiled material creates an active link instead of reusing an archived one');
  assert.equal(fromArchived.archivedAt, null);
  assert.equal(getDb().prepare('SELECT archived_at FROM study_material_placements WHERE id = ?').get(archivedPlacement.id).archived_at, '2026-09-01');
  materials.setStudyMaterialLifecycle(html.material.id, 'archive');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === html.material.id), false);
  materials.setStudyMaterialLifecycle(html.material.id, 'restore');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === html.material.id), true);
  materials.setStudyMaterialLifecycle(audio.material.id, 'trash');
  assert.equal(materials.listStudyMaterials().some((item) => item.id === audio.material.id), false);
  materials.setStudyMaterialLifecycle(audio.material.id, 'recover');
  materials.setStudyMaterialLifecycle(audio.material.id, 'delete');
  assert.throws(() => materials.getStudyMaterial(audio.material.id), /no encontrado/);

  closeDb();
  console.log('Study materials phase 5 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
