import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-report-image-'));
const hooks=installRuntimeHooks(directory), require=createRequire(import.meta.url), Module=require('node:module');
const originalLoad=Module._load;
let current=null, previous=null, providerFailure=false, providerCalls=0, abortedDuringProvider=null;
const owner = new AsyncLocalStorage(), scopedImages = new Map();
let providerBarrier=null;
const image=()=>owner.getStore()?scopedImages.get(owner.getStore()).current:current;
const setImage=value=>{if(owner.getStore())scopedImages.get(owner.getStore()).current=value;else current=value;return value;};
const old={entityKind:'deep_research',entityId:'report',status:'ready',assetRef:'old-image'};
const repo={
  getDecorativeImage:()=>image(),
  markDecorativeImagePending:input=>{if(owner.getStore())scopedImages.get(owner.getStore()).previous=image();else previous=image();return setImage({...input,status:'pending'});},
  saveDecorativeImagePrompt:(_kind,_id,context,prompt)=>{setImage({...image(),visualContext:context,prompt});},
  saveDecorativeImageReady:(_kind,_id,bytes,mime)=>setImage({...image(),status:'ready',assetRef:bytes.toString(),mimeType:mime}),
  saveDecorativeImageFailure:(_kind,_id,error)=>setImage({...image(),status:'failed',error}),
  restorePreviousDecorativeImage:()=>setImage(owner.getStore()?scopedImages.get(owner.getStore()).previous:previous),
};
Module._load=function(request,parent,isMain){
  if(request==='@google/genai')return {GoogleGenAI:class{}};
  if(request.endsWith('/decorativeImagesRepo'))return repo;
  if(request.endsWith('/settingsRepo'))return {getSettings:()=>({imageProvider:'nodus',imageModel:'mac-image',imageQuality:'standard',synthesisModel:{provider:'mac',model:'text'}})};
  if(request.endsWith('/vaultRegistry'))return {getActiveVault:()=>({id:owner.getStore()??'fixture',type:'academic'})};
  if(request.endsWith('/db/database'))return {getDb:()=>({prepare:()=>({get:id=>id==='report'?{title:'Real report',draft_json:'{}',model_json:null}:undefined})})};
  if(request.endsWith('/nodusLocalImages'))return {generateNodusLocalImage:async(model)=>{providerCalls++;assert.equal(model,'mac-image');if(providerBarrier)await providerBarrier;if(abortedDuringProvider)abortedDuringProvider.abort();if(providerFailure)throw new Error('provider failed');return {bytes:Buffer.from('new-image'),mimeType:'image/png'};}};
  if(request.endsWith('/imageStorage'))return {prepareImageStorage:bytes=>({image:bytes,mimeType:'image/png',thumbnail:bytes,thumbnailMimeType:'image/png'})};
  if(request.endsWith('/aiClient'))return {completeText:async()=> 'Visual context from Mac'};
  if(['/charactersRepo','/worldImagesRepo','/worldPlacesRepo','/worldGroupsRepo','/codexSubscription','/secretStore','/entitiesRepo'].some(suffix=>request.endsWith(suffix)))return {};
  return originalLoad.call(this,request,parent,isMain);
};
try{
  const {generateReportImageAndWait}=require('../electron/ai/decorativeImages.ts');
  const {reportImageRequest}=require('../electron/desktopBridge/reportImageGeneration.ts');
  assert.throws(()=>reportImageRequest({entityId:'report',style:'watercolor',provider:'mobile'}),/invalid_report_image_request/);
  assert.throws(()=>reportImageRequest({entityId:'report',style:'invented'}),/invalid_report_image_request/);
  const phases=[];current=old;
  const result=await generateReportImageAndWait('report','watercolor','  custom  scene ',phase=>phases.push(phase));
  assert.equal(result.status,'ready');assert.equal(result.model,'mac-image');assert.equal(result.visualContext,'custom scene');assert.deepEqual(phases,['context','generating','saving']);assert.equal(providerCalls,1);
  current=old;providerFailure=true;
  await assert.rejects(generateReportImageAndWait('report','watercolor','scene',()=>{}),/provider failed/);
  assert.equal(current.assetRef,'old-image','Failed regeneration preserves the prior illustration');
  current=old;providerFailure=false;abortedDuringProvider=new AbortController();
  await assert.rejects(generateReportImageAndWait('report','watercolor','scene',()=>{},abortedDuringProvider.signal),{name:'AbortError'});
  assert.equal(current.assetRef,'old-image','A local provider that completes after cancellation cannot publish its bytes');
  abortedDuringProvider=null;current=old;
  await assert.rejects(generateReportImageAndWait('missing','watercolor','scene',()=>{}),/ya no existe/);
  assert.equal(current.assetRef,'old-image','Unknown report never mutates the image');
  let release;
  providerBarrier=new Promise(resolve=>{release=resolve;});
  for(const vault of ['vault-a','vault-b'])scopedImages.set(vault,{current:old,previous:null});
  const first=owner.run('vault-a',()=>generateReportImageAndWait('report','watercolor','A',()=>{}));
  const second=owner.run('vault-b',()=>generateReportImageAndWait('report','watercolor','B',()=>{}));
  await assert.rejects(owner.run('vault-a',()=>generateReportImageAndWait('report','watercolor','A again',()=>{})),/report_image_generation_busy/);
  release();
  const results=await Promise.all([first,second]);
  assert.deepEqual(results.map(value=>value.visualContext),['A','B'],'Same imported report ID in two owning vaults must have independent tasks');
  assert.equal(scopedImages.get('vault-a').current.visualContext,'A');
  assert.equal(scopedImages.get('vault-b').current.visualContext,'B');
  providerBarrier=null;
  console.log('Mobile report image: canonical Mac settings, progress, request validation, report identity, failure restoration, cancellation and concurrent owning-vault isolation passed.');
}finally{Module._load=originalLoad;hooks.restore();fs.rmSync(directory,{recursive:true,force:true});}
