import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-source-files')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-source-files-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url);
let database, calls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { calls++; throw new Error('Opening a source must never call a provider'); };
try {
  database = require('../electron/db/database.ts');
  const {getActiveVault, createVault, withOwningVault} = require('../electron/vaults/vaultRegistry.ts');
  const first = getActiveVault(), second = createVault('Otra bóveda ficticia');
  const {writeGlobalPrefsRaw} = require('../electron/db/appPrefs.ts');
  const {LibraryDiskStore} = require('../electron/library/libraryStorage.ts');
  writeGlobalPrefsRaw({autoBackupFolder:path.join(root,'backups')});
  const store = new LibraryDiskStore(path.join(root,'backups/nodus-library'), 'fixture-device'); store.initialize();
  const folder = store.itemFolder('source-fixture'); fs.mkdirSync(folder,{recursive:true});
  const original = Buffer.alloc(4 * 1024 * 1024 + 731, 0x61); original.write('%PDF-1.7\n');
  const supplement = Buffer.from('Adjunto íntegro con nombre y contenido propios.');
  fs.writeFileSync(path.join(folder,'original.pdf'),original); fs.writeFileSync(path.join(folder,'supplement.txt'),supplement);
  fs.writeFileSync(path.join(folder,'reader.md'),'# Fuente ficticia\n\nCopia limpia guardada.');
  const id = 'nodus:source-fixture';
  store.upsertItem({id, storageId:'source-fixture',source:'nodus',metadata:{title:'Fuente ficticia',itemType:'report',creators:[],tags:[]},
    collectionIds:[],files:{reader:'reader.md',original:'original.pdf'},extraction:{status:'ready'},attachments:[
      {id:'supplement:with/slash',title:'Adjunto',fileName:'supplement.txt',relativePath:'supplement.txt',mimeType:'text/plain',byteSize:supplement.length,
        sha256:createHash('sha256').update(supplement).digest('hex'),role:'supplement',position:0}
    ]});
  await database.withVaultDatabase(first.id, () => database.getDb().prepare('INSERT INTO works(nodus_id,zotero_key,title,authors_json) VALUES(?,?,?,?)').run(id,'ACCFIXTURE','Fuente ficticia','[]'));
  const {serveBridgeFile} = require('../electron/desktopBridge/files.ts');
  async function request(vault, kind, identity, action, query='', domains=['corpus'], method='GET') {
    let status, payload, headers;
    await serveBridgeFile({method},{writeHead(code,fields){status=code;headers=fields;},end(body){payload=body;}},new URL('https://localhost/file'+query),vault.id,domains,kind,identity,action);
    return {status,payload,headers};
  }
  const descriptor = await request(first,'libraryOriginal',id,'descriptor'); assert.equal(descriptor.status,200);
  const metadata = JSON.parse(descriptor.payload);
  assert.equal(metadata.sha256,createHash('sha256').update(original).digest('hex')); assert.equal(metadata.filename,'original.pdf'); assert.equal(metadata.byteSize,original.length);
  const firstChunk = await request(first,'libraryOriginal',id,'content');
  const lastChunk = await request(first,'libraryOriginal',id,'content','?offset=4194304&limit=731');
  assert.deepEqual(Buffer.concat([firstChunk.payload,lastChunk.payload]),original);
  assert.equal(lastChunk.headers['x-nodus-file-offset'],'4194304');
  const identity = JSON.stringify([id,'supplement:with/slash']);
  const attachment = await request(first,'libraryAttachment',identity,'descriptor'); assert.equal(attachment.status,200);
  assert.equal(JSON.parse(attachment.payload).filename,'supplement.txt');
  assert.deepEqual((await request(first,'libraryAttachment',identity,'content')).payload,supplement);
  for (const kind of ['libraryOriginal','libraryAttachment']) {
    const record = kind === 'libraryOriginal' ? id : identity;
    assert.equal((await request(second,kind,record,'descriptor')).status,403,'The active global library does not grant a different vault access');
    assert.equal((await request(first,kind,record,'content','',[])).status,403);
    assert.equal((await request(first,kind,record,'content','?offset=-1')).status,416);
    assert.equal((await request(first,kind,record,'content','?limit=99999999')).status,416);
    assert.equal((await request(first,kind,record,'content','',['corpus'],'HEAD')).payload,undefined);
  }
  for (const malformed of ['../../private','[]','["one"]','["one",3]','["", "file"]']) assert.equal((await request(first,'libraryAttachment',malformed,'descriptor')).status,400);
  assert.equal((await request(first,'libraryAttachment',JSON.stringify([id,'../../private']),'descriptor')).status,404);
  fs.unlinkSync(path.join(folder,'original.pdf'));
  assert.ok([404,410].includes((await request(first,'libraryOriginal',id,'descriptor')).status));
  assert.equal(calls,0);
  console.log(JSON.stringify({passed:true,sourceOriginal:true,sourceAttachment:true,chunkedBytesAndHashes:true,isolatedVaults:2,
    crossVaultAndMissingGrantRefused:true,opaqueAttachmentIdentity:true,missingFilesAreErrors:true,providerCalls:calls,releaseApproved:false}));
} finally {
  globalThis.fetch = previousFetch; try {database?.closeDb();} catch {} fs.rmSync(root,{recursive:true,force:true});
}
