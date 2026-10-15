import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--scheme-declutter')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scheme-choices-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const database = load('electron/db/database.ts');
const registry = load('electron/vaults/vaultRegistry.ts');
const choices = load('electron/extraction/schemeDeclutter.ts');
const settings = load('electron/db/settingsRepo.ts');
const pdfLoader = load('electron/extraction/pdfjsLoader.ts');
const extractor = load('electron/extraction/textExtractor.ts');
const zotero = load('electron/zotero/zoteroClient.ts');
const owned = (vault, fn) => registry.withOwningVault(vault.id, () => database.withVaultDatabase(vault.id, fn));
const opts = { unpaywallEmail: '', preferZoteroFulltext: false, allowExternalRetrieval: false,
  ocr: { enabled: false, languages: 'eng', maxPages: 300 } };
const sourceRef = 'zotero:user:0:ATTACH01';
let filePath = path.join(root, 'shared.pdf');
fs.writeFileSync(filePath, 'Controlled PDF text layer');
const item = (str, x, y, size, width = 340) => ({ str, transform: [size, 0, 0, size, x, y], height: size, width, hasEOL: true });
const items = [
  item('Ordinary scientific prose describes an experiment and the conclusions supported by its results.', 111, 700, 10),
  item('The next sentence explains the reaction conditions with enough detail for meaningful retrieval.', 111, 688, 10),
  item('The final paragraph preserves the evidence and explains the implications for future research.', 111, 676, 10),
  item('OH O N O', 150, 620, 8, 100), item('OH O N O', 150, 600, 8, 100),
];
pdfLoader.openPdf = async () => ({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items }), cleanup() {} }), destroy() {} });
load('electron/extraction/pdfAnalyzer.ts').analyzePdf = async () => ({ strategy: 'digital', pageCount: 1 });
zotero.itemChildren = async () => [{ key: 'ATTACH01', itemKey: 'ATTACH01', title: 'Shared source', filename: 'shared.pdf',
  contentType: 'application/pdf', linkMode: 'imported_file', library: { type: 'user', id: '0' } }];
zotero.attachmentFilePath = async () => filePath;
const resolve = key => extractor.resolveWorkText('0', key, root, null, null, opts, 'book');
try {
  const oldVault = registry.getActiveVault();
  const newVault = registry.createVault('New academic work', 'academic');
  await owned(oldVault, () => {
    database.getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,resolved_text_hash,deep_hash) VALUES('same-work-id','SHARED01','Existing work','[]','book','existing-text','existing-analysis')").run();
    settings.updateSettings({ declutterNewDocuments: true });
  });
  await owned(newVault, () => {
    database.getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type) VALUES('same-work-id','SHARED01','New work','[]','book')").run();
    settings.updateSettings({ declutterNewDocuments: true });
  });
  // The obsolete global path list cannot change a used work in either vault.
  fs.writeFileSync(path.join(root, 'scheme-declutter.json'), JSON.stringify({ files: [filePath] }));
  const oldText = await owned(oldVault, () => resolve('SHARED01'));
  assert.ok(oldText.text.includes('OH O N O'));
  const newText = await owned(newVault, () => resolve('SHARED01'));
  assert.ok(newText.text.includes('[scheme]'));
  assert.ok(!newText.text.includes('OH O N O'));
  assert.equal((await owned(oldVault, () => resolve('SHARED01'))).text, oldText.text, 'another vault cannot change the existing work');
  await owned(newVault, () => {
    database.getDb().prepare("UPDATE works SET resolved_text_hash='used-after-first-extraction' WHERE nodus_id='same-work-id'").run();
    settings.updateSettings({ declutterNewDocuments: false });
  });
  assert.equal((await owned(newVault, () => resolve('SHARED01'))).text, newText.text, 'a stored declutter choice survives use and disabling the setting');
  assert.ok((await owned(newVault, () => extractor.extractFromPath(filePath, { ocr: opts.ocr }))).text.includes('OH O N O'), 'direct file extraction stays plain');

  await owned(newVault, () => {
    database.getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type) VALUES('other-work','OTHER01','Other work sharing this PDF','[]','book')").run();
  });
  const otherText = await owned(newVault, () => resolve('OTHER01'));
  assert.equal(otherText.text, oldText.text, 'a second work has an independent choice for the same attachment');
  await owned(newVault, () => settings.updateSettings({ declutterNewDocuments: true }));
  assert.equal((await owned(newVault, () => resolve('OTHER01'))).text, otherText.text, 'the plain choice is sticky even before a caller stores resolved-text state');
  const unknown = await owned(newVault, () => resolve('UNKNOWN01'));
  assert.equal(unknown.text, oldText.text, 'unknown works fail conservatively to plain text');
  await owned(newVault, () => {
    assert.equal(choices.declutterForWorkSource('SHARED01', sourceRef, false), true);
    assert.equal(choices.declutterForWorkSource('SHARED01', 'zotero:user:0:NEWATTACH', true), false, 'a newly encountered attachment of a used work is protected');
  });

  filePath = path.join(root, 'moved.pdf');
  fs.writeFileSync(filePath, 'Same controlled PDF moved to a different path');
  database.closeDb();
  assert.equal((await owned(newVault, () => resolve('SHARED01'))).text, newText.text, 'the attachment choice survives a moved path and a database reopen');
  assert.equal((await owned(newVault, () => resolve('OTHER01'))).text, otherText.text);
  assert.equal((await owned(oldVault, () => resolve('SHARED01'))).text, oldText.text);

  // A choice can bind the classifier its text came from, so a later classifier leaves it alone.
  const { createHash } = await import('node:crypto');
  const choiceKey = (nodusId, ref) => `pdf_declutter:${createHash('sha256').update(JSON.stringify([nodusId, ref])).digest('hex')}`;
  await owned(newVault, () => {
    const db = database.getDb();
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,resolved_text_hash) VALUES('bound-work','BOUND01','Bound work','[]','book','in-use')").run();
    db.prepare("INSERT INTO settings(key,value) VALUES(?, 'declutter:layout-2')").run(choiceKey('bound-work', sourceRef));
    assert.equal(choices.schemeClassifierForWorkSource('BOUND01', sourceRef, false), 'layout-2', 'a bound classifier is kept');
    assert.equal(choices.schemeClassifierForWorkSource('SHARED01', sourceRef, false), 'layout-4', "a plain 'declutter' choice means the current classifier");
    assert.equal(choices.schemeClassifierForWorkSource('OTHER01', sourceRef, true), null, 'a plain choice stays plain');
    db.prepare("UPDATE settings SET value='declutter:layout-99' WHERE key=?").run(choiceKey('bound-work', sourceRef));
    assert.equal(choices.schemeClassifierForWorkSource('BOUND01', sourceRef, false), 'layout-4', 'an unknown classifier still declutters, with the current one');
  });
  assert.equal(choices.declutterCacheKey('/a.pdf', 'layout-2'), '/a.pdf#declutter-layout-2');
  assert.equal(choices.declutterCacheKey('/a.pdf'), '/a.pdf#declutter-layout-4');
  const classifiers = load('electron/extraction/schemeClassifiers.ts');
  const layoutItems = items.map((entry) => ({ ...entry }));
  assert.deepEqual(classifiers.schemeClassifier('layout-2').pageSchemeLayout(layoutItems, 10), load('electron/extraction/schemeLayout2.ts').pageSchemeLayout(layoutItems, 10));
  assert.deepEqual(classifiers.schemeClassifier().pageSchemeLayout(layoutItems, 10), load('electron/extraction/schemeLayout.ts').pageSchemeLayout(layoutItems, 10));

  const controller = new AbortController();
  let sampled = 0;
  await assert.rejects(() => choices.pdfBodySize({ numPages: 40, getPage: async () => {
    sampled++;
    controller.abort();
    return { getTextContent: async () => ({ items }), cleanup() {} };
  } }, controller.signal), { name: 'AbortError' });
  assert.equal(sampled, 1, 'cancellation stops body-size sampling');
  let destroyed = 0;
  pdfLoader.openPdf = async () => ({ numPages: 1,
    getPage: async () => { throw new Error('sample page unavailable'); }, destroy() { destroyed++; } });
  await assert.rejects(() => extractor.extractPdfStreaming(filePath, { declutter: true, ocr: opts.ocr,
    analysis: { strategy: 'digital', pageCount: 1 } }), /sample page unavailable/);
  assert.equal(destroyed, 1, 'a body-size sampling failure releases the PDF');
  console.log('Scoped PDF choices, used works, shared attachments, setting changes, cache isolation, file moves, restart and cancellation passed.');
} finally {
  database.closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
