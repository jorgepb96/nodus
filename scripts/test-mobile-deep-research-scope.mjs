import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-deep-scope'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-deep-scope-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url);
global.fetch=async()=>{throw new Error('provider_or_network_forbidden_in_scope_contract');};
let database;
try {
 database=require('../electron/db/database.ts');
 const vaults=require('../electron/vaults/vaultRegistry.ts');
 const {mobileDeepResearchSource,mobileDeepResearchCorpusRevision,saveMobileDeepResearchReport}=require('../electron/desktopBridge/mobileDeepResearch.ts');
 const {resolveAcademicRunScope}=require('../electron/ai/researchCorpusRun.ts');
 const {withMobileCompletionReplay,mobileCompletionReply,hasMobileCompletionReplay,memoizedMobileSourceEmbedding}=require('../electron/ai/mobileCompletionReplay.ts');
 const {withMobileOperation}=require('../electron/desktopBridge/executionBoundary.ts');
 const model={provider:'openai',model:'gpt-4o'},request={objective:'Scoped report',model,deepResearchVersion:'v2',language:'es'},generationId='68029bdb-f7fc-48be-9f88-d4edcd014678';
 const input={stage:'snapshot',input:{brief:{kind:'deep_research',objective:request.objective,language:'es'}}};
 const vault=vaults.createVault('Isolated mobile Deep Research scope','academic');
 await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>withMobileOperation(async()=>{
  assert.equal(resolveAcademicRunScope().vaultId,vault.id,'Canonical scope must belong to the actual owning vault');
  await assert.rejects(mobileDeepResearchSource({request,generationId,expectedVaultId:'foreign-vault',...input,history:[],replies:{}}),/scope_conflict/);
  await assert.rejects(mobileDeepResearchSource({request,generationId,stage:'deleteVault',input:{},history:[],replies:{}}),/invalid_deep_research_source_request/);
  await assert.rejects(mobileDeepResearchSource({request:{...request,notebookId:'foreign-notebook'},generationId,...input,history:[],replies:{}}),/not_found|not_authorized|notebook|scope/i);
  const report={draft:{generatedAt:new Date().toISOString(),brief:{kind:'deep_research',objective:request.objective,language:'es'},selection:{ideas:[],themes:[],works:[],passages:[],gaps:[],contradictions:[],tutorRoutes:[]},title:'Actual isolated canonical save',abstract:'Summary',outline:[],draftMarkdown:'Actual complete authored report',matrix:[],bibliography:[],nextSteps:[],limitations:[]},meta:{}};
  const publication={request,source:{version:1,vaultId:vault.id,vaultType:'academic',revision:mobileDeepResearchCorpusRevision(request),sourceScope:'linked_corpus'},report,requestId:generationId};
  const saved=saveMobileDeepResearchReport(publication,'isolated-test-device');
  require('../electron/db/themesRepo.ts').getOrCreateTheme('Actual canonical corpus change after lost acknowledgement');
  assert.deepEqual(saveMobileDeepResearchReport(publication,'isolated-test-device'),saved,'Lost ACK returns same atomic receipt despite later corpus changes');
  assert.equal(database.getDb().prepare('SELECT COUNT(*) AS n FROM mobile_deep_research_publications').get().n,1);
  assert.throws(()=>saveMobileDeepResearchReport({...publication,report:{...report,draft:{...report.draft,title:'changed payload'}}},'isolated-test-device'),/idempotency_conflict/);
  assert.throws(()=>saveMobileDeepResearchReport({...publication,requestId:'78029bdb-f7fc-48be-9f88-d4edcd014678'},'isolated-test-device'),/source_conflict/);

 },['corpus','writing'])));
 // Complete guides must carry their canonical evidence sidecar into the same
 // durable publication; a receipt alone must never advertise missing evidence.
 const studyVault=vaults.createVault('Isolated mobile complete guide publication','estudio');
 await vaults.withOwningVault(studyVault.id,()=>database.withVaultDatabase(studyVault.id,()=>withMobileOperation(async()=>{
  const {normalizeCompleteGuideConfig}=require('../shared/completeGuide/types.ts');
  const {getCompleteGuideArtifacts}=require('../electron/db/completeGuideRepo.ts');
  const config=normalizeCompleteGuideConfig({version:1,runId:'cg-device-publication',webText:true,selection:{nodes:[{kind:'source',id:'document:owned-fixture'}],excludedSourceKeys:[]}});
  const {runId,...savedConfig}=config;
  const guideRequest={...request,completeGuide:config};
  const webRecord={url:'https://science.fixture.test/evidence',finalUrl:'https://science.fixture.test/evidence',title:'Actually captured web source',siteName:'Fixture science',domain:'science.fixture.test',byline:null,publishedAt:null,doi:null,kind:'html',pageNumber:null,heading:null,text:'Actual captured web evidence retained after download purge.',retrievedAt:'2026-10-15T12:00:00Z'};
  const webId=`web:${createHash('sha256').update(JSON.stringify([webRecord.finalUrl,webRecord.pageNumber,webRecord.text])).digest('hex')}`;
  const artifacts={runId,webPassages:[webRecord],items:[{id:'real-captured-item',statement:'Retained canonical evidence'}],chapters:[],syllabus:{title:'Actual captured plan'},sources:[],passages:[]};
  const report={draft:{generatedAt:new Date().toISOString(),brief:{kind:'deep_research',objective:request.objective,language:'es'},selection:{ideaIds:[],themeIds:[],workIds:[],passageIds:[],gapIds:[],contradictionIds:[],tutorRouteIds:[]},title:'Canonical complete guide',abstract:'Summary',outline:[],draftMarkdown:`Complete guide with [retained evidence](nodus://passage/${webId})`,matrix:[],bibliography:[],nextSteps:[],limitations:[],completeGuide:{version:1,runId,config:savedConfig}},meta:{},completeGuideArtifacts:artifacts};
  const publication={request:guideRequest,source:{version:1,vaultId:studyVault.id,vaultType:'estudio',revision:mobileDeepResearchCorpusRevision(guideRequest),sourceScope:'device_downloads'},report,requestId:'88029bdb-f7fc-48be-9f88-d4edcd014678'};
  assert.throws(()=>saveMobileDeepResearchReport({...publication,report:{...report,completeGuideArtifacts:undefined}},'guide-device'),/invalid_complete_guide_publication/);
  assert.equal(database.getDb().prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='mobile_deep_research_publications'").get().n,0,'Malformed guide is rejected before even preparing a publication table');
  const saved=saveMobileDeepResearchReport(publication,'guide-device');
  assert.equal(require('../electron/db/researchWebRepo.ts').getWebPassage(webId)?.text,webRecord.text,'Web citations resolve to the exact captured text, without fetching again');
  assert.deepEqual(getCompleteGuideArtifacts(saved.id),artifacts,'Canonical Mac reader can retrieve the actual published evidence');
  assert.deepEqual(saveMobileDeepResearchReport(publication,'guide-device'),saved,'Lost guide ACK does not duplicate draft or evidence');
  assert.equal(database.getDb().prepare('SELECT COUNT(*) AS n FROM complete_guide_artifacts').get().n,1);
 },['corpus','writing'])));
 const providers=require('../electron/ai/providers.ts'),secrets=require('../electron/secrets/secretStore.ts');
 const oldList=providers.listModels,oldKey=secrets.getApiKey;let catalogs=0,keyReads=0;
 providers.listModels=async()=>{catalogs++;return [{id:model.model}];};secrets.getApiKey=()=>{keyReads++;return 'test-only';};
 const {thinkingCatalogInfo}=require('../electron/ai/thinkingEffort.ts');
 await withMobileCompletionReplay('catalog-mobile',model,{},async()=>{assert.equal(await thinkingCatalogInfo(model),undefined);return 'done';});
 assert.equal(catalogs,0);assert.equal(keyReads,0,'Phone replay must not consult Mac credentials/catalogue');
 await thinkingCatalogInfo(model);assert.equal(catalogs,1,'Ordinary Desktop catalogue remains active');assert.equal(keyReads,1);
 providers.listModels=oldList;secrets.getApiKey=oldKey;
 const vectorMemo=new Map();let computations=0;const memo=async(key,work)=>{if(vectorMemo.has(key))return vectorMemo.get(key);const result=await work();vectorMemo.set(key,result);return result;};
 const query=()=>memoizedMobileSourceEmbedding({model:'owning-index',text:'actual query'},async()=>{computations++;return [0.25,0.5];});
 await withMobileCompletionReplay('vector-owning-request',model,{},query,memo);
 await withMobileCompletionReplay('vector-owning-request',model,{},query,memo);assert.equal(computations,1,'Source replay reuses durable query vector');
 await withMobileCompletionReplay('vector-other-request',model,{},query,memo);assert.equal(computations,2,'Another vault/request cannot borrow query vector');
 let release;const pause=new Promise(resolve=>release=resolve);
 const job=withMobileCompletionReplay('actual-vault+request-binding',model,{},async()=>{await pause;return mobileCompletionReply(model,{system:'canonical-system',user:'canonical-user',maxTokens:200},true,'off');});
 assert.equal(hasMobileCompletionReplay(),false,'Concurrent ordinary Desktop execution must not inherit the mobile host');
 assert.equal(mobileCompletionReply(model,{system:'ordinary',user:'ordinary'},true,'off'),undefined,'Normal transport is untouched outside the explicitly scoped host');
 release();const pending=await job;assert(pending.completion);assert.equal(pending.completion.model.provider,model.provider);
 const completed=await withMobileCompletionReplay('actual-vault+request-binding',model,{[pending.completion.id]:'{"canonical":"response"}'},async()=>mobileCompletionReply(model,{system:'canonical-system',user:'canonical-user',maxTokens:200},true,'off'));
 assert.equal(completed.value,'{"canonical":"response"}');
 await assert.rejects(withMobileCompletionReplay('actual-vault+request-binding',model,{[pending.completion.id]:'{"canonical":"response"}'},async()=>{
  try {return mobileCompletionReply(model,{system:'changed-canonical-system',user:'canonical-user',maxTokens:200},true,'off');}catch{return 'unsafe optional-stage fallback';}
 },undefined,[pending.completion.id]),/transcript_changed/,'A changed canonical prompt fails closed even if a stage catches the host error');
 const foreign=await withMobileCompletionReplay('other-vault+request-binding',model,{[pending.completion.id]:'{"canonical":"response"}'},async()=>mobileCompletionReply(model,{system:'canonical-system',user:'canonical-user',maxTokens:200},true,'off'));
 assert.notEqual(foreign.completion.id,pending.completion.id,'A reply is bound to its actual owning request/vault, not borrowed by another transcript');
 await assert.rejects(withMobileCompletionReplay('actual',model,{},async()=>mobileCompletionReply({provider:'anthropic',model:'fallback'}, {system:'same',user:'same'},true,'off')),/fallback_forbidden/);
 let child;
 await withMobileCompletionReplay('closed-child',model,{},async()=>{
  child=new Promise(resolve=>setTimeout(()=>{try{resolve(mobileCompletionReply(model,{system:'late',user:'late'},true,'off'));}catch(error){resolve(error);}},15));
  return 'finished';
 });
 assert.match((await child).message,/scope_closed/,'Late descendants remain blocked instead of falling back to the Mac');
 console.log('PASS isolated Deep Research scope contracts: actual vault/notebook rejection, typed stages, request-bound completion replay, concurrent Desktop separation, late-child denial, provider-free atomic SQLite publication/lost-ACK/CAS, per-request query-vector memo and no Mac credential/model fallback. No providers or HTTP E2E executed.');
}finally {database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
