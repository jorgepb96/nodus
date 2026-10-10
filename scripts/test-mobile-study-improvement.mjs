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
      if(failSave){failSave=false;throw new Error('Mac disconnected before saving');}
      return mobile.saveMobileStudyImprovement(args[0]);
    }
    if(method==='cancelAutonomousGeneration'){pendingReject?.(new Error('Provider cancelled'));return null;}
    throw new Error('Unexpected method: '+method);
  };
  await assert.rejects(frontend.autonomousWriting(call,{...request,model:{provider:'codex',model:'Mac-only'}},()=>{}),/Mac disconnected/);
  assert.equal(providerCalls,1);assert([...checkpoints.values()].some(value=>value.raw===raw && value.state==='failed'),'Interrupted save retains generated result');
  let preview='';
  const resumed=await frontend.autonomousWriting(call,request,text=>{preview+=text;});
  assert.equal(providerCalls,1,'Resuming a completed phone response does not regenerate it');assert.equal(preview,resumed.text);
  const cancelling=frontend.autonomousWriting(call,{...request,text:'Cancelar esta generación'},()=>{throw new Error('Cancelled preview must never be emitted');});
  while(!pendingReject)await new Promise(resolve=>setTimeout(resolve,5));
  await frontend.cancelAutonomousWriting(call);await assert.rejects(cancelling,/cancelled/);
  assert([...checkpoints.values()].some(value=>value.state==='cancelled'));
  console.log(JSON.stringify({suite:'mobile-study-improvement',passed:true,readOnlyContext:true,phoneProvider:true,protectedReferences:true,
    workspaceAndStudyTargets:true,trashedNoteRejected:true,originalUnchanged:true,staleSourceRejected:true,idempotentLog:true,interruptedSaveResumed:true,cancelledPreviewRejected:true}));
} finally {globalThis.fetch=fetchBefore;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
