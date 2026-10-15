import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-native-live-chat'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-native-live-chat-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),Module=require('node:module'),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Contract fixtures must not call a paid provider');};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let db,behavior,providerCalls=0;
const replaced=[];
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),history=require('../electron/desktopBridge/chatHistory.ts'),boundary=require('../electron/desktopBridge/executionBoundary.ts');
  // Replace only generation adapters. Ownership, CAS, actual SQL/Study history,
  // receipts, partial writes and the durable job journal remain production code.
  for(const [file,key,kind] of [['researchAssistant','streamResearchChat','research'],['worldChat','streamWorldChat','world'],['databaseChat','streamDatabaseChat','database'],['studyAssistant','streamStudyAssistant','study']]) {
    const filename=require.resolve(`../electron/ai/${file}.ts`),previous=require.cache[filename],module=new Module(filename);
    module.filename=filename;module.loaded=true;module.exports={[key]:async(request,delta,signal,...callbacks)=>{providerCalls++;return behavior(kind,request,delta,signal,callbacks);}};
    replaced.push([filename,previous]);require.cache[filename]=module;
  }
  const live=require('../electron/desktopBridge/nativeLiveChat.ts'),assets=require('../electron/chatAssets.ts'),{BridgeJobStore}=require('../electron/desktopBridge/jobs.ts');
  const domains=['corpus','writing','research-generation','study-recordings'];
  function question(kind,conversationId=randomUUID(),revision=null) {
    const requestId=randomUUID(),userId=randomUUID(),answerId=randomUUID();
    return {version:1,requestId,kind,answerId,edit:{version:1,id:requestId,conversationId,expectedRevision:revision,action:'save',draft:{title:'Pregunta móvil 🌊',archived:false,messages:[{id:userId,role:'user',content:'¿Qué sabemos de esta fuente? 🌊',createdAt:'2026-10-11T09:30:00Z'}],...(kind==='database'?{databaseIds:[]}:{}),...(kind==='study'?{study:{selection:{scope:'library',sourceKeys:[]},task:'answer',level:'standard',tone:'clear',language:'es',allowExternalKnowledge:false}}:{}),...(kind==='world'?{world:{selection:{scope:'auto',entryKeys:[],keepFocus:true},focus:[]}}:{})},companion:{messages:[{id:userId,role:'user',text:'¿Qué sabemos de esta fuente? 🌊',citations:[],createdAt:'2026-10-11T09:30:00Z'}]}},generation:{model:{provider:'codex',model:'contract-only-no-provider'},thinkingEffort:'standard',...(kind==='research'?{webSearch:'off'}:{})}};
  }
  const response=(kind,text,interrupted=false)=>kind==='world'?{text,focus:[{kind:'character',id:'fixture',title:'Personaje'}],noMaterial:false,...(interrupted?{aborted:true}:{})}:kind==='database'?{text,...(interrupted?{aborted:true}:{})}:kind==='study'?{answer:text,citations:[],stats:{fixture:true},interrupted}:{answer:text,stats:{fixture:true},...(interrupted?{aborted:true}:{})};
  for(const [kind,type] of [['research','academic'],['world','worldbuilding'],['database','databases'],['study','estudio'],['study','docencia']]) {
    const vault=vaults.createVault(`Native live ${type}`,type),grant=randomUUID(),request=question(kind);
    await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>boundary.withMobileOperation(async()=>{
      const owner=assets.chatAssetOwner({research:'assistant',world:'world-assistant',database:'database',study:'study'}[kind],request.edit.conversationId,vault.id);
      let generatedSource,councilSource;
      behavior=async(actual,modelRequest,delta,signal)=>{
        assert.equal(actual,kind);assert.equal(modelRequest.model.model,'contract-only-no-provider');
        const accepted=await history.readMobileChat(vault.id,kind,request.edit.conversationId,domains);
        assert.equal(accepted.data.messages.at(-1).id,request.edit.draft.messages[0].id,'Question is stored before a provider starts');
        generatedSource=assets.storeChatImage(owner,{bytes:Buffer.from([1,2,3]),mimeType:'image/png'},{title:'Generated fixture'});
        delta('Texto parcial 🌊');await delay(1150);
        const partial=await history.readMobileChat(vault.id,kind,request.edit.conversationId,domains);
        assert.equal(partial.data.messages.at(-1).id,request.answerId);assert.equal(partial.data.messages.at(-1).content,'Texto parcial 🌊');
        assert(assets.getChatImage(generatedSource.slice('nodus-image://chat/'.length)),'A prose checkpoint cannot delete a newly created pending result');
        delta('Texto parcial 🌊','replace');await delay(1150);
        assert(!signal.aborted,'An identical replacement is a new checkpoint, not an idempotency conflict');
        const result=response(kind,`Respuesta completa $x^2$\n\n![Original](${generatedSource})`);
        if(kind==='research') {
          councilSource=assets.storeChatImage(owner,{bytes:Buffer.from([4,5,6]),mimeType:'image/png'},{title:'Member result'});
          result.concilium={chairman:0,status:'complete',members:[{model:request.generation.model,status:'complete',answer:`![Member original](${councilSource})`}]};
        }
        return result;
      };
      const before=providerCalls,store=new BridgeJobStore(path.join(directory,`jobs-${vault.id}`),(job,emit,signal)=>vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,()=>boundary.withMobileOperation(()=>live.streamMobileCompanionChat(job.args[0],{jobId:job.id,deviceGrant:job.deviceGrant,idempotencyKey:job.idempotencyKey},emit,signal),job.domains))));
      const input={deviceGrant:grant,vaultId:vault.id,domains,method:'streamMobileCompanionChat',args:[request],idempotencyKey:request.requestId};
      const job=store.submit(input);assert.equal(store.submit(input).id,job.id);
      for(let i=0;i<100&&!['available','failed','cancelled'].includes(job.state);i++)await delay(50);
      assert.equal(job.state,'available',`${kind} (${type}): ${job.error}`);assert.equal(providerCalls,before+1);assert.equal(job.result.requestId,request.requestId);
      assert.equal(job.result.document.data.messages.length,2);assert.equal(job.result.document.data.messages.at(-1).id,request.answerId);
      assert(job.events.some(event=>event.channel==='mobile:chat:questionSaved'));assert(job.events.filter(event=>event.channel==='mobile:chat:checkpoint').length>=3);
      if(kind==='world')assert.equal(job.result.document.data.focus[0].title,'Personaje');
      if(kind==='research')assert.equal(job.result.document.data.model.model,'contract-only-no-provider');
      const completed=job.result.document;
      assert(assets.getChatImage(generatedSource.slice('nodus-image://chat/'.length)));
      if(councilSource)assert(assets.getChatImage(councilSource.slice('nodus-image://chat/'.length)),'Original member results survive final history cleanup');
      const forged={...request.edit,id:randomUUID(),expectedRevision:completed.revision,draft:{...request.edit.draft,messages:[...completed.data.messages,{id:randomUUID(),role:'assistant',content:'Forged',stats:{invented:true}}]}};
      await assert.rejects(history.saveMobileChat(vault.id,grant,kind,forged,domains),error=>error.code==='chat_rich_turn_changed');
      await history.saveMobileChat(vault.id,grant,kind,request.edit,domains);
      assert.equal((await history.readMobileChat(vault.id,kind,completed.id,domains)).revision,completed.revision,'Lost question acknowledgement never overwrites the finished answer');
      const restored=new BridgeJobStore(path.join(directory,`jobs-${vault.id}`),()=>{throw new Error('A completed receipt cannot repeat generation');});
      assert.equal(restored.submit(input).state,'available');assert.equal(restored.get(job.id,grant,vault.id).events.length,job.events.length);
    },domains)));
  }
  const vault=vaults.createVault('Native live failures','academic');
  await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>boundary.withMobileOperation(async()=>{
    const grant=randomUUID(),request=question('research'),identity={jobId:randomUUID(),deviceGrant:grant,idempotencyKey:request.requestId};
    await assert.rejects(live.streamMobileCompanionChat(request,{...identity,deviceGrant:''},()=>{}),error=>error.code==='live_chat_job_required');
    await assert.rejects(live.streamMobileCompanionChat({...request,generation:{model:{provider:'codex',model:'fixture',apiKey:'must-never-leave-Mac'}}},identity,()=>{}),error=>error.code==='invalid_live_chat_model');
    await assert.rejects(boundary.withMobileOperation(()=>live.streamMobileCompanionChat(request,identity,()=>{}),['corpus']),error=>error.code==='permission_denied');
    behavior=async(kind,_request,delta)=>{delta('Received before failure');throw new Error('Provider disconnected');};
    await assert.rejects(live.streamMobileCompanionChat(request,identity,()=>{}),/Provider disconnected/);
    const failed=await history.readMobileChat(vault.id,'research',request.edit.conversationId,domains);assert.equal(failed.data.messages.at(-1).content,'Received before failure');assert.equal(failed.data.messages.at(-1).error,true);
    const cancelled=question('research'),controller=new AbortController();
    behavior=async(kind,_request,delta)=>{delta('Partial cancelled');controller.abort();return response(kind,'Partial cancelled',true);};
    const stopped=await live.streamMobileCompanionChat(cancelled,{...identity,jobId:randomUUID(),idempotencyKey:cancelled.requestId},()=>{},controller.signal);
    assert.equal(stopped.interrupted,true);assert.equal(stopped.document.data.messages.at(-1).content,'Partial cancelled');
    const conflict=question('research');
    behavior=async(kind,_request,delta,signal)=>{
      delta('Partial before other device');await delay(1150);
      require('../electron/db/chatRepo.ts').renameConversation(conflict.edit.conversationId,'Edited on another device');
      delta(' New text');await delay(1150);assert(signal.aborted);return response(kind,'Partial before other device New text',true);
    };
    await assert.rejects(live.streamMobileCompanionChat(conflict,{...identity,jobId:randomUUID(),idempotencyKey:conflict.requestId},()=>{}),error=>error.code==='chat_revision_conflict');
    assert.equal((await history.readMobileChat(vault.id,'research',conflict.edit.conversationId,domains)).data.title,'Edited on another device');
  },domains)));
  console.log('Native live contract fixtures passed: real question/partial/result storage, all chat families, idempotent jobs, cancellation and CAS conflicts. Paid-provider and device E2E remain separate gates.');
} finally {
  for(const [filename,previous] of replaced){if(previous)require.cache[filename]=previous;else delete require.cache[filename];}
  globalThis.fetch=originalFetch;db?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});
}
