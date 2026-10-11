import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-bridge-files')) process.exit(0);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-bridge-files-'));
installRuntimeHooks(temp);
const require = createRequire(import.meta.url), Database = require('better-sqlite3'), db = new Database(':memory:');
const databaseModule = require.resolve('../electron/db/database.ts');
require.cache[databaseModule] = { id: databaseModule, filename: databaseModule, loaded: true, exports: {
  getDb: () => db, withVaultDatabase: async (vault, callback) => { assert.equal(vault, 'isolated-vault'); return callback(); },
} };
const { BRIDGE_FILE_KINDS, serveBridgeFile } = require('../electron/desktopBridge/files.ts');
const bytes = Buffer.alloc(4 * 1024 * 1024 + 721, 0xab), sha256 = createHash('sha256').update(bytes).digest('hex');
for (const spec of Object.values(BRIDGE_FILE_KINDS).filter(spec=>!spec.mime)) {
  db.exec(`CREATE TABLE ${spec.table} (${spec.id} TEXT PRIMARY KEY, ${spec.name} TEXT, mime_type TEXT, ${spec.blob} BLOB${spec.deleted ? ', deleted_at TEXT' : ''}${spec.path ? `, ${spec.path} TEXT` : ''})`);
  db.prepare(`INSERT INTO ${spec.table} (${spec.id},${spec.name},mime_type,${spec.blob}) VALUES (?,?,?,?)`).run('opaque-id','source.bin','application/octet-stream',bytes);
  db.prepare(`INSERT INTO ${spec.table} (${spec.id},${spec.name},mime_type) VALUES (?,?,?)`).run('removed','removed.bin','application/octet-stream');
}
// Database attachments use both real storage variants and require a live parent row.
db.exec(`CREATE TABLE db_databases (id TEXT PRIMARY KEY);
CREATE TABLE db_rows (id TEXT PRIMARY KEY, database_id TEXT);
CREATE TABLE db_blobs (hash TEXT PRIMARY KEY, data BLOB, mime_type TEXT);
CREATE TABLE db_attachments (id TEXT PRIMARY KEY, row_id TEXT, file_name TEXT, mime_type TEXT, blob BLOB, blob_hash TEXT, position INTEGER DEFAULT 0)`);
db.prepare('INSERT INTO db_databases VALUES (?)').run('database');
db.prepare('INSERT INTO db_rows VALUES (?,?)').run('row','database');
db.prepare('INSERT INTO db_blobs VALUES (?,?,?)').run(sha256,bytes,'application/octet-stream');
const attachmentInsert=db.prepare('INSERT INTO db_attachments (id,row_id,file_name,mime_type,blob,blob_hash) VALUES (?,?,?,?,?,?)');
attachmentInsert.run('opaque-id','row','Original.bin','application/octet-stream',null,sha256);
attachmentInsert.run('inline-id','row','Inline.bin','application/octet-stream',bytes,null);
attachmentInsert.run('removed','row','Missing.bin','application/octet-stream',null,'missing-blob');
attachmentInsert.run('orphan','missing-row','Orphan.bin','application/octet-stream',bytes,null);
async function request(kind, domains, action, id='opaque-id', query='') {
  if(kind==='pageAsset')id=id==='opaque-id'?sha256:id==='removed'?'b'.repeat(64):id==='missing'?'c'.repeat(64):id;
  let status, payload, headers;
  await serveBridgeFile({method:'GET'}, {writeHead(code, fields){status=code;headers=fields;},end(body){payload=body;}},
    new URL('https://localhost/file'+query), 'isolated-vault', domains, kind, id, action);
  return {status, payload, headers};
}
try {
  for (const [kind, spec] of Object.entries(BRIDGE_FILE_KINDS)) {
    const descriptor = await request(kind,[spec.domain],'descriptor'); assert.equal(descriptor.status,200);
    const file = JSON.parse(descriptor.payload); assert.equal(file.sha256,sha256); assert.equal(file.byteSize,bytes.length);
    const first=await request(kind,[spec.domain],'content'); const second=await request(kind,[spec.domain],'content','opaque-id','?offset=4194304&limit=721');
    assert.deepEqual(Buffer.concat([first.payload,second.payload]),bytes);
    assert.equal(second.headers['x-nodus-file-offset'],'4194304');
    assert.equal((await request(kind,[],'content')).status,403);
    assert.equal((await request(kind,[spec.domain],'descriptor','removed')).status,kind==='pageAsset'?404:410);
    assert.equal((await request(kind,[spec.domain],'content','missing')).status,404);
    for (const query of ['?offset=-1','?offset=1.5','?offset=99999999','?limit=99999999','?limit=0']) assert.equal((await request(kind,[spec.domain],'content','opaque-id',query)).status,416);
  }
  assert.equal((await request('databaseAttachment',['corpus'],'descriptor','orphan')).status,404);
  const inline=JSON.parse((await request('databaseAttachment',['corpus'],'descriptor','inline-id')).payload);
  assert.equal(inline.sha256,sha256);assert.equal(inline.byteSize,bytes.length);
  const {mobileDossierFiles}=require('../electron/desktopBridge/dossierFiles.ts');
  const databaseCatalog=mobileDossierFiles('isolated-vault',['corpus'],{collection:'databases',id:'database'});
  assert.equal(databaseCatalog.files.length,3);assert(!databaseCatalog.files.some(file=>file.id==='orphan'));
  assert(databaseCatalog.files.find(file=>file.id==='opaque-id').available);
  assert(!databaseCatalog.files.find(file=>file.id==='removed').available);
  assert.throws(()=>mobileDossierFiles('isolated-vault',['corpus'],{collection:'databases',id:'foreign-database'}),/record_not_found/);
  assert.throws(()=>mobileDossierFiles('isolated-vault',['corpus'],{collection:'archive-items',id:'opaque-id'}),/permission_denied/);
  assert.throws(()=>mobileDossierFiles('isolated-vault',['corpus'],{collection:'db_attachments',id:'opaque-id'}),/invalid_arguments/);
  assert.throws(()=>mobileDossierFiles('isolated-vault',['corpus'],{collection:'databases',id:'database',path:'/tmp/private'}),/invalid_arguments/);
  db.exec(`ALTER TABLE study_material_versions ADD COLUMN material_id TEXT;
    ALTER TABLE study_material_versions ADD COLUMN version_no INTEGER;
    ALTER TABLE archive_item_files ADD COLUMN item_id TEXT;
    ALTER TABLE archive_item_files ADD COLUMN sequence_no INTEGER;
    ALTER TABLE archive_item_files ADD COLUMN version_no INTEGER`);
  db.prepare('UPDATE study_material_versions SET material_id=?,version_no=1 WHERE id=?').run('opaque-id','opaque-id');
  const studyCatalog=mobileDossierFiles('isolated-vault',['corpus'],{collection:'study-materials',id:'opaque-id'});
  assert.deepEqual(studyCatalog.files.map(file=>file.kind),['studyMaterial','studyMaterialVersion']);
  db.prepare('UPDATE archive_item_files SET item_id=?,sequence_no=1,version_no=1 WHERE file_id=?').run('opaque-id','opaque-id');
  const archiveCatalog=mobileDossierFiles('isolated-vault',['corpus','primary-source-files'],{collection:'archive-items',id:'opaque-id'});
  assert.deepEqual(archiveCatalog.files.map(file=>file.kind),['archiveItem','archiveFile']);
  assert(!JSON.stringify([databaseCatalog,studyCatalog,archiveCatalog]).includes('content_blob'));
  assert(!JSON.stringify(archiveCatalog).includes('external_path'));
  assert.equal((await request('studyRecording',['corpus'],'content')).status,403);
  assert.equal((await request('testimonyMedia',['study-recordings'],'content')).status,403);
  assert.equal((await request('archiveFile',['corpus'],'content')).status,403);
  assert.equal((await request('sqlite_master',['corpus'],'content')).status,403);
  const external=path.join(temp,'external-private-file.bin');fs.writeFileSync(external,bytes);
  for(const [kind,spec] of Object.entries(BRIDGE_FILE_KINDS).filter(([,spec])=>spec.path)) {
    db.prepare(`INSERT INTO ${spec.table} (${spec.id},${spec.name},mime_type,${spec.path}) VALUES (?,?,?,?)`).run('registered-external','external.bin','application/octet-stream',external);
    const descriptor=JSON.parse((await request(kind,[spec.domain],'descriptor','registered-external')).payload);
    assert.equal(descriptor.sha256,sha256);assert.equal(descriptor.byteSize,bytes.length);
    assert.deepEqual((await request(kind,[spec.domain],'content','registered-external','?offset=4194304&limit=721')).payload,bytes.subarray(4194304));
    assert.equal((await request(kind,[],'content','registered-external')).status,403);
    assert.equal((await request(kind,[spec.domain],'content','missing',`?path=${encodeURIComponent(external)}`)).status,404,'An input path never grants access to an unregistered file');
  }
  fs.unlinkSync(external);
  assert.equal((await request('archiveFile',['primary-source-files'],'descriptor','registered-external')).status,410,'An unavailable external file is an explicit error');
  db.prepare("UPDATE study_recordings SET deleted_at='now' WHERE id=?").run('opaque-id');
  assert.equal((await request('studyRecording',['study-recordings'],'content')).status,404);
  console.log('Passed: six file kinds, three registered external-file kinds, exact chunked bytes and hashes, scoped grants, deleted/missing content and invalid ranges.');
} finally { db.close(); fs.rmSync(temp,{recursive:true,force:true}); }
