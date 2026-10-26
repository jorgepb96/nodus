import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-whole-workspace'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-whole-workspace-'));
// Exercise the renderer's real preload boundary too: dropping its fifth argument
// silently turns the simple workspace link into a frozen list of current vaults.
const runtime=installRuntimeHooks(root,{ipcRenderer:{invoke:async(channel,...args)=>{
 assert.equal(channel,'desktopBridge:offer');
 return bridge.createDesktopBridgeOffer(...args);
}}});runtime.app.on=()=>{};runtime.app.once=()=>{};runtime.safeStorage.isEncryptionAvailable=()=>true;
const require=createRequire(import.meta.url),cert=path.join(root,'test.crt'),key=path.join(root,'test.key');
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
function stub(module,exports){const id=require.resolve(module);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../electron/localServer/lanCert.ts',{ensureLanCert:async()=>({certPath:cert,keyPath:key}),lanAddresses:()=>['127.0.0.1']});
stub('../electron/serverSync/serverSyncShared.ts',{listVaultConfigs:()=>[]});
const vaults=require('../electron/vaults/vaultRegistry.ts'),database=require('../electron/db/database.ts'),bridge=require('../electron/desktopBridge/server.ts');
const agent=new https.Agent({ca:fs.readFileSync(cert)}),token=()=>randomBytes(32).toString('base64url');let origin;
async function request(route,method='GET',body,bearer){const text=body===undefined?undefined:JSON.stringify(body);return new Promise((resolve,reject)=>{const req=https.request(new URL(route,origin),{agent,method,headers:{...(text?{'content-type':'application/json'}:{}),...(bearer?{authorization:`Bearer ${bearer}`}:{})}},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString())});}catch(e){reject(e);}});});req.setTimeout(20000,()=>req.destroy(new Error('contract_timeout')));req.on('error',reject);req.end(text);});}
async function pair(offer,bearer){const next=token();const result=await request('/bridge/v1/pair','POST',{code:offer.code,deviceId:offer.id,deviceName:'Isolated contract',nextToken:next},bearer);assert.equal(result.status,201);return {id:result.body.pairing.id,token:next,pairing:result.body.pairing};}
const caps=async grant=>{const r=await request('/bridge/v2/capabilities','GET',undefined,grant.token);assert.equal(r.status,200);return r.body;};
try{
 const initial=vaults.getActiveVault();database.withVaultDatabase(initial.id,()=>database.getDb().prepare('SELECT 1').get());const second=vaults.createVault('Existing second fixture');vaults.setActiveVault(initial.id);
 assert.ok(vaults.listVaults().every(v=>fs.realpathSync(v.path).startsWith(fs.realpathSync(root)+path.sep)));
 const {platformApi}=require('../electron/preload/platform.ts');
 const wholeOffer=await platformApi.createDesktopBridgeOffer([initial.id],['corpus'],undefined,'direct',{wholeWorkspace:true});origin=`https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
 assert.equal(wholeOffer.wholeWorkspace,true);assert.ok(wholeOffer.vaultIds.includes(second.id));
 const envelope=JSON.parse(Buffer.from(new URL(wholeOffer.pairingURL).searchParams.get('offer'),'base64url'));assert.equal(envelope.wholeWorkspace,true);
 const whole=await pair(wholeOffer),legacy=await pair(await bridge.createDesktopBridgeOffer([initial.id],['corpus'],undefined,'direct')),explicitFalse=await pair(await bridge.createDesktopBridgeOffer([initial.id],['corpus'],undefined,'direct',{wholeWorkspace:false}));
 assert.equal(legacy.pairing.wholeWorkspace,undefined);assert.equal(explicitFalse.pairing.wholeWorkspace,false);
 const future=vaults.createVault('Future fixture','databases');vaults.setActiveVault(initial.id);
 const current=await caps(whole);assert.equal(current.wholeWorkspace,true);assert.ok(current.vaultIds.includes(future.id));assert.equal(current.vaults.find(v=>v.id===future.id).type,'databases');assert.deepEqual(current.domains,['corpus']);
 assert.ok(!(await caps(legacy)).vaultIds.includes(future.id));assert.ok(!(await caps(explicitFalse)).vaultIds.includes(future.id));
 const route=`/bridge/v2/vaults/${encodeURIComponent(future.id)}/corpus/snapshot`;
 assert.equal((await request(route,'GET',undefined,whole.token)).status,200,'New real canonical vault is readable with explicit dynamic grant');
 assert.equal((await request(route,'GET',undefined,legacy.token)).status,403);assert.equal((await request(route,'GET',undefined,explicitFalse.token)).status,403);
 assert.equal((await request(`/bridge/v2/vaults/${future.id}/teaching-roster/sources/teaching_students`,'GET',undefined,whole.token)).status,403,'Whole workspace never adds private domains');
 assert.equal((await request(`/bridge/v2/vaults/${future.id}/workspace-edits`,'POST',{},whole.token)).status,403,'Whole corpus grant never gains writing');
 const wholeRenewal=await bridge.createDesktopBridgeOffer([],[],whole.id,'direct',{wholeWorkspace:false});assert.equal(wholeRenewal.wholeWorkspace,true);assert.deepEqual(wholeRenewal.domains,['corpus']);const wholeRenewed=await pair(wholeRenewal,whole.token);assert.equal(wholeRenewed.id,whole.id);assert.equal(wholeRenewed.pairing.wholeWorkspace,true);whole.token=wholeRenewed.token;
 const legacyRenewal=await bridge.createDesktopBridgeOffer([future.id],['corpus','writing'],legacy.id,'direct',{wholeWorkspace:true});assert.equal(legacyRenewal.wholeWorkspace,undefined);assert.deepEqual(legacyRenewal.vaultIds,[initial.id]);assert.deepEqual(legacyRenewal.domains,['corpus']);const oldRenewed=await pair(legacyRenewal,legacy.token);legacy.token=oldRenewed.token;assert.equal(oldRenewed.id,legacy.id);assert.equal(oldRenewed.pairing.wholeWorkspace,undefined);
 await bridge.stopDesktopBridge();await bridge.resumeDesktopBridge();origin=`https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
 assert.ok((await caps(whole)).vaultIds.includes(future.id));assert.ok(!(await caps(legacy)).vaultIds.includes(future.id));
 const rotated=token();assert.equal((await request('/bridge/v2/pairing/renew','POST',{nextToken:rotated},whole.token)).status,200);whole.token=rotated;assert.equal((await caps(whole)).wholeWorkspace,true);
 vaults.deleteVault(future.id,false);
 assert.ok(!(await caps(whole)).vaultIds.includes(future.id));assert.equal((await request(route,'GET',undefined,whole.token)).status,403,'Removal ceases access even when SQLite file remains');
 assert.equal((await request(`/bridge/v2/vaults/${current.deviceId}/jobs`,'GET',undefined,whole.token)).status,403,'Mac installation ID is not a vault ID');
 await assert.rejects(bridge.createDesktopBridgeOffer([initial.id],['corpus'],undefined,'direct',{wholeWorkspace:'true'}),/invalid_pairing_scope/);
 const stored=JSON.parse(runtime.safeStorage.decryptString(fs.readFileSync(path.join(root,'desktop-bridge','pairings.bin'))));assert.equal(stored.find(p=>p.id===whole.id).wholeWorkspace,true);assert.equal(stored.find(p=>p.id===legacy.id).wholeWorkspace,undefined);assert.equal(stored.find(p=>p.id===explicitFalse.id).wholeWorkspace,false);
 console.log(JSON.stringify({suite:'mobile-pairing-whole-workspace',passed:true,transport:'real HTTPS trusted isolated CA',productionPreloadScope:true,canonicalFutureVault:true,removedVaultWithRetainedFileDenied:true,legacyStatic:true,explicitFalseStatic:true,renewalNoEscalation:true,persistedRestart:true,domainNoEscalation:true,macIdentityNotVault:true,providerCalls:0}));
}finally{agent.destroy();await bridge.stopDesktopBridge();database.closeDb();fs.rmSync(root,{recursive:true,force:true});}
