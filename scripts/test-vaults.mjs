import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-vaults-test')) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaults-build-'));
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaults-userdata-'));
  try {
    const entry = path.join(outDir, 'vault-test-entry.ts');
    const bundle = path.join(outDir, 'vault-test-entry.cjs');
    await writeFile(
      entry,
      [
        `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
        `export * as analysisReuse from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultAnalysisImport.ts'))};`,
        `export * as database from ${JSON.stringify(path.join(repoRoot, 'electron/db/database.ts'))};`,
        `export * as secrets from ${JSON.stringify(path.join(repoRoot, 'electron/secrets/secretStore.ts'))};`,
        `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
        `export * as provenance from ${JSON.stringify(path.join(repoRoot, 'electron/db/libraryAnalysisProvenance.ts'))};`,
        `export * as vaultCreationSettings from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultCreationSettings.ts'))};`,
      ].join('\n'),
      'utf8'
    );
    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/esbuild'),
      [
        entry,
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--target=es2022',
        `--outfile=${bundle}`,
        `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron-safe-storage.mjs')}`,
        '--external:better-sqlite3',
      ],
      { cwd: repoRoot, stdio: 'inherit' }
    );

    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/electron'),
      [path.join(repoRoot, 'scripts/test-vaults.mjs'), '--electron-vaults-test', bundle, userData],
      {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
        stdio: 'inherit',
      }
    );
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
const { registry, analysisReuse, database, secrets, settingsRepo, provenance, vaultCreationSettings } = require(bundle);

assert.equal(registry.getActiveVault().id, 'default');
assert.equal(registry.getActiveVault().type, 'academic', 'pre-existing/legacy vault defaults to academic type');
assert.equal(database.dbPath(), path.join(userData, 'nodus.sqlite'));

let db = database.getDb();
db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(JSON.stringify({ aiConcurrencyMode: 'manual', aiConcurrencyVersion: 0, concurrency: 1 }));
assert.equal(settingsRepo.getSettings().aiConcurrencyMode, 'automatic', 'an unchosen opt-in default graduates to automatic');
assert.equal(settingsRepo.getSettings().aiConcurrencyVersion, 1, 'the production concurrency migration is current');
settingsRepo.updateSettings({ aiConcurrencyMode: 'manual', aiConcurrencyVersion: 1, concurrency: 1 });
assert.equal(settingsRepo.getSettings().aiConcurrencyMode, 'manual', 'an explicit manual choice is never overwritten');
settingsRepo.updateSettings({ aiConcurrencyMode: 'automatic', aiConcurrencyVersion: 1 });
seedAnalyzedWork(db);
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('vault-import-test', 'source-only-setting');
secrets.setApiKey('openai', 'sk-default');
assert.equal(secrets.getApiKey('openai'), 'sk-default');
database.closeDb();

const researchVault = registry.createVault('Investigación separada');
assert.equal(researchVault.type, 'academic', 'createVault defaults to academic when no type is given');
assert.equal(registry.listVaults().length, 2);

// A long job keeps a dedicated connection to its source vault while the live app switches.
// This models an AI/image/comparison column yielding to a provider and finishing afterwards.
const scopedWrite = database.withVaultDatabase('default', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  database.getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('background-vault-test', 'source');
});
registry.setActiveVault(researchVault.id);
db = database.getDb();
await scopedWrite;
assert.equal(
  db.prepare('SELECT value FROM settings WHERE key = ?').get('background-vault-test'),
  undefined,
  'a background write never leaks into the newly active vault'
);
let resolveLateUiRead;
let rejectLateUiRead;
const lateUiRead = new Promise((resolve, reject) => {
  resolveLateUiRead = resolve;
  rejectLateUiRead = reject;
});
await database.withVaultDatabase('default', () => {
  setTimeout(() => {
    try {
      resolveLateUiRead(database.withoutDatabaseContext(() => settingsRepo.getSettings().uiLanguage));
    } catch (error) {
      rejectLateUiRead(error);
    }
  }, 10);
});
assert.equal(typeof await lateUiRead, 'string',
  'a delayed UI event escapes the closed background connection and reads the active vault safely');
database.closeDb();
registry.setActiveVault('default');
db = database.getDb();
assert.equal(
  db.prepare('SELECT value FROM settings WHERE key = ?').get('background-vault-test').value,
  'source',
  'the background write lands in its originating vault after the switch'
);
database.closeDb();

// ── Vault types ────────────────────────────────────────────────────────────
const studyVault = registry.createVault('Estudio de oposición', 'estudio');
assert.equal(studyVault.type, 'estudio', 'createVault honours an explicit type');
const studyManifest = JSON.parse(readFileSync(path.join(path.dirname(studyVault.path), 'manifest.json'), 'utf8'));
assert.equal(studyManifest.type, 'estudio', 'vault type is persisted to the manifest');

// setVaultType changes it and survives a fresh registry read.
registry.setVaultType(researchVault.id, 'estudio');
assert.equal(registry.getVault(researchVault.id).type, 'estudio', 'setVaultType updates the stored type');
assert.equal(
  JSON.parse(readFileSync(path.join(path.dirname(researchVault.path), 'manifest.json'), 'utf8')).type,
  'estudio',
  'setVaultType rewrites the manifest'
);
// Unknown types coerce back to academic instead of persisting garbage.
registry.setVaultType(researchVault.id, 'not-a-type');
assert.equal(registry.getVault(researchVault.id).type, 'academic', 'unknown vault types normalise to academic');
registry.deleteVault(studyVault.id, true);
assert.equal(registry.listVaults().length, 2, 'temporary study vault removed');

// The creation wizard persists two independent choices before the unopened vault
// becomes active. The general text choice follows the existing shared-model policy;
// embeddings stay local to the new database.
const configuredVault = registry.createVault('Configurada desde el asistente', 'genealogy');
const selection = vaultCreationSettings.validateVaultModelSelection({
  name: configuredVault.name,
  type: configuredVault.type,
  aiModel: { provider: 'gemini', model: 'gemini-test-model' },
  embeddingProvider: 'nodus',
  embeddingModel: 'multilingual-e5-small-int8',
});
assert.ok(selection, 'the complete wizard payload is accepted');
vaultCreationSettings.initializeVaultModelSelection(configuredVault.path, selection);
registry.setActiveVault(configuredVault.id);
db = database.getDb();
assert.deepEqual(settingsRepo.getSettings().synthesisModel, { provider: 'gemini', model: 'gemini-test-model' });
assert.equal(settingsRepo.getSettings().embeddingProvider, 'nodus');
assert.equal(settingsRepo.getSettings().embeddingModel, 'multilingual-e5-small-int8');
assert.equal(settingsRepo.getSettings().modelSettingsMode, 'basic');
database.closeDb();
registry.setActiveVault('default');
registry.deleteVault(configuredVault.id, true);
assert.equal(
  vaultCreationSettings.validateVaultModelSelection({ name: 'Legacy caller' }),
  null,
  'older createVault clients remain supported'
);
assert.throws(
  () => vaultCreationSettings.validateVaultModelSelection({ name: 'Incomplete', aiModel: { provider: 'openai', model: 'gpt-test' } }),
  /embeddings/,
  'partial wizard payloads are rejected instead of creating a half-configured vault'
);
assert.deepEqual(secrets.copyApiKeysBetweenVaults('default', researchVault.id), ['openai']);
assert.deepEqual(secrets.listApiKeyProvidersForVault(researchVault.id), ['openai']);

registry.setActiveVault(researchVault.id);
assert.equal(database.dbPath(), researchVault.path);
assert.equal(secrets.getApiKey('openai'), 'sk-default');
db = database.getDb();
assert.equal(countWorks(db), 0, 'new vault starts with an empty library');

// App-wide preferences and common capabilities are shared globally. Granular tool
// overrides stay in their vault.
settingsRepo.updateSettings({
  theme: 'light',
  uiLanguage: 'en',
  readTag: 'research-only',
  modelSettingsMode: 'advanced',
  chatModel: 'openrouter/anthropic/claude-3',
  synthesisModel: { provider: 'openai', model: 'gpt-4o' },
  relationModel: { provider: 'openai', model: 'gpt-4o' },
  favorites: [{ provider: 'openai', model: 'gpt-4o' }],
});
assert.equal(settingsRepo.getSettings().theme, 'light', 'theme applied in the active vault');
assert.equal(settingsRepo.getSettings().chatModel, 'openrouter/anthropic/claude-3', 'model applied in the active vault');
database.closeDb();
registry.setActiveVault('default');
database.getDb();
assert.equal(settingsRepo.getSettings().theme, 'light', 'theme persists across vaults (global preference)');
assert.equal(settingsRepo.getSettings().uiLanguage, 'en', 'uiLanguage persists across vaults (global preference)');
assert.deepEqual(settingsRepo.getSettings().chatModel, { provider: 'openai', model: 'gpt-4o' }, 'another vault materialises its own general model instead of leaking the granular override');
assert.deepEqual(settingsRepo.getSettings().synthesisModel, { provider: 'openai', model: 'gpt-4o' }, 'the common general model is shared');
assert.deepEqual(
  settingsRepo.getSettings().favorites,
  [{ provider: 'openai', model: 'gpt-4o' }],
  'favorite models are shared across vaults'
);
assert.notEqual(settingsRepo.getSettings().readTag, 'research-only', 'per-vault settings do NOT leak across vaults');
database.closeDb();
registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.equal(settingsRepo.getSettings().chatModel, 'openrouter/anthropic/claude-3', 'the vault keeps its own tool model');
db.prepare('INSERT INTO works (nodus_id, zotero_key, title) VALUES (?, ?, ?)').run('work-research', 'ZOT-RESEARCH', 'Research work');
db.prepare(`INSERT INTO works (
  nodus_id, zotero_key, title, light_hash, deep_hash, summary_hash, notes, manual_deep, read_tag
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('work-reused', 'ZOT-DEFAULT', 'Default work reused', 'light-hash', 'deep-hash', 'summary-hash', 'Private target note', 1, 1);
database.closeDb();

await database.withVaultDatabase('default', () => seedProvenance(database.getDb(), settingsRepo.getSettings(), provenance));

const canceledController = new AbortController();
canceledController.abort();
const canceledReuse = await analysisReuse.reuseVaultAnalysisForWorks(['work-reused'], { signal: canceledController.signal });
assert.equal(canceledReuse.canceled, true, 'reuse can be canceled between atomic per-work transactions');
assert.equal(canceledReuse.imported, 0);

registry.setActiveVault(researchVault.id);
db = database.getDb();
db.prepare('INSERT INTO works (nodus_id, zotero_key, title) VALUES (?, ?, ?)')
  .run('work-approximate', 'UNRELATED-KEY', 'Default work');
database.closeDb();
const approximate = await analysisReuse.reuseVaultAnalysisForWorks(['work-approximate']);
assert.equal(approximate.matched, 0, 'same-title and DOI-like approximate matches never reuse analysis');
registry.setActiveVault(researchVault.id);
db = database.getDb();
db.prepare('DELETE FROM works WHERE nodus_id=?').run('work-approximate');
database.closeDb();

const beforeManualSettings = database.getDb().prepare("SELECT value FROM settings WHERE key='app'").get().value;
database.getDb().prepare("UPDATE settings SET value=json_set(value,'$.academicMode','manual') WHERE key='app'").run();
const manualReuse = await analysisReuse.reuseVaultAnalysisForWorks(['work-reused']);
assert.equal(manualReuse.imported, 0, 'manual vault cannot inherit generated knowledge from another vault');
assert.equal(database.getDb().prepare("SELECT COUNT(*) AS n FROM idea_occurrences WHERE nodus_id='work-reused'").get().n, 0);
database.getDb().prepare("UPDATE settings SET value=? WHERE key='app'").run(beforeManualSettings);
// Same dormancy rule as a rescan: the target already holds the imported idea asleep
// (INSERT OR IGNORE keeps that row), so the import has to wake it.
// A shared global_id only happens when one vault started as a copy of the other, so the
// sleeping row is the same idea: copy it verbatim, asleep.
const sourceIdea = await database.withVaultDatabase('default', () => database.getDb().prepare("SELECT * FROM ideas WHERE global_id = 'idea-default'").get());
registry.setActiveVault(researchVault.id);
db = database.getDb();
{
  const columns = Object.keys(sourceIdea).filter((column) => column !== 'orphaned_at');
  db.prepare(`INSERT INTO ideas (${columns.join(', ')}, orphaned_at) VALUES (${columns.map(() => '?').join(', ')}, ?)`)
    .run(...columns.map((column) => sourceIdea[column]), '2026-09-01T00:00:00.000Z');
}
database.closeDb();

const reused = await analysisReuse.reuseVaultAnalysisForWorks(['work-reused']);
assert.equal(reused.requested, 1);
assert.equal(reused.matched, 1);
assert.equal(reused.imported, 1);
const reusedWorkResult = reused.works[0];
assert.equal(reusedWorkResult.matchedVaultId, 'default');
assert.equal(reusedWorkResult.matchedSourceNodusId, 'work-default');
assert.ok(reusedWorkResult.importedRows > 0, 'analysis reuse reports copied rows');
assert.ok(reusedWorkResult.imported.includes('themes'), 'themes are reused');
assert.ok(reusedWorkResult.imported.includes('ideas'), 'ideas are reused');
assert.ok(reusedWorkResult.imported.includes('ideaEmbeddings'), 'idea embeddings are reused');
assert.ok(reusedWorkResult.imported.includes('summary'), 'summaries are reused');
assert.ok(reusedWorkResult.imported.includes('passages'), 'passage embeddings are reused');
assert.ok(reusedWorkResult.imported.includes('documentProfile'), 'audited document profiles are reused');
assert.equal(reused.canceled, false);
assert.equal(reusedWorkResult.compatibility.ideas.state, 'reused');
assert.equal(reusedWorkResult.tableRows.works, undefined, 'analysis reuse does not copy source works');
registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.deepEqual(workTitles(db), ['Default work reused', 'Research work']);
assert.equal(countWorks(db), 2, 'analysis reuse keeps the target library independent');
assert.equal(countRows(db, 'ideas'), 1, 'reused ideas are available in the target vault');
assert.equal(
  db.prepare("SELECT orphaned_at FROM ideas WHERE global_id = 'idea-default'").get().orphaned_at,
  null,
  'an imported idea that already existed asleep in the target wakes up, since a work holds it now'
);

assert.equal(countRows(db, 'work_summaries'), 1, 'reused summaries are available in the target vault');
assert.equal(countRows(db, 'passages'), 1, 'reused passage embeddings are available in the target vault');
assert.equal(countRows(db, 'document_profile_versions'), 1, 'the current document profile version is copied');
assert.equal(countRows(db, 'document_vectors'), 1, 'whole-document vectors are copied without recomputation');
assert.equal(countRows(db, 'document_profile_overrides'), 1, 'verified user corrections travel with the reusable profile');
assert.deepEqual(
  db.prepare('SELECT nodus_id, status FROM document_profile_state WHERE nodus_id=?').get('work-reused'),
  { nodus_id: 'work-reused', status: 'current' },
  'the reused profile becomes the current profile of the target work'
);
assert.equal(
  db.prepare('SELECT target_id FROM document_idea_links WHERE nodus_id=?').get('work-reused').target_id,
  'work-reused:field:field-default',
  'profile links are remapped to target-local field ids'
);
assert.deepEqual(
  db.prepare('SELECT light_status, deep_status, summary_status FROM works WHERE nodus_id = ?').get('work-reused'),
  { light_status: 'done', deep_status: 'done', summary_status: 'done' },
  'reused analysis updates the target work statuses'
);
assert.deepEqual(
  db.prepare('SELECT notes, manual_deep, read_tag FROM works WHERE nodus_id = ?').get('work-reused'),
  { notes: 'Private target note', manual_deep: 1, read_tag: 1 },
  'private notes and manual target decisions never travel with reusable analysis'
);
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM idea_occurrences WHERE nodus_id = ?').get('work-reused').count,
  1,
  'reused ideas are attached to the selected target work'
);
assert.equal(
  db.prepare('SELECT nodus_id FROM work_summaries WHERE nodus_id = ?').get('work-reused').nodus_id,
  'work-reused',
  'reused summary is attached to the selected target work'
);
assert.deepEqual(
  db.prepare('SELECT passage_id, nodus_id FROM passages WHERE nodus_id = ?').get('work-reused'),
  { passage_id: 'work-reused#0', nodus_id: 'work-reused' },
  'reused passages are rewritten for the selected target work'
);
assert.deepEqual(
  db.prepare('SELECT source_ref, page_number FROM evidence WHERE nodus_id = ?').get('work-reused'),
  { source_ref: 'zotero:user:0:ATTACHMENT-B', page_number: 7 },
  'reused graph evidence preserves its exact attachment and page'
);
assert.deepEqual(
  db.prepare('SELECT source_ref, page_number FROM passages WHERE nodus_id = ?').get('work-reused'),
  { source_ref: 'zotero:user:0:ATTACHMENT-A', page_number: 12 },
  'reused passages preserve their exact attachment and page'
);
assert.equal(
  Buffer.from(db.prepare('SELECT embedding FROM embedding_read_ideas WHERE global_id = ?').get('idea-default').embedding).toString('hex'),
  Buffer.from(new Float32Array([1, 2, 3, 4]).buffer).toString('hex'),
  'idea embedding blob is preserved'
);
assert.equal(
  db.prepare('SELECT value FROM settings WHERE key = ?').get('vault-import-test'),
  undefined,
  'vault import does not overwrite target settings'
);
database.closeDb();

registry.setActiveVault('default');
db = database.getDb();
assert.equal(countWorks(db), 1, 'default vault kept its work');
assert.equal(workTitle(db), 'Default work');
assert.equal(secrets.getApiKey('openai'), 'sk-default');
database.closeDb();

const incompatibleVault = registry.createVault('Incompatible embedding model');
registry.setActiveVault(incompatibleVault.id);
db = database.getDb();
settingsRepo.updateSettings({ embeddingProvider: 'openai', embeddingModel: 'different-embedding-model' });
db.prepare(`INSERT INTO works (
  nodus_id, zotero_key, title, light_hash, deep_hash, summary_hash
) VALUES (?, ?, ?, ?, ?, ?)`)
  .run('work-model-mismatch', 'ZOT-DEFAULT', 'Model mismatch', 'light-hash', 'deep-hash', 'summary-hash');
database.closeDb();
const modelMismatch = await analysisReuse.reuseVaultAnalysisForWorks(['work-model-mismatch']);
assert.ok(modelMismatch.works[0].imported.includes('ideas'), 'a compatible ideas component is independently reused');
assert.ok(!modelMismatch.works[0].imported.includes('ideaEmbeddings'), 'a different embedding model invalidates embeddings only');
assert.ok(!modelMismatch.works[0].imported.includes('passages'), 'passage embeddings remain pending for the target model');
assert.equal(modelMismatch.works[0].compatibility.ideaEmbeddings.state, 'incompatible');
database.closeDb();
registry.setActiveVault('default');
registry.deleteVault(incompatibleVault.id, true);
db = database.getDb();

registry.renameVault(researchVault.id, 'Archivo 2026');
assert.equal(registry.getVault(researchVault.id).name, 'Archivo 2026');

const snapshotPath = path.join(userData, 'default-snapshot.sqlite');
await db.backup(snapshotPath);
const duplicate = registry.createVaultFromDatabaseFile(snapshotPath, 'Principal duplicada');
secrets.copyApiKeysBetweenVaults('default', duplicate.id);
database.closeDb();

registry.setActiveVault(duplicate.id);
db = database.getDb();
assert.equal(countWorks(db), 1, 'duplicated vault preserves data');
assert.equal(workTitle(db), 'Default work');
assert.equal(secrets.getApiKey('openai'), 'sk-default');
database.closeDb();

registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.equal(countWorks(db), 2, 'research vault kept its independent and reused works');
assert.deepEqual(workTitles(db), ['Default work reused', 'Research work']);
database.closeDb();

registry.resetVaultDatabase(researchVault.id);
registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.equal(countWorks(db), 0, 'reset vault recreates an empty database');
assert.equal(secrets.getApiKey('openai'), 'sk-default', 'reset keeps vault API keys available');
database.closeDb();

const removable = registry.createVault('Temporal para borrar');
const removableDir = path.dirname(removable.path);
assert.ok(existsSync(removableDir), 'created vault directory exists before delete');
registry.deleteVault(removable.id, true);
assert.equal(registry.getVault(removable.id), null, 'deleted vault is removed from registry');
assert.equal(existsSync(removableDir), false, 'deleted vault files are removed from disk');

function countWorks(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM works').get().count;
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function workTitle(db) {
  return db.prepare('SELECT title FROM works ORDER BY nodus_id LIMIT 1').get().title;
}

function workTitles(db) {
  return db.prepare('SELECT title FROM works ORDER BY title').all().map((row) => row.title);
}

function seedAnalyzedWork(db) {
  const now = '2026-07-07T00:00:00.000Z';
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, title, authors_json, light_status, light_at, light_hash,
      deep_status, deep_at, deep_hash, summary_status, summary_at, summary_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-default',
    'ZOT-DEFAULT',
    'Default work',
    '[]',
    'done',
    now,
    'light-hash',
    'done',
    now,
    'deep-hash',
    'done',
    now,
    'summary-hash'
  );
  db.prepare('INSERT INTO themes (theme_id, label, created_at) VALUES (?, ?, ?)').run('theme-default', 'Theme', now);
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-default', 'theme-default');
  db.prepare(
    `INSERT INTO ideas (
      global_id, type, label, statement, embedding, created_at,
      embedding_provider, embedding_model, embedding_dim, embedding_text_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'idea-default',
    'claim',
    'Imported idea',
    'Imported statement',
    Buffer.from(new Float32Array([1, 2, 3, 4]).buffer),
    now,
    'openai',
    'text-embedding-3-small',
    4,
    db.prepare('SELECT idea_embedding_text_hash(?,?,?,?) h').get('claim', 'Imported idea', 'Imported statement', '').h
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-default',
    'work-default',
    'central',
    'development',
    0.9
  );
  db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind, source_ref, page_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'evidence-default',
    'idea-default',
    'work-default',
    'quote',
    'p. 1',
    'quote',
    'zotero:user:0:ATTACHMENT-B',
    7
  );
  db.prepare(
    `INSERT INTO work_summaries (
      nodus_id, summary, source_level, model_json, content_hash, embedding,
      embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-default',
    'Summary',
    'deep',
    '{}',
    'summary-content-hash',
    Buffer.from(new Float32Array([5, 6, 7, 8]).buffer),
    'openai',
    'text-embedding-3-small',
    4,
    'summary-embedding-hash',
    now,
    now
  );
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, source_ref, page_number, char_len, content_hash,
      embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'passage-default',
    'work-default',
    0,
    'Passage',
    '1',
    'zotero:user:0:ATTACHMENT-A',
    12,
    7,
    'deep-hash',
    Buffer.from(new Float32Array([9, 10, 11, 12]).buffer),
    'openai',
    'text-embedding-3-small',
    4,
    'passage-embedding-hash',
    now
  );
  db.prepare(`INSERT INTO document_profile_versions(
    version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,source_language,
    presentation_language,overview,profile_json,prompt_hash,audit_json,quality_score,created_at,published_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'profile-default','work-default','current','deep-hash','document-profile/1',1,'es','es',
    'Overview','{"thesis":"Corrected thesis"}','prompt-hash','{"passed":true,"score":1,"supportCoverage":1,"structureCoverage":1,"issues":[],"repaired":false}',1,now,now,
  );
  db.prepare(`INSERT INTO document_profile_fields(
    field_id,version_id,nodus_id,kind,ordinal,text,confidence,centrality,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run('field-default','profile-default','work-default','thesis',0,'Generated thesis',1,1,now);
  db.prepare(`INSERT INTO document_sections(
    section_id,version_id,nodus_id,parent_section_id,level,ordinal,title,role,summary,concepts_json,claims_json,
    page_start,page_end,char_start,char_end,content_hash,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'section-default','profile-default','work-default',null,1,0,'Chapter','argument','Section summary','["concept"]','["claim"]',
    '1','10',0,100,'section-hash',now,
  );
  db.prepare(`INSERT INTO document_profile_support(
    support_id,version_id,nodus_id,target_kind,target_id,section_id,passage_id,page_start,page_end,char_start,char_end,
    quote,quote_hash,support_kind,confidence,validation_status,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'support-default','profile-default','work-default','field','field-default','section-default',null,'2','2',10,40,
    'Supporting quote','quote-hash','direct',1,'valid',now,
  );
  db.prepare(`INSERT INTO document_vectors(
    vector_id,nodus_id,version_id,kind,source_id,text,text_hash,weight,embedding,
    embedding_provider,embedding_model,embedding_dim,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'vector-default','work-default','profile-default','overview',null,'Overview','vector-hash',1,Buffer.from(new Float32Array([13,14,15,16]).buffer),
    'openai','text-embedding-3-small',4,now,
  );
  db.prepare(`INSERT INTO document_idea_links(
    version_id,nodus_id,global_id,target_kind,target_id,role,score,created_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run('profile-default','work-default','idea-default','field','field-default','principal',1,now);
  db.prepare(`INSERT INTO document_profile_overrides(
    override_id,nodus_id,field_path,base_version_id,generated_value_json,value_json,verified,conflict,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    'override-default','work-default','fields.thesis.0','profile-default','"Generated thesis"','"Corrected thesis"',1,0,now,now,
  );
  db.prepare(`INSERT INTO document_profile_state(
    nodus_id,current_version_id,status,source_fingerprint,profile_fingerprint,pipeline_version,updated_at
  ) VALUES(?,?,?,?,?,?,?)`).run('work-default','profile-default','current','deep-hash','profile-hash','document-profile/1',now);
}

function seedProvenance(db, settings, provenance) {
  const now = '2026-07-07T00:00:00.000Z';
  const documents = {
    light: 'light-hash', deep: 'deep-hash', ideas: 'deep-hash', summary: 'summary-hash',
    passages: 'deep-hash', embeddings: 'deep-hash', documentProfile: 'deep-hash',
  };
  const insert = db.prepare(`INSERT OR REPLACE INTO library_analysis_provenance (
    work_id, component, document_fingerprint, library_item_id, library_revision_fingerprint,
    pipeline_version, model_fingerprint, output_fingerprint, source_vault_id, source_work_id, updated_at
  ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`);
  for (const component of Object.keys(documents)) insert.run(
    'work-default', component, documents[component], provenance.ANALYSIS_PIPELINES[component],
    provenance.analysisModelFingerprint(component, settings), documents[component], 'default', 'work-default', now,
  );
}
