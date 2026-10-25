// The Library's status presets, against a vault whose vectors live in the saved index.
//
// "Listo" and "Incompleto" are the same question asked twice, so they must partition the
// analysable corpus between them. Both evaluate passage freshness in SQL, and a passage's
// vector is not in its `passages` row: it lives in `embedding_index_values`, which the
// `embedding_read_passages` compatibility view presents under the old column names. A
// predicate that reads the base table sees `embedding IS NULL` on every row of a fully
// indexed vault, which made "Listo" empty and "Incompleto" the whole corpus.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--library-readiness-presets')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-readiness-presets-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { runMigrations, SCHEMA_VERSION } = require('../electron/db/migrations.ts');
const indexes = require('../electron/db/embeddingIndexesRepo.ts');
const { embeddingTextForIdea, embeddingTextHash } = require('../electron/db/ideaEmbeddingText.ts');
const { readinessWhere } = require('../electron/db/readinessFilters.ts');
const { withDatabaseContext } = require('../electron/db/database.ts');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const SETTINGS = { embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', localProviders: {} };
const VECTOR = [0.5, 0.5, 0.5, 0.5];

/**
 * A vault with two fully analysed works, indexed by the real pipeline writer.
 *
 * `ready` has both passages embedded from the text the analysis saw. `stale` has been
 * re-extracted since — its `resolved_text_hash` has moved on from the hash its passages
 * carry — which is the state library preparation leaves a document in when its text changes.
 * The presets must put one work in each.
 */
function indexedVault() {
  const file = path.join(root, 'readiness.sqlite');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify(SETTINGS));

  const profile = indexes.embeddingProfile(SETTINGS);
  const context = indexes.ensureInitialEmbeddingIndex(db, profile) ?? indexes.indexContext(db, indexes.createIndex(db, profile));
  db.prepare('UPDATE embedding_index_state SET active_id=?, enabled=1').run(context.indexId);
  indexes.registerEmbeddingIndexFunctions(db, { indexId: context.indexId, generation: context.generation });
  // Registered on the app's own connection from the same helper the pipeline uses (database.ts).
  // The readiness SQL names it, so it has to exist here or the statement will not even prepare.
  db.function('idea_embedding_text_hash', (type, label, statement, themeLabels) => {
    const themes = typeof themeLabels === 'string' && themeLabels ? themeLabels.split(',').filter(Boolean) : [];
    const asJsText = (value) => (value == null ? 'null' : String(value));
    return embeddingTextHash(embeddingTextForIdea({
      type: type == null ? null : String(type), label: asJsText(label), statement: asJsText(statement), themes,
    }));
  });

  const work = db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,
      light_status,deep_status,deep_hash,summary_status,archived,resolved_source_type,resolved_text_hash)
      VALUES(?,?,?,'[]',2006,'book','pdf','done','done',?,'done',0,'pdf',?)`);
  const passage = db.prepare(`INSERT INTO passages(passage_id,nodus_id,chunk_index,text,char_len,content_hash,created_at)
      VALUES(?,?,?,'Texto',5,?,'2026-10-20')`);
  const contract = indexes.contractForProfile(profile, VECTOR.length);
  for (const [id, textHash, resolved] of [['ready', 'hash-ready', 'hash-ready'], ['stale', 'hash-stale', 'hash-stale-v2']]) {
    work.run(id, `ZK-${id}`, `Obra ${id}`, textHash, resolved);
    for (const chunk of [0, 1]) {
      passage.run(`${id}-${chunk}`, id, chunk, textHash);
      indexes.storeIndexValue(db, context, { family: 'passages', entityId: `${id}-${chunk}`, textHash, contract, vector: VECTOR });
    }
  }
  return db;
}

const db = indexedVault();
const matches = (readiness) => withDatabaseContext(db, () => {
  const preset = readinessWhere(readiness);
  assert.ok(preset, `${readiness} must have a SQL predicate`);
  return db.prepare(`SELECT w.nodus_id FROM works w WHERE ${preset.sql} ORDER BY w.nodus_id`)
    .all(preset.params).map((row) => row.nodus_id);
});

test('an indexed vault keeps its passage vectors outside the passage row', () => {
  // The premise of the whole file. If this ever stops holding, the predicates below are
  // testing nothing and the base table would have been a legitimate thing to read.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM passages WHERE embedding IS NOT NULL').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM embedding_index_values WHERE family='passages'").get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_read_passages WHERE embedding IS NOT NULL').get().n, 4);
});

test('a fully indexed work is Listo, and is not also Incompleto', () => {
  assert.deepEqual(matches('ready'), ['ready'], 'the preset must find the work whose passages are all current');
  assert.ok(!matches('incomplete').includes('ready'), 'a ready work must not appear under Incompleto');
});

test('a work whose text moved under its passages is Incompleto, and is not Listo', () => {
  assert.deepEqual(matches('incomplete'), ['stale'], 'only the work with stale passages is incomplete');
  assert.ok(!matches('ready').includes('stale'), 'a work with stale passages must not read as ready');
});

test('the two presets partition the analysable corpus, with nothing in both or neither', () => {
  const ready = matches('ready');
  const incomplete = matches('incomplete');
  assert.deepEqual([...ready, ...incomplete].sort(), ['ready', 'stale'], 'every analysable work lands in exactly one preset');
  assert.equal(ready.filter((id) => incomplete.includes(id)).length, 0);
  // "Everything is incomplete" is also a partition, and was exactly the broken behaviour.
  assert.ok(ready.length > 0 && incomplete.length > 0, 'neither preset may swallow the whole corpus');
});
