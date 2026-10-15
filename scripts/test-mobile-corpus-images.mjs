import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-corpus-images')) process.exit(0);
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'nodus-corpus-images-'));
const runtime = installRuntimeHooks(directory); runtime.app.on=()=>{}; runtime.app.once=()=>{};
const require = createRequire(import.meta.url), originalFetch = globalThis.fetch;
globalThis.fetch = async()=>{throw new Error('Image transport must not call a provider or external URL');};
let database;
try {
  database = require('../electron/db/database.ts'); const db = database.getDb();
  const {getActiveVault,createVault} = require('../electron/vaults/vaultRegistry.ts');
  const first = getActiveVault(), other = createVault('Bóveda aislada');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=','base64'), stamp = '2026-10-11T00:00:00Z';
  db.prepare('INSERT INTO persons(person_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('person/37','Persona',stamp,stamp);
  db.prepare('INSERT INTO person_portraits(person_id,blob,mime,updated_at) VALUES(?,?,?,?)').run('person/37',png,'image/png',stamp);
  const {serveBridgeFile} = require('../electron/desktopBridge/files.ts');
  async function read(vault,source,action='descriptor',domains=['corpus'],query='') {
    let status,payload,headers;
    await serveBridgeFile({method:'GET'},{writeHead(code,value){status=code;headers=value;},end(value){payload=value;}},new URL('https://localhost/file'+query),vault.id,domains,'corpusImage',source,action);
    return {status,payload,headers};
  }
  const source = 'nodus-image://portrait/person%2F37?v=2';
  const meta = await read(first,source); assert.equal(meta.status,200);
  const descriptor = JSON.parse(meta.payload); assert.equal(descriptor.sha256,createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(descriptor.requiredDomains,['corpus']);
  const content = await read(first,source,'content',['corpus'],`?offset=0&limit=${png.length}`);
  assert.equal(content.status,200); assert.deepEqual(content.payload,png); assert.equal(content.headers['x-nodus-file-size'],String(png.length));
  assert.equal((await read(other,source)).status,404);
  assert.equal((await read(first,'https://example.com/file')).status,400);
  assert.equal((await read(first,'nodus-image://portrait/person?file=/private')).status,400);
  assert.equal((await read(first,source,'descriptor',[])).status,403);
  await database.withVaultDatabase(first.id,()=>database.getDb().prepare('INSERT INTO prosop_person_profiles(person_id,created_at,updated_at) VALUES(?,?,?)').run('person/37',stamp,stamp));
  assert.equal((await read(first,source)).status,403);
  const privateMeta = JSON.parse((await read(first,source,'descriptor',['corpus','prosopography-private'])).payload);
  assert.deepEqual(privateMeta.requiredDomains,['corpus','prosopography-private']);
  const {chatAssetOwner,storeChatImage} = require('../electron/chatAssets.ts');
  await database.withVaultDatabase(first.id,()=>database.getDb().prepare('INSERT INTO chat_conversations(id,created_at,updated_at) VALUES(?,?,?)').run('conversation',stamp,stamp));
  const chat = storeChatImage(chatAssetOwner('assistant','conversation',first.id),{bytes:png,mimeType:'image/png'},{title:'Nodus'});
  assert.equal((await read(first,chat)).status,200); assert.equal((await read(other,chat)).status,403);
  const figureOwner = chatAssetOwner('document-figure','immersion:session:revision:figure',first.id);
  const figureImage = storeChatImage(figureOwner,{bytes:png,mimeType:'image/png'},{title:'Figura guardada'});
  await database.withVaultDatabase(first.id,()=>database.getDb().prepare('INSERT INTO immersion_sessions(id,topic,title,language,minutes,plan_json,progress_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('session','Tema','Recorrido','es',20,'{}','{}',stamp,stamp));
  const {writeDocumentVisuals} = require('../electron/capabilities/documentStore.ts');
  writeDocumentVisuals({schemaVersion:1,vaultId:first.id,target:{kind:'immersion',id:'session'},contentHash:'source',revision:'revision',createdAt:stamp,updatedAt:stamp,state:'ready',policy:{enabled:true,skills:[]},usage:{},
    blocks:[{id:'block',field:'content',index:0,endLine:1,markdown:'Texto'}],figures:[{id:'figure',skillId:'fixture',brief:'Figura conservada',layout:'wide',state:'ready',caption:'Figura guardada',sources:[],blockId:'block',owner:figureOwner}]});
  assert.equal((await read(first,figureImage)).status,200); assert.equal((await read(other,figureImage)).status,403);
  console.log('Scoped image identity, original bytes, ranges, domain revocation and foreign vault rejection contracts passed.');
} finally {
  globalThis.fetch=originalFetch; database?.closeDb(); runtime.restore(); fs.rmSync(directory,{recursive:true,force:true});
}
