import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-map-job-transport-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
runtime.safeStorage.isEncryptionAvailable=()=>true;
const require=createRequire(import.meta.url);
const cert=path.join(root,'test.crt'),key=path.join(root,'test.key');
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
function stub(module,exports){const id=require.resolve(module);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../electron/localServer/lanCert.ts',{ensureLanCert:async()=>({certPath:cert,keyPath:key}),lanAddresses:()=>['127.0.0.1']});
stub('../electron/vaults/vaultRegistry.ts',{getVault:id=>id==='map-vault'?{id,name:'Transport fixture',type:'worldbuilding'}:null});
const {MOBILE_OPERATIONS}=require('../shared/mobileOperations.ts');
const executions=[];
stub('../electron/desktopBridge/operations.ts',{
 authorizeMobileOperation:(domains,method)=>{assert(MOBILE_OPERATIONS[method]);if(!domains.includes(MOBILE_OPERATIONS[method][1]))throw new Error('permission_denied');},
 executeMobileOperation:async(_vault,_domains,method,args)=>{executions.push({method,size:JSON.stringify(args).length});return {saved:true};},
});
const bridge=require('../electron/desktopBridge/server.ts');
const agent=new https.Agent({ca:fs.readFileSync(cert)});
function request(route,method,input,token){
 const payload=JSON.stringify(input);
 return new Promise((resolve,reject)=>{
  const req=https.request(new URL(route,`https://127.0.0.1:${bridge.desktopBridgeStatus().port}`),{agent,method,headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload),...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(error){reject(error);}});
  });
  req.setTimeout(10000,()=>req.destroy(new Error('transport_timeout')));req.on('error',reject);req.end(payload);
 });
}
try{
 const offer=await bridge.createDesktopBridgeOffer(['map-vault'],['corpus','writing','research-generation'],undefined,'direct');
 const linked=await request('/bridge/v1/pair','POST',{code:offer.code,deviceId:'map-phone',deviceName:'Transport fixture'});
 assert.equal(linked.status,201);const token=linked.body.token;
 const route='/bridge/v2/vaults/map-vault/jobs';
 const image='A'.repeat(6_000_000);
 const map={method:'saveMobileWorldMapImage',args:[{bytes:image}],idempotencyKey:'11111111-1111-4111-8111-111111111111'};
 const accepted=await request(route,'POST',map,token);assert.equal(accepted.status,202);
 assert.equal(accepted.body.job.method,map.method);
 const cancel={...map,idempotencyKey:'22222222-2222-4222-8222-222222222222'};
 const cancelled=await request(route,'DELETE',cancel,token);assert.equal(cancelled.status,200);assert.equal(cancelled.body.job.state,'cancelled');
 const replay=await request(route,'POST',cancel,token);assert.equal(replay.status,202);assert.equal(replay.body.job.id,cancelled.body.job.id);assert.equal(replay.body.job.state,'cancelled');
 for(const method of ['POST','DELETE']){
  const refused=await request(route,method,{...map,method:'generateMobileWorldMap',idempotencyKey:'33333333-3333-4333-8333-333333333333'},token);
  assert.equal(refused.status,400);assert.equal(refused.body.error,'request_too_large');
 }
 const tooLarge=await request(route,'POST',{...map,args:[{bytes:'A'.repeat(28_128_001)}],idempotencyKey:'44444444-4444-4444-8444-444444444444'},token).catch(error=>({transportError:error}));
 if(tooLarge.transportError)assert(['ECONNRESET','EPIPE'].includes(tooLarge.transportError.code),String(tooLarge.transportError));
 else{assert.equal(tooLarge.status,400);assert.equal(tooLarge.body.error,'payload_too_large');}
 assert.equal(executions.filter(item=>item.method==='saveMobileWorldMapImage').length,1,'cancel-before-submit must not publish the image');
 console.log(JSON.stringify({suite:'mobile-map-job-transport',passed:true,scope:'real trusted HTTPS request/body limits and durable cancellation; provider execution stubbed',mapAbove4MiBAccepted:true,otherJobsRemain4MiB:true,oversizedImageRejected:true,cancellationReplay:true}));
}finally{agent.destroy();await bridge.stopDesktopBridge();runtime.restore();fs.rmSync(root,{recursive:true,force:true});}
