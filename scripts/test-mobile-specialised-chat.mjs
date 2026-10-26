import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-specialised-chat')) process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-chat-'));
const runtime=installRuntimeHooks(directory); runtime.app.on=()=>{}; runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Consultation and transport contracts must not invoke a provider');};
let database;
try {
  database=require('../electron/db/database.ts'); database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'); const first=vaults.getActiveVault(),other=vaults.createVault('Aislado');
  const {mobileChatSurface,mobileStudyCitation,MOBILE_CHAT_STREAM_METHODS,MOBILE_CHAT_STREAM_EVENTS}=require('../src/mobileWeb/mobileChat.ts');
  const {MOBILE_OPERATIONS,MOBILE_JOB_OPERATIONS}=require('../shared/mobileOperations.ts');
  const {registerMobileOperation,executeMobileOperation}=require('../electron/desktopBridge/operations.ts');
  const {withMobileOperation}=require('../electron/desktopBridge/executionBoundary.ts');
  const {generationSignal}=require('../electron/ai/generationSignal.ts');
  assert.deepEqual(['academic','worldbuilding','estudio','docencia','databases'].map(mobileChatSurface),['research','world','study','teaching','database']);
  const citation=new URL(mobileStudyCitation('recording','grabación /37',{timestampSeconds:12.5,transcriptId:'versión/2'}));
  assert.equal(citation.searchParams.get('t'),'12.5'); assert.equal(citation.searchParams.get('transcript'),'versión/2');
  assert.equal(decodeURIComponent(citation.pathname),'/recording/grabación /37');
  assert.equal(new URL(mobileStudyCitation('material','material',{pageNumber:37,slideNumber:12})).searchParams.get('page'),'37');
  assert.throws(()=>mobileStudyCitation('recording','recording',{timestampSeconds:NaN}));
  for(const method of MOBILE_CHAT_STREAM_METHODS) {
    assert.ok(MOBILE_JOB_OPERATIONS.has(method));
    const [channel,domain]=MOBILE_OPERATIONS[method]; assert.equal(domain,'research-generation');
    const event=Object.keys(MOBILE_CHAT_STREAM_EVENTS).find(value=>value.startsWith(channel==='worldChat:stream'?'worldChat:':channel==='study:assistant:stream'?'study:assistant:':channel+':') && value.endsWith('delta'));
    assert.ok(event);
    registerMobileOperation(channel,async(e,id,request)=>{
      assert.equal(vaults.getActiveVault().id,first.id); assert.equal(request.question,'Pregunta de contrato');
      e.sender.send(event,id,'Respuesta de contrato');
      const signal=generationSignal(); assert.ok(signal);
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
    });
    const controller=new AbortController(),events=[];
    const pending=executeMobileOperation(first.id,['research-generation'],method,['request-37',{question:'Pregunta de contrato'}],(channel,...args)=>events.push({channel,args}),controller.signal);
    await new Promise(resolve=>setImmediate(resolve)); controller.abort();
    await assert.rejects(pending,/cancelled/); assert.deepEqual(events,[{channel:event,args:['request-37','Respuesta de contrato']}]);
    await assert.rejects(executeMobileOperation(first.id,['corpus'],method,[]),/permission_denied/);
  }
  const stamp='2026-10-11T00:00:00Z';
  const entry=kind=>({indexId:kind,kind,sourceId:kind,title:kind,text:'Texto original 37',subtitle:'',tags:[],scope:{},location:{},createdAt:stamp,updatedAt:stamp,contentHash:kind,embedding:null,excluded:false});
  const index=path.join(vaults.activeVaultDir(),'study-search-index.json');
  const serialized=JSON.stringify({version:1,entries:[entry('document'),entry('transcript')],updatedAt:stamp,modelProvider:'',modelName:'',excludedSourceIds:[],savedSearches:[],history:[]});
  fs.writeFileSync(index,serialized);
  const study=require('../electron/ai/studyAssistant.ts'),search=require('../electron/ai/studySearch.ts');
  const sources=await withMobileOperation(()=>study.getStudyAssistantSources(),['corpus']);
  assert.ok(sources.some(row=>row.kind==='document')); assert.ok(!sources.some(row=>row.kind==='transcript'));
  assert.equal(fs.readFileSync(index,'utf8'),serialized,'Mobile consultation must not regenerate the index');
  await assert.rejects(withMobileOperation(()=>search.rebuildStudySearchIndex(),['corpus']),/desktop_preparation_required/);
  const chat=study.createStudyAssistantConversation({title:'Privado'});
  study.updateStudyAssistantConversation(chat.id,{messages:[{id:'37',role:'assistant',content:'Texto de grabación',createdAt:stamp,citations:[{id:'S1',sourceKey:'transcript:transcript',indexId:'transcript',kind:'transcript',sourceId:'transcript',title:'Grabación',subtitle:'',quote:'Texto original 37',scope:{},location:{recordingId:'recording',transcriptId:'transcript',timestampSeconds:12.5}}]}]});
  assert.throws(()=>withMobileOperation(()=>study.getStudyAssistantConversation(chat.id),['corpus']),/permission_denied/);
  assert.equal(withMobileOperation(()=>study.getStudyAssistantConversation(chat.id),['corpus','study-recordings']).id,chat.id);
  assert.equal(await vaults.withOwningVault(other.id,()=>database.withVaultDatabase(other.id,()=>study.getStudyAssistantConversation(chat.id))),null);
  console.log('Specialised chat routing, event identity, grant, cancellation, transcript locators and Desktop-only index contracts passed. Provider/UI acceptance remains separate.');
} finally {
  globalThis.fetch=originalFetch; database?.closeDb(); runtime.restore(); fs.rmSync(directory,{recursive:true,force:true});
}
