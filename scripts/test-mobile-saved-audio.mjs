import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-saved-audio')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-saved-audio-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url);
let database;
try {
  database = require('../electron/db/database.ts');
  const registry = require('../electron/vaults/vaultRegistry.ts');
  const first = registry.getActiveVault(), second = registry.createVault('Isolated other vault');
  const own = (vault, action) => registry.withOwningVault(vault.id, () => database.withVaultDatabase(vault.id, action));
  const audio = require('../electron/audio/audioService.ts');
  const {serveBridgeFile} = require('../electron/desktopBridge/files.ts');
  const {executeMobileOperation, registerMobileOperation} = require('../electron/desktopBridge/operations.ts');
  registerMobileOperation('audio:listClips', (_event,kind,id) => audio.listEntityClips(kind,id));
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 973, 0x12);
  const clips = [];
  for (const kind of ['deep_research','immersion','study_document','study_transcript']) {
    clips.push(await own(first, () => audio.saveClip(kind,'opaque-entity',{segmentIndex:0,segmentLabel:kind,provider:'piper',voice:'fixture',language:'es',bytes})));
  }
  async function request(vault, id, action='descriptor', query='', domains=['corpus'], method='GET') {
    let status, payload, headers;
    await serveBridgeFile({method},{writeHead(code,value){status=code;headers=value;},end(value){payload=value;}},
      new URL('https://localhost/file'+query),vault.id,domains,'audioClip',id,action);
    return {status,payload,headers};
  }
  for (const clip of clips) {
    const domains = clip.entityKind === 'study_transcript' ? ['corpus','study-recordings'] : ['corpus'];
    const response = await request(first,clip.id,'descriptor','',domains); assert.equal(response.status,200);
    const descriptor = JSON.parse(response.payload);
    assert.equal(descriptor.kind,'audioClip');assert.equal(descriptor.byteSize,bytes.length);
    assert.equal(descriptor.sha256,createHash('sha256').update(bytes).digest('hex'));
    const start = await request(first,clip.id,'content','',domains);
    const end = await request(first,clip.id,'content','?offset=4194304&limit=973',domains);
    assert.deepEqual(Buffer.concat([start.payload,end.payload]),bytes);
    assert.equal(end.headers['x-nodus-file-offset'],'4194304');
    assert.equal((await request(second,clip.id)).status,404,'A registered clip never crosses vault ownership');
    assert.equal((await request(first,clip.id,'content','',[])).status,403);
    assert.equal((await request(first,clip.id,'content','?offset=-1',domains)).status,416);
    assert.equal((await request(first,clip.id,'content','?limit=99999999',domains)).status,416);
    assert.equal((await request(first,clip.id,'content','',domains,'HEAD')).payload,undefined);
    const list = await executeMobileOperation(first.id,domains,'listAudioClips',[clip.entityKind,'opaque-entity']);
    assert.equal(list.length,1);assert.equal(list[0].id,clip.id);
  }
  await assert.rejects(executeMobileOperation(first.id,['corpus'],'listAudioClips',['study_transcript','opaque-entity']),/permission_denied/);
  assert.equal((await request(first,clips[3].id)).status,403);
  for (const args of [[],['invalid','entity'],['deep_research',''],['deep_research','entity','extra']]) {
    await assert.rejects(executeMobileOperation(first.id,['corpus'],'listAudioClips',args),/invalid_arguments/);
  }
  const clip = clips[0];
  const outside = path.join(root,'outside-secret.wav');fs.writeFileSync(outside,'private test content');
  await own(first, () => database.getDb().prepare('UPDATE audio_clips SET file_name=? WHERE id=?').run('../outside-secret.wav',clip.id));
  assert.equal((await request(first,clip.id)).status,403);
  await own(first, () => database.getDb().prepare('UPDATE audio_clips SET file_name=? WHERE id=?').run('outside-link.wav',clip.id));
  const audioFolder = await own(first, () => path.join(registry.activeVaultDir(), 'audio'));
  fs.symlinkSync(outside,path.join(audioFolder,'outside-link.wav'));
  assert.equal((await request(first,clip.id)).status,403,'A symlink cannot expose a file outside the vault audio directory');
  await own(first, () => database.getDb().prepare('UPDATE audio_clips SET file_name=? WHERE id=?').run('missing.wav',clip.id));
  assert.equal((await request(first,clip.id)).status,410);
  assert.equal((await request(first,'missing')).status,404);
  console.log(JSON.stringify({suite:'mobile-saved-audio',result:'passed',actualVaults:2,clipKinds:4,
    chunkedLargeFile:true,transcriptPermission:true,opaqueIdentity:true,missingVisible:true,pathAndSymlinkIsolation:true}));
} finally { database?.closeDb();fs.rmSync(root,{recursive:true,force:true}); }
