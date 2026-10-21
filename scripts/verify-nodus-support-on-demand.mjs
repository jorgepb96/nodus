// Native managed-download test. Uses an ephemeral TEST signing key and synthetic data.
// Production platform signatures are mandatory in support-app-release/supportDistribution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import archiver from 'archiver';
import yauzl from 'yauzl';
import {_electron} from 'playwright-core';
import {SupportAppInstallation} from '../apps/nodus-support/core/app-installation.mjs';
import {inventory,hashFile} from '../apps/nodus-support/core/files.mjs';
import {extractRuntime} from '../apps/nodus-support/core/releases.mjs';
import {supportContentDigest} from '../shared/support/appDistribution.mjs';
import {executableArchitectures} from '../apps/nodus-support/core/installation.mjs';
const repo=path.resolve(import.meta.dirname,'..'),scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-on-demand-native-')));
const mac=process.platform==='darwin',source=mac?path.join(repo,'release-support',process.arch==='arm64'?'mac-arm64':'mac','nodus-support.app'):path.join(repo,'release-support',process.platform==='win32'?'win-unpacked':'linux-unpacked');
const archive=path.join(scratch,'runtime.zip');
await new Promise((resolve,reject)=>{
 const out=fs.createWriteStream(archive),zip=archiver('zip',{forceZip64:true,zlib:{level:1}});out.on('close',resolve);out.on('error',reject);zip.on('error',reject);zip.pipe(out);
 function walk(folder,relative){for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),entry=relative?`${relative}/${name}`:name,stat=fs.lstatSync(file);if(stat.isSymbolicLink())zip.symlink(entry,fs.readlinkSync(file),stat.mode);else if(stat.isDirectory()){zip.append('',{name:entry+'/',mode:stat.mode});walk(file,entry);}else zip.file(file,{name:entry,mode:stat.mode});}}
 if(mac)zip.append('',{name:'nodus-support.app/',mode:0o700});walk(source,mac?'nodus-support.app':'');void zip.finalize();
});
const verification=path.join(scratch,'verification');await extractRuntime(archive,verification,yauzl.open);const contents=await inventory(verification,undefined,undefined,{links:true});
const version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version,name=`Nodus-Support-Runtime-${process.platform}-${process.arch}.zip`;
const artifact={name,format:'zip',platformSignature:mac?'macos-notarized':'none',bytes:fs.statSync(archive).size,sha256:await hashFile(archive),url:`https://github.com/jorgepb96/nodus/releases/download/v${version}/${name}`};
const executable=mac?'nodus-support.app/Contents/MacOS/nodus-support':process.platform==='win32'?'nodus-support.exe':'nodus-support';
const manifest={format:'nodus.support-app/1',protocol:1,version,platform:process.platform,arch:process.arch,executable,expandedBytes:contents.bytes,contentSha256:supportContentDigest(contents),runtime:artifact,installers:[{...artifact,format:mac?'dmg':process.platform==='win32'?'nsis':'AppImage'}]};
const pair=generateKeyPairSync('ed25519'),keys=[{keyId:'native-test-only',publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'})}],payload=Buffer.from(JSON.stringify(manifest));
const envelope={keyId:keys[0].keyId,payload:payload.toString('base64'),signature:sign(null,payload,pair.privateKey).toString('base64')};
const manager=new SupportAppInstallation({storage:path.join(scratch,'independent-apps'),keys,platform:process.platform,arch:process.arch,verifyPlatform:async file=>assert.ok(executableArchitectures(file).includes(process.arch))});
const installed=await manager.install(envelope,{fetch:async()=>new Response(Readable.toWeb(fs.createReadStream(archive)))});assert.equal((await manager.current()).executable,installed.executable);
const profile=path.join(scratch,'original-profile');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'app-prefs.json'),'{"uiLanguage":"en"}');fs.writeFileSync(path.join(profile,'private-note.txt'),'private synthetic content');const before=await inventory(profile);
const stateRoot=path.join(scratch,'support-state'),token=randomUUID(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
// Disposable Linux CI has user namespaces disabled. Provision the same trusted
// root-owned sandbox a native DEB/RPM installation supplies; never disable it.
if(process.platform==='linux'&&process.env.CI==='true') {
 const helper=path.join(repo,'node_modules/electron/dist/chrome-sandbox'),stat=fs.statSync(helper);
 assert.equal(stat.uid,0);assert.ok(stat.mode&0o4000);env.CHROME_DEVEL_SANDBOX=helper;
}
const args=[`--support-state=${stateRoot}`,`--nodus-profile=${profile}`,`--nodus-executable=${path.join(scratch,'missing-nodus')}`,`--nodus-version=${version}`];
const child=spawn(installed.executable,[...args,`--support-launch-token=${token}`],{env,stdio:['ignore','ignore','pipe']});let error,stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});child.on('error',value=>{error=value;});
const receipt=path.join(stateRoot,'launch-receipts',`${token}.json`),deadline=Date.now()+90000;let ready;
try {
 while(Date.now()<deadline){if(error)throw error;try{ready=JSON.parse(fs.readFileSync(receipt,'utf8'));break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.equal(ready?.token,token,`Real self-retaining startup must acknowledge readiness; exit=${child.exitCode}, signal=${child.signalCode}; ${stderr}`);assert.equal(ready.format,'nodus.support-ready/1');assert.ok(fs.existsSync(path.join(stateRoot,'runtimes')));
 assert.deepEqual(await inventory(profile),before);console.log(`Managed Support download + real self-retention + launch receipt passed: ${process.platform}/${process.arch}.`);
}finally{if(ready?.pid)try{process.kill(ready.pid,'SIGTERM');}catch{}else child.kill();}
// A separate controlled window proves the actual installed renderer can inspect the source.
const app=await _electron.launch({executablePath:installed.executable,args:['--support-retained=1',...args,`--support-state=${path.join(scratch,'renderer-state')}`].filter((arg,index,all)=>!arg.startsWith('--support-state=')||index===all.length-1),env,chromiumSandbox:true,timeout:60000});
try {
 const page=await app.firstWindow();await page.locator('h1').waitFor();const state=await page.evaluate(()=>window.nodusSupport.inspect());assert.equal(state.inspection.profile,profile);
 // The main Nodus process is Electron too: its managed installer must see whole
 // physical ASAR files, rather than Electron's virtual directory/stat metadata.
 const electronFixture=path.join(scratch,'electron-main-installer.cjs');
 // Compile a test-only CJS entry: Playwright's evaluator has no dynamic-import callback.
 const {build}=await import('esbuild');
 await build({stdin:{contents:`const fs=require('node:fs'),{Readable}=require('node:stream');const {SupportAppInstallation}=require(${JSON.stringify(path.join(repo,'apps/nodus-support/core/app-installation.mjs'))});module.exports=async(input)=>{const manager=new SupportAppInstallation({storage:input.storage,keys:input.keys,platform:process.platform,arch:process.arch});const installed=await manager.install(input.envelope,{fetch:async()=>new Response(Readable.toWeb(fs.createReadStream(input.archive)))});return (await manager.current())?.executable===installed.executable;};`,resolveDir:repo},outfile:electronFixture,bundle:true,platform:'node',format:'cjs',external:['original-fs'],define:{'import.meta.url':JSON.stringify(pathToFileURL(path.join(repo,'apps/nodus-support/core/files.mjs')).href)}});
 const installedInElectron=await app.evaluate(async(_electron,input)=>{
   const Module=process.getBuiltinModule('module');
   const execute=Module.createRequire(input.fixture)(input.fixture);return execute(input);
 },{fixture:electronFixture,storage:path.join(scratch,'electron-managed-apps'),keys,envelope,archive});
 assert.equal(installedInElectron,true);assert.deepEqual(await inventory(profile),before);
 console.log('Managed installation and signed content verification inside the actual Electron main process passed.');
}finally{await app.close();}
const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}-on-demand.json`),JSON.stringify({format:'nodus.support-distribution-evidence/1',managedInstallation:true,electronMainInstallation:true,ephemeralTestKey:true,contentVerified:true,retainedRuntime:true,startupReceipt:true,originalProfileUnchanged:true}));
