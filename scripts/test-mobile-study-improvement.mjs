import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-writing-test')) process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-writing-contract-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url);
Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
const fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('This phone writing contract must never call Mac providers');};
let database;
try {
  database=require('../electron/db/database.ts');const db=database.getDb();
  const org=require('../electron/db/studyOrgRepo.ts'),styles=require('../electron/db/studyStylesRepo.ts');
  const mobile=require('../electron/ai/mobileStudyImprovement.ts');
  const core=require('../shared/studyImprovementGeneration.ts');
  const original='La propaganda creó 37 imágenes en 2024 (García, 2023, p. 8). $E=mc^2$ y [fuente](nodus://passage/work%230).';
  const document=org.createStudyDocument({title:'Ensayo del móvil',contentMarkdown:original});
  const request={documentId:document.id,text:original,styleId:'builtin:clear',scope:'paragraph',level:'minimal',length:'similar',mode:'preserve',protectedTerms:['García'],model:{provider:'deepseek',model:'phone-owned'}};
  const context=mobile.mobileStudyImprovementContext(request);
  assert.equal(styles.listStudyImprovementLog(document.id).length,0,'Context preparation is read only');
  const portable=require('../shared/mobileStudyImprovement.ts');
  const sorted=value=>value && typeof value==='object' ? Array.isArray(value) ? value.map(sorted)
    : Object.fromEntries(Object.entries(value).filter(([,child])=>child!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,sorted(child)])) : value;
  const selectedSource=sorted(JSON.parse(JSON.stringify(mobile.mobileStudyImprovementOfflineSource({documentId:document.id}))));
  const freshRequest={...request,text:'Una selección nueva mantiene 37 datos (García, 2023, p. 8).',styleId:'builtin:concise',length:'shorter',promptLanguage:'en'};
  const freshContext=await portable.studyImprovementContextFromCopy(sorted(freshRequest),selectedSource);
  assert.equal(freshContext.offlineSourceVersion,1);
  assert.equal(freshContext.revision,mobile.mobileStudyImprovementContext(freshRequest,1).revision,'Native key reordering does not change the portable source revision');
  assert.equal(styles.listStudyImprovementLog(document.id).length,0,'Downloading and deriving a new context remain read only');
  const freshRaw=core.prepareStudyImprovement(freshRequest,freshContext.style,freshContext.promptLanguage).protectedValue.text.replace('mantiene','conserva');
  const freshInput={request:freshRequest,revision:freshContext.revision,offlineSourceVersion:1,raw:freshRaw,requestId:'fe71eb0b-c8dc-441b-8dfd-d9000d20e206'};
  assert.match(mobile.saveMobileStudyImprovement(freshInput).text,/conserva 37 datos/);
  assert.equal(mobile.saveMobileStudyImprovement(freshInput).logId,freshInput.requestId,'A fresh offline selection is published once');
  assert.throws(()=>mobile.saveMobileStudyImprovement({...freshInput,offlineSourceVersion:2}),/unsupported_offline_source_version/);
  await assert.rejects(portable.studyImprovementContextFromCopy({...freshRequest,documentId:'foreign-vault'},selectedSource),/offline_source_unavailable/);
  await assert.rejects(portable.studyImprovementContextFromCopy({...freshRequest,styleId:'missing-style'},selectedSource),/style_unavailable/);
  // Keep the historical scenario's own log count independent of this new path.
  db.prepare('DELETE FROM study_improvement_log WHERE id=?').run(freshInput.requestId);
  const custom=styles.createStudyStyle({name:'Estilo descargado',prompt:'Conserva el significado y mejora la claridad.'});
  const customRequest={...freshRequest,styleId:custom.id};
  const customSource=mobile.mobileStudyImprovementOfflineSource({documentId:document.id});
  const customContext=await portable.studyImprovementContextFromCopy(customRequest,customSource);
  const customInput={...freshInput,request:customRequest,revision:customContext.revision,
    raw:core.prepareStudyImprovement(customRequest,customContext.style,customContext.promptLanguage).protectedValue.text,
    requestId:'b0c3ed3d-071f-4fdb-9f57-3a4a38082fdb'};
  styles.updateStudyStyle(custom.id,{prompt:'Nuevo estilo cambiado mientras el móvil estaba fuera.'});
  assert.throws(()=>mobile.saveMobileStudyImprovement(customInput),/generation_conflict/,'A changed Mac style cannot accept an older offline context');
  assert.throws(()=>mobile.mobileStudyImprovementContext({...request,documentId:'foreign-vault'}),/source_unavailable/);
  assert.throws(()=>mobile.mobileStudyImprovementContext({...request,noteId:'also-note'}),/invalid_study_improvement_target/);
  assert.throws(()=>mobile.mobileStudyImprovementContext({...request,mode:'invalid'}),/invalid_study_improvement_request/);
  const prepared=core.prepareStudyImprovement(request,context.style,context.promptLanguage);
  const raw=prepared.protectedValue.text.replace('creó','produjo');
  const input={request,revision:context.revision,raw,requestId:'be840b29-7ca2-4d62-9eb0-dd8fa2bc80cb'};
  // Workspace notes use their real trashed_at lifecycle, distinct from study
  // documents. Exercise both repositories, including a soft-deleted note.
  const notes=require('../electron/db/notesRepo.ts');
  const note=notes.createNote({title:'Nota de Scriptor',kind:'markdown',content:original,tags:[]});
  const noteRequest={...request,documentId:undefined,noteId:note.id};
  const noteContext=mobile.mobileStudyImprovementContext(noteRequest);
  const noteResult=mobile.saveMobileStudyImprovement({request:noteRequest,revision:noteContext.revision,raw,requestId:'fd8459fe-ab4b-46c3-a764-2bdd8cd77e41'});
  assert.match(noteResult.text,/produjo 37 imágenes/);
  assert.equal(db.prepare('SELECT content FROM notes WHERE id=?').get(note.id).content,original);
  assert.equal(styles.listStudyImprovementLog(note.id).length,1);
  notes.trashNotes([note.id]);
  assert.throws(()=>mobile.mobileStudyImprovementContext(noteRequest),/source_unavailable/);
  assert.throws(()=>mobile.saveMobileStudyImprovement({...input,raw:''}),/no devolvió texto/);
  assert.throws(()=>mobile.saveMobileStudyImprovement({...input,raw:raw.replace(prepared.protectedValue.spans[0].placeholder,'altered')}),/fragmento/);
  assert.throws(()=>mobile.saveMobileStudyImprovement({...input,revision:'0'.repeat(64)}),/generation_conflict/);
  const result=mobile.saveMobileStudyImprovement(input);
  assert.equal(result.modelName,'phone-owned');assert.match(result.text,/produjo 37 imágenes en 2024/);
  assert.match(result.text,/nodus:\/\/passage\/work%230/);assert.match(result.text,/\$E=mc\^2\$/);
  assert.equal(mobile.saveMobileStudyImprovement(input).logId,result.logId);assert.equal(styles.listStudyImprovementLog(document.id).length,1);
  assert.throws(()=>mobile.saveMobileStudyImprovement({...input,raw:raw.replace('produjo','generó')}),/idempotency_conflict/);
  assert.equal(db.prepare('SELECT content_markdown FROM study_docs WHERE id=?').get(document.id).content_markdown,original,'Generating never mutates the source');
  db.prepare('UPDATE study_docs SET content_markdown=? WHERE id=?').run('Edición simultánea en Desktop',document.id);
  assert.throws(()=>mobile.saveMobileStudyImprovement(input),/generation_conflict/);
  db.prepare('UPDATE study_docs SET content_markdown=? WHERE id=?').run(original,document.id);
  const frontend=require('../src/mobileWeb/autonomousWriting.ts');
  const offlineCheckpoints=new Map();let offlineProviders=0, macAvailable=false;
  const offlineCall=async(method,...args)=>{
    if(method==='getSettings')return {writingModel:request.model};
    if(method==='mobileGenerationCheckpoint'){
      if(args[0]==='load')return structuredClone(offlineCheckpoints.get(args[2])??null);
      offlineCheckpoints.set(args[2],structuredClone(args[3]));return null;
    }
    if(method==='getStudyImprovementGenerationContext')throw Object.assign(new Error('Mac unavailable'),{code:'offline'});
    if(method==='getStudyImprovementOfflineSource'){assert.deepEqual(args[0],{documentId:document.id});return selectedSource;}
    if(method==='mobileStructuredCompletion'){offlineProviders++;return freshRaw;}
    if(method==='saveStudyImprovementFromMobile'){
      if(!macAvailable)throw Object.assign(new Error('Mac unavailable'),{code:'offline'});
      return mobile.saveMobileStudyImprovement(args[0]);
    }
    throw new Error('Unexpected offline method: '+method);
  };
  const {pendingStudyImprovementRequestId}=require('../shared/studyImprove.ts');
  let pendingId;
  await assert.rejects(frontend.autonomousWriting(offlineCall,freshRequest,()=>{
    assert.fail('An unacknowledged preview must not be emitted for automatic replacement');
  }),error=>{
    pendingId=pendingStudyImprovementRequestId(error);
    return error.code==='mobile_publication_pending' && Boolean(pendingId);
  });
  assert.equal([...offlineCheckpoints.values()].find(value=>value.id===pendingId)?.state,'saved');
  assert.equal(db.prepare('SELECT content_markdown FROM study_docs WHERE id=?').get(document.id).content_markdown,original);
  assert.equal(pendingStudyImprovementRequestId({code:'offline',requestId:pendingId}),null);
  assert.equal(pendingStudyImprovementRequestId({code:'mobile_publication_pending',requestId:'forged-log-id'}),null);
  assert.equal(pendingStudyImprovementRequestId(null),null);
  assert([...offlineCheckpoints.values()].some(value=>value.context.offlineSourceVersion===1 && value.preview.text.includes('conserva 37 datos') && value.state==='saved'));
  macAvailable=true;
  const newlyPublished=await frontend.autonomousWriting(offlineCall,freshRequest,()=>{});
  assert.equal(offlineProviders,1,'New offline assistance resumes publication without another model call');
  assert.match(newlyPublished.text,/conserva 37 datos/);
  db.prepare('UPDATE study_docs SET content_markdown=? WHERE id=?').run('Mac changed while the phone was away',document.id);
  assert.throws(()=>mobile.saveMobileStudyImprovement(freshInput),/generation_conflict/);
  db.prepare('UPDATE study_docs SET content_markdown=? WHERE id=?').run(original,document.id);
  db.prepare('DELETE FROM study_improvement_log WHERE id=?').run(newlyPublished.logId);
  const checkpoints=new Map();let providerCalls=0, failSave=true, pendingReject;
  const call=async(method,...args)=>{
    if(method==='getSettings')return {writingModel:request.model,improveModel:request.model};
    if(method==='mobileGenerationCheckpoint'){
      if(args[0]==='load')return structuredClone(checkpoints.get(args[2])??null);
      checkpoints.set(args[2],structuredClone(args[3]));return null;
    }
    if(method==='getStudyImprovementGenerationContext')return mobile.mobileStudyImprovementContext(args[0]);
    if(method==='mobileStructuredCompletion'){
      providerCalls++;assert.equal(args[0].model.model,'phone-owned');assert.equal(args[0].format,'text');
      if(args[0].user.includes('Cancelar'))return await new Promise((_,reject)=>{pendingReject=reject;});
      return raw;
    }
    if(method==='saveStudyImprovementFromMobile'){
      if(failSave){failSave=false;throw Object.assign(new Error('Mac disconnected before saving'),{code:'offline'});}
      return mobile.saveMobileStudyImprovement(args[0]);
    }
    if(method==='cancelAutonomousGeneration'){pendingReject?.(new Error('Provider cancelled'));return null;}
    throw new Error('Unexpected method: '+method);
  };
  await assert.rejects(frontend.autonomousWriting(call,{...request,model:{provider:'codex',model:'Mac-only'}},()=>{}),error=>error.code==='mobile_publication_pending');
  assert.equal(providerCalls,1);assert([...checkpoints.values()].some(value=>value.raw===raw && value.state==='saved' && value.publicationPending && value.preview.text.includes('produjo')),'Interrupted save remains a readable complete response awaiting synchronization');
  let preview='';
  const resumed=await frontend.autonomousWriting(call,request,text=>{preview+=text;});
  assert.equal(providerCalls,1,'Resuming a completed phone response does not regenerate it');assert.equal(preview,resumed.text);
  const recovered=[...checkpoints.entries()].find(([,value])=>value.result?.logId===resumed.logId);
  checkpoints.set(recovered[0],{...recovered[1],recoveredPublication:true});
  let restored='';assert.equal((await frontend.autonomousWriting(call,request,text=>{restored+=text;})).logId,resumed.logId);
  assert.equal(restored,resumed.text);assert.equal(providerCalls,1,'Reopening a publication acknowledged during reconnection never regenerates it');
  const recovery=require('../src/mobileWeb/publicationRecovery.ts');
  const providerFailure={state:'running',error:'Provider unreachable'};
  assert.equal(recovery.preservePendingPublication(providerFailure,{code:'offline'}),false,'A failed provider call is not a completed response');
  assert.equal(recovery.preservePendingPublication({state:'saved'},{code:'permission_denied'}),false,'Grant rejection is never a pending transport save');
  assert.equal(recovery.preservePendingPublication({state:'saved'},{code:'translation_generation_conflict'}),false,'A source conflict is never reported as offline success');
  const cancelling=frontend.autonomousWriting(call,{...request,text:'Cancelar esta generación'},()=>{throw new Error('Cancelled preview must never be emitted');});
  while(!pendingReject)await new Promise(resolve=>setTimeout(resolve,5));
  await frontend.cancelAutonomousWriting(call);await assert.rejects(cancelling,/cancelled/);
  assert([...checkpoints.values()].some(value=>value.state==='cancelled'));
  console.log(JSON.stringify({suite:'mobile-study-improvement',passed:true,readOnlyContext:true,phoneProvider:true,protectedReferences:true,
    workspaceAndStudyTargets:true,trashedNoteRejected:true,originalUnchanged:true,staleSourceRejected:true,idempotentLog:true,interruptedSaveResumed:true,cancelledPreviewRejected:true}));
} finally {globalThis.fetch=fetchBefore;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
