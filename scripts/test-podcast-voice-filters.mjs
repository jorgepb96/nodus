// What the podcast composer offers depends on what is installed: only engines with their
// runtime AND a downloaded checkpoint count, languages follow those checkpoints, voices
// follow engine and language, and two-host defaults pick two different voices.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-podcast-voices-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'voices.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/podcastVoices.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const v = await import(pathToFileURL(outfile).href);

const status = ({ kokoro = true, phonon = true, models = [] } = {}) => ({
  kokoroRuntime: { installed: kokoro }, phononRuntime: { installed: phonon }, runtime: { installed: false }, pocketRuntime: { installed: false },
  models: models.map((id) => ({ id, downloaded: true })),
});

test('only ready engines are offered, with their languages', () => {
  assert.deepEqual(v.podcastEngineOptions(null), []);
  const none = v.podcastEngineOptions(status({ models: [] }));
  assert.deepEqual(none, [], 'nothing downloaded, nothing offered');
  const kokoroOnly = v.podcastEngineOptions(status({ phonon: false, models: ['kokoro-82m-int8', 'phonon-40m-multilingual'] }));
  assert.deepEqual(kokoroOnly.map((o) => [o.engine, o.languages]), [['kokoro', ['es', 'en']]], 'a checkpoint without its runtime does not count');
  const both = v.podcastEngineOptions(status({ models: ['kokoro-82m-int8', 'phonon-40m-multilingual', 'phonon-31m-en', 'ming3-0.5b-mlx-8bit'] }));
  assert.deepEqual(both.map((o) => o.modelId).sort(), ['kokoro-82m-int8', 'phonon-31m-en', 'phonon-40m-multilingual']);
  assert.deepEqual(v.podcastLanguages(both), ['es', 'en', 'fr', 'de', 'pt']);
  assert.equal(both.find((o) => o.modelId === 'phonon-40m-multilingual').nonCommercial, true);
  assert.equal(both.find((o) => o.modelId === 'kokoro-82m-int8').nonCommercial, false);
  assert.deepEqual(v.podcastEnginesFor(both, 'en').map((o) => o.modelId), ['phonon-31m-en', 'kokoro-82m-int8', 'phonon-40m-multilingual'], 'the most specific checkpoint first');
  assert.deepEqual(v.podcastEnginesFor(both, 'fr').map((o) => o.modelId), ['phonon-40m-multilingual']);
});

const voices = [
  { id: 'kokoro:ef_dora', name: 'Dora', origin: 'kokoro', language: 'es', locale: 'es', gender: 'female' },
  { id: 'kokoro:em_alex', name: 'Alex', origin: 'kokoro', language: 'es', locale: 'es', gender: 'male' },
  { id: 'kokoro:af_heart', name: 'Heart', origin: 'kokoro', language: 'en', locale: 'en-us', gender: 'female' },
  { id: 'phonon:x', name: 'Noa', origin: 'phonon', language: 'es', locale: 'es-es', gender: 'female' },
  { id: 'phonon:c', name: 'Robot', origin: 'phonon', language: 'en', locale: 'characters', gender: 'none' },
  { id: 'phonon:a', name: 'Zoey', origin: 'phonon', language: 'en', locale: 'en-us', gender: 'female' },
  { id: 'ming:x', name: 'Ming', origin: 'builtin', language: 'es' },
  { id: 'user:1', name: 'Mi voz', origin: 'recorded', language: 'es' },
  { id: 'pocket:p', name: 'Pocket', origin: 'pocket', language: 'es' },
];

test('voices follow engine and language; defaults pick two different voices', () => {
  assert.deepEqual(v.podcastVoicesFor(voices, 'kokoro', 'es').map((x) => x.name), ['Alex', 'Dora']);
  assert.deepEqual(v.podcastVoicesFor(voices, 'phonon', 'en').map((x) => x.name), ['Zoey', 'Robot'], 'character voices last');
  assert.deepEqual(v.podcastVoicesFor(voices, 'phonon', 'fr'), []);
  assert.deepEqual(v.podcastVoicesFor(voices, 'ming', 'es').map((x) => x.id).sort(), ['ming:x', 'user:1'], 'Ming: built-in voices and clones, never Pocket');
  const pair = v.defaultPodcastVoices(v.podcastVoicesFor(voices, 'kokoro', 'es'), 2);
  assert.deepEqual(pair.map((x) => x.name), ['Dora', 'Alex'], 'one of each gender');
  assert.deepEqual(v.defaultPodcastVoices(v.podcastVoicesFor(voices, 'kokoro', 'en'), 2).map((x) => x.name), ['Heart'], 'only one voice: only one default');
  assert.equal(v.podcastHostName({ name: 'Noa (es-ES)' }), 'Noa');
  assert.equal(v.podcastHostName({ name: 'Lucía - narradora' }), 'Lucía');
});
