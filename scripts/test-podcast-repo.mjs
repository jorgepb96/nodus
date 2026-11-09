// Podcast persistence (migration 207) on node:sqlite: the tables are machine-local, the
// migration replays safely, episodes round-trip, listening position never reorders the
// gallery, and deleting an episode takes its images with it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const stubDatabase = {
  name: 'stub-database',
  setup(b) {
    b.onResolve({ filter: /^\.\/database$/ }, () => ({ path: 'database', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function getDb() { throw new Error("no default db in tests"); }', loader: 'js' }));
  },
};
const built = await build({ entryPoints: ['electron/db/podcastRepo.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [stubDatabase], tsconfig: 'electron/tsconfig.json' });
const module_ = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module_, module_.exports, require_);
const repo = module_.exports;

const migrations = fs.readFileSync('electron/db/migrations.ts', 'utf8');
const body = migrations.match(/\{ version: 207, up: \/\* sql \*\/ `([\s\S]*?)` \}/)?.[1];

function migrated() {
  assert.ok(body, 'migration 207 exists');
  const db = new DatabaseSync(':memory:');
    db.exec(body);
  return db;
}

const request = {
  objective: 'La memoria colectiva', format: 'conversation', language: 'es', ttsModelId: 'kokoro-82m-int8',
  hosts: [{ speaker: 'A', voiceId: 'kokoro:ef_dora', name: 'Dora' }, { speaker: 'B', voiceId: 'kokoro:em_alex', name: 'Alex' }],
  audience: 'general', durationCapMin: 5, cover: true, extraImages: 1, reviewScript: false,
};
const episode = (id, title) => ({
  id, title, request,
  plan: { title, hook: 'h', summary: 's', chapters: [{ index: 0, title: 'Uno', goal: 'g', keyPoints: [], sourceIds: [], targetWords: 100 }, { index: 1, title: 'Dos', goal: 'g', keyPoints: [], sourceIds: [], targetWords: 100 }], images: [] },
  script: { turns: [{ id: 't1', chapterIndex: 0, speaker: 'A', text: 'Hola.', sourceIds: [] }] },
  sources: [{ id: 'S1', kind: 'passage', title: 'Obra', excerpt: 'texto' }],
  researchLog: 'log', timeline: { turns: [{ turnId: 't1', startS: 0, durationS: 1 }], chapters: [{ index: 0, title: 'Uno', startS: 0 }] },
  durationS: 1.2, audioFile: `${id}.m4a`, audioMime: 'audio/mp4', audioBytes: 1234,
  generation: { ttsModelId: 'kokoro-82m-int8', engine: 'kokoro', codec: 'mp4a.40.2' },
});

test('podcast tables are classified as local-only and the schema advanced', () => {
  const sync = fs.readFileSync('electron/db/syncTables.ts', 'utf8');
  for (const table of ['podcast_episodes', 'podcast_images']) assert.match(sync, new RegExp(`'${table}'`), `${table} is classified`);
  const version = migrations.match(/export const SCHEMA_VERSION = (\d+);/);
  assert.ok(version && Number(version[1]) >= 207);
});

test('migration 207 is pure CREATE and replays on a database that already has it', () => {
  const db = migrated();
  db.exec(body);
  assert.doesNotMatch(body.replace(/--[^\n]*/g, ' '), /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i, 'the app replays only bodies its isCreateOnly() accepts');
});

test('episodes round-trip, listening keeps the order and delete cascades to images', () => {
  const db = migrated();
  repo.savePodcastEpisode(episode('ep-1', 'Primero'), db);
  repo.savePodcastEpisode(episode('ep-2', 'Segundo'), db);
  db.prepare("UPDATE podcast_episodes SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = 'ep-1'").run();
  const list = repo.listPodcastEpisodes(db);
  assert.deepEqual(list.map((e) => e.id), ['ep-2', 'ep-1'], 'newest first');
  assert.equal(list[0].chapterCount, 2);
  assert.equal(list[0].hosts[1].name, 'Alex');
  const full = repo.getPodcastEpisode('ep-1', db);
  assert.equal(full.script.turns[0].text, 'Hola.');
  assert.equal(full.timeline.chapters[0].title, 'Uno');
  assert.equal(full.request.durationCapMin, 5);
  const updated = full.updatedAt;
  repo.setPodcastListenPosition('ep-1', 42.5, db);
  const after = repo.getPodcastEpisode('ep-1', db);
  assert.equal(after.listenedPositionS, 42.5);
  assert.equal(after.updatedAt, updated, 'listening is not an edit');
  repo.renamePodcastEpisode('ep-1', '  Nuevo   título ', db);
  assert.equal(repo.getPodcastEpisode('ep-1', db).title, 'Nuevo título');
  assert.throws(() => repo.renamePodcastEpisode('ep-1', '   ', db), /PODCAST_EMPTY_TITLE/);

  repo.putPodcastImagePlaceholder('ep-1', 0, null, 'cover', 'editorial', db);
  repo.putPodcastImagePlaceholder('ep-1', 1, 1, 'chapter', 'editorial', db);
  repo.setPodcastImageData('ep-1', 0, { mime: 'image/png', image: new Uint8Array([1, 2]), thumbnail: new Uint8Array([3]), provider: 'google', model: 'm' }, db);
  repo.setPodcastImageStatus('ep-1', 1, 'failed', 'boom', db);
  const images = repo.listPodcastImages('ep-1', db);
  assert.deepEqual(images.map((i) => [i.slot, i.status]), [[0, 'ready'], [1, 'failed']]);
  assert.equal(images[1].error, 'boom');
  assert.deepEqual([...repo.getPodcastImageBytes('ep-1', 0, 'thumbnail', db).bytes], [3]);
  assert.equal(repo.getPodcastImageBytes('ep-1', 1, 'image', db), null, 'a failed image has no bytes');
  assert.equal(repo.listPodcastEpisodes(db).find((e) => e.id === 'ep-1').imageCount, 1);

  assert.deepEqual(repo.podcastAudioFile('ep-1', db), { file: 'ep-1.m4a', mime: 'audio/mp4' });
  assert.equal(repo.deletePodcastEpisode('ep-1', db), 'ep-1.m4a');
  assert.equal(repo.getPodcastEpisode('ep-1', db), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM podcast_images WHERE episode_id = 'ep-1'").get().n, 0);
  assert.equal(repo.deletePodcastEpisode('missing', db), null);
});

test('images interrupted by a quit become failed so they can be retried', () => {
  const db = migrated();
  repo.savePodcastEpisode(episode('ep-3', 'Tres'), db);
  repo.putPodcastImagePlaceholder('ep-3', 0, null, 'cover', 'editorial', db);
  repo.failInterruptedPodcastImages(db);
  assert.equal(repo.listPodcastImages('ep-3', db)[0].status, 'failed');
});
