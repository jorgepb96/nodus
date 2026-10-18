import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { clonePreparedResearchProfile } from './clone-prepared-research-profile.mjs';

const model = 'embeddinggemma-2-text-q8-v1';
const embeddingModel = 'embeddinggemma-2-text-q8-512-v1';
const synthetic = { expectedDocumentCount: null, expectedVectorCount: null };

function put(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function markedRoot(parent) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'nodus-research-source-')));
  put(path.join(root, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root }));
  const dbs = [
    ['profile/nodus.sqlite', `CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('app', '{"embeddingProvider":"nodus","embeddingModel":"${embeddingModel}","customProvider":{"baseUrl":"http://localhost/private"},"nodusServerUrl":"http://localhost/private-token","mcpToken":"test-secret"}'); CREATE TABLE test_path(path TEXT); INSERT INTO test_path VALUES ('ROOT/profile/nodus.sqlite');`],
    ['profile/documentary/store.sqlite', 'CREATE TABLE documentary_requests(document_id TEXT PRIMARY KEY, configuration_json TEXT, revision TEXT) WITHOUT ROWID; INSERT INTO documentary_requests VALUES (\'stable-id\', \'{"scope":"ROOT/profile/nodus.sqlite"}\', \'r2\');'],
    ['profile/library/catalog.sqlite', 'CREATE TABLE test_items(id TEXT PRIMARY KEY, file TEXT); INSERT INTO test_items VALUES (\'stable-item\', \'ROOT/library/nodus-library/doc.pdf\');'],
  ];
  for (const [relative, schema] of dbs) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    const sql = schema.replaceAll('ROOT', root);
    const py = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()";
    const result = spawnSync('python3', ['-c', py, path.join(root, relative), sql], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  put(path.join(root, `profile/local-ai/models/${model}/onnx/model_quantized.onnx`), 'fixed model payload');
  put(path.join(root, 'profile/library/device.json'), JSON.stringify({ format: 'nodus.library-device', formatVersion: 1, id: 'synthetic-device' }));
  put(path.join(root, 'profile/profile-migrations/library-origin.json'), JSON.stringify({ schemaVersion: 1, hadLibrary: true }));
  put(path.join(root, 'library/nodus-library/item/metadata.json'), JSON.stringify({ id: 'stable-item', sourcePath: `${root}/library/nodus-library/item.pdf` }));
  put(path.join(root, 'fixtures/corpus/doc.pdf'), 'fixture bytes');
  return root;
}

test('clones prepared QA data into an independent marked profile, rebases contained paths, and records hashes', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-clone-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sourceParent = path.join(temp, 'source-parent'), targetParent = path.join(temp, 'target-parent');
  fs.mkdirSync(sourceParent); fs.mkdirSync(targetParent);
  const source = markedRoot(sourceParent);
  const sourceDbHash = fs.readFileSync(path.join(source, 'profile/documentary/store.sqlite'));
  const result = clonePreparedResearchProfile({ sourceRoot: source, targetParent, name: 'shard-a', sourceClosed: true, ...synthetic });

  assert.equal(result.format, 'nodus.prepared-research-clone/1');
  assert.notEqual(result.root, source);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.root, 'isolation.json'), 'utf8')).root, result.root);
  const registry = JSON.parse(fs.readFileSync(path.join(result.root, 'profile', 'vaults.json'), 'utf8'));
  assert.equal(registry.activeVaultId, 'default');
  assert.deepEqual(registry.vaults.map(({ id, type, origin, path: vaultPath }) => ({ id, type, origin, path: vaultPath })), [
    { id: 'default', type: 'academic', origin: 'local', path: path.join(result.root, 'profile/nodus.sqlite') },
  ]);
  assert.deepEqual(fs.readFileSync(path.join(source, 'profile/documentary/store.sqlite')), sourceDbHash, 'source database bytes remain unchanged');
  assert.notDeepEqual(fs.readFileSync(path.join(result.root, 'profile/documentary/store.sqlite')), sourceDbHash, 'only the clone SQLite paths are rebased');
  assert.equal(fs.existsSync(path.join(result.root, 'profile', 'documentary', 'store.sqlite-wal')), false);
  assert.equal(fs.readFileSync(path.join(result.root, 'fixtures/corpus/doc.pdf'), 'utf8'), 'fixture bytes');
  const metadata = JSON.parse(fs.readFileSync(path.join(result.root, 'library/nodus-library/item/metadata.json'), 'utf8'));
  assert.equal(metadata.sourcePath, `${result.root}/library/nodus-library/item.pdf`);
  const receipt = JSON.parse(fs.readFileSync(path.join(result.root, 'artifacts/clone-receipt.json'), 'utf8'));
  assert.equal(receipt.cloneSafety.independentSQLiteFiles, true);
  assert.equal(receipt.sourceFilesUnchangedByDesign, true);
  assert.deepEqual(receipt.embeddingSelection, { embeddingProvider: 'nodus', embeddingModel });
  const appPrefs = JSON.parse(fs.readFileSync(path.join(result.root, 'profile/app-prefs.json'), 'utf8'));
  assert.equal(appPrefs.autoBackupFolder, path.join(result.root, 'library'));
  assert.equal(appPrefs.customProvider, null, 'a clone never inherits a provider endpoint');
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.root, 'profile/library/device.json'), 'utf8')).id, 'synthetic-device');
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.root, 'profile/profile-migrations/library-origin.json'), 'utf8')).hadLibrary, true);
  const rebaseReceipt = JSON.parse(fs.readFileSync(path.join(result.root, 'artifacts/clone-rebase-receipt.json'), 'utf8'));
  assert.equal(rebaseReceipt.tablesEqualExceptAllowedColumns, true);
  assert.equal(rebaseReceipt.sameRevisionContract, true);
  assert.equal(rebaseReceipt.sameVectorPayloads, true);
  assert.equal(rebaseReceipt.rebaseVerified, true);
  assert.equal(receipt.documentaryTransferProofSha256.length, 64);
  assert.ok(receipt.copiedFiles.some((file) => file.path === `profile/local-ai/models/${model}/onnx/model_quantized.onnx` && file.sha256));

  const py = "import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True); print(*c.execute('select document_id,configuration_json,revision from documentary_requests').fetchone(),sep='\\n'); c.close()";
  const query = spawnSync('python3', ['-c', py, path.join(result.root, 'profile/documentary/store.sqlite')], { encoding: 'utf8' });
  assert.equal(query.status, 0, query.stderr);
  assert.deepEqual(query.stdout.trim().split('\n'), ['stable-id', JSON.stringify({ scope: `${result.root}/profile/nodus.sqlite` }), 'r2']);

  const prefs = spawnSync('python3', ['-c', "import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True); print(c.execute(\"select value from settings where key='app'\").fetchone()[0]); print(c.execute('select path from test_path').fetchone()[0]); c.close()", path.join(result.root, 'profile/nodus.sqlite')], { encoding: 'utf8' });
  assert.equal(prefs.status, 0, prefs.stderr);
  const [settings, vaultPath] = prefs.stdout.trim().split('\n');
  assert.deepEqual(JSON.parse(settings), { embeddingProvider: 'nodus', embeddingModel });
  assert.equal(vaultPath, `${result.root}/profile/nodus.sqlite`);
});

test('requires a closed-source attestation and refuses SQLite WAL sidecars and symlinks', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-clone-guards-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sourceParent = path.join(temp, 'source-parent'), targetParent = path.join(temp, 'target-parent');
  fs.mkdirSync(sourceParent); fs.mkdirSync(targetParent);
  const source = markedRoot(sourceParent);
  assert.throws(() => clonePreparedResearchProfile({ sourceRoot: source, targetParent, ...synthetic }), /sourceClosed: true/);

  const wal = path.join(source, 'profile/documentary/store.sqlite-wal');
  put(wal, 'open sqlite marker');
  assert.throws(() => clonePreparedResearchProfile({ sourceRoot: source, targetParent, sourceClosed: true, ...synthetic }), /not closed/);
  fs.rmSync(wal);

  const link = path.join(source, 'fixtures/corpus/linked');
  fs.symlinkSync(path.join(source, 'fixtures/corpus/doc.pdf'), link);
  assert.throws(() => clonePreparedResearchProfile({ sourceRoot: source, targetParent, sourceClosed: true, ...synthetic }), /symlink/);
});

test('does not rebase sibling-prefix paths or follow paths outside the marked root', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-clone-prefix-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sourceParent = path.join(temp, 'source-parent'), targetParent = path.join(temp, 'target-parent');
  fs.mkdirSync(sourceParent); fs.mkdirSync(targetParent);
  const source = markedRoot(sourceParent);
  const sibling = `${source}-sibling/document.pdf`;
  put(path.join(source, 'library/nodus-library/item/metadata.json'), JSON.stringify({ sibling }));
  const result = clonePreparedResearchProfile({ sourceRoot: source, targetParent, sourceClosed: true, ...synthetic });
  const metadata = JSON.parse(fs.readFileSync(path.join(result.root, 'library/nodus-library/item/metadata.json'), 'utf8'));
  assert.equal(metadata.sibling, sibling);
});
