import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-port-collision-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
runtime.safeStorage.isEncryptionAvailable=()=>true;
const require=createRequire(import.meta.url);
const cert=path.join(root,'test.crt'),key=path.join(root,'test.key');
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
function stub(module,exports){const id=require.resolve(module);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../electron/localServer/lanCert.ts',{ensureLanCert:async()=>({certPath:cert,keyPath:key}),lanAddresses:()=>['127.0.0.1']});
stub('../electron/vaults/vaultRegistry.ts',{getVault:id=>id==='vault-a'?{id,name:'Isolated fixture',type:'academic'}:null});
stub('../electron/serverSync/serverSyncShared.ts',{listVaultConfigs:()=>[]});
const bridge=require('../electron/desktopBridge/server.ts');
const {listenDesktopBridge}=require('../electron/desktopBridge/listen.ts');
const agent=new https.Agent({ca:fs.readFileSync(cert)});
let occupied;
function request(port,route,method='GET',body,token){
  return new Promise((resolve,reject)=>{
    const req=https.request(new URL(route,`https://127.0.0.1:${port}`),{agent,method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})}},response=>{
      const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(parts).toString())});}catch(error){reject(error);}});
    });req.setTimeout(5000,()=>req.destroy(new Error('contract_timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
async function close(server){if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
try {
  const offer=await bridge.createDesktopBridgeOffer(['vault-a'],['corpus','writing'],undefined,'direct');
  const initial=bridge.desktopBridgeStatus(),token=randomBytes(32).toString('base64url');
  const paired=await request(initial.port,'/bridge/v1/pair','POST',{code:offer.code,deviceId:'isolated-phone',deviceName:'Port collision contract',nextToken:token});
  assert.equal(paired.status,201);
  const beforeReceipt=await request(initial.port,'/bridge/v2/pairing','GET',undefined,token);assert.equal(beforeReceipt.status,200);
  const folder=path.join(root,'desktop-bridge'),identityFiles=['identity','server.crt','server.key','pairings.bin'];
  const identityBefore=new Map(identityFiles.map(file=>[file,fs.readFileSync(path.join(folder,file))]));
  await bridge.stopDesktopBridge();
  occupied=net.createServer();await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(initial.port,'0.0.0.0',resolve);});
  await bridge.resumeDesktopBridge();
  const resumed=bridge.desktopBridgeStatus();
  assert.equal(resumed.running,true);assert.notEqual(resumed.port,initial.port);
  assert.equal(Number(fs.readFileSync(path.join(folder,'port'),'utf8')),resumed.port);
  assert.equal(resumed.certificateFingerprint,initial.certificateFingerprint);
  assert(resumed.origins.length>0);assert(resumed.origins.every(origin=>Number(new URL(origin).port)===resumed.port));
  for(const [file,bytes] of identityBefore)assert.deepEqual(fs.readFileSync(path.join(folder,file)),bytes,`${file} must not rotate on a port collision`);
  const afterReceipt=await request(resumed.port,'/bridge/v2/pairing','GET',undefined,token);assert.equal(afterReceipt.status,200);
  assert.equal(afterReceipt.body.pairing.id,beforeReceipt.body.pairing.id);assert.deepEqual(afterReceipt.body.pairing.domains,beforeReceipt.body.pairing.domains);assert.deepEqual(afterReceipt.body.pairing.vaultIds,beforeReceipt.body.pairing.vaultIds);
  const capabilities=await request(resumed.port,'/bridge/v2/capabilities','GET',undefined,token);assert.equal(capabilities.status,200);assert.equal(capabilities.body.deviceId,offer.macDeviceId);
  const fresh=await bridge.createDesktopBridgeOffer(['vault-a'],['corpus'],undefined,'direct');assert.equal(fresh.macDeviceId,offer.macDeviceId);assert.equal(fresh.certificateFingerprint,offer.certificateFingerprint);assert(fresh.origins.every(origin=>Number(new URL(origin).port)===resumed.port));
  await bridge.stopDesktopBridge();await bridge.resumeDesktopBridge();
  assert.equal(bridge.desktopBridgeStatus().port,resumed.port,'An available saved port remains the first choice');
  // Other startup failures must propagate untouched, without a second listen.
  class FailedServer extends EventEmitter {calls=[];constructor(code){super();this.error=Object.assign(new Error(code),{code});}listen(port){this.calls.push(port);queueMicrotask(()=>this.emit('error',this.error));return this;}}
  for(const code of ['EACCES','EADDRNOTAVAIL']){const failed=new FailedServer(code);await assert.rejects(listenDesktopBridge(failed,12345),error=>error===failed.error);assert.deepEqual(failed.calls,[12345]);assert.equal(failed.listenerCount('listening'),0);assert.equal(failed.listenerCount('error'),0);}
  const twiceOccupied=new FailedServer('EADDRINUSE');await assert.rejects(listenDesktopBridge(twiceOccupied,12345),error=>error===twiceOccupied.error);assert.deepEqual(twiceOccupied.calls,[12345,0]);assert.equal(twiceOccupied.listenerCount('listening'),0);assert.equal(twiceOccupied.listenerCount('error'),0);
  const exhausted=new FailedServer('EADDRINUSE');await assert.rejects(listenDesktopBridge(exhausted,0),error=>error===exhausted.error);assert.deepEqual(exhausted.calls,[0]);
  const invalid=new FailedServer('EACCES');await assert.rejects(listenDesktopBridge(invalid,65536),/invalid_bridge_port/);assert.deepEqual(invalid.calls,[]);
  console.log(JSON.stringify({suite:'mobile-bridge-port-collision',passed:true,realOccupiedPersistedPort:true,trustedHttps:true,existingTokenAuthorized:true,identityTlsGrantsPreserved:true,updatedPortAndOffers:true,otherErrorsPropagate:true}));
} finally {agent.destroy();await bridge.stopDesktopBridge();await close(occupied);runtime.restore();fs.rmSync(root,{recursive:true,force:true});}
