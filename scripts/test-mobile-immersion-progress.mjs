import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-immersion-progress')) process.exit(0);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-immersion-progress-contract-'));
const runtime=installRuntimeHooks(temporary); runtime.app.on=()=>{}; runtime.app.once=()=>{};
const require=createRequire(import.meta.url), originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Private immersion progress must never invoke a provider');};
let database;
try {
  database=require('../electron/db/database.ts'); const db=database.getDb();
  const {getActiveVault,createVault}=require('../electron/vaults/vaultRegistry.ts');
  const {emptyImmersionProgress,setImmersionProgress}=require('../electron/db/immersionRepo.ts');
  const {readImmersionMobileProgress,saveImmersionMobileProgress,immersionProgressSourceRevision}=require('../electron/desktopBridge/immersionProgress.ts');
  const vault=getActiveVault().id, stamp='2026-10-11T00:00:00Z';
  const choice={id:'choice',kind:'choice',question:'¿Qué cambió?',options:['Uno','Dos'],correctIndex:1,explanation:'Razón literal',expected:'',ideaIds:[]};
  const reflection={id:'reflection',kind:'open',question:'Explica tu lectura',options:[],correctIndex:null,explanation:'',expected:'Vínculos y tensiones',ideaIds:[]};
  const plan={topic:'Fotografía / océano 🌊',title:'Recorrido de prueba',language:'es',generatedAt:stamp,minutes:60,
    overview:'Panorama',stations:[{id:'station',title:'Estación',context:'',synthesis:'',citations:[],quiz:[choice]}],exam:{questions:[reflection]}};
  assert.equal(immersionProgressSourceRevision(plan),'c19cf1805619e9cdb68381ef3842cbd1d65986712e67f04c098085f1a3f49f75');
  const insert=db.prepare('INSERT INTO immersion_sessions(id,topic,title,language,minutes,plan_json,progress_json,stats_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('session',plan.topic,plan.title,'es',60,JSON.stringify(plan),JSON.stringify(emptyImmersionProgress()),'{}',stamp,stamp);
  const initial=await readImmersionMobileProgress(vault,'session');
  const answer={questionId:'choice',kind:'choice',answer:'1',correct:false,assessment:null,answeredAt:stamp};
  const progress={...initial.progress,currentStep:1,furthestStep:1,completedSteps:[0],startedAt:stamp,answers:[answer]};
  const input={version:1,id:'11111111-1111-4111-8111-111111111111',sourceRevision:initial.sourceRevision,expectedProgressRevision:initial.progressRevision,progress};
  const saved=await saveImmersionMobileProgress(vault,'grant','session',input);
  assert.equal(saved.snapshot.progress.answers[0].correct,true); assert.equal(saved.snapshot.progress.currentStep,1);
  assert.notEqual(saved.snapshot.progressRevision,initial.progressRevision);
  const desktopProgress={...saved.snapshot.progress,answers:[...saved.snapshot.progress.answers,{questionId:'reflection',kind:'open',answer:'Reflexión posterior del Mac',correct:null,assessment:null,answeredAt:stamp}]};
  setImmersionProgress('session',desktopProgress);
  assert.deepEqual(await saveImmersionMobileProgress(vault,'grant','session',input),saved);
  assert.deepEqual((await readImmersionMobileProgress(vault,'session')).progress,desktopProgress,'Lost ACK replay must not overwrite later Desktop work');
  await assert.rejects(()=>saveImmersionMobileProgress(vault,'grant','session',{...input,progress:{...progress,currentStep:2,furthestStep:2}}),{code:'idempotency_conflict'});
  const stale={...input,id:'22222222-2222-4222-8222-222222222222'};
  await assert.rejects(()=>saveImmersionMobileProgress(vault,'grant','session',stale),error=>error.code==='immersion_progress_conflict' && error.remote.progress.answers.length===2);
  await assert.rejects(()=>saveImmersionMobileProgress(vault,'grant','session',{...stale,expectedProgressRevision:null}),{code:'immersion_progress_conflict'});
  const latest=await readImmersionMobileProgress(vault,'session');
  const {registerMobileOperation,executeMobileOperation}=require('../electron/desktopBridge/operations.ts');
  const {getImmersionSession}=require('../electron/db/immersionRepo.ts');
  registerMobileOperation('immersion:get',(_event,id)=>getImmersionSession(id));
  assert.deepEqual((await executeMobileOperation(vault,['corpus'],'getImmersionSession',['session'])).progress,emptyImmersionProgress());
  assert.deepEqual((await executeMobileOperation(vault,['corpus','writing'],'getImmersionSession',['session'])).progress,desktopProgress);
  const valid={...stale,expectedProgressRevision:latest.progressRevision};
  await assert.rejects(()=>saveImmersionMobileProgress(vault,'grant','session',{...valid,sourceRevision:'0'.repeat(64)}),{code:'immersion_plan_changed'});
  for (const bad of [
    {...progress,currentStep:5,furthestStep:5},
    {...progress,completedSteps:[0,0]},
    {...progress,answers:[{...answer,questionId:'foreign-question'}]},
    {...progress,answers:[{...answer,answer:'19'}]},
    {...progress,answers:[{...answer,assessment:{score:99}}]},
  ]) await assert.rejects(()=>saveImmersionMobileProgress(vault,'grant','session',{...valid,progress:bad}),{status:400});
  assert.deepEqual((await readImmersionMobileProgress(vault,'session')).progress,desktopProgress,'Rejected input must preserve current private work');
  const resolution=await saveImmersionMobileProgress(vault,'grant','session',valid);
  assert.equal(resolution.snapshot.progress.answers.length,1,'Explicit reviewed phone selection applies against the current revision');
  insert.run('offline-first',plan.topic,plan.title,'es',60,JSON.stringify(plan),JSON.stringify(emptyImmersionProgress()),'{}',stamp,stamp);
  const first=await saveImmersionMobileProgress(vault,'grant','offline-first',{...input,id:'33333333-3333-4333-8333-333333333333',expectedProgressRevision:null});
  assert.equal(first.snapshot.sessionId,'offline-first');
  const other=createVault('Otro vault de progreso');
  await assert.rejects(()=>readImmersionMobileProgress(other.id,'session'),{status:404});
  await assert.rejects(()=>readImmersionMobileProgress(vault,'missing'),{status:404});
  console.log('Private immersion progress, source identity, concurrent edits, lost acknowledgements and scoped initialization contracts passed.');
} finally {
  globalThis.fetch=originalFetch; database?.closeDb(); runtime.restore(); fs.rmSync(temporary,{recursive:true,force:true});
}
