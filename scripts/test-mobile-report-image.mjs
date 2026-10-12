import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-report-image-'));
const hooks=installRuntimeHooks(directory), require=createRequire(import.meta.url), Module=require('node:module');
const originalLoad=Module._load;
let current=null, previous=null, providerFailure=false, providerCalls=0, abortedDuringProvider=null;
const old={entityKind:'deep_research',entityId:'report',status:'ready',assetRef:'old-image'};
const repo={
  getDecorativeImage:()=>current,
  markDecorativeImagePending:input=>{previous=current;current={...input,status:'pending'};return current;},
  saveDecorativeImagePrompt:(_kind,_id,context,prompt)=>{current={...current,visualContext:context,prompt};},
  saveDecorativeImageReady:(_kind,_id,bytes,mime)=>{current={...current,status:'ready',assetRef:bytes.toString(),mimeType:mime};return current;},
  saveDecorativeImageFailure:(_kind,_id,error)=>{current={...current,status:'failed',error};return current;},
  restorePreviousDecorativeImage:()=>{current=previous;return current;},
};
Module._load=function(request,parent,isMain){
  if(request==='@google/genai')return {GoogleGenAI:class{}};
  if(request.endsWith('/decorativeImagesRepo'))return repo;
  if(request.endsWith('/settingsRepo'))return {getSettings:()=>({imageProvider:'nodus',imageModel:'mac-image',imageQuality:'standard',synthesisModel:{provider:'mac',model:'text'}})};
  if(request.endsWith('/vaultRegistry'))return {getActiveVault:()=>({type:'academic'})};
  if(request.endsWith('/db/database'))return {getDb:()=>({prepare:()=>({get:id=>id==='report'?{title:'Real report',draft_json:'{}',model_json:null}:undefined})})};
  if(request.endsWith('/nodusLocalImages'))return {generateNodusLocalImage:async(model)=>{providerCalls++;assert.equal(model,'mac-image');if(abortedDuringProvider)abortedDuringProvider.abort();if(providerFailure)throw new Error('provider failed');return {bytes:Buffer.from('new-image'),mimeType:'image/png'};}};
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
  console.log('Mobile report image: canonical Mac settings, progress, request validation, report identity, failure restoration and cancellation passed.');
}finally{Module._load=originalLoad;hooks.restore();fs.rmSync(directory,{recursive:true,force:true});}
