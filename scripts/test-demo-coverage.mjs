// Cross-vault demo contract: every developed vault type must populate every
// persistent surface it exposes, and cleanup must leave no demo residue.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-demo-coverage-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-demo-coverage.mjs'), '--electron-demo-coverage-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-demo-coverage-'));
installRuntimeHooks(root);
try {
  const academic = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const genealogy = require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesDemoData.ts'));
  const study = require(path.join(repoRoot, 'electron/db/studyDemoData.ts'));
  const teaching = require(path.join(repoRoot, 'electron/db/teachingDemoData.ts'));
  const worldbuilding = require(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'));
  const demoI18n = require(path.join(repoRoot, 'shared/worldbuildingDemoI18n.ts'));
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const studyChat = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const places = require(path.join(repoRoot, 'electron/db/worldPlacesRepo.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/worldGroupsRepo.ts'));
  const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
  const maps = require(path.join(repoRoot, 'electron/db/worldMapsRepo.ts'));
  const mapMarkers = require(path.join(repoRoot, 'electron/db/mapMarkersRepo.ts'));
  const calendar = require(path.join(repoRoot, 'electron/db/worldCalendarRepo.ts'));
  const encyclopedia = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
  const threads = require(path.join(repoRoot, 'electron/db/worldThreadsRepo.ts'));
  const rules = require(path.join(repoRoot, 'electron/db/worldRulesRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
  const manuscript = require(path.join(repoRoot, 'electron/db/worldManuscriptRepo.ts'));
  const presence = require(path.join(repoRoot, 'electron/db/worldPresenceRepo.ts'));
  const continuity = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  const count = (table, where = '1=1') => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n);
  const demoAssetDir = path.join(repoRoot, 'electron/assets/worldbuilding-demo');
  const demoAssetFiles = fs.readdirSync(demoAssetDir);
  const originalAssets = demoAssetFiles.filter((file) => file.endsWith('.original.webp'));
  const thumbnailAssets = demoAssetFiles.filter((file) => file.endsWith('.webp') && !file.endsWith('.original.webp'));
  assert.equal(originalAssets.length, 55, 'worldbuilding ships every full-resolution demo original');
  assert.equal(thumbnailAssets.length, 55, 'every original has an independent compact thumbnail');
  assert.deepEqual(
    originalAssets.map((file) => file.replace(/\.original\.webp$/, '')).sort(),
    thumbnailAssets.map((file) => file.replace(/\.webp$/, '')).sort(),
    'originals and thumbnails match one-to-one',
  );
  assert.ok(!demoAssetFiles.some((file) => file.endsWith('.png')), 'no PNG ships: they were 118 MB of every installer');
  // An existing demo vault may still hold what earlier builds stored (the PNG originals
  // of 5.9.1 and earlier, the first demo's WebP crops); their hashes are what lets the
  // upgrade tell those demo-owned rows from author artwork.
  const legacyOriginals = JSON.parse(fs.readFileSync(path.join(demoAssetDir, 'legacy-originals.json'), 'utf8'));
  assert.deepEqual(
    Object.keys(legacyOriginals.pngOriginals).sort(),
    originalAssets.map((file) => file.replace(/\.original\.webp$/, '')).sort(),
    'every original keeps the hash of the PNG it replaced',
  );
  assert.ok(Object.values(legacyOriginals.pngOriginals).every((hash) => /^[0-9a-f]{64}$/.test(hash)));
  assert.ok(Object.keys(legacyOriginals.webpCrops).length >= 40, 'the first demo\'s crops are recognisable');
  for (const file of [...originalAssets, ...thumbnailAssets]) {
    const header = fs.readFileSync(path.join(demoAssetDir, file)).subarray(0, 12);
    assert.equal(header.subarray(0, 4).toString(), 'RIFF', `${file} is a RIFF WebP`);
    assert.equal(header.subarray(8, 12).toString(), 'WEBP', `${file} is a RIFF WebP`);
  }

  assert.equal(academic.seedDemoData(), true);
  for (const [label, table, where] of [
    ['library', 'works', "nodus_id LIKE 'demo-%'"], ['ideas', 'ideas', "global_id LIKE 'demo-%'"],
    ['graph/debate', 'edges', "id LIKE 'demo-%'"], ['gaps/hypotheses', 'gaps', "id LIKE 'demo-%'"],
    ['authors', 'authors', "author_id LIKE 'demo-%'"], ['notes', 'notes', "id LIKE 'demo-%'"],
    ['research coverage', 'research_questions', "id LIKE 'demo-%'"], ['writing/deep research', 'writing_saved_drafts', "id LIKE 'demo-%'"],
    ['immersion', 'immersion_sessions', "id LIKE 'demo-%'"], ['projects', 'projects', "id LIKE 'demo-%'"],
  ]) assert.ok(count(table, where) > 0, `academic ${label} is populated`);
  assert.equal(count('works', "nodus_id LIKE 'demo-w%'"), 15, 'academic demo has a substantial source corpus');
  assert.equal(count('ideas', "global_id LIKE 'demo-i%'"), 27, 'academic demo has a substantial idea graph');
  assert.equal(count('themes', "theme_id LIKE 'demo-t%'"), 12, 'academic overview has a substantial theme constellation');
  academic.clearDemoData();

  assert.equal(genealogy.seedGenealogyDemoData(), true);
  for (const [label, table, where] of [
    ['persons', 'persons', "person_id LIKE 'demo-%'"], ['timeline', 'events', "event_id LIKE 'demo-%'"],
    ['archive', 'archive_items', "item_id LIKE 'demo-%'"], ['map', 'person_places', "id LIKE 'demo-%'"],
    ['relations', 'relationships', "rel_id LIKE 'demo-%'"], ['library/search', 'works', "nodus_id LIKE 'demo-genealogy-%'"],
    ['notes', 'notes', "id LIKE 'demo-genealogy-%'"], ['deep research', 'writing_saved_drafts', "id LIKE 'demo-genealogy-%'"],
  ]) assert.ok(count(table, where) > 0, `genealogy ${label} is populated`);
  genealogy.clearGenealogyDemoData();

  assert.equal(databases.seedDatabasesDemoData(), true);
  for (const [label, table, where] of [
    ['tables', 'db_databases', "id LIKE 'demo-%'"], ['rows/search/analysis', 'db_rows', "id LIKE 'demo-%'"],
    ['relations', 'db_relations', "id LIKE 'demo-%'"], ['notes', 'notes', "id LIKE 'demo-db-%'"],
    ['chat', 'database_chat_conversations', "id LIKE 'demo-%'"],
  ]) assert.ok(count(table, where) > 0, `databases ${label} is populated`);
  databases.clearDatabasesDemoData();

  vaults.setVaultType(vaults.getActiveVault().id, 'estudio');
  assert.equal(study.seedStudyDemoData(), true);
  for (const [label, table, where] of [
    ['courses/folders', 'study_courses', "id LIKE 'demo-study-%'"], ['notes', 'study_docs', "id LIKE 'demo-study-%'"],
    ['document history', 'study_doc_versions', "id LIKE 'demo-study-%'"], ['materials', 'study_materials', "id LIKE 'demo-study-%'"],
    ['recordings', 'study_recordings', "id LIKE 'demo-study-%'"], ['transcripts', 'study_transcripts', "id LIKE 'demo-study-%'"],
    ['ideas/graph', 'study_ideas', "id LIKE 'demo-study-%'"], ['question bank', 'study_questions', "id LIKE 'demo-study-%'"],
    ['tests', 'study_assessments', "id LIKE 'demo-study-%'"], ['attempt history', 'study_attempts', "id LIKE 'demo-study-%'"],
    ['flashcards', 'study_flashcards', "id LIKE 'demo-study-%'"], ['review history', 'study_reviews', "id LIKE 'demo-study-%'"],
    ['planner/calendar', 'study_plans', "id LIKE 'demo-study-%'"], ['schedule', 'study_schedule_periods', "id LIKE 'demo-study-%'"],
    ['study sessions', 'study_study_sessions', "id LIKE 'demo-study-%'"],
  ]) assert.ok(count(table, where) > 0, `study ${label} is populated`);
  assert.ok(studyChat.listStudyAssistantConversations().some((item) => item.id === 'demo-study-chat-membrane'), 'study chat is populated');
  study.clearStudyDemoData();
  assert.equal(count('study_courses', "id LIKE 'demo-study-%'"), 0);
  assert.equal(studyChat.listStudyAssistantConversations(true).filter((item) => item.id.startsWith('demo-study-')).length, 0);

  vaults.setVaultType(vaults.getActiveVault().id, 'docencia');
  assert.equal(teaching.seedTeachingDemoData(), true);
  for (const [label, table, where] of [
    ['courses/subjects', 'study_courses', "id LIKE 'demo-teaching-%'"], ['notes', 'study_docs', "id LIKE 'demo-teaching-%'"],
    ['materials', 'study_materials', "id LIKE 'demo-teaching-%'"], ['recordings', 'study_recordings', "id LIKE 'demo-teaching-%'"],
    ['transcripts', 'study_transcripts', "id LIKE 'demo-teaching-%'"], ['question bank', 'study_questions', "id LIKE 'demo-teaching-%'"],
    ['ideas/graph', 'study_ideas', "id LIKE 'demo-teaching-%'"], ['idea edges', 'study_idea_edges', "id LIKE 'demo-teaching-%'"],
    ['idea evidence', 'study_idea_evidence', "occurrence_id LIKE 'demo-teaching-%'"],
    ['unit design', 'writing_saved_drafts', "id LIKE 'demo-teaching-%'"],
    ['schedule', 'study_schedule_periods', "id LIKE 'demo-teaching-%'"], ['calendar', 'study_calendar_events', "id LIKE 'demo-teaching-%'"],
    ['groups', 'teaching_groups', "id LIKE 'demo-teaching-%'"], ['students', 'teaching_students', "id LIKE 'demo-teaching-%'"],
    ['rubrics', 'teaching_rubrics', "id LIKE 'demo-teaching-%'"], ['exams', 'teaching_exams', "id LIKE 'demo-teaching-%'"],
    ['exam questions', 'teaching_exam_questions', "id LIKE 'demo-teaching-%'"],
    ['gradebook plan', 'teaching_assessment_plans', "id LIKE 'demo-teaching-%'"],
    ['gradebook tree', 'teaching_assessment_items', "id LIKE 'demo-teaching-%'"],
    ['grades', 'teaching_grade_entries', "id LIKE 'demo-teaching-%'"],
    ['rubric marks', 'teaching_rubric_evaluations', "id LIKE 'demo-teaching-%'"],
    ['attendance', 'teaching_attendance', "id LIKE 'demo-teaching-%'"],
    ['attendance holidays', 'teaching_attendance_holidays', "id LIKE 'demo-teaching-%'"],
  ]) assert.ok(count(table, where) > 0, `teaching ${label} is populated`);
  assert.ok(studyChat.listStudyAssistantConversations().some((item) => item.id === 'demo-teaching-chat-commentary'), 'teaching chat is populated');
  teaching.clearTeachingDemoData();
  assert.equal(count('study_courses', "id LIKE 'demo-teaching-%'"), 0);
  assert.equal(count('teaching_groups', "id LIKE 'demo-teaching-%'"), 0);
  assert.equal(count('study_ideas', "id LIKE 'demo-teaching-%'"), 0);
  assert.equal(count('writing_saved_drafts', "id LIKE 'demo-teaching-%'"), 0);
  assert.equal(studyChat.listStudyAssistantConversations(true).filter((item) => item.id.startsWith('demo-teaching-')).length, 0);

  vaults.setVaultType(vaults.getActiveVault().id, 'worldbuilding');
  // Regression fixture: older builds left this row behind when exiting the demo,
  // making the next click fail with a primary-key collision.
  db.prepare(`
    INSERT INTO world_scene_days
      (scene_id, mode, offset_days, anchor_world_day, created_at, updated_at)
    VALUES
      ('demo-world-scene-prologue', 'anchor', 0, 0, '2026-01-01', '2026-01-01')
  `).run();
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), true);

  const distinctGroupIds = [
    'council', 'firstlight', 'guard', 'sails', 'vellum',
    'tideborn', 'tidecant', 'veyari',
  ].map((slug) => `demo-world-group-${slug}`);
  const seededGroupArt = distinctGroupIds.map((groupId) => db.prepare(
    "SELECT thumbnail FROM world_images WHERE entity_kind = 'group' AND entity_id = ?"
  ).get(groupId).thumbnail.toString('base64'));
  assert.equal(
    new Set(seededGroupArt).size,
    seededGroupArt.length,
    'every demo faction and culture has distinct card artwork'
  );

  // Regression: older demo builds paired the lossless original with an independently
  // produced thumbnail, and also copied the avatar itself into the gallery. The upgrade
  // repairs the portrait pair and replaces only that demo-owned duplicate with a real
  // secondary scene, while preserving author-owned replacements.
  //
  // Those builds stored lossless PNG originals that no longer ship. A stand-in PNG,
  // registered by hash exactly as legacy-png-originals.json registers the real ones,
  // plays that vault.
  const elanThumbnail = fs.readFileSync(path.join(demoAssetDir, 'character-elan.webp'));
  const elanOriginal = fs.readFileSync(path.join(demoAssetDir, 'character-elan.original.webp'));
  const legacyElanPng = Buffer.from('the lossless PNG original of character-elan that 5.9.1 shipped');
  worldbuilding.__setLegacyDemoOriginalsForTest({
    ...legacyOriginals,
    pngOriginals: { ...legacyOriginals.pngOriginals, 'character-elan': createHash('sha256').update(legacyElanPng).digest('hex') },
  });
  const elanGalleryOriginal = fs.readFileSync(path.join(demoAssetDir, 'character-elan-gallery.original.webp'));
  const elanGalleryThumbnail = fs.readFileSync(path.join(demoAssetDir, 'character-elan-gallery.webp'));
  const wrongThumbnail = fs.readFileSync(path.join(demoAssetDir, 'character-aurel.webp'));
  db.prepare(
    "UPDATE person_portraits SET blob = ?, mime = 'image/png', thumbnail = ? WHERE person_id = 'demo-world-char-elan'"
  ).run(legacyElanPng, wrongThumbnail);
  db.prepare(
    "UPDATE world_images SET mime_type = 'image/png', bytes = ?, blob = ?, thumbnail = ? WHERE image_id = 'demo-world-image-character-char-elan-0'"
  ).run(legacyElanPng.length, legacyElanPng, wrongThumbnail);
  const customOriginal = Buffer.from('author-owned-original');
  const customThumbnail = Buffer.from('author-owned-thumbnail');
  const veshPortrait = db.prepare(
    "SELECT blob, thumbnail, mime, thumbnail_mime, updated_at FROM person_portraits WHERE person_id = 'demo-world-char-vesh'"
  ).get();
  db.prepare(
    "UPDATE person_portraits SET blob = ?, thumbnail = ? WHERE person_id = 'demo-world-char-vesh'"
  ).run(customOriginal, customThumbnail);
  // Early demos also reused one illustration for every culture. Simulate that shipped
  // state so the startup reconciliation proves it fixes an existing vault as well.
  const tideArt = db.prepare(
    "SELECT blob, thumbnail FROM world_images WHERE entity_id = 'demo-world-group-tideborn'"
  ).get();
  db.prepare(
    "UPDATE world_images SET blob = ?, thumbnail = ? WHERE entity_id = 'demo-world-group-tidecant'"
  ).run(tideArt.blob, tideArt.thumbnail);
  assert.equal(worldbuilding.upgradeWorldbuildingDemoImageQuality(), true);
  const elanPortrait = db.prepare("SELECT blob, mime, thumbnail FROM person_portraits WHERE person_id = 'demo-world-char-elan'").get();
  assert.ok(elanPortrait.thumbnail.equals(elanThumbnail), 'legacy character card thumbnail is rebuilt from the matching original');
  assert.ok(elanPortrait.blob.equals(legacyElanPng) && elanPortrait.mime === 'image/png', 'the lossless PNG the vault already holds is kept');
  const elanGallery = db.prepare("SELECT blob, mime_type FROM world_images WHERE image_id = 'demo-world-image-character-char-elan-0'").get();
  assert.ok(elanGallery.blob.equals(elanGalleryOriginal), 'legacy avatar copy is replaced by a distinct secondary gallery original');
  assert.equal(elanGallery.mime_type, 'image/webp', 'the replacement is labelled with its own format');
  assert.ok(
    db.prepare("SELECT thumbnail FROM world_images WHERE image_id = 'demo-world-image-character-char-elan-0'").get().thumbnail.equals(elanGalleryThumbnail),
    'legacy gallery thumbnail is rebuilt from that secondary original'
  );
  assert.ok(
    db.prepare("SELECT thumbnail FROM person_portraits WHERE person_id = 'demo-world-char-vesh'").get().thumbnail.equals(customThumbnail),
    'an author-owned replacement is not rewritten'
  );
  const repairedCultureArt = ['tideborn', 'tidecant', 'veyari'].map((slug) => db.prepare(
    'SELECT thumbnail FROM world_images WHERE entity_id = ?'
  ).get(`demo-world-group-${slug}`).thumbnail.toString('base64'));
  assert.equal(
    new Set(repairedCultureArt).size,
    repairedCultureArt.length,
    'legacy demos regain distinct culture artwork'
  );
  db.prepare(
    `UPDATE person_portraits
        SET blob = ?, thumbnail = ?, mime = ?, thumbnail_mime = ?, updated_at = ?
      WHERE person_id = 'demo-world-char-vesh'`
  ).run(veshPortrait.blob, veshPortrait.thumbnail, veshPortrait.mime, veshPortrait.thumbnail_mime, veshPortrait.updated_at);
  // A vault seeded today holds no PNG: put Elan back to the shipped original.
  db.prepare("UPDATE person_portraits SET blob = ?, mime = 'image/webp' WHERE person_id = 'demo-world-char-elan'").run(elanOriginal);
  worldbuilding.__setLegacyDemoOriginalsForTest(null);
  const untouched = db.prepare("SELECT updated_at FROM world_images WHERE image_id = 'demo-world-image-character-char-elan-0'").get().updated_at;
  assert.equal(worldbuilding.upgradeWorldbuildingDemoImageQuality(), true);
  assert.equal(
    db.prepare("SELECT updated_at FROM world_images WHERE image_id = 'demo-world-image-character-char-elan-0'").get().updated_at,
    untouched,
    'a repaired row holding today\'s original is not rewritten on the next launch',
  );
  // The very first demo stored its small WebP crops as originals. Originals are WebP
  // now too, so only the crop's hash can tell it from a WebP the author chose.
  const gateCrop = fs.readFileSync(path.join(demoAssetDir, 'lore-gate.webp'));
  assert.ok(
    Object.values(legacyOriginals.webpCrops).flat().includes(createHash('sha256').update(gateCrop).digest('hex')),
    'lore-gate.webp is still byte-identical to the crop the first demo stored',
  );
  const authorWebp = Buffer.from('RIFF....WEBPVP8 an image the author chose');
  db.prepare("UPDATE world_images SET mime_type = 'image/webp', blob = ? WHERE image_id = 'demo-world-image-scene-scene-gate-0'").run(gateCrop);
  db.prepare("UPDATE world_images SET mime_type = 'image/webp', blob = ? WHERE image_id = 'demo-world-image-scene-scene-archive-0'").run(authorWebp);
  assert.equal(worldbuilding.upgradeWorldbuildingDemoImageQuality(), true);
  assert.ok(
    db.prepare("SELECT blob FROM world_images WHERE image_id = 'demo-world-image-scene-scene-gate-0'").get().blob
      .equals(fs.readFileSync(path.join(demoAssetDir, 'lore-gate.original.webp'))),
    'a first-demo crop is replaced by the full original',
  );
  assert.ok(
    db.prepare("SELECT blob FROM world_images WHERE image_id = 'demo-world-image-scene-scene-archive-0'").get().blob.equals(authorWebp),
    'a WebP the author put in a demo row is not mistaken for a crop',
  );
  db.prepare("UPDATE world_images SET blob = ? WHERE image_id = 'demo-world-image-scene-scene-archive-0'")
    .run(fs.readFileSync(path.join(demoAssetDir, 'lore-archive.original.webp')));

  // Existing demo vaults must gain the new dynasty section without being reset.
  db.prepare(`
    DELETE FROM world_images
    WHERE entity_kind = 'group'
      AND entity_id IN ('demo-world-group-sarn', 'demo-world-group-mir')
  `).run();
  db.prepare(`
    UPDATE world_images SET kind = 'portrait'
    WHERE entity_kind = 'group' AND entity_id = 'demo-world-group-venn'
  `).run();
  db.prepare(`
    DELETE FROM world_groups
    WHERE group_id IN ('demo-world-group-sarn', 'demo-world-group-mir')
  `).run();
  assert.equal(worldbuilding.upgradeWorldbuildingDemoDynasties(), true, 'an existing demo receives the dynasty expansion');
  assert.equal(count('world_groups', "group_id LIKE 'demo-world-group-%' AND kind = 'house'"), 3);
  assert.equal(count('world_images', "entity_id LIKE 'demo-world-group-%' AND kind = 'emblem'"), 3);
  assert.equal(count('character_affiliations', "affiliation_id IN ('demo-world-aff-maelor-sarn','demo-world-aff-tarek-sarn','demo-world-aff-sena-mir')"), 3);
  assert.equal(worldbuilding.upgradeWorldbuildingDemoDynasties(), true, 'the dynasty upgrade is idempotent');
  assert.equal(count('world_groups', "group_id LIKE 'demo-world-group-%' AND kind = 'house'"), 3);
  assert.equal(count('world_images', "entity_id LIKE 'demo-world-group-%' AND kind = 'emblem'"), 3);
  // Opening an old manuscript/profile in the renderer may have autosaved it under a
  // current timestamp without actually deepening the seed text. The content threshold,
  // not the original timestamp, must decide whether it still needs the upgrade.
  db.prepare(`
    UPDATE character_profiles
       SET voice_sample = 'Muestra antigua.', updated_at = '2026-07-28T17:00:00.000Z'
     WHERE person_id = 'demo-world-char-nara'
  `).run();
  db.prepare(`
    UPDATE world_scene_text
       SET text = 'Pasaje antiguo.', word_count = 2, updated_at = '2026-07-28T17:00:00.000Z'
     WHERE scene_id = 'demo-world-scene-prologue'
  `).run();
  assert.equal(worldbuilding.upgradeWorldbuildingDemoNarrativeDepth(), true, 'existing demos receive deeper characters and scenes');
  assert.ok(
    Number(db.prepare("SELECT LENGTH(voice_sample) AS n FROM character_profiles WHERE person_id = 'demo-world-char-nara'").get().n) >= 170,
    'a shallow character autosave is deepened'
  );
  assert.ok(
    Number(db.prepare("SELECT word_count AS n FROM world_scene_text WHERE scene_id = 'demo-world-scene-prologue'").get().n) >= 120,
    'a shallow manuscript autosave is deepened'
  );
  assert.equal(worldbuilding.upgradeWorldbuildingDemoNarrativeDepth(), true, 'the narrative upgrade is idempotent');

  for (const [label, table, where] of [
    ['characters', 'persons', "person_id LIKE 'demo-world-%'"],
    ['character profiles', 'character_profiles', "person_id LIKE 'demo-world-%'"],
    ['primary portraits', 'person_portraits', "person_id LIKE 'demo-world-%'"],
    ['gallery images', 'world_images', "image_id LIKE 'demo-world-%'"],
    ['places', 'places', "place_id LIKE 'demo-world-%'"],
    ['place profiles', 'place_profiles', "place_id LIKE 'demo-world-%'"],
    ['factions and cultures', 'world_groups', "group_id LIKE 'demo-world-%'"],
    ['affiliations', 'character_affiliations', "affiliation_id LIKE 'demo-world-%'"],
    ['relationships and dynasty', 'relationships', "rel_id LIKE 'demo-world-%'"],
    ['social contacts', 'social_contacts', "contact_id LIKE 'demo-world-%'"],
    ['social relations', 'social_relations', "relation_id LIKE 'demo-world-%'"],
    ['timeline', 'events', "event_id LIKE 'demo-world-%'"],
    ['event participants', 'event_participants', "event_id LIKE 'demo-world-%'"],
    ['event evidence', 'record_evidence', "id LIKE 'demo-world-%'"],
    ['presence map', 'person_places', "id LIKE 'demo-world-%'"],
    ['calendar eras', 'world_calendar_eras', "era_id LIKE 'demo-world-%'"],
    ['calendar months', 'world_calendar_months', "month_id LIKE 'demo-world-%'"],
    ['secrets', 'world_secrets', "secret_id LIKE 'demo-world-%'"],
    ['secret knowledge', 'secret_knowers', "id LIKE 'demo-world-%'"],
    ['scenes', 'world_scenes', "scene_id LIKE 'demo-world-%'"],
    ['scene cast', 'scene_characters', "id LIKE 'demo-world-%'"],
    ['scene chronology', 'world_scene_days', "scene_id LIKE 'demo-world-%'"],
    ['maps', 'world_maps', "map_id LIKE 'demo-world-%'"],
    ['map canvases', 'map_images', "image_id LIKE 'demo-world-%'"],
    ['map layers', 'map_layers', "layer_id LIKE 'demo-world-%'"],
    ['map markers', 'map_markers', "marker_id LIKE 'demo-world-%'"],
    ['travel modes', 'map_travel_modes', "mode_id LIKE 'demo-world-%'"],
    ['encyclopedia articles', 'world_articles', "article_id LIKE 'demo-world-%'"],
    ['encyclopedia links', 'world_links', "source_id LIKE 'demo-world-%'"],
    ['entry proposals', 'world_entry_proposals', "proposal_id LIKE 'demo-world-%'"],
    ['conflicts and arcs', 'world_threads', "thread_id LIKE 'demo-world-%'"],
    ['thread parties', 'thread_parties', "party_id LIKE 'demo-world-%'"],
    ['beats', 'world_beats', "thread_id LIKE 'demo-world-%'"],
    ['rules', 'world_rules', "rule_id LIKE 'demo-world-%'"],
    ['questions', 'world_questions', "question_id LIKE 'demo-world-%'"],
    ['question options', 'world_question_options', "option_id LIKE 'demo-world-%'"],
    ['continuity mute workflow', 'world_notice_mutes', "reason LIKE 'demo-world-%'"],
    ['manuscript prose', 'world_scene_text', "scene_id LIKE 'demo-world-%'"],
    ['chapters', 'world_chapter_breaks', "scene_id LIKE 'demo-world-%'"],
    ['books', 'world_manuscript_starts', "scene_id LIKE 'demo-world-%'"],
    ['manuscript snapshots', 'world_scene_snapshots', "snapshot_id LIKE 'demo-world-%'"],
    ['writing diary', 'world_word_days', "day IN ('2000-01-01','2000-01-02','2000-01-03')"],
    ['notes', 'notes', "id LIKE 'demo-world-%'"],
    ['note folders', 'note_folders', "id LIKE 'demo-world-%'"],
  ]) assert.ok(count(table, where) > 0, `worldbuilding ${label} is populated`);
  assert.equal(count('persons', "person_id LIKE 'demo-world-char-%'"), 10, 'worldbuilding demo has a substantial cast');
  assert.equal(count('places', "place_id LIKE 'demo-world-place-%'"), 12, 'worldbuilding demo has a substantial geography');
  assert.equal(count('world_groups', "group_id LIKE 'demo-world-group-%'"), 11, 'worldbuilding demo covers organizations, cultures and dynasties');
  assert.equal(count('world_groups', "group_id LIKE 'demo-world-group-%' AND kind = 'house'"), 3, 'worldbuilding demo has several distinct dynasties');
  assert.equal(count('world_scenes', "scene_id LIKE 'demo-world-scene-%'"), 9, 'worldbuilding demo covers the story sequence');
  const characterDepth = db.prepare(`
    SELECT
      MIN(LENGTH(p.notes)) AS min_notes,
      MIN(LENGTH(cp.personality)) AS min_personality,
      MIN(LENGTH(cp.backstory)) AS min_backstory,
      MIN(LENGTH(cp.voice_register)) AS min_register,
      MIN(LENGTH(cp.voice_tics)) AS min_tics,
      MIN(LENGTH(cp.voice_sample)) AS min_sample,
      SUM(CASE WHEN cp.voice_register IS NULL OR cp.voice_tics IS NULL OR cp.voice_sample IS NULL THEN 1 ELSE 0 END) AS missing_voice
    FROM persons p
    JOIN character_profiles cp ON cp.person_id = p.person_id
    WHERE p.person_id LIKE 'demo-world-char-%'
  `).get();
  assert.ok(Number(characterDepth.min_notes) >= 500, 'every demo character has a substantial performance guide');
  assert.ok(Number(characterDepth.min_personality) >= 240, 'every demo character has developed personality');
  assert.ok(Number(characterDepth.min_backstory) >= 280, 'every demo character has developed backstory');
  assert.ok(Number(characterDepth.min_register) >= 130, 'every demo character has a concrete speech register');
  assert.ok(Number(characterDepth.min_tics) >= 120, 'every demo character has repeatable speech habits');
  assert.ok(Number(characterDepth.min_sample) >= 170, 'every demo character has several voice examples');
  assert.equal(Number(characterDepth.missing_voice), 0, 'even the unborn character has a bounded interview voice');
  const sceneDepth = db.prepare(`
    SELECT
      MIN(LENGTH(s.summary)) AS min_summary,
      MIN(LENGTH(s.notes)) AS min_notes,
      MIN(t.word_count) AS min_words,
      SUM(t.word_count) AS total_words
    FROM world_scenes s
    JOIN world_scene_text t ON t.scene_id = s.scene_id
    WHERE s.scene_id LIKE 'demo-world-scene-%'
  `).get();
  assert.ok(Number(sceneDepth.min_summary) >= 350, 'every demo scene has objective, conflict, turn and consequence');
  assert.ok(Number(sceneDepth.min_notes) >= 220, 'every demo scene has actionable author notes');
  assert.ok(Number(sceneDepth.min_words) >= 120, 'every demo scene is fully dramatised');
  assert.ok(Number(sceneDepth.total_words) >= 1650, 'the demo manuscript is substantial enough to exercise story flows');
  assert.equal(count('world_maps', "map_id LIKE 'demo-world-map-%'"), 4, 'worldbuilding demo covers map scopes');
  assert.equal(count('world_articles', "article_id LIKE 'demo-world-article-%'"), 14, 'worldbuilding demo has a substantial encyclopedia');
  assert.equal(count('world_threads', "thread_id LIKE 'demo-world-%'"), 7, 'worldbuilding demo covers conflicts and arcs');
  assert.equal(count('world_rules', "rule_id LIKE 'demo-world-rule-%'"), 7, 'worldbuilding demo covers rule states and scopes');
  assert.equal(count('person_portraits', "person_id LIKE 'demo-world-%' AND mime = 'image/webp' AND thumbnail_mime = 'image/webp' AND generated = 1"), 10, 'every demo character has a full original and separate thumbnail');
  assert.equal(count('world_images', "image_id LIKE 'demo-world-%' AND mime_type = 'image/webp' AND thumbnail_mime_type = 'image/webp' AND generated = 1"), 56, 'every visual world entity has a full gallery original and separate thumbnail');
  assert.equal(count('world_images', "entity_id LIKE 'demo-world-group-%' AND kind = 'emblem' AND mime_type = 'image/webp'"), 3, 'each demo dynasty has a full coat of arms');
  assert.equal(count('map_images', "image_id LIKE 'demo-world-%' AND mime_type = 'image/webp' AND thumbnail_mime_type = 'image/webp' AND generated = 1"), 6, 'all map roles keep their full artwork');
  const seededArtwork = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM person_portraits WHERE person_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM world_images WHERE image_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(blob)), 0) FROM map_images WHERE image_id LIKE 'demo-world-%')
      AS original_bytes,
      (SELECT COALESCE(SUM(LENGTH(thumbnail)), 0) FROM person_portraits WHERE person_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(thumbnail)), 0) FROM world_images WHERE image_id LIKE 'demo-world-%') +
      (SELECT COALESCE(SUM(LENGTH(thumbnail)), 0) FROM map_images WHERE image_id LIKE 'demo-world-%')
      AS thumbnail_bytes
  `).get();
  assert.ok(Number(seededArtwork.original_bytes) > Number(seededArtwork.thumbnail_bytes) * 2, 'lists stay light without reducing the zoomable originals');
  for (const personId of [
    'aurel', 'cael', 'elan', 'ilyra', 'maelor', 'nara', 'odran', 'sena', 'tarek', 'vesh',
  ].map((slug) => `demo-world-char-${slug}`)) {
    const slug = personId.slice('demo-world-char-'.length);
    const portrait = db.prepare(
      'SELECT blob, thumbnail FROM person_portraits WHERE person_id = ?'
    ).get(personId);
    assert.ok(
      portrait.blob.equals(fs.readFileSync(path.join(demoAssetDir, `character-${slug}.original.webp`))),
      `${slug} dossier uses its own original`
    );
    assert.ok(
      portrait.thumbnail.equals(fs.readFileSync(path.join(demoAssetDir, `character-${slug}.webp`))),
      `${slug} card uses the thumbnail derived from that original`
    );
    const gallery = db.prepare(
      "SELECT blob, thumbnail FROM world_images WHERE entity_kind = 'character' AND entity_id = ?"
    ).get(personId);
    assert.ok(
      gallery.blob.equals(fs.readFileSync(path.join(demoAssetDir, `character-${slug}-gallery.original.webp`))),
      `${slug} gallery opens its own high-resolution scene`
    );
    assert.ok(
      gallery.thumbnail.equals(fs.readFileSync(path.join(demoAssetDir, `character-${slug}-gallery.webp`))),
      `${slug} gallery card is derived from that same scene`
    );
    assert.ok(!gallery.blob.equals(portrait.blob), `${slug} does not repeat its avatar in the gallery`);
    assert.equal(characters.listCharacterImages(personId).length, 1, `${slug} exposes one distinct gallery scene`);
  }

  // A populated table is not enough: every non-AI reader behind the eighteen
  // Worldbuilding sections must be able to interpret the same connected corpus.
  assert.equal(characters.listCharacters().length, 10);
  assert.equal(characters.characterCounts().total, 10);
  assert.equal(characters.listWorldEvents().length, 8);
  assert.equal(places.listWorldPlaces().length, 12);
  assert.ok(places.inhabitantsOfPlace('demo-world-place-faro').length > 0);
  assert.equal(groups.listWorldGroups().length, 11);
  assert.deepEqual(new Set(groups.listWorldGroups().map((group) => group.kind)), new Set(['faction', 'order', 'house', 'religion', 'culture', 'species', 'language']));
  assert.ok(groups.listAffiliationsForCharacter('demo-world-char-ilyra').length > 0);
  assert.equal(story.listScenes('narrative').length, 9);
  assert.equal(story.listScenes('chronological').length, 9);
  assert.equal(story.listSecrets().length, 3);
  assert.ok(story.listKnowers('demo-world-secret-name').length > 0);
  assert.equal(story.listSceneDayLinks().length, 9);
  assert.equal(maps.listWorldMaps().length, 4);
  assert.equal(maps.childMaps('demo-world-map-world').length, 2);
  assert.ok(maps.getMapThumbnail('demo-world-map-orthea')?.blob.length > 0);
  assert.ok(maps.worldMapCoverage().some((item) => item.markerPlaceIds.length > 0));
  assert.ok(mapMarkers.listMapLayers('demo-world-map-orthea').length >= 4);
  assert.ok(mapMarkers.listMapMarkers('demo-world-map-orthea').length >= 4);
  assert.equal(mapMarkers.listTravelModes().length, 4);
  assert.equal(calendar.getWorldCalendar().eras.length, 2);
  assert.equal(calendar.getWorldCalendar().months.length, 6);
  assert.equal(encyclopedia.listWorldArticles().length, 14);
  assert.ok(encyclopedia.listWorldEntries().length >= 50);
  assert.ok(encyclopedia.worldBacklinks({ kind: 'character', id: 'demo-world-char-ilyra' }).length > 0);
  assert.ok(encyclopedia.worldUnresolvedLinks().some((link) => link.label.includes('Ciudad Sepultada') || link.label.includes('Buried City')));
  assert.ok(encyclopedia.searchWorldBodies('Corazón').length > 0 || encyclopedia.searchWorldBodies('Heart').length > 0);
  assert.equal(threads.listWorldThreads('conflict').length, 4);
  assert.equal(threads.listWorldThreads('arc').length, 3);
  assert.equal(threads.threadBoardData().cast.length, 10);
  assert.ok(threads.listWorldBeats().length >= 20);
  assert.equal(rules.listWorldRules().length, 7);
  assert.ok(rules.rulesInPlay('demo-world-scene-archive').length > 0);
  assert.equal(questions.listWorldQuestions().length, 4);
  assert.ok(questions.questionFeed(true).length >= 4);
  assert.ok(questions.sceneQuestionLoad('demo-world-scene-arrival').count > 0);
  const spine = manuscript.manuscriptSpine();
  assert.equal(spine.books.length, 2);
  assert.equal(spine.totals.scenes, 9);
  assert.ok(spine.totals.words > 0);
  assert.equal(manuscript.listSceneSnapshots('demo-world-scene-archive').length, 1);
  assert.equal(manuscript.listWordDays().length, 3);
  assert.ok(presence.listPresences().length > 20);
  assert.ok(continuity.continuitySummary().facts > 0);
  assert.ok(continuity.runContinuityUnfiltered().length > continuity.runContinuity().length, 'the demo includes a real muted continuity exception');

  // Changing the interface language updates untouched demo-owned content in place,
  // including a database that was seeded by an older session. Exact author edits must
  // survive the same pass.
  db.prepare("UPDATE world_groups SET notes = 'Nota personal del autor.' WHERE group_id = 'demo-world-group-venn'").run();
  for (const language of ['fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'en', 'es']) {
    assert.equal(worldbuilding.relocalizeWorldbuildingDemoData(language), true, `demo changes to ${language}`);
    assert.equal(
      db.prepare('SELECT name FROM world_calendar WHERE id = 1').get().name,
      demoI18n.worldbuildingDemoText(language, 'Calendario de las Mareas')
    );
    assert.equal(
      db.prepare("SELECT name FROM places WHERE place_id = 'demo-world-place-lumina'").get().name,
      demoI18n.worldbuildingDemoText(language, 'Lúmina')
    );
    assert.equal(
      db.prepare("SELECT role FROM scene_characters WHERE id = 'demo-world-scene-prologue-cast-0'").get().role,
      demoI18n.worldbuildingDemoText(language, 'punto de vista')
    );
    assert.equal(
      db.prepare("SELECT notes FROM world_groups WHERE group_id = 'demo-world-group-venn'").get().notes,
      'Nota personal del autor.',
      `relocalization to ${language} preserves edited demo fields`
    );
  }
  assert.equal(db.prepare('SELECT name FROM world_calendar WHERE id = 1').get().name, 'Calendario de las Mareas');
  assert.equal(
    db.prepare("SELECT notes FROM world_groups WHERE group_id = 'demo-world-group-venn'").get().notes,
    'Nota personal del autor.'
  );

  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false, 'worldbuilding demo cannot be seeded twice');
  academic.clearDemoData();
  assert.equal(count('persons', "person_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_scene_days', "scene_id LIKE 'demo-world-%'"), 0, 'worldbuilding cleanup removes scene chronology');
  assert.equal(count('world_maps', "map_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_articles', "article_id LIKE 'demo-world-%'"), 0);
  assert.equal(count('world_calendar'), 0);

  // An author may begin with geography or with the calendar. Neither path is "empty",
  // and the offer must never invite a demo that the seeder would then refuse.
  db.prepare(
    "INSERT INTO places (place_id,name,created_at,updated_at) VALUES ('real-place-only','Real place','2026-01-01','2026-01-01')"
  ).run();
  assert.equal(academic.hasAnyData(), true);
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false);
  db.prepare("DELETE FROM places WHERE place_id = 'real-place-only'").run();
  db.prepare(
    "INSERT INTO world_calendar (id,name,created_at,updated_at) VALUES (1,'Real calendar','2026-01-01','2026-01-01')"
  ).run();
  assert.equal(academic.hasAnyData(), true);
  assert.equal(worldbuilding.seedWorldbuildingDemoData(), false);
  db.prepare('DELETE FROM world_calendar WHERE id = 1').run();
  // ── Testimonios ──────────────────────────────────────────────────────────
  // Regression: salir del modo demo dejaba entera la bóveda de historia oral, porque
  // `clearDemoData` no llamaba a su limpieza. La prueba sale por la MISMA puerta que usa
  // la aplicación — `clearDemoData()` —, no por la limpieza específica del vertical.
  vaults.setVaultType(vaults.getActiveVault().id, 'testimonios');
  const testimonies = require(path.join(repoRoot, 'electron/db/testimonyDemoData.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  settings.updateSettings({ testimonyTourComplete: true });
  assert.equal(testimonies.seedTestimonyDemoData(), true);
  assert.equal(settings.getSettings().testimonyTourComplete, true, 'loading the demo preserves the tutorial decision');
  for (const [label, table, where] of [
    ['interviews', 'testimony_interviews', "id LIKE 'demo-tst-%'"],
    ['participants', 'testimony_participant_profiles', "person_id LIKE 'demo-tst-%'"],
    ['sessions', 'testimony_sessions', "id LIKE 'demo-tst-%'"],
    ['media', 'testimony_media', "id LIKE 'demo-tst-%'"],
    ['transcripts', 'testimony_transcripts', "id LIKE 'demo-tst-%'"],
    ['segments', 'testimony_transcript_segments', "id LIKE 'demo-tst-%'"],
    ['codes', 'testimony_codes', "id LIKE 'demo-tst-%'"],
    ['annotations', 'testimony_annotations', "id LIKE 'demo-tst-%'"],
    ['agreements', 'testimony_agreements', "id LIKE 'demo-tst-%'"],
    ['contrasts', 'testimony_contrasts', "id LIKE 'demo-tst-%'"],
    ['pinned fragments', 'testimony_contrast_items', "contrast_id LIKE 'demo-tst-%'"],
    ['notes', 'notes', "id LIKE 'demo-tst-%'"],
    ['note links', 'testimony_note_links', "note_id LIKE 'demo-tst-%'"],
  ]) assert.ok(count(table, where) > 0, `testimonios ${label} is populated`);
  assert.equal(settings.getSettings().testimonyProjectPurpose.length > 0, true, 'the demo writes the project purpose');

  // Lo que el usuario cree mientras explora la demo tiene que sobrevivir a la salida.
  db.prepare(`
    INSERT INTO testimony_interviews (id, short_id, title, workflow_status, interview_kind, created_at, updated_at)
    VALUES ('mine-1', 'ENT-9999', 'Mi entrevista', 'planned', 'individual', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO testimony_codes (id, label, normalized_label, created_at, updated_at)
    VALUES ('mine-code', 'Mi código', 'mi codigo', '2026-01-01', '2026-01-01')
  `).run();

  academic.clearDemoData();
  for (const [table, where] of [
    ['testimony_interviews', "id LIKE 'demo-tst-%'"], ['testimony_media', "id LIKE 'demo-tst-%'"],
    ['testimony_transcript_segments', "id LIKE 'demo-tst-%'"], ['testimony_annotations', "id LIKE 'demo-tst-%'"],
    ['testimony_contrasts', "id LIKE 'demo-tst-%'"], ['testimony_agreements', "id LIKE 'demo-tst-%'"],
    ['testimony_codes', "id LIKE 'demo-tst-%'"], ['notes', "id LIKE 'demo-tst-%'"],
    ['testimony_note_links', "note_id LIKE 'demo-tst-%'"], ['persons', "person_id LIKE 'demo-tst-%'"],
  ]) assert.equal(count(table, where), 0, `exiting the demo removes ${table}`);
  assert.equal(count('testimony_interviews', "id = 'mine-1'"), 1, 'and keeps what the user created');
  assert.equal(count('testimony_codes', "id = 'mine-code'"), 1, 'and keeps the codes the user created');
  const afterExit = settings.getSettings();
  assert.equal(afterExit.testimonyProjectPurpose, '', 'the fictional purpose does not stay presiding over Inicio');
  assert.equal(afterExit.testimonyRepositoryName, '', 'nor the invented municipal archive');
  assert.equal(afterExit.testimonyDefaultAccess, 'private', 'and the default access goes back to the safe one');
  db.prepare("DELETE FROM testimony_interviews WHERE id = 'mine-1'").run();
  db.prepare("DELETE FROM testimony_codes WHERE id = 'mine-code'").run();

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  console.log('Cross-vault demo coverage tests passed!');
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
    dialog: {}, shell: {}, BrowserWindow: class {}, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    // `@shared/assessment` is a directory, so a blind `.ts` suffix misses its index.
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return fs.existsSync(direct) ? direct : asIndex;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
