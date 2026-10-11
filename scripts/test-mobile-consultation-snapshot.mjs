import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../shared/mobileConsultationSnapshot.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { mobileConsultationSnapshot } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const rows = Array.from({ length: 1200 }, (_, index) => ({ passage_id: `work#${index}`, text: 'Documento extenso ajeno '.repeat(100) }));
const tables = {
  dictionary_entries: [{ id: 'entry', content_markdown: '[Actual](nodus://idea/current)' }],
  dictionary_versions: [{ id: 'old', content_markdown: '[Anterior](nodus://passage/work%231199) [Hueco](nodus://gap/historical)' }],
  dictionary_evidence: [{ kind: 'passage', ref_id: 'work#0' }],
  dictionary_relations: [{ id: 'relation' }],
  passages: rows, ideas: [{ global_id: 'current' }, { global_id: 'uncited' }],
  gaps: [{ id: 'historical' }, { id: 'unrelated' }], works: [{ nodus_id: 'work' }],
  evidence: [{ global_id: 'uncited' }], work_idea_synthesis: [],
  teaching_students: [{ id: 'private' }], study_recordings: [{ id: 'private-recording' }],
};
const document = { format: 'nodus.server-snapshot', formatVersion: 2, vault: { id: 'vault', type: 'academico' },
  capabilities: { hasAssets: true, includesLibraryDocuments: true, includesPassages: true, includesUserContent: true },
  assets: [{ hash: 'private-image' }], library: { items: ['private-file'] }, tables };
const before = JSON.stringify(document);
const dictionary = mobileConsultationSnapshot(document, 'dictionary');
assert.deepEqual(dictionary.tables.passages.map(row => row.passage_id), ['work#0', 'work#1199']);
assert.deepEqual(dictionary.tables.ideas, [{ global_id: 'current' }]);
assert.deepEqual(dictionary.tables.gaps, [{ id: 'historical' }]);
assert.deepEqual(dictionary.tables.dictionary_versions, tables.dictionary_versions);
assert.equal(dictionary.tables.teaching_students, undefined);
assert.equal(dictionary.tables.study_recordings, undefined);
assert.equal(dictionary.tables.evidence, undefined);
assert.equal(dictionary.tables.edge_feedback, undefined, 'Missing tables must remain missing, not become empty successes');
assert.equal(dictionary.library, undefined);
assert.deepEqual(dictionary.assets, []);
assert.equal(dictionary.capabilities.hasAssets, false);
assert.equal(dictionary.capabilities.includesLibraryDocuments, false);
assert.equal(dictionary.capabilities.includesUserContent, false);
assert.ok(JSON.stringify(dictionary).length < before.length / 100);
const sources = mobileConsultationSnapshot(document, 'sources');
assert.deepEqual(sources.tables.ideas, tables.ideas, 'Uncited source ideas remain consultable');
assert.deepEqual(sources.tables.evidence, tables.evidence);
assert.equal(sources.tables.passages, undefined);
assert.equal(sources.tables.teaching_students, undefined);
assert.equal(sources.capabilities.includesPassages, false);
assert.equal(sources.formatVersion, 2);
assert.deepEqual(sources.vault, document.vault);
assert.equal(JSON.stringify(document), before, 'Selecting a consultation must never change the cached full snapshot');
assert.throws(() => mobileConsultationSnapshot({ tables: [] }, 'dictionary'), /invalid_snapshot_tables/);
console.log('PASS live consultation projections: complete historical citations, uncited dossiers, bounded payload and private-domain exclusion');
