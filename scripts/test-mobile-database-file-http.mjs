import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-file-http'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-database-file-http-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};runtime.safeStorage.isEncryptionAvailable=()=>true;
const require=createRequire(import.meta.url),cert=path.join(root,'test.crt'),key=path.join(root,'test.key');
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
function stub(module,exports){const id=require.resolve(module);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../electron/localServer/lanCert.ts',{ensureLanCert:async()=>({certPath:cert,keyPath:key}),lanAddresses:()=>['127.0.0.1']});
stub('../electron/serverSync/serverSyncShared.ts',{listVaultConfigs:()=>[]});
const vaults=require('../electron/vaults/vaultRegistry.ts'),database=require('../electron/db/database.ts'),bridge=require('../electron/desktopBridge/server.ts');
const agent=new https.Agent({ca:fs.readFileSync(cert)}),token=()=>randomBytes(32).toString('base64url');let origin;
async function request(route,method='GET',body,bearer){const text=body===undefined?undefined:JSON.stringify(body);return new Promise((resolve,reject)=>{const req=https.request(new URL(route,origin),{agent,method,headers:{...(text?{'content-type':'application/json'}:{}),...(bearer?{authorization:`Bearer ${bearer}`}:{})}},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>{try{resolve({status:res.statusCode,body:Buffer.concat(parts).length?JSON.parse(Buffer.concat(parts).toString()):null});}catch(e){reject(e);}});});req.setTimeout(20000,()=>req.destroy(new Error('contract_timeout')));req.on('error',reject);req.end(text);});}
async function pair(offer,bearer){const next=token();const result=await request('/bridge/v1/pair','POST',{code:offer.code,deviceId:offer.id,deviceName:'Isolated contract',nextToken:next},bearer);assert.equal(result.status,201);return {id:result.body.pairing.id,token:next,pairing:result.body.pairing};}
const originalFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;throw new Error('No provider during file transport');};
try {
 const initial=vaults.getActiveVault();database.withVaultDatabase(initial.id,()=>database.getDb().prepare('SELECT 1').get());
 const vault=vaults.createVault('HTTP files fixture','databases'),repo=require('../electron/db/databasesRepo.ts');let spec,rowId,columnId;
 await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>{
   const db=repo.createDatabase('Transfer fixture'),column=repo.createColumn(db.id,'Files','files'),row=repo.createRow(db.id);rowId=row.id;columnId=column.id;
   spec={rowId,columnId,fileName:'bounded-transfer.bin',mimeType:'application/octet-stream',expectedRowRevision:database.getDb().prepare('SELECT revision FROM db_rows WHERE id=?').get(rowId).revision,expectedColumnRevision:database.getDb().prepare('SELECT revision FROM db_columns WHERE id=?').get(columnId).revision};
 }));
 assert.ok(vaults.listVaults().every(v=>fs.realpathSync(v.path).startsWith(fs.realpathSync(root)+path.sep)));
 const offer=await bridge.createDesktopBridgeOffer([vault.id],['corpus','writing'],undefined,'direct');origin=`https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
 const grant=await pair(offer),read=await pair(await bridge.createDesktopBridgeOffer([vault.id],['corpus'],undefined,'direct'));
 const id=randomUUID(),base=`/bridge/v2/vaults/${vault.id}/database-files/${id}/`,bytes=Buffer.alloc(13*1024*1024+17,37),hash=value=>createHash('sha256').update(value).digest('hex');
 const input={...spec,size:bytes.length,sha256:hash(bytes)};
 assert.equal((await request(base+'begin','POST',input,read.token)).status,403);
 assert.equal((await request(base+'begin','POST',input,'invalid-fixture-token')).status,401);
 assert.equal((await request(base+'begin','POST',input,grant.token)).status,200);
 const chunkBytes=512*1024;
 for(let index=0;index<Math.ceil(bytes.length/chunkBytes);index++) {
   const chunk=bytes.subarray(index*chunkBytes,(index+1)*chunkBytes),body={index,bytes:chunk.toString('base64'),sha256:hash(chunk)};
   if(index===0){assert.equal((await request(base+'chunk','POST',{...body,sha256:'0'.repeat(64)},grant.token)).status,409);}
   assert.equal((await request(base+'chunk','POST',body,grant.token)).status,200);
   if(index===0){await bridge.stopDesktopBridge();await bridge.resumeDesktopBridge();origin=`https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;assert.equal((await request(base+'status','POST',{},grant.token)).body.received.length,1);}
 }
 const committed=await request(base+'commit','POST',{},grant.token);assert.equal(committed.status,200);assert.equal(committed.body.result.id,'datt_'+id);assert.equal(committed.body.result.bytes,bytes.length);
 assert.deepEqual((await request(base+'commit','POST',{},grant.token)).body.result,committed.body.result);
 assert.deepEqual((await request(base+'begin','POST',input,grant.token)).body.result,committed.body.result);
 await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>{assert.deepEqual(repo.getAttachmentBlob('datt_'+id),bytes);assert.equal(repo.getAttachment('datt_'+id).extractedText,null);}));
 assert.equal((await request('/bridge/v2/pairing','DELETE',undefined,grant.token)).status,200);
 assert.equal((await request(base+'status','POST',{},grant.token)).status,401);assert.equal(providerCalls,0);
 console.log('Real HTTPS 13MiB+17 canonical attachment: bounded chunks, SHA rejection, staged restart resume, duplicate ACK, corpus-only/invalid/revoked grants denied, no extraction/provider: PASS');
} finally {globalThis.fetch=originalFetch;agent.destroy();await bridge.stopDesktopBridge();database.closeDb();runtime.restore();fs.rmSync(root,{recursive:true,force:true});}
