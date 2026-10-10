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
for (const spec of Object.values(BRIDGE_FILE_KINDS)) {
  db.exec(`CREATE TABLE ${spec.table} (${spec.id} TEXT PRIMARY KEY, ${spec.name} TEXT, mime_type TEXT, ${spec.blob} BLOB${spec.deleted ? ', deleted_at TEXT' : ''}${spec.path ? `, ${spec.path} TEXT` : ''})`);
  db.prepare(`INSERT INTO ${spec.table} (${spec.id},${spec.name},mime_type,${spec.blob}) VALUES (?,?,?,?)`).run('opaque-id','source.bin','application/octet-stream',bytes);
  db.prepare(`INSERT INTO ${spec.table} (${spec.id},${spec.name},mime_type) VALUES (?,?,?)`).run('removed','removed.bin','application/octet-stream');
}
async function request(kind, domains, action, id='opaque-id', query='') {
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
    assert.equal((await request(kind,[spec.domain],'descriptor','removed')).status,410);
    assert.equal((await request(kind,[spec.domain],'content','missing')).status,404);
    for (const query of ['?offset=-1','?offset=1.5','?offset=99999999','?limit=99999999','?limit=0']) assert.equal((await request(kind,[spec.domain],'content','opaque-id',query)).status,416);
  }
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
