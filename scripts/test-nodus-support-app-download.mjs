import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import archiver from 'archiver';
import {SupportAppInstallation,verifySystemSupport} from '../apps/nodus-support/core/app-installation.mjs';
import {inventory} from '../apps/nodus-support/core/files.mjs';
import {verifySupportApp,supportContentDigest,supportInstallerFormat,selectSupportInstaller,resolveSupportApp} from '../shared/support/appDistribution.mjs';
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),keys=[{keyId:'fixture',publicKeyPem:publicKey.export({type:'spki',format:'pem'})}];
const envelope=value=>{const payload=Buffer.from(JSON.stringify(value));return {keyId:'fixture',payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};};
async function fixture() {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-app-install-'))),source=path.join(root,'source'),storage=path.join(root,'support-installations');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'nodus-support'),'independent executable');fs.writeFileSync(path.join(source,'personal-original'),'must remain');fs.mkdirSync(path.join(source,'resources/app'),{recursive:true});fs.writeFileSync(path.join(source,'resources/app/package.json'),JSON.stringify({name:'nodus-support',version:'5.13.0'}));
 const zipFile=path.join(root,'fixture.zip');await new Promise((resolve,reject)=>{const out=fs.createWriteStream(zipFile),zip=archiver('zip');out.once('close',resolve);zip.once('error',reject);zip.pipe(out);zip.directory(source,false);void zip.finalize();});
 const zip=fs.readFileSync(zipFile),artifact={name:'Nodus-Support-Runtime-linux-x64.zip',format:'zip',platformSignature:'none',bytes:zip.length,sha256:createHash('sha256').update(zip).digest('hex'),url:'https://github.com/jorgepb96/nodus/releases/download/v5.13.0/Nodus-Support-Runtime-linux-x64.zip'};
 const manifest={format:'nodus.support-app/1',protocol:1,version:'5.13.0',platform:'linux',arch:'x64',executable:'nodus-support',expandedBytes:(await inventory(source)).bytes,contentSha256:supportContentDigest(await inventory(source)),runtime:artifact,installers:[{...artifact,format:'AppImage'}]};
 const manager=new SupportAppInstallation({storage,keys,platform:'linux',arch:'x64'});
 return {root,source,storage,manifest,manager,zip,fetch:async()=>new Response(zip)};
}

test('Support selects Windows, both Mac architectures and each Linux installation format',()=>{
 assert.equal(supportInstallerFormat('win32'),'nsis');assert.equal(supportInstallerFormat('darwin'),'dmg');
 assert.equal(supportInstallerFormat('linux',{appImage:true,deb:true}),'AppImage');assert.equal(supportInstallerFormat('linux',{deb:true}),'deb');assert.equal(supportInstallerFormat('linux',{rpm:true}),'rpm');assert.equal(supportInstallerFormat('linux'),'AppImage');
 assert.throws(()=>supportInstallerFormat('freebsd'),/UNSUPPORTED/);
});
test('downloaded Support is independent, persistent, opens offline and retains damaged updates and earlier versions',async()=>{
 const f=await fixture();try {
  const before=await inventory(f.source),first=await f.manager.install(envelope(f.manifest),{fetch:f.fetch});assert.notEqual(first.executable,path.join(f.source,'nodus-support'));
  const second=await f.manager.install(envelope(f.manifest),{fetch:f.fetch});assert.notEqual(second.executable,first.executable);
  fs.writeFileSync(second.executable,'damaged update');assert.equal((await f.manager.current()).executable,first.executable);assert.equal(fs.readFileSync(second.executable,'utf8'),'damaged update');
  assert.deepEqual(await inventory(f.source),before);assert.equal(fs.readdirSync(f.storage).length,2);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('signed contents, OS and architecture are checked, including after local installation records are edited',async()=>{
 const f=await fixture();try {
  const signed=envelope(f.manifest);assert.equal(verifySupportApp(signed,keys,'linux','x64').version,'5.13.0');assert.throws(()=>verifySupportApp(signed,keys,'linux','arm64'));assert.throws(()=>verifySupportApp({...signed,signature:'bad'},keys,'linux','x64'));
  const installed=await f.manager.install(signed,{fetch:f.fetch});fs.writeFileSync(installed.executable,'modified executable');
  const record=path.join(path.dirname(path.dirname(installed.executable)),'installed.json'),value=JSON.parse(fs.readFileSync(record,'utf8'));value.inventory=await inventory(path.dirname(installed.executable));fs.writeFileSync(record,JSON.stringify(value));assert.equal(await f.manager.current(),null);
  await assert.rejects(f.manager.install(envelope({...f.manifest,contentSha256:'a'.repeat(64)}),{fetch:f.fetch}),/SUPPORT_DOWNLOAD_INVALID/);
  await assert.rejects(f.manager.install(signed,{fetch:async()=>new Response('wrong bytes')}),/DOWNLOAD_HASH_MISMATCH/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('stopping a download retains a partial attempt and does not hide a verified installed copy',async()=>{
 const f=await fixture();try {
  const first=await f.manager.install(envelope(f.manifest),{fetch:f.fetch}),abort=new AbortController();
  await assert.rejects(f.manager.install(envelope(f.manifest),{signal:abort.signal,fetch:async()=>{abort.abort();abort.signal.throwIfAborted();}}));
  assert.equal((await f.manager.current()).executable,first.executable);assert.equal(fs.readdirSync(f.storage).length,2);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('Support waits for post-publication assets, validates the exact tag, and never serves beta builds to stable Nodus',async()=>{
 const f=await fixture();try {
  const urls=[],signed=envelope(f.manifest),fetch=async url=>{urls.push(url);return new Response(JSON.stringify(url.includes('api.github.com')?{tag_name:'v5.13.0',draft:false,prerelease:false}:signed));};
  assert.equal((await resolveSupportApp('5.12.0',keys,'linux','x64',{fetch})).manifest.version,'5.13.0');assert.ok(urls[1].includes('/v5.13.0/nodus-support-app-linux-x64.json'));
  await assert.rejects(resolveSupportApp('5.12.0',keys,'linux','x64',{fetch:async url=>url.includes('api.github.com')?fetch(url):new Response('',{status:404})}),/SUPPORT_ASSET_PENDING/);
  await assert.rejects(resolveSupportApp('5.12.0',keys,'linux','x64',{fetch:async()=>new Response(JSON.stringify({tag_name:'v5.13.0-beta.1',draft:false,prerelease:true}))}),/SUPPORT_ASSET_PENDING/);
  assert.throws(()=>selectSupportInstaller(f.manifest,'deb'),/SUPPORT_ASSET_PENDING/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('native installations are accepted only when their actual content matches the signed app',async()=>{
 const f=await fixture();try {
  const executable=path.join(f.source,'nodus-support'),signed=envelope(f.manifest);
  assert.equal((await verifySystemSupport(executable,signed,{keys,platform:'linux',arch:'x64'})).manifest.version,'5.13.0');
  fs.writeFileSync(path.join(f.source,'resources/app/package.json'),JSON.stringify({name:'nodus-support',version:'5.12.0'}));
  await assert.rejects(verifySystemSupport(executable,signed,{keys,platform:'linux',arch:'x64'}),/SUPPORT_DOWNLOAD_INVALID/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
