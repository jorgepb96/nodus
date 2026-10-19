import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-model-prefs-test')) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-prefs-build-'));
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-prefs-userdata-'));
  try {
    const entry = path.join(outDir, 'entry.ts');
    const bundle = path.join(outDir, 'entry.cjs');
    await writeFile(entry, [
      `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
      `export * as database from ${JSON.stringify(path.join(repoRoot, 'electron/db/database.ts'))};`,
      `export * as indexes from ${JSON.stringify(path.join(repoRoot, 'electron/db/embeddingIndexesRepo.ts'))};`,
      `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
    ].join('\n'));
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--outfile=${bundle}`,
      `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`,
      '--external:better-sqlite3',
    ], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [
      path.join(repoRoot, 'scripts/test-model-prefs-recovery.mjs'),
      '--electron-model-prefs-test',
      bundle,
      userData,
    ], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
      stdio: 'inherit',
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
  process.exit(0);
}

const [, , , bundle, userData] = process.argv;
process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const { registry, database, settingsRepo, indexes } = require(bundle);

const integrated = { provider: 'nodus', model: 'qwen3.5-0.8b-q4' };
const gemini = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
const bge = { provider: 'openrouter', model: 'baai/bge-m3' };
const granularKeys = [
  'extractionModel', 'visionModel', 'summaryModel', 'fusionModel', 'chatModel', 'nodiModel',
  'deepResearchModel', 'immersionModel', 'writingModel', 'argumentMapModel', 'authorModel',
  'studyModel', 'tutorModel', 'hypothesisModel', 'improveModel', 'questionGenModel',
  'gradingModel', 'flashcardModel',
];

const primary = registry.getActiveVault();
let db = database.getDb();
const broken = {
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  favorites: [],
  modelSettingsMode: 'basic',
  modelSettingsVersion: 2,
  synthesisModel: integrated,
  ...Object.fromEntries(granularKeys.map((key) => [key, integrated])),
};
db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(broken));
// The registry is authoritative even if restored legacy preferences name another model.
const bgeProfile = indexes.embeddingProfile({ ...broken, localProviders: {} }, bge);
const bgeIndex = indexes.createIndex(db, bgeProfile);
const bgeContext = indexes.indexContext(db, bgeIndex);
indexes.storeIndexValue(db, bgeContext, { family: 'ideas', entityId: 'bge-idea', textHash: 'hash', vector: [1, 2, 3, 4], contract: indexes.contractForProfile(bgeProfile, 4) });
db.prepare('UPDATE embedding_index_state SET pending_id=?').run(bgeIndex.id);
indexes.commitEmbeddingIndex(db, bgeContext);
// Simulate a stale preference restored independently of the registry.
db.prepare("UPDATE settings SET value=? WHERE key='app'").run(JSON.stringify(broken));


const secondary = registry.createVault('Recovery evidence');
const SecondaryDatabase = require('better-sqlite3');
const secondaryDb = new SecondaryDatabase(secondary.path);
secondaryDb.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(JSON.stringify({ favorites: [gemini, { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' }] }));
secondaryDb.close();

await writeFile(path.join(userData, 'app-prefs.json'), JSON.stringify({
  favorites: [],
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  modelSettingsMode: 'basic',
  modelSettingsVersion: 2,
  synthesisModel: integrated,
  chatModel: gemini,
  deepResearchModel: gemini,
  writingModel: integrated,
}, null, 2));

const recovered = settingsRepo.getSettings();
assert.equal(recovered.embeddingProvider, bge.provider, 'the only real embedding signature restores its provider');
assert.equal(recovered.embeddingModel, bge.model, 'the only real embedding signature restores its model');
assert.deepEqual(recovered.favorites, [gemini, { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' }], 'favorites are merged from every vault');
assert.equal(recovered.modelSettingsMode, 'advanced', 'ignored legacy task choices restore advanced mode');
assert.deepEqual(recovered.chatModel, gemini);
assert.deepEqual(recovered.deepResearchModel, gemini);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM embedding_index_values WHERE index_id=?").get(bgeIndex.id).count, 1, 'recovery never changes embeddings');

const prefs = JSON.parse(readFileSync(path.join(userData, 'app-prefs.json'), 'utf8'));
assert.equal(prefs.v23ModelPrefsRecoveryVersion, 1, 'the repair is marked as one-shot');
assert.throws(() => settingsRepo.updateSettings({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' }), /Prepara y activa/);
const selected = indexes.createIndex(db, indexes.embeddingProfile(settingsRepo.getSettings(), { provider: 'openai', model: 'text-embedding-3-small' }));
db.prepare('UPDATE embedding_index_state SET pending_id=?').run(selected.id);
indexes.commitEmbeddingIndex(db, indexes.indexContext(db, selected));
assert.equal(settingsRepo.getSettings().embeddingProvider, 'openai', 'a later intentional change is not reverted');
settingsRepo.updateSettings({ codexReasoningEfforts: { 'gpt-test': 'xhigh', 'stale-model': '../turbo' } });
settingsRepo.updateSettings({ studyImproveLastStyleId: 'builtin:formal', imageFavorites: [{ provider: 'codex', model: 'image-a' }] });
assert.deepEqual(
  settingsRepo.getSettings().codexReasoningEfforts,
  { 'gpt-test': 'xhigh' },
  'Codex reasoning preferences reject unsafe values outside the protocol identifier shape'
);

database.closeDb();
registry.setActiveVault(secondary.id);
db = database.getDb();
settingsRepo.getSettings();
db.prepare(`INSERT INTO ideas (
  global_id, type, label, statement, embedding, created_at,
  embedding_provider, embedding_model, embedding_dim, embedding_text_hash
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('openai-idea', 'claim', 'OpenAI', 'Indexed with OpenAI', Buffer.from(new Float32Array([5, 6, 7, 8]).buffer), new Date().toISOString(), 'openai', 'text-embedding-3-small', 4, 'hash-2');
const secondarySettings = settingsRepo.getSettings();
assert.equal(secondarySettings.studyImproveLastStyleId, 'builtin:clear', 'each vault starts with its own last writing style');
assert.deepEqual(secondarySettings.imageFavorites, [{ provider: 'codex', model: 'image-a' }], 'image favorites are shared separately from text favorites');
settingsRepo.updateSettings({ studyImproveLastStyleId: 'builtin:academic' });
assert.equal(secondarySettings.embeddingProvider, 'openai', 'each vault recovers against its own independent index');
assert.equal(secondarySettings.embeddingModel, 'text-embedding-3-small');
assert.deepEqual(secondarySettings.codexReasoningEfforts, { 'gpt-test': 'xhigh' }, 'Codex reasoning preferences are shared across vaults');

const favoritesPinnedInSecondary = [gemini, integrated];
settingsRepo.updateSettings({ favorites: favoritesPinnedInSecondary });
database.closeDb();
registry.setActiveVault(primary.id);
db = database.getDb();
assert.equal(settingsRepo.getSettings().studyImproveLastStyleId, 'builtin:formal', 'changing the style in another vault preserves the original vault preference');
assert.deepEqual(settingsRepo.getSettings().favorites, favoritesPinnedInSecondary, 'models pinned in one vault appear in every other vault');

settingsRepo.updateSettings({ favorites: [integrated] });
database.closeDb();
registry.setActiveVault(secondary.id);
db = database.getDb();
assert.deepEqual(settingsRepo.getSettings().favorites, [integrated], 'unpinning a shared model updates every vault too');

database.closeDb();
console.log('2.3 model preference recovery tests passed');
