import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), 'utf8'));
const snapshot = read('electron/serverSync/serverSnapshot.ts');
const library = read('electron/serverSync/serverLibrary.ts');
const service = read('electron/serverSync/serverSyncService.ts');
const contract = read('shared/serverPublication.ts');

test('canonical snapshot excludes personal annotation/read tables', () => {
  const userTables = snapshot.slice(snapshot.indexOf('const USER_TABLES'), snapshot.indexOf('export const TEACHING_SERVER_TABLES'));
  for (const table of ['writing_draft_annotations', 'writing_draft_reads', 'note_annotations']) {
    assert.doesNotMatch(userTables, new RegExp(`['"]${table}['"]`));
  }
  const studyTables = snapshot.slice(snapshot.indexOf('export const STUDY_SERVER_TABLES'), snapshot.indexOf('export const PRIMARY_SOURCES_SERVER_TABLES'));
  for (const table of ['study_annotations', 'study_material_annotations']) {
    assert.doesNotMatch(studyTables, new RegExp(`['"]${table}['"]`));
  }
  assert.match(snapshot, /buildServerPersonalImport/);
});

test('library annotations are personal overlay data, not manifest data', () => {
  assert.match(library, /personalAnnotations/);
  const documentInterface = library.slice(library.indexOf('export interface PublishedLibraryDocument'), library.indexOf('export interface PublishedLibraryManifest'));
  assert.doesNotMatch(documentInterface, /annotations\s*:/);
});

test('primary-source/testimony projections and permanent denylist are explicit', () => {
  assert.match(snapshot, /PRIMARY_SOURCES_SERVER_TABLES/);
  assert.match(snapshot, /TESTIMONIES_SERVER_TABLES/);
  for (const table of ['testimony_media', 'testimony_agreements', 'teaching_students', 'teaching_grade_entries', 'teaching_attendance', 'teaching_attendance_holidays', 'study_attempts']) {
    assert.match(contract, new RegExp(`['"]${table}['"]`));
  }
  assert.match(snapshot, /DENIED_COLUMN_PATTERN/);
});

test('primary-source and testimony opt-ins travel from Desktop settings to both publishers', () => {
  const types = read('shared/types.ts');
  const defaults = read('shared/defaultAppSettings.ts');
  const shared = read('electron/serverSync/serverSyncShared.ts');
  const cloudflare = read('electron/serverSync/cloudflarePublisher.ts');
  const settings = read('src/views/Settings.tsx');
  for (const field of ['nodusServerIncludePrimarySources', 'nodusServerIncludeTestimonies']) {
    assert.match(types, new RegExp(field));
    assert.match(defaults, new RegExp(`${field}: false`));
    assert.match(shared, new RegExp(field));
    assert.match(settings, new RegExp(field));
  }
  assert.match(cloudflare, /nodusServerIncludePrimarySources: config\.includePrimarySources/);
  assert.match(cloudflare, /nodusServerIncludeTestimonies: config\.includeTestimonies/);
});

test('prosopography remains a private identity-resolution surface', () => {
  assert.doesNotMatch(snapshot, /prosopography:\s*GENEALOGY_SERVER_TABLES/);
  assert.match(read('src/serverWeb/vaults/index.tsx'), /prosopography-persons[^\n]+published: false/);
  assert.match(read('src/serverWeb/vaults/index.tsx'), /testimony-participants[^\n]+published: false/);
});

test('classic publisher consults policy before snapshot and posts a publisher envelope', () => {
  const policyAt = service.indexOf('readPublicationPolicy(config, token)');
  const snapshotAt = service.indexOf('buildServerSnapshotInUtility({');
  assert.ok(policyAt >= 0 && policyAt < snapshotAt);
  assert.match(contract, /personal-annotations\/import/);
  assert.match(service, /x-nodus-publisher-id/);
  assert.match(service, /annotations/);
  assert.match(contract, /nodus\.server-personal-import/);
});
